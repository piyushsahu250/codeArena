const prisma = require("../prisma");
const { logAudit, AUDIT_ACTIONS } = require("./auditLog");

// Opt-in, off-by-default automatic Daily/Weekly Challenge publisher. Always covers the Global
// scope (instituteId=null, academicGroupId=null); additionally covers any Institute that has
// explicitly opted in via Institute.autoScheduleChallenges — this keeps the scheduler's blast
// radius bounded rather than auto-creating a row for every institute x academic-group on a
// multi-tenant platform. Institute/academic-group-specific challenges beyond that stay an
// admin-explicit action (see routes/challenges.js's admin scheduling routes, and the bulk-
// schedule action in ChallengeAdmin.jsx).
//
// Uses an HOURLY idempotent check-and-create tick rather than a precise 24h timer (unlike
// aiRefreshScheduler.js) — a 24h `setInterval` measured from process-boot time drifts away from
// midnight and isn't resilient to a free-tier container restarting mid-day. Worst case here is up
// to a 1-hour publish delay after midnight/Monday, never a missed day — each tick just checks
// "does today's/this-week's row already exist for this scope" via the DB unique constraint and
// only creates one if not.

function dayStart(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function isoWeekStart(d) {
  const x = dayStart(d);
  const day = x.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

async function resolveActiveScopes() {
  const optedInInstitutes = await prisma.institute.findMany({
    where: { autoScheduleChallenges: true, isActive: true },
    select: { id: true },
  });
  return [
    { instituteId: null, academicGroupId: null },
    ...optedInInstitutes.map((i) => ({ instituteId: i.id, academicGroupId: null })),
  ];
}

// Progressively relaxes: recency exclusion -> topic-diversity preference -> difficulty rotation
// -> (empty pool) skip this scope this tick, retry next hour. Logged the same way pickQuestions()
// in interview.js logs its usedFallback, for the same reasoning: a repeat/off-rotation question
// beats no challenge at all.
async function pickChallengeQuestion({ kind, scope, asOf }) {
  const model = kind === "DAILY" ? prisma.dailyChallenge : prisma.weeklyChallenge;
  const dateField = kind === "DAILY" ? "date" : "weekStart";
  const lookbackMs = kind === "DAILY"
    ? Math.max(1, Number(process.env.DAILY_CHALLENGE_LOOKBACK_DAYS) || 30) * 24 * 60 * 60 * 1000
    : Math.max(1, Number(process.env.WEEKLY_CHALLENGE_LOOKBACK_WEEKS) || 8) * 7 * 24 * 60 * 60 * 1000;
  const since = new Date(asOf.getTime() - lookbackMs);

  const recent = await model.findMany({
    where: { [dateField]: { gte: since, lt: asOf }, instituteId: scope.instituteId, academicGroupId: scope.academicGroupId },
    select: { questionId: true, question: { select: { topic: true } } },
    orderBy: { [dateField]: "desc" },
  });
  const recentQuestionIds = recent.map((r) => r.questionId);
  const recentTopics = new Set(recent.slice(0, 5).map((r) => r.question?.topic).filter(Boolean));

  // Simple day-of-cycle difficulty rotation — Daily leans easier early in a 7-day cycle, harder
  // later; Weekly (a capstone, not a daily warm-up) alternates MEDIUM/HARD.
  const dayIndex = Math.floor(asOf.getTime() / (24 * 60 * 60 * 1000));
  const dailyCycle = ["EASY", "EASY", "MEDIUM", "MEDIUM", "HARD", "MEDIUM", "EASY"];
  const weeklyCycle = ["MEDIUM", "HARD"];
  const targetDifficulty = kind === "DAILY" ? dailyCycle[dayIndex % dailyCycle.length] : weeklyCycle[dayIndex % weeklyCycle.length];

  const baseWhere = { questionType: "CODING" };
  const attempts = [
    { ...baseWhere, difficulty: targetDifficulty, id: { notIn: recentQuestionIds } },
    { ...baseWhere, id: { notIn: recentQuestionIds } },
    { ...baseWhere, difficulty: targetDifficulty },
    { ...baseWhere },
  ];

  for (let i = 0; i < attempts.length; i++) {
    let pool = await prisma.question.findMany({ where: attempts[i], select: { id: true, topic: true } });
    if (i < 2 && recentTopics.size > 0) {
      const diversified = pool.filter((q) => !recentTopics.has(q.topic));
      if (diversified.length > 0) pool = diversified;
    }
    if (pool.length > 0) {
      if (i > 0) console.warn(`[challengeScheduler] pickChallengeQuestion relaxed to attempt ${i} for ${kind} scope ${JSON.stringify(scope)}`);
      return pool[Math.floor(Math.random() * pool.length)].id;
    }
  }
  return null;
}

async function runOnce() {
  const scopes = await resolveActiveScopes();
  const today = dayStart(new Date());
  const thisWeek = isoWeekStart(new Date());
  let dailyCreated = 0;
  let weeklyCreated = 0;

  for (const scope of scopes) {
    try {
      const existingDaily = await prisma.dailyChallenge.findUnique({
        where: { date_instituteId_academicGroupId: { date: today, instituteId: scope.instituteId, academicGroupId: scope.academicGroupId } },
      });
      if (!existingDaily) {
        const questionId = await pickChallengeQuestion({ kind: "DAILY", scope, asOf: today });
        if (questionId) {
          await prisma.dailyChallenge.create({ data: { date: today, questionId, instituteId: scope.instituteId, academicGroupId: scope.academicGroupId } });
          dailyCreated++;
        } else {
          console.warn(`[challengeScheduler] No eligible CODING question found for daily scope ${JSON.stringify(scope)}`);
        }
      }
    } catch (err) {
      console.error(`[challengeScheduler] Daily publish failed for scope ${JSON.stringify(scope)}:`, err.message);
    }

    try {
      const existingWeekly = await prisma.weeklyChallenge.findUnique({
        where: { weekStart_instituteId_academicGroupId: { weekStart: thisWeek, instituteId: scope.instituteId, academicGroupId: scope.academicGroupId } },
      });
      if (!existingWeekly) {
        const questionId = await pickChallengeQuestion({ kind: "WEEKLY", scope, asOf: thisWeek });
        if (questionId) {
          await prisma.weeklyChallenge.create({ data: { weekStart: thisWeek, questionId, instituteId: scope.instituteId, academicGroupId: scope.academicGroupId } });
          weeklyCreated++;
        } else {
          console.warn(`[challengeScheduler] No eligible CODING question found for weekly scope ${JSON.stringify(scope)}`);
        }
      }
    } catch (err) {
      console.error(`[challengeScheduler] Weekly publish failed for scope ${JSON.stringify(scope)}:`, err.message);
    }
  }

  await logAudit({ action: AUDIT_ACTIONS.CHALLENGE_AUTO_SCHEDULE_RUN, details: { dailyCreated, weeklyCreated, scopeCount: scopes.length } });
  return { dailyCreated, weeklyCreated, scopeCount: scopes.length };
}

// Called once from index.js at boot. Deliberately does NOT run immediately on startup, same
// reasoning as aiRefreshScheduler.js — the first check happens intervalMs after the process comes
// up, so enabling this flag doesn't race a fresh deploy's own migration/seed steps.
function startChallengeScheduler() {
  if (process.env.ENABLE_CHALLENGE_SCHEDULER !== "true") return;

  const intervalMs = Math.max(60 * 1000, Number(process.env.CHALLENGE_SCHEDULER_INTERVAL_MS) || 60 * 60 * 1000);
  console.log(`Challenge scheduler enabled — running every ${intervalMs}ms.`);
  setInterval(() => {
    runOnce().catch((err) => console.error("Challenge scheduler run failed:", err));
  }, intervalMs);
}

module.exports = { startChallengeScheduler, runOnce, pickChallengeQuestion };
