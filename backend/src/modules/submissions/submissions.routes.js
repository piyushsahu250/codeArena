// /api/submissions: URLs, authentication, permission and rate limits only. The rules live in submissions.service.js.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { authenticate } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requirePermission } = require("../../utils/permissions");
const c = require("./submissions.controller");

const router = express.Router();

// Per-student (not per-IP) throttling: a shared campus network must not share one budget. Code EXECUTION is limited tightly; exact-match quiz saves have no
// compute cost and get a generous limit so a fast student (or a client retry) can never lose answers to a 429; /autosave is a plain DB write and is not limited.
const execLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => req.user.id });
const quizSaveLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, keyGenerator: (req) => req.user.id });

const student = [authenticate, requirePermission("student.portal")];

router.get("/queue-status", authenticate, c.queueStatus);
router.post("/run", ...student, attachRequesterInstitute, execLimiter, c.run);
router.post("/autosave", ...student, c.autosave);
router.post("/submit-code", ...student, execLimiter, c.submitCode);
router.post("/submit", ...student, quizSaveLimiter, c.submitQuiz);
router.post("/finalize/:attemptId", ...student, c.finalize);

module.exports = router;
