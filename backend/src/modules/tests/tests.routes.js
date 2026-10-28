// Tests: URLs, authentication, permission and rate limits only. The rules live in the services next to this file.
// Mounted by routes/tests.js BEFORE the routes that still live there, so "/staff-directory" is matched before "/:id".
//   staff.console     ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN, STAFF   (identical to the requireRole lists these routes had)
//   institute.console ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN         (delete)
//   student.portal    STUDENT                                      (the attempt flow)
const express = require("express");
const rateLimit = require("express-rate-limit");
const { authenticate } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requirePermission } = require("../../utils/permissions");
const c = require("./tests.controller");

const router = express.Router();
const manage = [authenticate, requirePermission("staff.console"), attachRequesterInstitute];
const adminOnly = [authenticate, requirePermission("institute.console"), attachRequesterInstitute];
const student = [authenticate, requirePermission("student.portal")];
const anyone = [authenticate, attachRequesterInstitute];

// Per-student (not per-IP) limits: a shared campus network must not share one budget. Violations are cheap DB writes (the client already self-throttles
// to ~1 per 1.5s); AI help costs money, so it is tight.
const violationLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, keyGenerator: (req) => req.user.id });
const examAiAssistLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, keyGenerator: (req) => req.user.id });
// Exports carry student names, e-mails and PRNs and are built in memory: a modest per-user budget.
const exportLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user.id });
// The administrator's duration change is rare and heavy enough (it reads every running attempt): a few per minute is plenty. The student clock sync is polled about every 20 s per open exam page.
const durationLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user.id });
const clockLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user.id });

// authoring and management
router.post("/", ...manage, c.create);
router.get("/staff-directory", ...manage, c.staffDirectory);
router.patch("/:id", ...manage, c.update);
router.get("/:id/duration-impact", ...manage, c.durationImpact);
router.patch("/:id/duration", ...manage, durationLimiter, c.changeDuration);
router.post("/:id/duplicate", ...manage, c.duplicate);
router.delete("/:id", ...adminOnly, c.remove);
router.patch("/:id/publish", ...manage, c.publish);
router.get("/:id/notification-recipients", ...manage, c.recipients);
router.post("/:id/notify", ...manage, c.notify);
router.get("/:id/notification-log", ...manage, c.notificationLog);
router.post("/:id/shares", ...manage, c.share);
router.delete("/:id/shares/:staffId", ...manage, c.unshare);

// reading (staff and students see different shapes of the same routes)
router.get("/", ...anyone, c.list);
router.get("/:id", ...anyone, c.getOne);

// the student attempt flow, and the staff view of its violations
router.post("/:id/start", ...student, c.start);
router.post("/attempts/:attemptId/violation", ...student, violationLimiter, c.violation);
router.get("/attempts/:attemptId/clock", ...student, clockLimiter, c.attemptClock);
router.get("/admin/attempts/:attemptId/violations", ...manage, c.violationLog);
router.post("/attempts/:attemptId/ai-assist", ...student, examAiAssistLimiter, c.aiAssist);
router.get("/:id/my-result", ...student, c.myResult);

// results, export, question analytics and reattempt (staff side)
router.post("/:testId/attempts/:studentId/reattempt", ...manage, c.reattempt);
router.get("/:id/results", ...manage, c.leaderboard);
router.get("/:id/results/export", ...manage, exportLimiter, c.exportResults);
router.get("/:id/question-analytics", ...manage, c.questionAnalytics);

module.exports = router;
