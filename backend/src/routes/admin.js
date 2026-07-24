const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { getSnapshot } = require("../utils/metrics");
const { getQueueStatus } = require("../utils/queue");

const router = express.Router();

// ADMIN: dashboard summary stats
router.get("/stats", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const now = new Date();
    const [
      totalInstitutes, totalClasses, totalUsers, totalStudents, totalStaff,
      totalTests, totalQuestions, activeTests, scheduledTests, completedTests,
      totalCourses, totalPracticeQuestions, certificatesIssued, interviewCertificatesIssued,
      totalAcademicGroups, studentsUnlinkedFromAcademicGroup,
    ] = await Promise.all([
      prisma.institute.count(),
      prisma.class.count(),
      prisma.user.count(),
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.user.count({ where: { role: "STAFF" } }),
      prisma.test.count(),
      prisma.question.count(),
      prisma.test.count({ where: { isPublished: true, startTime: { lte: now }, endTime: { gte: now } } }),
      prisma.test.count({ where: { isPublished: true, startTime: { gt: now } } }),
      prisma.test.count({ where: { isPublished: true, endTime: { lt: now } } }),
      prisma.course.count(),
      prisma.practiceQuestion.count(),
      prisma.certificate.count(),
      prisma.interviewCertificate.count(),
      // Institute->Batch->Department->Section migration visibility (see
      // backend/scripts/migrateAcademicGroups.js) — surfaced here so the zero-data-loss gate is
      // checkable at a glance from the dashboard that's already loaded, no separate API call needed.
      prisma.academicGroup.count(),
      prisma.user.count({ where: { role: "STUDENT", classId: { not: null }, academicGroupId: null } }),
    ]);

    res.json({
      totalInstitutes, totalClasses, totalUsers, totalStudents, totalStaff,
      totalTests, totalQuestions, activeTests, scheduledTests, completedTests,
      totalCourses, totalPracticeQuestions, certificatesIssued: certificatesIssued + interviewCertificatesIssued,
      totalAcademicGroups, studentsUnlinkedFromAcademicGroup,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

// Shared by the audit route below — same "mandatory field" set the admin CRUD routes already
// enforce at creation time (2 visible / 10 hidden test cases, description, etc., see
// moduleCoding.js/questions.js/learning.js/interview.js's own validation) plus a few fields those
// routes leave optional but a genuinely complete question should still have (inputFormat,
// outputFormat, constraints, tags, starter code). Deliberately read-only and non-destructive: this
// only reports what's missing, it never invents content to fill the gap — an admin who hasn't
// reviewed a question shouldn't have Claude-authored placeholder text silently attributed to them.
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
  if (hidden < 10) missing.push(`hidden test cases (has ${hidden}, needs 10)`);
  const hasStarter = (q.starterCodeByLanguage && Object.keys(q.starterCodeByLanguage).length > 0) || !!q.starterCode;
  if (!hasStarter) missing.push("starter code");
  if (q.evaluationType === "FUNCTION" && !q.functionSignature) missing.push("function signature");
  return missing;
}

// ADMIN: read-only completeness report across every coding question on the platform (Question,
// PracticeQuestion, InterviewQuestion) — flags which mandatory fields each one is missing, so an
// admin can find and fix incomplete questions instead of discovering them one at a time when a
// student hits a confusing gap. Never writes anything.
router.get("/question-audit", authenticate, requireRole("ADMIN"), async (req, res) => {
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

// ADMIN: outbound email delivery log — every welcome/password-reset send attempt, with real
// provider-confirmed status (never inferred). Optional ?status=FAILED filter; capped at 300 rows,
// most recent first — this is an operational log, not a paginated archive.
router.get("/email-logs", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const where = {};
    if (req.query.status && ["PENDING", "SENT", "FAILED", "RETRYING"].includes(req.query.status)) {
      where.status = req.query.status;
    }
    const logs = await prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true, studentId: true, recipientName: true, recipientEmail: true, emailType: true,
        status: true, errorMessage: true, messageId: true, retryCount: true, createdAt: true, sentAt: true,
      },
    });
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load email logs" });
  }
});

// ADMIN: real-time system monitoring. Every number here is genuinely measured from this one
// Node process and this one database connection — nothing is estimated or simulated. What this
// deliberately does NOT show: system-wide CPU% (Node doesn't expose host CPU utilization without
// an external metrics agent; `os.loadavg()` is a 1/5/15-min load average, not the same thing, so
// it's labeled as exactly that below, not mislabeled as "CPU Usage"), and per-route error counts
// for routes that catch and handle their own errors gracefully (only uncaught process-level
// failures are tracked — see utils/metrics.js).
router.get("/monitoring", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const os = require("os");
    const mem = process.memoryUsage();

    const dbPingStart = process.hrtime.bigint();
    await prisma.$queryRaw`SELECT 1`;
    const dbPingMs = Number(process.hrtime.bigint() - dbPingStart) / 1e6;

    const [activeTestAttempts, activeModuleAttempts, activeInterviewSessions] = await Promise.all([
      prisma.testAttempt.count({ where: { status: "IN_PROGRESS" } }),
      prisma.moduleCodingAttempt.count({ where: { status: "IN_PROGRESS" } }),
      prisma.interviewSession.count({ where: { status: "IN_PROGRESS" } }),
    ]);

    const snapshot = getSnapshot();

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
      requestTiming: snapshot.requestTimingMs,
      judgeQueue: getQueueStatus(),
      activeSessions: {
        codingTests: activeTestAttempts,
        moduleCodingAssessments: activeModuleAttempts,
        mockInterviews: activeInterviewSessions,
      },
      recentErrors: snapshot.recentErrors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load monitoring data" });
  }
});

module.exports = router;
