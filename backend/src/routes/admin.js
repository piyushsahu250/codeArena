const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { getSnapshot } = require("../utils/metrics");
const { getQueueStatus } = require("../utils/queue");
const { getQueueStatus: getAiQueueStatus } = require("../utils/aiQueue");
const { cached } = require("../utils/cache");
const { sendMail, sendMailLogged, retryEmailLogged, wrapBranded, MAX_EMAIL_RETRIES } = require("../utils/mailer");
const { credentialsResendTemplate } = require("../utils/emailTemplates");
const { generateTempPassword, recordPasswordChange } = require("../utils/password");
const { revokeAllSessions } = require("../utils/sessions");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const geminiProvider = require("../services/ai/geminiProvider");
const aiRateLimits = require("../services/ai/rateLimits");

const router = express.Router();

// ADMIN/SUPER_ADMIN/INSTITUTE_ADMIN: dashboard summary stats — 16 counts on every admin dashboard
// load, cached briefly since none of these need to be second-by-second accurate on a summary card.
//
// Institute-scoped for INSTITUTE_ADMIN (and any institute-scoped legacy ADMIN) — previously this
// counted platform-wide unconditionally regardless of caller, which was harmless while only
// platform-level accounts could reach this route, but became a real bug the moment an
// institute-scoped role was let in: an Institute Admin would have seen every OTHER institute's
// totals mixed into their own dashboard, violating the "dashboard must be calculated from that
// institute's data" requirement. Course/PracticeQuestion counts stay unscoped on purpose — that
// content has no instituteId at all (see docs/INSTITUTE_ADMIN_ROLLOUT.md), it's genuinely global,
// same total for every caller. Cache key includes requesterInstituteId so two different
// institutes' admins never share one institute's cached numbers.
router.get("/stats", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId;
    const stats = await cached(`admin:stats:${instituteId || "all"}`, 60 * 1000, async () => {
      const now = new Date();
      const [
        totalInstitutes, totalClasses, totalUsers, totalStudents, totalStaff,
        totalTests, totalQuestions, activeTests, scheduledTests, completedTests,
        totalCourses, totalPracticeQuestions, certificatesIssued, interviewCertificatesIssued,
        totalAcademicGroups, studentsUnlinkedFromAcademicGroup,
      ] = await Promise.all([
        instituteId ? Promise.resolve(1) : prisma.institute.count(),
        prisma.class.count({ where: instituteId ? { instituteId } : {} }),
        prisma.user.count({ where: instituteId ? { instituteId } : {} }),
        prisma.user.count({ where: { role: "STUDENT", ...(instituteId ? { instituteId } : {}) } }),
        prisma.user.count({ where: { role: "STAFF", ...(instituteId ? { instituteId } : {}) } }),
        prisma.test.count({ where: instituteId ? { instituteId } : {} }),
        prisma.question.count({ where: instituteId ? { instituteId } : {} }),
        prisma.test.count({ where: { isPublished: true, startTime: { lte: now }, endTime: { gte: now }, ...(instituteId ? { instituteId } : {}) } }),
        prisma.test.count({ where: { isPublished: true, startTime: { gt: now }, ...(instituteId ? { instituteId } : {}) } }),
        prisma.test.count({ where: { isPublished: true, endTime: { lt: now }, ...(instituteId ? { instituteId } : {}) } }),
        prisma.course.count(),
        prisma.practiceQuestion.count(),
        prisma.certificate.count({ where: instituteId ? { student: { instituteId } } : {} }),
        prisma.interviewCertificate.count({ where: instituteId ? { student: { instituteId } } : {} }),
        // Institute->Batch->Department->Section migration visibility (see
        // backend/scripts/migrateAcademicGroups.js) — surfaced here so the zero-data-loss gate is
        // checkable at a glance from the dashboard that's already loaded, no separate API call needed.
        prisma.academicGroup.count({ where: instituteId ? { instituteId } : {} }),
        prisma.user.count({ where: { role: "STUDENT", classId: { not: null }, academicGroupId: null, ...(instituteId ? { instituteId } : {}) } }),
      ]);

      return {
        totalInstitutes, totalClasses, totalUsers, totalStudents, totalStaff,
        totalTests, totalQuestions, activeTests, scheduledTests, completedTests,
        totalCourses, totalPracticeQuestions, certificatesIssued: certificatesIssued + interviewCertificatesIssued,
        totalAcademicGroups, studentsUnlinkedFromAcademicGroup,
      };
    });

    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// Shared by the audit route below — same "mandatory field" set the admin CRUD routes already
// enforce at creation time (2 visible / 5 hidden test cases, description, etc., see
// moduleCoding.js/questions.js/learning.js/interview.js's own validation) plus a few fields those
// routes leave optional but a genuinely complete question should still have (inputFormat,
// outputFormat, constraints, tags, starter code). Deliberately read-only and non-destructive: this
// only reports what's missing, it never invents content to fill the gap — an admin who hasn't
// reviewed a question shouldn't have Claude-authored placeholder text silently attributed to them.
// The hidden-test minimum was lowered platform-wide from 10 to 5 (explicit product decision, not a
// bug fix) — the 138 existing questions authored under the old 10-minimum are unaffected and keep
// every one of their existing hidden cases; this only changes what's required of NEW ones.
function auditQuestion(q) {
  const missing = [];
  if (!q.title || !String(q.title).trim()) missing.push("title");
  if (!q.description && !q.prompt) missing.push("description");
  if (!q.inputFormat) missing.push("inputFormat");
  if (!q.outputFormat) missing.push("outputFormat");
  if (!q.constraints) missing.push("constraints");
  if (!Array.isArray(q.tags) || q.tags.length === 0) missing.push("tags");
  const testCases = Array.isArray(q.testCases) ? q.testCases : [];
  const visible = testCases.filter((tc) => !tc.isHidden).length;
  const hidden = testCases.filter((tc) => tc.isHidden).length;
  if (visible < 2) missing.push(`visible test cases (has ${visible}, needs 2)`);
  if (hidden < 5) missing.push(`hidden test cases (has ${hidden}, needs 5)`);
  const hasStarter = (q.starterCodeByLanguage && Object.keys(q.starterCodeByLanguage).length > 0) || !!q.starterCode;
  if (!hasStarter) missing.push("starter code");
  if (q.evaluationType === "FUNCTION" && !q.functionSignature) missing.push("function signature");
  return missing;
}

// ADMIN: read-only completeness report across every coding question on the platform (Question,
// PracticeQuestion, InterviewQuestion) — flags which mandatory fields each one is missing, so an
// admin can find and fix incomplete questions instead of discovering them one at a time when a
// student hits a confusing gap. Never writes anything.
router.get("/question-audit", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const [questions, practiceQuestions, interviewQuestions] = await Promise.all([
      prisma.question.findMany({ where: { questionType: "CODING" }, include: { testCases: true } }),
      prisma.practiceQuestion.findMany({ where: { type: "CODING" } }),
      prisma.interviewQuestion.findMany({ where: { category: "CODING" } }),
    ]);

    const items = [];
    for (const [rows, source] of [[questions, "Question"], [practiceQuestions, "PracticeQuestion"], [interviewQuestions, "InterviewQuestion"]]) {
      for (const q of rows) {
        const missingFields = auditQuestion(q);
        if (missingFields.length > 0) {
          items.push({ id: q.id, source, title: q.title || (q.description || q.prompt || "").slice(0, 60) || "(untitled)", missingFields });
        }
      }
    }

    res.json({
      summary: { totalScanned: questions.length + practiceQuestions.length + interviewQuestions.length, incompleteCount: items.length },
      items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to run question audit" });
  }
});

// Shared where-builder for the email-logs list route below — mirrors the buildAdminChallengeWhere
// pattern already established in challenges.js (status + free-text search + exact match filters).
function buildEmailLogWhere({ status, type, q, from, to, batchId }) {
  const where = {};
  if (status && ["PENDING", "SENT", "FAILED", "RETRYING"].includes(status)) where.status = status;
  if (type) where.emailType = type;
  if (batchId) where.batchId = batchId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { recipientName: { contains: q, mode: "insensitive" } },
      { recipientEmail: { contains: q, mode: "insensitive" } },
      { student: { registrationNumber: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

// ADMIN: outbound email delivery log — every welcome/password-reset send attempt, with real
// provider-confirmed status (never inferred). Filterable by status/type/date-range/batch, plus a
// free-text search across recipient name/email/registration number, page/pageSize paginated
// (previously a hard 300-row cap with no way to see older entries).
router.get("/email-logs", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = buildEmailLogWhere(req.query);
    // Scoped on EmailLog's own instituteId column (not the student relation) so rows with no
    // studentId — e.g. POST /email-logs/test — are still correctly attributed and visible to the
    // institute that sent them, not just to a platform-wide admin. Without this scoping at all,
    // any institute-scoped ADMIN could list (and, via the retry route below, act on) every other
    // institute's outbound account/password-reset emails — see reset-password's identical
    // requesterInstituteId check in users.js for the established pattern this mirrors.
    if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, studentId: true, recipientName: true, recipientEmail: true, emailType: true,
          status: true, errorMessage: true, messageId: true, retryCount: true, batchId: true, createdAt: true, sentAt: true,
        },
      }),
      prisma.emailLog.count({ where }),
    ]);
    res.json({ rows: logs, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load email logs" });
  }
});

// ADMIN: live counts for one bulk-send batch (bulk-upload / bulk-regenerate-password), keyed by
// the batchId those routes return immediately in their response — since credential emails for a
// batch now send in the background after that response, the frontend polls this cheap groupBy
// to show a live sent/failed summary instead of a number that was only ever true at request time.
router.get("/email-logs/batch/:batchId/summary", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = { batchId: req.params.batchId };
    if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
    const counts = await prisma.emailLog.groupBy({
      by: ["status"],
      where,
      _count: { status: true },
    });
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count.status]));
    const queued = counts.reduce((sum, c) => sum + c._count.status, 0);
    res.json({
      queued,
      sent: byStatus.SENT || 0,
      failed: byStatus.FAILED || 0,
      pending: (byStatus.PENDING || 0) + (byStatus.RETRYING || 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load batch summary" });
  }
});

// ADMIN: whether the mail transport is actually configured, plus cheap delivery-health
// aggregates — never echoes MAIL_PASSWORD or any secret, only presence/absence.
router.get("/email-logs/status", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const connected = !!(process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASSWORD);
    const [lastSent, failedCount, queuedCount] = await Promise.all([
      prisma.emailLog.findFirst({ where: { status: "SENT" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
      prisma.emailLog.count({ where: { status: "FAILED" } }),
      prisma.emailLog.count({ where: { status: { in: ["PENDING", "RETRYING"] } } }),
    ]);
    res.json({
      connected,
      senderEmail: process.env.MAIL_FROM || null,
      lastSuccessfulAt: lastSent?.sentAt || null,
      failedCount,
      queuedCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load email system status" });
  }
});

// ADMIN: sends a real test email to a given address to confirm the configured mailbox actually
// works, without needing to trigger an unrelated account-creation/reset flow first. Logged like
// any other email so it's visible (and debuggable) in the list above.
router.post("/email-logs/test", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const to = String(req.body.to || "").trim();
    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    const result = await sendMailLogged(prisma, {
      to,
      name: "Test recipient",
      emailType: "OTHER_SYSTEM_EMAIL",
      instituteId: req.requesterInstituteId || null,
      subject: "CodeArena Test Email",
      html: wrapBranded(`<p>This is a test email sent from the CodeArena admin panel by ${admin?.name || req.user.email} to confirm the mail system is working.</p>`),
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.EMAIL_TEST_SENT,
      actorId: req.user.id, actorName: admin?.name || req.user.email, actorRole: req.user.role,
      details: { to, emailSent: !!result.ok, emailError: result.error || null },
    });
    res.json({ ok: !!result.ok, error: result.error || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send test email" });
  }
});

// ADMIN/STAFF: retries a specific failed EmailLog row in place (matches the existing
// requireRole gate on POST /users/:id/reset-password, which this route replaces as the Email
// Logs page's retry action). Since plaintext temp passwords are never stored, a "retry" here
// necessarily issues a fresh password for the student — there is no original message body to
// literally resend — but unlike the old workaround (which created a brand-new EmailLog row every
// time), this updates the SAME row's retryCount/status and enforces MAX_EMAIL_RETRIES.
router.post("/email-logs/:id/retry", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const log = await prisma.emailLog.findUnique({ where: { id: req.params.id } });
    if (!log) return res.status(404).json({ error: "Email log entry not found" });
    if (!log.studentId) return res.status(400).json({ error: "Can't retry — this student's account no longer exists." });
    if (log.retryCount >= MAX_EMAIL_RETRIES) {
      return res.status(409).json({ error: `Retry limit reached (${MAX_EMAIL_RETRIES} attempts).`, retryCount: log.retryCount });
    }

    const student = await prisma.user.findUnique({ where: { id: log.studentId } });
    if (!student) return res.status(400).json({ error: "Can't retry — this student's account no longer exists." });
    // Without this, any institute-scoped ADMIN/STAFF could retry another institute's email-log
    // row — which, since a "retry" here issues a BRAND NEW password (see the comment above),
    // amounts to a full account takeover of another institute's student. Same check as
    // users.js's /:id/reset-password.
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only retry emails for students under your own institute" });
    }

    const newPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: student.id }, data: { passwordHash, mustChangePassword: true } });
      await recordPasswordChange(tx, student.id, passwordHash, null);
    });
    await revokeAllSessions(student.id).catch(() => {}); // same reasoning as users.js's reset-password routes

    const result = await retryEmailLogged(prisma, log.id, () =>
      sendMail({
        to: student.email,
        subject: "Your CodeArena Password Has Been Reset",
        html: credentialsResendTemplate({ name: student.name, email: student.email, password: newPassword }),
      })
    );

    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    await logAudit({
      req, action: AUDIT_ACTIONS.EMAIL_RETRIED,
      actorId: req.user.id, actorName: admin?.name || req.user.email, actorRole: req.user.role,
      studentId: student.id,
      details: { emailLogId: log.id, retryCount: result.retryCount, emailSent: !!result.ok, emailError: result.error || null },
    });

    res.json({ success: true, emailSent: !!result.ok, emailError: result.error || null, retryCount: result.retryCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to retry email" });
  }
});

// ADMIN: real-time system monitoring. Every number here is genuinely measured from this one
// Node process and this one database connection — nothing is estimated or simulated. What this
// deliberately does NOT show: system-wide CPU% (Node doesn't expose host CPU utilization without
// an external metrics agent; `os.loadavg()` is a 1/5/15-min load average, not the same thing, so
// it's labeled as exactly that below, not mislabeled as "CPU Usage"), and per-route error counts
// for routes that catch and handle their own errors gracefully (only uncaught process-level
// failures are tracked — see utils/metrics.js).
router.get("/monitoring", authenticate, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const os = require("os");
    const fs = require("fs");
    const mem = process.memoryUsage();

    const dbPingStart = process.hrtime.bigint();
    await prisma.$queryRaw`SELECT 1`;
    const dbPingMs = Number(process.hrtime.bigint() - dbPingStart) / 1e6;

    const [activeTestAttempts, activeModuleAttempts, activeInterviewSessions] = await Promise.all([
      prisma.testAttempt.count({ where: { status: "IN_PROGRESS" } }),
      prisma.moduleCodingAttempt.count({ where: { status: "IN_PROGRESS" } }),
      prisma.interviewSession.count({ where: { status: "IN_PROGRESS" } }),
    ]);

    // "Active users" — LoginSession has no separate expiresAt column (session validity is purely
    // the JWT's own exp claim, see utils/sessions.js), so this can't say "currently holds a valid
    // token" with certainty. loginAt within the last 24h + never explicitly logged out is an
    // honest, clearly-scoped proxy for "recently active," not a claim of live concurrent sessions.
    const activeUsersSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeUserCount = await prisma.loginSession.findMany({
      where: { isActive: true, loginAt: { gte: activeUsersSince } },
      select: { userId: true },
      distinct: ["userId"],
    }).then((rows) => rows.length);

    const snapshot = getSnapshot();

    // AI provider health — AiUsageLog has been recording every Gemini call (success, failure,
    // errorType, latency) since aiService.js's logUsage() since long before this section existed;
    // nothing admin-facing ever read it back until now. Cached briefly (same reasoning as the
    // dashboard stats above): this page polls every 10s and a `groupBy` + two `aggregate` queries
    // on every poll is wasted work when the underlying numbers only change once per AI call.
    const aiProvider = await cached("admin:monitoring:aiProvider", 15000, async () => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const [totalToday, failuresByType, latency, lastFailure] = await Promise.all([
        prisma.aiUsageLog.count({ where: { createdAt: { gte: since } } }),
        prisma.aiUsageLog.groupBy({ by: ["errorType"], where: { createdAt: { gte: since }, success: false }, _count: { _all: true } }),
        prisma.aiUsageLog.aggregate({ where: { createdAt: { gte: since }, success: true }, _avg: { latencyMs: true } }),
        prisma.aiUsageLog.findFirst({ where: { success: false }, orderBy: { createdAt: "desc" }, select: { feature: true, errorType: true, createdAt: true } }),
      ]);
      const failedToday = failuresByType.reduce((sum, g) => sum + g._count._all, 0);
      return {
        configured: geminiProvider.isConfigured(),
        provider: "gemini", // matches AiUsageLog.provider's own value — see aiService.js's PRIMARY_PROVIDER
        model: geminiProvider.DEFAULT_MODEL,
        today: {
          total: totalToday,
          success: totalToday - failedToday,
          failed: failedToday,
          byErrorType: Object.fromEntries(failuresByType.map((g) => [g.errorType || "UNKNOWN", g._count._all])),
          avgLatencyMs: latency._avg.latencyMs != null ? Math.round(latency._avg.latencyMs) : null,
        },
        quota: {
          globalLimit: aiRateLimits.GLOBAL_DAILY_LIMIT,
          globalUsed: totalToday,
          perInstituteLimit: aiRateLimits.PER_INSTITUTE_DAILY_LIMIT,
        },
        lastFailure,
      };
    });

    // Email delivery — EmailLog has recorded every send attempt (Apps Script bridge or SMTP,
    // utils/mailer.js's sendMailLogged) since long before this section existed; same "nothing
    // admin-facing ever read it back" gap the AI section above already closed.
    const emailDelivery = await cached("admin:monitoring:email", 15000, async () => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const byStatus = await prisma.emailLog.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } });
      const counts = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));
      const lastFailure = await prisma.emailLog.findFirst({
        where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, select: { emailType: true, errorMessage: true, createdAt: true },
      });
      return {
        today: { sent: counts.SENT || 0, failed: counts.FAILED || 0, pending: counts.PENDING || 0, retrying: counts.RETRYING || 0 },
        transportConfigured: !!(process.env.APPS_SCRIPT_WEB_APP_URL || process.env.MAIL_HOST),
        lastFailure,
      };
    });

    // Disk — the one resource judge.js's own temp-file writes (submission I/O) actually depend
    // on running out of. fs.statfsSync is Node 18.15+/20+ built-in, no new dependency. Wrapped
    // separately: unlike every other section here, a filesystem call failing shouldn't take the
    // whole monitoring page down with it.
    let storage = null;
    try {
      const stat = fs.statfsSync("/app");
      const totalBytes = stat.blocks * stat.bsize;
      const freeBytes = stat.bfree * stat.bsize;
      storage = {
        totalGb: Math.round((totalBytes / 1024 / 1024 / 1024) * 10) / 10,
        freeGb: Math.round((freeBytes / 1024 / 1024 / 1024) * 10) / 10,
        usedPercent: Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10,
      };
    } catch (err) {
      console.warn("[monitoring] disk stat unavailable:", err.message);
    }

    res.json({
      process: {
        uptimeSec: Math.round(process.uptime()),
        memoryMb: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        },
        loadAverage1m: Math.round(os.loadavg()[0] * 100) / 100,
        eventLoopLagMs: snapshot.eventLoopLagMs,
      },
      database: {
        pingMs: Math.round(dbPingMs * 10) / 10,
      },
      storage,
      requestTiming: snapshot.requestTimingMs,
      judgeQueue: getQueueStatus(),
      aiQueue: getAiQueueStatus(),
      activeSessions: {
        codingTests: activeTestAttempts,
        moduleCodingAssessments: activeModuleAttempts,
        mockInterviews: activeInterviewSessions,
      },
      activeUsers: { last24h: activeUserCount },
      aiProvider,
      emailDelivery,
      recentErrors: snapshot.recentErrors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load monitoring data" });
  }
});

module.exports = router;
