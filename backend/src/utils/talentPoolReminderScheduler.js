const prisma = require("../prisma");
const { notifyDeadlineReminder } = require("./notifications");

// Opt-in, off-by-default deadline-reminder sweep — mirrors aiRefreshScheduler.js's exact pattern
// (env-gated, setInterval-driven, never runs on a fresh/default deploy). This is the only Talent
// Pool notification event that genuinely needs a clock rather than firing as a route side-effect
// — add/remove/assessment-assigned/results-published all happen synchronously inside their own
// routes; a deadline approaching has no request to hang off of.
async function runOnce() {
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 3600 * 1000);

  const upcoming = await prisma.talentPoolTest.findMany({
    where: { reminderSentAt: null, test: { startTime: { gte: now, lte: in48h } } },
    include: {
      test: { select: { id: true, title: true, startTime: true } },
      pool: { select: { id: true, name: true, members: { include: { student: { select: { id: true, name: true, email: true } } } } } },
    },
  });

  let remindersSent = 0;
  for (const link of upcoming) {
    for (const member of link.pool.members) {
      await notifyDeadlineReminder(prisma, member.student, link.pool, link.test.title, link.test.startTime).catch((err) =>
        console.error(`Talent Pool reminder failed for student ${member.student.id}:`, err.message)
      );
      remindersSent += 1;
    }
    // Stamped once per link regardless of per-member send failures above (best-effort side
    // channel, same posture as every other notification write) — this is idempotency against
    // re-sending the whole batch next sweep, not a delivery guarantee for each member.
    await prisma.talentPoolTest.update({ where: { id: link.id }, data: { reminderSentAt: now } }).catch(() => {});
  }

  return { linksProcessed: upcoming.length, remindersSent };
}

function startTalentPoolReminderScheduler() {
  if (process.env.ENABLE_TALENT_POOL_REMINDERS !== "true") return;

  const intervalMs = Math.max(60 * 1000, Number(process.env.TALENT_POOL_REMINDER_INTERVAL_MS) || 60 * 60 * 1000);
  console.log(`Talent Pool reminder scheduler enabled — running every ${intervalMs}ms.`);
  setInterval(() => {
    runOnce().catch((err) => console.error("Talent Pool reminder sweep failed:", err));
  }, intervalMs);
}

module.exports = { startTalentPoolReminderScheduler, runOnce };
