const prisma = require("../prisma");
const { sendMail, retryEmailLogged, wrapBranded } = require("./mailer");
const { sessionTypeLabel } = require("../routes/interview");

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";

// Automatically retries FAILED EmailLog rows -- previously there was no automated retry at all,
// only a manual per-row "Retry" button on the admin Email Logs page (confirmed by audit,
// 2026-10-01). A real incident earlier the same day (a transient Gmail SMTP block) self-resolved
// before anyone noticed, but had it lasted longer, every failed send -- credentials, password
// resets, notifications -- would have sat silently FAILED until an admin happened to look.
//
// Deliberately narrow scope: sendMailLogged never persists the rendered email body (confirmed in
// mailer.js), so a retry can only ever work by re-fetching CURRENT data and rebuilding the email
// from scratch, not literally resending what was queued before. That's safe and exact for a type
// whose content is just a reference to a permanent, non-secret record (a link the student can
// always reach again) -- but NOT safe to do blindly for a type whose content is itself a one-time
// secret:
//   - CREDENTIALS / CREDENTIALS_RESEND: the plaintext password is never stored anywhere (hashed
//     immediately) -- "retrying" would mean silently generating a NEW password and overwriting the
//     student's real one, which is a materially different, surprising action, not a retry.
//   - PASSWORD_RESET / EMAIL_VERIFICATION: same shape of problem -- only a one-way hash of the
//     token is stored (see routes/auth.js's resetTokenHash), so the original link can't be
//     reconstructed; minting a fresh one on an automated retry invalidates the original, which is
//     low-risk but still a real side effect this scheduler shouldn't take unsupervised.
//   - LOGIN_ALERT: no stored reference back to which login event triggered it at all.
//   - SYSTEM_ANNOUNCEMENT / OTHER_SYSTEM_EMAIL / TEST_ASSIGNED / COURSE_ASSIGNED: not yet audited
//     for a safe, idempotent rebuild path -- left alone rather than guessed at.
// Every one of those stays exactly as it works today: visible as FAILED, retried only by an admin
// clicking Retry. Only INTERVIEW_REPORT_READY is handled here, because its content is provably
// just {student name/email, session type, score, a permanent report link} -- all re-fetchable,
// none secret, rebuilding it twice produces byte-identical output. sessionTypeLabel is imported
// from routes/interview.js (not re-implemented here) so the two can never drift apart -- see that
// file's own export comment.
const AUTO_RETRYABLE_TYPES = ["INTERVIEW_REPORT_READY"];

async function rebuildInterviewReportReady(log) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: log.sourceId },
    include: { report: true, student: { select: { name: true, email: true } } },
  });
  if (!session || !session.report || !session.student?.email) {
    return { ok: false, error: "Source interview session, report, or student no longer exists" };
  }
  const html = wrapBranded(`
    <p>Hi ${session.student.name},</p>
    <p>Your ${sessionTypeLabel(session)} interview has been evaluated.</p>
    <p><strong>Overall Score: ${session.report.overallScore}%</strong></p>
    <p>Log in to view your full report, question-by-question feedback, and improvement suggestions at <a href="${FRONTEND_URL}/interview/report/${session.id}">${FRONTEND_URL}</a>.</p>
    <p>Regards,<br/>CodeArena Team</p>
  `);
  return sendMail({ to: session.student.email, subject: "Your AI Mock Interview Report is Ready", html });
}

const REBUILDERS = { INTERVIEW_REPORT_READY: rebuildInterviewReportReady };

async function runOnce() {
  const candidates = await prisma.emailLog.findMany({
    where: { status: "FAILED", emailType: { in: AUTO_RETRYABLE_TYPES }, sourceId: { not: null }, retryCount: { lt: Number(process.env.MAX_EMAIL_RETRIES) || 5 } },
    take: 50, // safety cap per tick, matching testAttemptAutoFinalizeScheduler's own convention
  });

  let retried = 0, stillFailed = 0, skipped = 0;
  for (const log of candidates) {
    const rebuild = REBUILDERS[log.emailType];
    if (!rebuild) { skipped++; continue; } // should be unreachable given the query filter, kept as a safety net
    try {
      const result = await retryEmailLogged(prisma, log.id, () => rebuild(log));
      if (result.ok) retried++;
      else stillFailed++;
    } catch (err) {
      stillFailed++;
      console.error(`[emailRetryScheduler] Failed to retry EmailLog ${log.id}:`, err.message);
    }
  }
  return { candidateCount: candidates.length, retried, stillFailed, skipped };
}

// Off by default like every other background scheduler on this platform.
function startEmailRetryScheduler() {
  if (process.env.ENABLE_EMAIL_AUTO_RETRY !== "true") return;

  const intervalMs = Math.max(60 * 1000, Number(process.env.EMAIL_AUTO_RETRY_INTERVAL_MS) || 10 * 60 * 1000);
  console.log(`Email auto-retry scheduler enabled — running every ${intervalMs}ms.`);
  setInterval(() => {
    runOnce().catch((err) => {
      console.error("Email auto-retry scheduler run failed:", err);
      require("./metrics").recordProcessError(err, "emailRetryScheduler");
    });
  }, intervalMs);
}

module.exports = { startEmailRetryScheduler, runOnce };
