// HTTP in, HTTP out. Each handler reads the request, calls the service, and maps its result or ServiceError to a response; per-route fallback messages for
// unexpected faults are the same wording students have always seen.
const { getQueueStatus } = require("../../utils/queue");
const { safeErrorMessage } = require("../../utils/errors");
const { enforceTestSession } = require("../../utils/testExamSecurity");
const { ServiceError } = require("../../utils/serviceError");
const service = require("./submissions.service");

function handler(fallbackMessage, fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, { session: (attempt) => enforceTestSession(req, res, attempt) });
      if (out === service.HANDLED) return; // the secure-session check already answered
      res.json(out);
    } catch (err) {
      if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      console.error(err);
      res.status(500).json({ error: safeErrorMessage(err, fallbackMessage) });
    }
  };
}

// Any authenticated user: how busy the judge is right now (polled while a Run/Submit is pending so a slow response reads as "N students ahead of you").
const queueStatus = (req, res) => res.json(getQueueStatus());

const run = handler("Failed to run your code. Please try again in a moment.", (req) => service.runSample({ body: req.body, requesterInstituteId: req.requesterInstituteId }));
const autosave = handler("Failed to save your code — your latest changes may not be saved. Please try again.", (req, guards) => service.autosaveDraft({ body: req.body, userId: req.user.id, guards }));
const submitCode = handler("Failed to submit your code. Please try again — if this keeps happening, contact your proctor.", (req, guards) => service.submitCode({ body: req.body, userId: req.user.id, guards }));
const submitQuiz = handler("Failed to save your answer. Please try again.", (req, guards) => service.submitQuizAnswer({ body: req.body, userId: req.user.id, guards }));
const finalize = handler("Failed to submit your test. Please try again immediately — if this persists, contact your proctor so your submission isn't lost.",
  (req, guards) => service.finalizeAttempt({ attemptId: req.params.attemptId, reason: req.body?.reason, userId: req.user.id, guards }));

module.exports = { queueStatus, run, autosave, submitCode, submitQuiz, finalize };
