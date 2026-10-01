const prisma = require("../prisma");
const { gradePendingCodingSubmissions } = require("./gradeAttempt");
const { processGamification } = require("./gamification");

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
  for (const attempt of candidates) {
    try {
      await gradePendingCodingSubmissions(attempt.id);
      const claim = await prisma.testAttempt.updateMany({
        where: { id: attempt.id, status: "IN_PROGRESS" },
        data: { status: "AUTO_SUBMITTED", submittedAt: new Date() },
      });
      if (claim.count > 0) {
        finalized++;
        processGamification(attempt.studentId, {
          xpActivities: ["TEST_COMPLETE"], xpMeta: { attemptId: attempt.id }, streakEligible: true,
        }).catch((e) => console.error("[testAttemptAutoFinalizeScheduler] gamification failed", e));
      }
    } catch (err) {
      failed++;
      console.error(`[testAttemptAutoFinalizeScheduler] Failed to finalize attempt ${attempt.id}:`, err.message);
    }
  }
  return { candidateCount: candidates.length, finalized, failed };
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

module.exports = { startTestAttemptAutoFinalizeScheduler, runOnce };
