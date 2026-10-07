const prisma = require("../prisma");
const { gradePendingCodingSubmissions } = require("./gradeAttempt");
const { processGamification } = require("./gamification");
const { logAudit, AUDIT_ACTIONS } = require("./auditLog");

// Finalize is normally driven entirely client-side (TestTaking.jsx's countdown calls
// POST /finalize when it hits zero) or by the 3-strike violation handler in tests.js. Neither
// path runs if a student closes the tab, loses connection, or the browser crashes before their
// own deadline — nothing server-side ever revisits that attempt afterward, so it sits at
// IN_PROGRESS forever (confirmed live in production, 2026-10-01: a TCS Codevita 9 attempt with
// zero submissions still showed IN_PROGRESS 8+ hours after the test's own endTime). This tick
// is the missing enforcement: it finds every IN_PROGRESS attempt whose test has fully closed
// (Test.endTime passed — the hard outer boundary every student shares, unlike the per-student
// startedAt+durationMin deadline that finalize.js's deadlineOf() checks) and closes it out the
// same way a late finalize call would.
async function runOnce() {
  const candidates = await prisma.testAttempt.findMany({
    where: { status: "IN_PROGRESS", test: { endTime: { lt: new Date() } } },
    select: { id: true, studentId: true },
  });

  let finalized = 0, failed = 0;
  const finalizedAttemptIds = [];
  for (const attempt of candidates) {
    try {
      await gradePendingCodingSubmissions(attempt.id);
      const claim = await prisma.testAttempt.updateMany({
        where: { id: attempt.id, status: "IN_PROGRESS" },
        data: { status: "AUTO_SUBMITTED", submittedAt: new Date() },
      });
      if (claim.count > 0) {
        finalized++;
        finalizedAttemptIds.push(attempt.id);
        processGamification(attempt.studentId, {
          xpActivities: ["TEST_COMPLETE"], xpMeta: { attemptId: attempt.id }, streakEligible: true,
        }).catch((e) => console.error("[testAttemptAutoFinalizeScheduler] gamification failed", e));
      }
    } catch (err) {
      failed++;
      console.error(`[testAttemptAutoFinalizeScheduler] Failed to finalize attempt ${attempt.id}:`, err.message);
    }
  }
  // One audit row per run that actually changed anything (not one per attempt, and nothing at all
  // on an idle tick -- this runs every 5 minutes forever). Mirrors TEST_SCHEDULED_PUBLISH: the
  // other scheduler that mutates records with no human actor, so the change is attributable and
  // an admin investigating "why did this attempt flip to AUTO_SUBMITTED" has an answer.
  if (finalized > 0) {
    await logAudit({
      action: AUDIT_ACTIONS.TEST_ATTEMPTS_AUTO_FINALIZED, actorName: "Auto-Finalize Scheduler",
      details: { finalized, failed, attemptIds: finalizedAttemptIds.slice(0, 100) },
    });
  }
  const readiness = await sweepExpiredReadinessAssessments().catch((err) => {
    console.error("[testAttemptAutoFinalizeScheduler] readiness sweep failed:", err.message);
    return { closed: 0 };
  });
  await pruneExamSecurityEvents().catch((err) => console.error("[testAttemptAutoFinalizeScheduler] security-event retention failed:", err.message));
  const secureSweep = await require("../routes/secureExam").sweepLostSecureSessions().catch((err) => { console.error("[testAttemptAutoFinalizeScheduler] secure-session sweep failed:", err.message); return { submitted: 0 }; });
  const sessions = await expireStaleLoginSessions().catch((err) => { console.error("[testAttemptAutoFinalizeScheduler] session expiry failed:", err.message); return { expired: 0 }; });
  return { candidateCount: candidates.length, finalized, failed, readinessClosed: readiness.closed, sessionsExpired: sessions.expired };
}


// Retention for exam-security evidence (docs/EXAM_SECURITY.md): rows older than EXAM_SECURITY_RETENTION_DAYS (default 180)
// are deleted, at most once an hour, in bounded batches, so the table cannot grow without limit.
let lastSecurityPrune = 0;
async function pruneExamSecurityEvents({ force = false } = {}) {
  if (!force && Date.now() - lastSecurityPrune < 60 * 60 * 1000) return;
  lastSecurityPrune = Date.now();
  const days = Math.max(30, Number(process.env.EXAM_SECURITY_RETENTION_DAYS) || 180);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await prisma.examSecurityEvent.deleteMany({ where: { createdAt: { lt: cutoff }, reviewStatus: { notIn: ["ESCALATED"] } } });
  await prisma.secureExamSession.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

// Login tokens live 12h (sessions.js TOKEN_TTL), after which the JWT itself is rejected -- but nothing
// ever flipped the matching LoginSession row to inactive when a student simply closed the tab and never
// logged out, so rows accumulated as isActive=true forever (5,052 of them were over 7 days old on
// 2026-10-06). They could not authenticate anyone, but they inflated every "active sessions" count
// (staff/clerk management, monitoring) and grew the table without bound. Closing rows older than the
// token TTL plus a 1h margin is exactly what expiry already means.
async function expireStaleLoginSessions() {
  const cutoff = new Date(Date.now() - 13 * 60 * 60 * 1000);
  const r = await prisma.loginSession.updateMany({ where: { isActive: true, loginAt: { lt: cutoff } }, data: { isActive: false, logoutAt: new Date() } });
  return { expired: r.count };
}
// Readiness assessments have no outer test window, only a per-attempt startedAt+durationMin deadline,
// and (like Formal Tests above) depend on the client to submit. A closed tab leaves them IN_PROGRESS
// forever -- which also blocks the student from starting a fresh attempt on that subject/mode.
// A 2-minute grace after the deadline lets a legitimately in-flight client submit land first.
async function sweepExpiredReadinessAssessments() {
  const { completeReadinessAssessment, readinessDeadlineOf } = require("./readinessCompletion");
  const grace = 2 * 60 * 1000;
  const open = await prisma.readinessAssessment.findMany({
    where: { status: "IN_PROGRESS", startedAt: { lt: new Date(Date.now() - grace) } },
    select: { id: true, startedAt: true, durationMin: true },
    take: 200,
  });
  const expired = open.filter((a) => Date.now() > readinessDeadlineOf(a) + grace);
  let closed = 0;
  for (const a of expired) {
    try {
      const r = await completeReadinessAssessment(a.id);
      if (r && !r.alreadyCompleted) closed++;
    } catch (err) {
      console.error(`[testAttemptAutoFinalizeScheduler] Failed to close readiness assessment ${a.id}:`, err.message);
    }
  }
  return { closed };
}

// Off by default like every other background scheduler on this platform — see
// testScheduledPublishScheduler.js's identical reasoning.
function startTestAttemptAutoFinalizeScheduler() {
  if (process.env.ENABLE_TEST_ATTEMPT_AUTO_FINALIZE !== "true") return;

  const intervalMs = Math.max(60 * 1000, Number(process.env.TEST_ATTEMPT_AUTO_FINALIZE_INTERVAL_MS) || 5 * 60 * 1000);
  console.log(`Test attempt auto-finalize scheduler enabled — running every ${intervalMs}ms.`);
  setInterval(() => {
    runOnce().catch((err) => {
      console.error("Test attempt auto-finalize scheduler run failed:", err);
      require("./metrics").recordProcessError(err, "testAttemptAutoFinalizeScheduler");
    });
  }, intervalMs);
}

module.exports = { startTestAttemptAutoFinalizeScheduler, runOnce, pruneExamSecurityEvents };
