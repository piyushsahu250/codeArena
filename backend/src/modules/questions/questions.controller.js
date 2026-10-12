// HTTP in, HTTP out for the question-bank authoring routes. Reads the request, calls the service and maps results and ServiceErrors to responses. Failure styles are
// those of the routes this replaced:
//   create, edit, duplicate, image:  an unexpected error is logged and answered 400 with its (sanitised) message;
//   delete:                          an unexpected error is logged and answered 500 with a fixed message;
//   list, filters, read one:         an unexpected error goes to the application's error handler (these had no try/catch);
//   analytics:                       500 with the sanitised message, not logged;
//   starter-code preview and test-case validation: 400 with the sanitised message (503 when the judge queue is busy).
const { ServiceError } = require("../../utils/serviceError");
const { safeErrorMessage } = require("../../utils/errors");
const service = require("./questions.service");
const folders = require("./questions.folders.service");
const bulk = require("./questions.bulk.service");
const importer = require("./questions.import.service");
const exporter = require("./questions.export.service");
const { templateWorkbook, templateText } = require("./questions.import.domain");

const actor = (req) => ({ req, user: req.user, requesterInstituteId: req.requesterInstituteId });

function refuse(res, err) {
  if (err.extra && err.extra.rawBody) return res.status(err.status).json(err.extra.rawBody);
  return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
}

// onFault(err, res) answers an unexpected error.
function handler(fn, onFault) {
  return async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof ServiceError) return refuse(res, err);
      return onFault(err, res, next);
    }
  };
}
const badRequestLogged = (fallback) => (err, res) => { console.error(err); res.status(400).json({ error: safeErrorMessage(err, fallback) }); };
const toErrorHandler = (err, res, next) => next(err);

const create = handler((req) => service.createQuestion(actor(req), req.body), badRequestLogged("Failed to create question"));
const edit = handler((req) => service.editQuestion(actor(req), req.params.id, req.body), badRequestLogged("Failed to update question"));
const duplicate = handler((req) => service.duplicateQuestion(actor(req), req.params.id), badRequestLogged("Failed to duplicate question"));
const uploadImage = handler((req) => service.uploadImage(actor(req), req.params.id, req.file), badRequestLogged("Failed to upload image"));
const removeImage = handler((req) => service.removeImage(actor(req), req.params.id), badRequestLogged("Failed to remove image"));
const remove = handler((req) => service.deleteQuestion(actor(req), req.params.id), (err, res) => { console.error(err); res.status(500).json({ error: "Failed to delete question" }); });

const list = handler((req) => service.listQuestions(req), toErrorHandler);
const filters = handler((req) => service.filterOptions(req), toErrorHandler);
const getOne = handler((req) => service.getQuestion(actor(req), req.params.id), toErrorHandler);

const analytics = handler((req) => service.analytics(req), (err, res) => res.status(500).json({ error: safeErrorMessage(err, "Failed to load question analytics") }));
const previewStarterCode = handler((req) => service.previewStarterCode(req.body), (err, res) => res.status(400).json({ error: safeErrorMessage(err, "Invalid function signature") }));
const validateTestCases = handler((req) => service.validateTestCases(req.body), (err, res) => {
  if (err.queueBusy) return res.status(503).json({ error: "Code execution is currently busy. Please try again shortly.", queueBusy: true });
  res.status(400).json({ error: safeErrorMessage(err, "Could not validate test cases") });
});

// ---- folders and bulk operations ----
// Folder list, create, rename, share and revoke answer an unexpected error with a fixed 500 message (create and rename also turn a unique-name collision into a
// 409); preview, recursive delete, clear, merge, share list and every bulk route had no try/catch and hand an unexpected error to the application's error handler.
const nameTaken = (err, res) => err.code === "P2002" && res.status(409).json({ error: "A folder with this name already exists" });
const logged500 = (fallback, { p2002 = false } = {}) => (err, res) => {
  if (p2002 && nameTaken(err, res)) return;
  console.error(err);
  res.status(500).json({ error: fallback });
};

const listFolders = handler((req) => folders.listFolders(actor(req)), logged500("Failed to load folders"));
const createFolder = handler((req) => folders.createFolder(actor(req), req.body), logged500("Failed to create folder", { p2002: true }));
const editFolder = handler((req) => folders.editFolder(actor(req), req.params.id, req.body), logged500("Failed to update folder", { p2002: true }));
const deletePreview = handler((req) => folders.deletePreview(actor(req), req.params.id), toErrorHandler);
const deleteFolder = handler((req) => folders.deleteFolderTree(actor(req), req.params.id), toErrorHandler);
const clearFolder = handler((req) => folders.clearFolder(actor(req), req.params.id), toErrorHandler);
const mergeFolder = handler((req) => folders.mergeFolder(actor(req), req.params.id, req.body.targetId), toErrorHandler);
const listShares = handler((req) => folders.listShares(actor(req), req.params.id), toErrorHandler);
const shareFolder = handler((req) => folders.shareFolder(actor(req), req.params.id, req.body), logged500("Failed to share question bank"));
const revokeShare = handler((req) => folders.revokeShare(actor(req), req.params.id, req.params.staffId), logged500("Failed to revoke access"));

const bulkMove = handler((req) => bulk.move(actor(req), req.body), toErrorHandler);
const bulkAssignSubject = handler((req) => bulk.assignSubject(actor(req), req.body), toErrorHandler);
const bulkStatus = handler((req) => bulk.changeStatus(actor(req), req.body), toErrorHandler);
const bulkDelete = handler((req) => bulk.remove(actor(req), req.body), toErrorHandler);
const bulkCopy = handler((req) => bulk.copy(actor(req), req.body), toErrorHandler);

// ---- templates, export and bulk import ----
// The import routes answer an unexpected error with a fixed 500 message per kind of request; a file or payload problem is a 400 and a folder outside the requester's
// institute a 403. The export has no try/catch, so an unexpected error goes to the application's error handler.
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const template = (req, res) => {
  if (req.query.format === "txt") {
    const { body, filename } = templateText(req.query.type === "coding");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    return res.send(body);
  }
  const { buffer, filename } = templateWorkbook(req.query.type);
  res.setHeader("Content-Type", XLSX_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(buffer);
};

const exportQuestions = async (req, res, next) => {
  try {
    const buffer = await exporter.exportQuestions(req);
    res.setHeader("Content-Type", XLSX_TYPE);
    res.setHeader("Content-Disposition", "attachment; filename=question-bank-export.xlsx");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const importQuiz = handler((req) => importer.importFile(req, { coding: false, commit: true }), logged500("Bulk import failed"));
const previewQuiz = handler((req) => importer.importFile(req, { coding: false, commit: false }), logged500("Preview failed"));
const confirmQuiz = handler((req) => importer.confirmRows(req, { coding: false }), logged500("Import failed"));
const importCoding = handler((req) => importer.importFile(req, { coding: true, commit: true }), logged500("Bulk import failed"));
const previewCoding = handler((req) => importer.importFile(req, { coding: true, commit: false }), logged500("Preview failed"));
const confirmCoding = handler((req) => importer.confirmRows(req, { coding: true }), logged500("Import failed"));
const previewCombined = handler((req) => importer.previewCombined(req), logged500("Preview failed"));
const confirmCombined = handler((req) => importer.confirmCombined(req), logged500("Import failed"));

module.exports = {
  create, edit, duplicate, uploadImage, removeImage, remove, list, filters, getOne, analytics, previewStarterCode, validateTestCases,
  listFolders, createFolder, editFolder, deletePreview, deleteFolder, clearFolder, mergeFolder, listShares, shareFolder, revokeShare, bulkMove, bulkAssignSubject, bulkStatus, bulkDelete, bulkCopy,
  template, exportQuestions, importQuiz, previewQuiz, confirmQuiz, importCoding, previewCoding, confirmCoding, previewCombined, confirmCombined,
};
