// Question-bank export to .xlsx. An explicit `questionIds` (comma-separated or repeated) overrides the filter-based selection entirely, which is what "Export selected"
// from the bulk action bar uses. Behaviour and messages are those of the route this replaced (see backend/test/snapshots/question-import-export-contract.json).
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const repo = require("./questions.repository");
const { exportWorkbook } = require("./questions.import.domain");

async function exportQuestions(req) {
  const wanted = req.query.questionIds;
  const questions = wanted
    ? await repo.exportByIds(req, Array.isArray(wanted) ? wanted : String(wanted).split(",").map((s) => s.trim()).filter(Boolean))
    : await repo.exportByFilter(req);
  const buffer = exportWorkbook(questions);
  await logAudit({
    req, action: AUDIT_ACTIONS.QUESTION_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
    instituteId: req.requesterInstituteId, details: { count: questions.length },
  });
  return buffer;
}

module.exports = { exportQuestions };
