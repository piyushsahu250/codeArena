// Test authoring and management: URLs, authentication and permission only. The rules live in tests.service.js.
// Mounted by routes/tests.js BEFORE the routes that still live there, so "/staff-directory" is matched before the legacy "/:id".
//   staff.console     ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN, STAFF   (identical to the requireRole lists these routes had)
//   institute.console ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN         (delete)
const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requirePermission } = require("../../utils/permissions");
const c = require("./tests.controller");

const router = express.Router();
const manage = [authenticate, requirePermission("staff.console"), attachRequesterInstitute];
const adminOnly = [authenticate, requirePermission("institute.console"), attachRequesterInstitute];

router.post("/", ...manage, c.create);
router.get("/staff-directory", ...manage, c.staffDirectory);
router.patch("/:id", ...manage, c.update);
router.post("/:id/duplicate", ...manage, c.duplicate);
router.delete("/:id", ...adminOnly, c.remove);
router.patch("/:id/publish", ...manage, c.publish);
router.get("/:id/notification-recipients", ...manage, c.recipients);
router.post("/:id/notify", ...manage, c.notify);
router.get("/:id/notification-log", ...manage, c.notificationLog);
router.post("/:id/shares", ...manage, c.share);
router.delete("/:id/shares/:staffId", ...manage, c.unshare);

module.exports = router;
