// /api/questions, the authoring half: URLs, authentication, permission, feature gate and upload limits only. The rules live in questions.service.js.
// Mounted by routes/questions.js AFTER the routes that still live there, so those literal paths ("/folders", "/bulk-template", "/export", ...) are matched before
// this file's "/:id". Inside this file every literal path is registered before "/:id" for the same reason.
//   staff.console  ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN, STAFF   (identical to the requireRole lists these routes had)
// All of them sit behind the "question_bank" feature switch of the requester's institute.
const express = require("express");
const multer = require("multer");
const { authenticate } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requireFeature } = require("../../middleware/featureGate");
const { requirePermission } = require("../../utils/permissions");
const c = require("./questions.controller");

const router = express.Router();
const staffOnly = [authenticate, requirePermission("staff.console"), requireFeature("question_bank")];
const staffInstitute = [authenticate, requirePermission("staff.console"), attachRequesterInstitute, requireFeature("question_bank")];

// Question-image upload: accepts anything up front, because the real check is the magic-byte sniff on the buffer in the service (the only check that cannot be
// fooled by a renamed file or a spoofed Content-Type); this filter only rejects non-image form fields fast.
const uploadQuestionImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype || "")),
});

router.post("/preview-starter-code", ...staffOnly, c.previewStarterCode);
router.post("/validate-test-cases", ...staffOnly, c.validateTestCases);
router.get("/analytics/summary", ...staffInstitute, c.analytics);
router.post("/", ...staffInstitute, c.create);
router.get("/", ...staffInstitute, c.list);
router.get("/meta/filters", ...staffInstitute, c.filters);

// folders and bulk operations: literal paths, before "/:id"
router.get("/folders", ...staffInstitute, c.listFolders);
router.post("/folders", ...staffInstitute, c.createFolder);
router.patch("/folders/:id", ...staffInstitute, c.editFolder);
router.get("/folders/:id/delete-preview", ...staffInstitute, c.deletePreview);
router.delete("/folders/:id", ...staffInstitute, c.deleteFolder);
router.get("/folders/:id/shares", ...staffInstitute, c.listShares);
router.post("/folders/:id/shares", ...staffInstitute, c.shareFolder);
router.delete("/folders/:id/shares/:staffId", ...staffInstitute, c.revokeShare);
router.post("/folders/:id/merge", ...staffInstitute, c.mergeFolder);
router.post("/folders/:id/clear", ...staffInstitute, c.clearFolder);
router.post("/bulk-move", ...staffInstitute, c.bulkMove);
router.post("/bulk-assign-subject", ...staffInstitute, c.bulkAssignSubject);
router.post("/bulk-status", ...staffInstitute, c.bulkStatus);
router.post("/bulk-delete", ...staffInstitute, c.bulkDelete);
router.post("/bulk-copy", ...staffInstitute, c.bulkCopy);

router.post("/:id/duplicate", ...staffInstitute, c.duplicate);
router.get("/:id", ...staffInstitute, c.getOne);
router.patch("/:id", ...staffInstitute, c.edit);
router.delete("/:id", ...staffInstitute, c.remove);
router.post("/:id/image", ...staffInstitute, uploadQuestionImage.single("image"), c.uploadImage);
router.delete("/:id/image", ...staffInstitute, c.removeImage);

module.exports = router;
