// /api/staff-analytics: URLs, authentication, permission and rate limits only. The rules live in staffAnalytics.service.js.
//   staffAnalytics.view  -> SUPER_ADMIN, ADMIN, INSTITUTE_ADMIN (institute scope is forced server-side for institute-bound accounts)
//   staffAnalytics.self  -> STAFF, CLERK (their own record only)
const express = require("express");
const rateLimit = require("express-rate-limit");
const { authenticate } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requirePermission } = require("../../utils/permissions");
const c = require("./staffAnalytics.controller");

const router = express.Router();
const perUser = (max) => rateLimit({ windowMs: 60 * 1000, max, keyGenerator: (req) => req.user.id, standardHeaders: true, legacyHeaders: false });
const readLimiter = perUser(120);
const exportLimiter = perUser(10);

const admin = [authenticate, requirePermission("staffAnalytics.view"), attachRequesterInstitute, readLimiter];
const self = [authenticate, requirePermission("staffAnalytics.self"), attachRequesterInstitute, readLimiter];

router.get("/meta", ...admin, c.meta);
router.get("/summary", ...admin, c.summary);
router.get("/people", ...admin, c.people);
router.get("/people/:id", ...admin, c.person);
router.get("/people/:id/events", ...admin, c.personEvents);
router.get("/compare", ...admin, c.compare);
router.get("/export", authenticate, requirePermission("staffAnalytics.view"), attachRequesterInstitute, exportLimiter, c.exportReport);

router.get("/me", ...self, c.me);
router.get("/me/events", ...self, c.meEvents);

module.exports = router;
