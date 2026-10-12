// /api/questions: URLs, authentication, permission, feature gate and upload limits only. The rules live in the services next to this file. Every literal path is
// registered before "/:id" so it is never taken for an id.
//   staff.console  ADMIN, SUPER_ADMIN, INSTITUTE_ADMIN, STAFF   (identical to the requireRole lists these routes had)
// All of them sit behind the "question_bank" feature switch of the requester's institute.
const express = require("express");
const multer = require("multer");
const { authenticate } = require("../../middleware/auth");
const { attachRequesterInstitute } = require("../../middleware/institute");
const { requireFeature } = require("../../middleware/featureGate");
const { requirePermission } = require("../../utils/permissions");
const { invalidate } = require("../../utils/cache");
const { spreadsheetOrTextFileFilter } = require("../../utils/uploadFilters");
const c = require("./questions.controller");

const router = express.Router();

// GET /analytics (below) caches its result per institute+user for 60s, but with ~25 separate
// question/folder mutation routes in this file (create, bulk-move/status/delete/copy, several
// bulk-import variants, folder CRUD/merge/share/clear, patch/delete, image upload/delete) none of
// them invalidated it -- confirmed as a live bug class 2026-09-23 alongside the same gap in
// several other cached routes. Rather than hand-instrument every one of those routes individually
// (error-prone, and silently stops covering any new mutation route added here later), this single
// router-level hook invalidates the cache after any non-GET request that actually succeeds --
// covers every mutation in this file uniformly, present and future.
router.use((req, res, next) => {
  if (req.method !== "GET") {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) invalidate("questionAnalytics:");
      return originalJson(body);
    };
  }
  next();
});
const staffOnly = [authenticate, requirePermission("staff.console"), requireFeature("question_bank")];
const staffInstitute = [authenticate, requirePermission("staff.console"), attachRequesterInstitute, requireFeature("question_bank")];

// Question-image upload: accepts anything up front, because the real check is the magic-byte sniff on the buffer in the service (the only check that cannot be
// fooled by a renamed file or a spoofed Content-Type); this filter only rejects non-image form fields fast.
const uploadQuestionImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype || "")),
});

// Bulk import takes the spreadsheet (or Notepad text) and, optionally, an images ZIP; the confirm step re-attaches only the ZIP, because a preview never stores an image.
// Bulk import with an OPTIONAL "images ZIP" alongside the spreadsheet -- a row's "Image File Name"
// column names a file the ZIP must actually contain (see utils/bulkImageZip.js). Two named fields
// instead of `.single(...)` because a bulk-import request can legitimately carry both files at
// once; fileFilter branches on fieldname since "file" and "imagesZip" accept different formats.
// 20MB cap (vs. 5MB for the spreadsheet alone) -- a ZIP of even a few dozen diagrams adds up
// quickly; utils/bulkImageZip.js enforces its own tighter per-file/total-uncompressed limits on
// top of this multer-level cap on the compressed upload itself.
const uploadQuestionFileWithImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "imagesZip") {
      cb(null, /\.zip$/i.test(file.originalname || ""));
      return;
    }
    spreadsheetOrTextFileFilter(req, file, cb);
  },
}).fields([{ name: "file", maxCount: 1 }, { name: "imagesZip", maxCount: 1 }]);
// Confirm-step counterpart: no spreadsheet re-upload (the validated row data is posted as JSON/
// form fields instead — see the /confirm routes below), just the same images ZIP again, since the
// preview step never uploads any image to S3 and the actual bytes only ever existed in that ZIP.
// When the request isn't multipart at all (the common, image-free case — still a plain JSON
// POST, unchanged from before this feature existed), multer/busboy no-ops and simply calls
// next() without touching req.body, so this is safe to apply unconditionally.
const uploadImagesZipOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.zip$/i.test(file.originalname || "")),
}).fields([{ name: "imagesZip", maxCount: 1 }]);

router.post("/preview-starter-code", ...staffOnly, c.previewStarterCode);
router.post("/validate-test-cases", ...staffOnly, c.validateTestCases);
router.get("/analytics/summary", ...staffInstitute, c.analytics);
router.post("/", ...staffInstitute, c.create);
router.get("/", ...staffInstitute, c.list);
router.get("/meta/filters", ...staffInstitute, c.filters);
// templates, export and bulk import: literal paths, before "/:id"
router.get("/bulk-template", ...staffOnly, c.template);
router.get("/export", ...staffInstitute, c.exportQuestions);
router.post("/bulk-import", ...staffInstitute, uploadQuestionFileWithImages, c.importQuiz);
router.post("/bulk-import/preview", ...staffInstitute, uploadQuestionFileWithImages, c.previewQuiz);
router.post("/bulk-import/confirm", ...staffInstitute, uploadImagesZipOnly, c.confirmQuiz);
router.post("/bulk-import-coding", ...staffInstitute, uploadQuestionFileWithImages, c.importCoding);
router.post("/bulk-import-coding/preview", ...staffInstitute, uploadQuestionFileWithImages, c.previewCoding);
router.post("/bulk-import-coding/confirm", ...staffInstitute, uploadImagesZipOnly, c.confirmCoding);
router.post("/bulk-import-combined/preview", ...staffInstitute, uploadQuestionFileWithImages, c.previewCombined);
router.post("/bulk-import-combined/confirm", ...staffInstitute, uploadImagesZipOnly, c.confirmCombined);

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
