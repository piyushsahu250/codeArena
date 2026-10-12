// /api/users: URLs, authentication, permission and rate limits only. The rules live in the services next to this file.
// Mounted by routes/users.js. Order matters inside this file: every literal path is registered before "/:id".
//   institute.console  ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN                  (identical to the requireRole lists these routes had)
//   staff.console      ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN, STAFF
//   placement.console  ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN, STAFF, CLERK
//   platform.console   ADMIN, SUPER_ADMIN
// The performance routes allow every role (a student sees only their own), which no permission key expresses, so they keep an explicit role list.
const express = require("express");
const multer = require("multer");
const { spreadsheetFileFilter } = require("../../utils/uploadFilters");
const { dbRateLimit } = require("../../utils/dbRateLimit");
const { authenticate, requireRole } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requirePermission } = require("../../utils/permissions");
const c = require("./users.controller");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });
const instituteAdmin = [authenticate, requirePermission("institute.console"), attachRequesterInstitute];
const staffAndUp = [authenticate, requirePermission("staff.console"), attachRequesterInstitute];
const placementAndUp = [authenticate, requirePermission("placement.console"), attachRequesterInstitute];
const everyRole = [authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK", "STUDENT")];

// How often a signed-in user can (re)request a sign-in e-mail change: the token goes to the NEW address, so the abuse shape is spamming an arbitrary inbox, not
// guessing credentials. Keyed by the account (this route already requires a session) and shared by both routes that send that mail.
const emailChangeLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `email-change:${req.user.id}`,
  message: { error: "Too many email change requests. Please try again later." },
});

// own account and sessions (any signed-in user)
router.patch("/me", authenticate, emailChangeLimiter, c.updateOwnAccount);
router.post("/me/resend-verification", authenticate, emailChangeLimiter, c.resendVerification);
router.get("/me/sessions", authenticate, c.mySessions);
router.delete("/me/sessions/:sessionId", authenticate, c.endMySession);

// directory and views: literal paths first
router.get("/", ...instituteAdmin, c.listUsers);
router.get("/bulk-template", authenticate, requirePermission("institute.console"), c.template);
router.get("/lookup/:query", ...instituteAdmin, c.lookup);
router.get("/search", ...placementAndUp, c.search);
router.get("/browse", ...placementAndUp, c.browse);
router.get("/password-reset-history", ...staffAndUp, c.resetHistory);
router.get("/roll-number-conflicts", ...instituteAdmin, c.conflicts);
router.get("/audit-log", ...placementAndUp, c.auditLog);
router.get("/audit-log/actions", ...placementAndUp, c.auditActions);
router.get("/migration-status", authenticate, requirePermission("platform.console"), c.migrationStatus);

// one user, then a student's performance
router.get("/:id", ...instituteAdmin, c.getUser);
router.get("/:id/performance", ...everyRole, c.dashboard);
router.get("/:id/placement-readiness", ...everyRole, c.readiness);
router.get("/:id/performance/report.xlsx", ...everyRole, c.excelReport);
router.get("/:id/performance/report.pdf", ...everyRole, c.pdfReport);


// writes. A literal path (bulk-upload/..., bulk-regenerate-password, bulk-status) never collides with "/:id" or "/:id/reset-password" because the segment counts
// differ; PATCH "/me" above is registered before PATCH "/:id".
router.post("/", ...instituteAdmin, c.createAccount);
router.patch("/:id", ...instituteAdmin, c.editAccount);
router.post("/bulk-upload/preview", ...instituteAdmin, upload.single("file"), c.bulkPreview);
router.post("/bulk-upload/confirm", ...instituteAdmin, c.bulkConfirm);
router.post("/bulk-regenerate-password", ...instituteAdmin, c.bulkRegenerate);
router.post("/bulk-status", ...instituteAdmin, c.bulkStatus);
router.post("/:id/reset-password", ...staffAndUp, c.resetPassword);
router.delete("/:id", ...instituteAdmin, c.deleteAccount);

module.exports = router;
