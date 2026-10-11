// HTTP in, HTTP out for the test-authoring routes. Builds the acting-user object from the AUTHENTICATED request, calls the service and maps results and
// ServiceErrors to responses. Two failure styles are preserved from the routes this replaced:
//   create / edit:   any unexpected error answers 400 with its message (validation errors are plain Errors), unless it carries a status;
//   everything else: an unexpected fault answers 500 with a fixed message.
const { safeErrorMessage } = require("../../utils/errors");
const { ServiceError } = require("../../utils/serviceError");
const service = require("./tests.service");

const actor = (req) => ({ user: req.user, requesterInstituteId: req.requesterInstituteId, req });

function send(res, out) {
  if (out && out[service.AFTER]) { res.json(out.body); out[service.AFTER](); return; }
  res.json(out);
}

function handler(fallback, fn, { badRequestOnError = false } = {}) {
  return async (req, res) => {
    try {
      send(res, await fn(req));
    } catch (err) {
      if (err instanceof ServiceError) {
        if (err.extra && err.extra.rawBody) return res.status(err.status).json(err.extra.rawBody);
        return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      }
      console.error(err);
      if (badRequestOnError) return res.status(400).json({ error: safeErrorMessage(err, fallback) });
      res.status(500).json({ error: fallback });
    }
  };
}

const create = handler("Failed to create test", (req) => service.createTest(actor(req), req.body), { badRequestOnError: true });
const update = handler("Failed to update test", (req) => service.updateTest(actor(req), req.params.id, req.body), { badRequestOnError: true });
const duplicate = handler("Failed to duplicate test", (req) => service.duplicateTest(actor(req), req.params.id));
const remove = handler("Failed to delete test", (req) => service.deleteTest(actor(req), req.params.id));
const publish = handler("Failed to update publish status", (req) => service.setPublished(actor(req), req.params.id, req.body.isPublished));
const recipients = handler("Failed to compute recipients", (req) => service.notificationRecipients(actor(req), req.params.id));
const notify = handler("Failed to send notification", (req) => service.notify(actor(req), req.params.id, req.body));
const notificationLog = handler("Failed to load notification log", (req) => service.notificationLog(actor(req), req.params.id));
const share = handler("Failed to share test", (req) => service.shareTest(actor(req), req.params.id, req.body.staffIds));
const unshare = handler("Failed to revoke access", (req) => service.unshareTest(actor(req), req.params.id, req.params.staffId));
const staffDirectory = handler("Failed to load staff directory", (req) => service.staffDirectory(actor(req)));

module.exports = { create, update, duplicate, remove, publish, recipients, notify, notificationLog, share, unshare, staffDirectory };

// ---- batch 2: reading tests and the student attempt flow ----
const read = require("./tests.read.service");
const attempts = require("./tests.attempts.service");
const { sendAiError } = require("../../utils/aiErrors");

const list = handler("Failed to load tests", (req) => read.listTests(actor(req)));
const getOne = handler("Failed to load test", (req) => read.getTest(actor(req), req.params.id));
const start = handler("Could not start test", (req) => attempts.startAttempt(actor(req), req.params.id));
const violation = handler("Failed to record violation", (req) => attempts.recordViolation(actor(req), req.params.attemptId, req.body.type));
const violationLog = handler("Failed to load violation log", (req) => attempts.violationLog(actor(req), req.params.attemptId));
const myResult = handler("Failed to load result", (req) => attempts.myResult(actor(req), req.params.id));
// AI errors keep their own mapping (quota, provider, safety) through the shared helper.
async function aiAssist(req, res) {
  try {
    res.json(await attempts.aiAssist(actor(req), req.params.attemptId, req.body));
  } catch (err) {
    if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    sendAiError(res, err, "Failed to get AI assistance");
  }
}

Object.assign(module.exports, { list, getOne, start, violation, violationLog, myResult, aiAssist });
