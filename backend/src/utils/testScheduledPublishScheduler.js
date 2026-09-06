const prisma = require("../prisma");
const { logAudit, AUDIT_ACTIONS } = require("./auditLog");
const { notifyTestAssigned } = require("./notifications");
const { getTestRecipients } = require("./testEligibility");
const { validateTestForPublish, TEST_PUBLISH_VALIDATION_INCLUDE } = require("./testPublishValidation");

// Scheduled Publishing (platform-maturity roadmap item, paired with the manual "Send Notification"
// fix) — an admin/staff sets Test.scheduledPublishAt instead of having to be at their keyboard at
// the exact moment a test should go live. This tick finds every unpublished test whose scheduled
// time has passed and runs the EXACT same publish path a manual click does: same validation
// (testPublishValidation.js, shared with routes/tests.js's PATCH /:id/publish so the two can never
// drift), same in-app-only notification (never auto-email — see notifyTestAssigned's own "stop
// automatic email for every test" comment).
//
// A test that fails validation at its scheduled moment (e.g. someone removed all its questions
// after scheduling it) is left alone — scheduledPublishAt stays set and this tick just retries it
// again next time, since the underlying problem might get fixed before the exam window opens. It's
// logged once per tick to the console/metrics feed, not to AuditLog every 5 minutes forever, so a
// long-broken schedule doesn't spam the admin audit trail.

async function runOnce() {
  const due = await prisma.test.findMany({
    where: { isPublished: false, scheduledPublishAt: { lte: new Date() } },
    include: TEST_PUBLISH_VALIDATION_INCLUDE,
  });

  let published = 0, skipped = 0;
  for (const test of due) {
    try {
      const problems = validateTestForPublish(test);
      if (problems.length > 0) {
        skipped++;
        console.warn(`[testScheduledPublishScheduler] Test ${test.id} ("${test.title}") is past its scheduled publish time but still fails validation: ${problems.join("; ")}`);
        continue;
      }
      const updated = await prisma.test.update({
        where: { id: test.id },
        data: { isPublished: true, scheduledPublishAt: null },
      });
      published++;
      await logAudit({
        action: AUDIT_ACTIONS.TEST_SCHEDULED_PUBLISH, actorName: "Scheduled Publish",
        instituteId: test.instituteId, details: { testId: test.id, title: test.title },
      });
      // Same in-app-only posture as the manual publish route -- never auto-email.
      getTestRecipients(prisma, test.id)
        .then((students) => notifyTestAssigned(prisma, students, updated))
        .catch((err) => console.error(`[testScheduledPublishScheduler] notification failed for test ${test.id}:`, err));
    } catch (err) {
      console.error(`[testScheduledPublishScheduler] Failed to publish test ${test.id}:`, err.message);
    }
  }
  return { published, skipped, dueCount: due.length };
}

// Called once from index.js at boot. Off by default like every other background scheduler on this
// platform (challengeScheduler.js, talentPoolReminderScheduler.js, aiRefreshScheduler.js) --
// deliberately does NOT run immediately on startup, same reasoning as those: the first check
// happens intervalMs after the process comes up, so enabling this doesn't race a fresh deploy's
// own migration/seed steps.
function startTestScheduledPublishScheduler() {
  if (process.env.ENABLE_TEST_SCHEDULED_PUBLISH !== "true") return;

  const intervalMs = Math.max(60 * 1000, Number(process.env.TEST_SCHEDULED_PUBLISH_INTERVAL_MS) || 5 * 60 * 1000);
  console.log(`Test scheduled-publish scheduler enabled — running every ${intervalMs}ms.`);
  setInterval(() => {
    runOnce().catch((err) => {
      console.error("Test scheduled-publish scheduler run failed:", err);
      require("./metrics").recordProcessError(err, "testScheduledPublishScheduler");
    });
  }, intervalMs);
}

module.exports = { startTestScheduledPublishScheduler, runOnce };
