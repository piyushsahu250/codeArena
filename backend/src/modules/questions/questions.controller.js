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

module.exports = { create, edit, duplicate, uploadImage, removeImage, remove, list, filters, getOne, analytics, previewStarterCode, validateTestCases };
