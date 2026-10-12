// Bulk operations on selected questions: move into a folder, assign subject and unit, change review status, delete and copy. Each one first narrows the selection
// to the questions the requester may touch (the same ownership rule the single-question routes use) and reports how many were skipped. No req/res: the controller
// passes an `actor` { req, user, requesterInstituteId }.
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/question-folders-contract.json).
const { ServiceError } = require("../../utils/serviceError");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { ownsQuestionRow } = require("../../utils/questionVisibility");
const { resolveSubjectUnitTopic } = require("../../utils/subjectAccess");
const { validateQuestionForVerification } = require("../../utils/questionValidation");
const d = require("./questions.domain");
const repo = require("./questions.repository");
const { validateReferenceSolutions } = require("./questions.verification");

const NONE_OWNED = "None of the selected questions are in your institute's question bank";
const FOLDER_REFUSED = "That folder isn't in your institute's question bank";

const selection = (body) => (Array.isArray(body.questionIds) ? body.questionIds : []);
function requireSelection(ids) {
  if (ids.length === 0) throw new ServiceError(400, "No questions selected");
}
const auditBulk = (actor, action, details) => logAudit({ req: actor.req, action, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role, instituteId: actor.requesterInstituteId, details });

// Files several existing questions into a folder, or out of every folder (null), in one call.
async function move(actor, body) {
  const questionIds = selection(body);
  requireSelection(questionIds);
  const folderId = body.folderId || null;
  if (folderId) {
    const folder = await repo.findFolder(folderId);
    if (!folder || !ownsQuestionRow(actor.req, folder)) throw new ServiceError(403, FOLDER_REFUSED);
  }
  const movableIds = (await repo.questionsByIds(questionIds)).filter((q) => ownsQuestionRow(actor.req, q)).map((q) => q.id);
  if (movableIds.length === 0) throw new ServiceError(403, NONE_OWNED);
  await repo.moveQuestions(movableIds, folderId);
  return { movedCount: movableIds.length, skippedCount: questionIds.length - movableIds.length };
}

// The working tool for clearing the "needs classification" backlog without opening each question, behind the same Subject / Unit validation and authorization every
// other Subject / Unit write goes through.
async function assignSubject(actor, body) {
  const questionIds = selection(body);
  requireSelection(questionIds);
  const resolved = await resolveSubjectUnitTopic(actor.req, { subjectId: body.subjectId, unitId: body.unitId, topicId: body.topicId });
  if (resolved.error) throw new ServiceError(400, resolved.error);

  const updatableIds = (await repo.questionsByIds(questionIds)).filter((q) => ownsQuestionRow(actor.req, q)).map((q) => q.id);
  if (updatableIds.length === 0) throw new ServiceError(403, NONE_OWNED);
  await repo.classifyQuestions(updatableIds, { subjectId: resolved.subjectId, unitId: resolved.unitId, topicId: resolved.topicId });
  await auditBulk(actor, AUDIT_ACTIONS.QUESTION_UPDATED, { bulk: true, type: "subject_assigned", count: updatableIds.length, subjectId: resolved.subjectId, unitId: resolved.unitId });
  return { updatedCount: updatableIds.length, skippedCount: questionIds.length - updatableIds.length };
}

// Powers the review queue (filter by Draft / Under Review, select a batch, Verify or Archive). A coding or SQL question that fails the VERIFIED gate is left out of
// the batch rather than failing the whole request, and listed with its reasons.
async function changeStatus(actor, body) {
  const questionIds = selection(body);
  const { questionStatus } = body;
  requireSelection(questionIds);
  if (!d.QUESTION_STATUSES.includes(questionStatus)) throw new ServiceError(400, "Invalid review status");

  const updatable = (await repo.questionsByIds(questionIds)).filter((q) => ownsQuestionRow(actor.req, q));
  if (updatable.length === 0) throw new ServiceError(403, NONE_OWNED);

  const blocked = [];
  let finalized = updatable;
  if (questionStatus === "VERIFIED") {
    const gradable = updatable.filter((q) => q.questionType === "CODING" || q.questionType === "SQL");
    if (gradable.length > 0) {
      const cases = await repo.testCasesForQuestions(gradable.map((q) => q.id));
      const casesByQuestion = new Map();
      for (const tc of cases) {
        if (!casesByQuestion.has(tc.questionId)) casesByQuestion.set(tc.questionId, []);
        casesByQuestion.get(tc.questionId).push(tc);
      }
      for (const q of gradable) {
        const qCases = casesByQuestion.get(q.id) || [];
        const reasons = validateQuestionForVerification(q, qCases);
        // Executing the reference solution is only worth it once the structural gate has passed.
        if (reasons.length === 0) reasons.push(...(await validateReferenceSolutions(q, qCases)));
        if (reasons.length > 0) blocked.push({ id: q.id, title: q.title || q.description.slice(0, 60), reasons });
      }
      const blockedIds = new Set(blocked.map((b) => b.id));
      finalized = updatable.filter((q) => !blockedIds.has(q.id));
    }
  }
  if (finalized.length > 0) await repo.setQuestionStatus(finalized.map((q) => q.id), questionStatus, actor.user.id);
  await auditBulk(actor, AUDIT_ACTIONS.QUESTION_UPDATED, { bulk: true, count: finalized.length, questionStatus, blockedCount: blocked.length });
  return { updatedCount: finalized.length, skippedCount: questionIds.length - finalized.length, blocked };
}

// One row at a time (not deleteMany) so a mixed selection partially succeeds instead of failing on the first protected question.
async function remove(actor, body) {
  const questionIds = selection(body);
  requireSelection(questionIds);
  const owned = await repo.questionsByIds(questionIds);
  const withHistory = await repo.questionIdsWithSubmissionHistory(owned.map((q) => q.id));
  const blocked = [];
  let deletedCount = 0;
  for (const q of owned) {
    if (!ownsQuestionRow(actor.req, q)) continue;
    if (withHistory.has(q.id)) { blocked.push(d.blockedEntry(q, d.BLOCKED_BY_HISTORY)); continue; }
    try {
      await repo.deleteQuestion(q.id);
      deletedCount++;
    } catch (err) {
      // Declared change: a question a test uses is restricted by the database, which Prisma reports with no error code, so this check never matched and the
      // whole request failed with a 500 on the first such question. It is now listed as blocked, as intended.
      if (d.isReferencedByRestrict(err)) blocked.push(d.blockedEntry(q, d.BLOCKED_BY_TEST));
      else throw err;
    }
  }
  if (deletedCount > 0) await auditBulk(actor, AUDIT_ACTIONS.QUESTION_DELETED, { bulk: true, count: deletedCount });
  return { deletedCount, skippedCount: questionIds.length - deletedCount - blocked.length, blocked };
}

// Clones questions (with test cases) into a DIFFERENT bank. A question already in the target is skipped rather than cloned into itself, which would create the
// exact duplicates the duplicate detection elsewhere tries to prevent.
async function copy(actor, body) {
  const questionIds = selection(body);
  const folderId = body.folderId || null;
  requireSelection(questionIds);
  if (!folderId) throw new ServiceError(400, "A destination question bank is required");
  const folder = await repo.findFolder(folderId);
  if (!folder || !ownsQuestionRow(actor.req, folder)) throw new ServiceError(403, FOLDER_REFUSED);

  const owned = await repo.questionsByIds(questionIds, { withTests: true });
  let copiedCount = 0;
  let skippedCount = questionIds.length - owned.length;
  for (const q of owned) {
    if (!ownsQuestionRow(actor.req, q) || q.folderId === folderId) { skippedCount++; continue; }
    await repo.copyQuestion(d.copiedQuestionData(q, actor, folderId));
    copiedCount++;
  }
  return { copiedCount, skippedCount };
}

module.exports = { move, assignSubject, changeStatus, remove, copy };
