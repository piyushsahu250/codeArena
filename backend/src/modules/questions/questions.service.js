// Question-bank authoring: create, list, filters, read one, edit, duplicate, delete, image attach and remove, analytics, and the two authoring helpers (starter-code
// preview and test-case validation). No req/res: the controller passes an `actor` { req, user, requesterInstituteId }; `req` is used only where the shared
// visibility helpers and the audit entry need it. Behaviour, status codes and messages are those of the routes this replaced
// (see backend/test/snapshots/questions-contract.json).
const { ServiceError } = require("../../utils/serviceError");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { questionVisibilityWhere, ownsQuestionRow } = require("../../utils/questionVisibility");
const { resolveSubjectUnitTopic } = require("../../utils/subjectAccess");
const { validateQuestionForVerification } = require("../../utils/questionValidation");
const { validateSignature, generateStarterCode, languagesSupportedBy } = require("../../utils/functionHarness");
const { guardStarterCodeIsNotSolution } = require("../../utils/starterCodeGuard");
const { judgeSubmission } = require("../../utils/judgeGateway");
const { runQueued } = require("../../utils/queue");
const { cached } = require("../../utils/cache");
const questionImages = require("../../utils/questionImages");
const d = require("./questions.domain");
const repo = require("./questions.repository");
const { validateReferenceSolutions } = require("./questions.verification");

const audit = (actor, details) => logAudit({ req: actor.req, action: details.action, actorId: actor.user.id, actorName: actor.user.name, actorRole: actor.user.role, instituteId: actor.requesterInstituteId, details: details.details });
const CREATED = AUDIT_ACTIONS.QUESTION_CREATED;
const UPDATED = AUDIT_ACTIONS.QUESTION_UPDATED;

async function requireOwned(actor, id, load) {
  const question = await load(id);
  // 404, not 403, on a cross-institute id: it does not confirm whether the id exists at all.
  if (!question || !ownsQuestionRow(actor.req, question)) throw new ServiceError(404, "Question not found");
  return question;
}
async function requireFolder(actor, folderId, load) {
  const folder = await load(folderId);
  if (!folder || !ownsQuestionRow(actor.req, folder)) throw new ServiceError(403, "That folder isn't in your institute's question bank");
  return folder;
}
async function resolveClassification(actor, input) {
  const resolved = await resolveSubjectUnitTopic(actor.req, input);
  if (resolved.error) throw new ServiceError(400, resolved.error);
  return resolved;
}

// ---------------------------------------------------------------- create
async function createQuestion(actor, body) {
  const { description, subjectId, unitId, topicId, folderId, allowDuplicate } = body;
  if (!description) throw new ServiceError(400, "Question text is required");

  const resolvedSubject = await resolveClassification(actor, { subjectId, unitId, topicId });
  if (folderId) await requireFolder(actor, folderId, repo.findFolder);

  if (!allowDuplicate) {
    // Subject and Unit scoped: "Java Unit 1" and "DBMS Unit 1" are never cross-flagged just because the text matches.
    const duplicate = await repo.findDuplicate(actor.req, { folderId, subjectId: resolvedSubject.subjectId, unitId: resolvedSubject.unitId, description });
    if (duplicate) {
      throw new ServiceError(409, "Duplicate question", { rawBody: { duplicate: true, existing: { id: duplicate.id, title: duplicate.title, description: duplicate.description } } });
    }
  }

  const { type, data } = d.createBase(body, resolvedSubject, actor);
  let part;
  if (type === "CODING") part = d.createCoding(body);
  else if (type === "SQL") part = d.createSql(body);
  else if (type === "NUMERICAL") part = d.createNumerical(body);
  else part = d.createQuiz(type, body);
  Object.assign(data, part.data);

  if (type === "CODING" && data.starterCodeByLanguage) {
    const guardError = await guardStarterCodeIsNotSolution({
      starterCodeByLanguage: data.starterCodeByLanguage, testCases: part.cases,
      evaluationType: data.evaluationType, functionSignature: data.functionSignature,
      timeLimitMs: data.timeLimitMs, memoryLimitKb: data.memoryLimitKb,
      comparisonMode: data.comparisonMode, floatAbsoluteTolerance: data.floatAbsoluteTolerance, floatRelativeTolerance: data.floatRelativeTolerance,
    });
    if (guardError) throw new ServiceError(400, guardError, { starterCodeIsSolution: true });
  }

  const question = await repo.createQuestion(data);
  await audit(actor, { action: CREATED, details: { questionId: question.id, title: d.label(question) } });
  return question;
}

// ---------------------------------------------------------------- read
// Paginated: a bank can run into the thousands of questions. Presigning image URLs is a local computation, so doing it for a page is cheap.
async function listQuestions(req) {
  const where = d.buildWhere(req.query, req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
  const [rows, total] = await repo.listPage(where, page, pageSize);
  await questionImages.attachQuestionImageUrls(rows);
  return { rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

// Scoped the same way the list is, so a dropdown never surfaces a value that exists only in another institute's bank. A STAFF requester sees only their own and
// legacy content anyway, so the creators query is skipped for them.
async function filterOptions(req) {
  const visible = { ...questionVisibilityWhere(req), moduleCodingTestId: null };
  const { subjects, topics, creators } = await repo.filterLists(visible, req.user.role !== "STAFF");
  // "Needs classification": questions that predate the Subject/Unit taxonomy (no subject) or have a subject but no unit.
  const [needsClassificationCount, noSubjectCount] = await repo.classificationCounts(visible);
  return {
    // Legacy free-text lists, kept for questions that still carry only the old subject/topic strings.
    subjects: subjects.map((s) => s.subject).filter(Boolean).sort(),
    topics: topics.map((t) => t.topic).filter(Boolean).sort(),
    creators: creators.sort((a, b) => a.name.localeCompare(b.name)),
    needsClassificationCount,
    noSubjectCount,
  };
}

async function getQuestion(actor, id) {
  const question = await requireOwned(actor, id, repo.findQuestionDetail);
  await questionImages.attachQuestionImageUrls(question);
  return question;
}

// ---------------------------------------------------------------- edit
async function editQuestion(actor, id, body) {
  const existing = await requireOwned(actor, id, repo.findQuestionForAccess);
  // Declared change: an edit could blank the question text (the create route requires it, the edit took any non-null string, "" included).
  if (body.description !== undefined && body.description !== null && !String(body.description).trim()) throw new ServiceError(400, "Question text is required");
  const { folderId, subjectId, unitId, topicId, testCases, starterCodeByLanguage } = body;

  if (folderId !== undefined && folderId !== null && folderId !== existing.folderId) await requireFolder(actor, folderId, repo.findFolderWithShares);

  // Classification is re-validated only when the caller sends it: an edit that does not touch it (fixing a typo) must not force reclassifying a legacy question.
  let resolvedSubject = { subjectId: existing.subjectId, unitId: existing.unitId, topicId: existing.topicId };
  if (subjectId !== undefined || unitId !== undefined) {
    resolvedSubject = await resolveClassification(actor, {
      subjectId: subjectId !== undefined ? subjectId : existing.subjectId,
      unitId: unitId !== undefined ? unitId : existing.unitId,
      topicId: topicId !== undefined ? topicId : existing.topicId,
    });
  }

  const { type, data } = d.editBase(body, existing, resolvedSubject, actor);
  if (type === "CODING") {
    d.editCoding(body, existing, data);
    // Only when THIS request supplies starterCodeByLanguage: an edit that does not touch starter code must never re-trigger the guard against a question's
    // pre-existing (possibly already bad) starter code.
    if (starterCodeByLanguage !== undefined && data.starterCodeByLanguage) {
      const guardCases = testCases || (await repo.testCasesOf(existing.id));
      const guardError = await guardStarterCodeIsNotSolution({
        starterCodeByLanguage: data.starterCodeByLanguage, testCases: guardCases,
        evaluationType: data.evaluationType, functionSignature: data.functionSignature,
        timeLimitMs: data.timeLimitMs, memoryLimitKb: data.memoryLimitKb,
        comparisonMode: data.comparisonMode, floatAbsoluteTolerance: data.floatAbsoluteTolerance, floatRelativeTolerance: data.floatRelativeTolerance,
      });
      if (guardError) throw new ServiceError(400, guardError, { starterCodeIsSolution: true });
    }
  } else if (type === "SQL") d.editSql(body, existing, data);
  else if (type === "NUMERICAL") d.editNumerical(body, data);
  else d.editQuiz(type, body, existing, data);

  if (data.questionStatus === "VERIFIED" && (type === "CODING" || type === "SQL")) {
    const effectiveCases = testCases || (await repo.testCasesOf(existing.id));
    const merged = { ...existing, ...data };
    const reasons = validateQuestionForVerification(merged, effectiveCases);
    // Execute the stored solution only once the structural checks pass.
    if (reasons.length === 0) reasons.push(...(await validateReferenceSolutions(merged, effectiveCases)));
    if (reasons.length > 0) throw new ServiceError(400, "Cannot mark as VERIFIED — this question isn't ready yet", { reasons });
  }

  const question = await repo.updateQuestion(existing.id, data);
  await audit(actor, { action: UPDATED, details: { questionId: question.id, title: d.label(question) } });
  await questionImages.attachQuestionImageUrls(question);
  return question;
}

// ---------------------------------------------------------------- duplicate
// A near-identical starting point in the SAME bank ("Two Sum" becomes "Two Sum (Copy)"), unlike bulk-copy which moves a question into a different bank.
async function duplicateQuestion(actor, id) {
  const original = await requireOwned(actor, id, repo.findQuestionForDuplicate);
  // The image columns are excluded: only the database row is copied, so a clone that kept the same imageKey would delete the original's image when its own was
  // removed. A duplicate starts with no image.
  const { id: _id, questionNumber, createdAt, testCases, createdById: _c, instituteId: _i, imageKey: _ik, imageMimeType: _imt, ...rest } = original;
  const clone = await repo.createQuestion({
    ...rest,
    title: rest.title ? `${rest.title} (Copy)` : rest.title,
    // A duplicate is unreviewed content until an admin re-checks it, whatever the original's own status.
    questionStatus: "DRAFT",
    instituteId: actor.requesterInstituteId,
    createdById: actor.user.id,
    testCases: { create: testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation || null })) },
  });
  await audit(actor, { action: CREATED, details: { questionId: clone.id, title: d.label(clone), duplicatedFrom: original.id } });
  return clone;
}

// ---------------------------------------------------------------- delete
async function deleteQuestion(actor, id) {
  const existing = await requireOwned(actor, id, repo.findQuestionForAccess);
  const withHistory = await repo.questionIdsWithSubmissionHistory([existing.id]);
  if (withHistory.has(existing.id)) throw new ServiceError(409, d.SUBMISSION_HISTORY_BLOCK_MESSAGE);
  try {
    await repo.deleteQuestion(id);
  } catch (err) {
    if (d.isReferencedByRestrict(err)) throw new ServiceError(409, d.USED_IN_TEST_MESSAGE);
    throw err;
  }
  await questionImages.deleteQuestionImage(existing.imageKey);
  await audit(actor, { action: AUDIT_ACTIONS.QUESTION_DELETED, details: { questionId: existing.id, title: d.label(existing) } });
  return { success: true };
}

// ---------------------------------------------------------------- images
// Any prior image is deleted from storage only after the new one is stored and the row repointed, so a failed upload never leaves a broken or missing image.
async function uploadImage(actor, id, file) {
  if (!questionImages.isConfigured()) throw new ServiceError(503, "Image storage isn't configured on this server yet");
  const existing = await requireOwned(actor, id, repo.findQuestionForAccess);
  if (!file) throw new ServiceError(400, "No image uploaded");
  const mime = questionImages.sniffImageMime(file.buffer);
  if (!mime) throw new ServiceError(400, "Unsupported or unrecognized image format — use PNG, JPEG, GIF, or WebP");

  const imageKey = await questionImages.uploadQuestionImage(existing.id, file.buffer, mime);
  const question = await repo.updateQuestion(existing.id, { imageKey, imageMimeType: mime });
  if (existing.imageKey && existing.imageKey !== imageKey) await questionImages.deleteQuestionImage(existing.imageKey);
  await audit(actor, { action: UPDATED, details: { questionId: question.id, title: d.label(question), imageUploaded: true } });
  await questionImages.attachQuestionImageUrls(question);
  return question;
}

async function removeImage(actor, id) {
  const existing = await requireOwned(actor, id, repo.findQuestionForAccess);
  if (!existing.imageKey) return { success: true }; // already has none
  const question = await repo.updateQuestion(existing.id, { imageKey: null, imageMimeType: null });
  await questionImages.deleteQuestionImage(existing.imageKey);
  await audit(actor, { action: UPDATED, details: { questionId: question.id, title: d.label(question), imageRemoved: true } });
  return question;
}

// ---------------------------------------------------------------- analytics
// Bank health: counts by status, type and difficulty, plus attempt-based stats computed with groupBy / aggregate against Submission rows, never by loading and
// summing rows here. Submission rows come only from formal-test coding questions, so this reflects formal-assessment performance specifically.
async function computeAnalytics(req) {
  const where = questionVisibilityWhere(req);
  const [byStatus, byType, byDifficulty, total] = await repo.analyticsTotals(where);
  const scopedQuestions = await repo.analyticsQuestions(where);
  const idToQuestion = new Map(scopedQuestions.map((q) => [q.id, q]));
  const perQuestion = await repo.submissionStats(scopedQuestions.map((q) => q.id));

  const withStats = perQuestion.map((p) => {
    const q = idToQuestion.get(p.questionId);
    const totalCases = p._sum.totalCases || 0;
    return {
      questionId: p.questionId,
      title: q?.title || (q?.description ? q.description.slice(0, 60) : "Untitled"),
      subject: q?.subject || null,
      topic: q?.topic || null,
      attempts: p._count,
      avgScore: Math.round((p._avg.score || 0) * 10) / 10,
      passRate: totalCases > 0 ? Math.round(((p._sum.passedCases || 0) / totalCases) * 1000) / 10 : null,
      avgTimeMs: p._avg.timeMs != null ? Math.round(p._avg.timeMs) : null,
    };
  });

  const totalAttempts = withStats.reduce((s, q) => s + q.attempts, 0);
  const avgScoreOverall = withStats.length > 0 ? withStats.reduce((s, q) => s + q.avgScore, 0) / withStats.length : 0;
  // A question with fewer than 3 attempts is never flagged: one lucky or unlucky attempt is not a signal yet. A consistently ~100% pass rate over real volume is its
  // own quality signal (possibly trivial, or a leaked or guessable key), not just "good".
  const rated = withStats.filter((q) => q.attempts >= 3 && q.passRate !== null);
  const mostDifficult = [...rated].sort((a, b) => a.passRate - b.passRate).slice(0, 10);
  const mostTrivial = [...rated].sort((a, b) => b.passRate - a.passRate).slice(0, 10);
  const mostAttempted = [...withStats].sort((a, b) => b.attempts - a.attempts).slice(0, 10);

  // A coding or SQL question with no formal-test submission ever is dead weight worth pruning or a sign it was added and forgotten.
  const attemptedIds = new Set(withStats.map((q) => q.questionId));
  const neverAttempted = scopedQuestions.filter((q) => !attemptedIds.has(q.id)).slice(0, 20)
    .map((q) => ({ questionId: q.id, title: q.title || (q.description ? q.description.slice(0, 60) : "Untitled"), subject: q.subject || null, topic: q.topic || null }));

  return {
    totals: {
      total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.questionStatus, r._count])),
      byType: Object.fromEntries(byType.map((r) => [r.questionType, r._count])),
      byDifficulty: Object.fromEntries(byDifficulty.map((r) => [r.difficulty, r._count])),
    },
    attempts: { questionsAttempted: withStats.length, totalAttempts, avgScore: Math.round(avgScoreOverall * 10) / 10 },
    mostDifficult,
    mostTrivial,
    mostAttempted,
    neverAttempted: { count: scopedQuestions.length - withStats.length, sample: neverAttempted },
  };
}

// Cached 60s per institute and user; the router-level hook in the questions router clears it after any successful non-GET request.
function analytics(req) {
  const instituteKey = req.requesterInstituteId || "all";
  return cached(`questionAnalytics:${instituteKey}:${req.user.role}:${req.user.id}`, 60 * 1000, () => computeAnalytics(req));
}

// ---------------------------------------------------------------- authoring helpers
// The same generator resolveCodingFields uses at save time, so the preview is guaranteed to match what is saved and judged.
function previewStarterCode(body) {
  const { functionSignature } = body;
  validateSignature(functionSignature);
  const supported = languagesSupportedBy(functionSignature);
  const starterCodeByLanguage = {};
  for (const lang of supported) starterCodeByLanguage[lang] = generateStarterCode(lang, functionSignature);
  return { starterCodeByLanguage, supportedLanguages: supported };
}

// Runs a reference solution through the judge against the question's own test cases before any student sees it: the only way to confirm every expected output is
// right (a structural check cannot catch a wrong value, an infinite loop or a case that does not match the signature). One language at a time.
async function validateTestCases(body) {
  const { language, code, testCases, evaluationType, functionSignature, sqlSchema, timeLimitMs, memoryLimitKb, comparisonMode, floatAbsoluteTolerance, floatRelativeTolerance } = body;
  if (!language || !code || !code.trim()) throw new ServiceError(400, "A reference solution is required to validate");
  const cases = Array.isArray(testCases) ? testCases : [];
  if (cases.length === 0) throw new ServiceError(400, "No test cases to validate against");

  // Validates with the comparisonMode the question is being authored with: otherwise a FLOAT_TOLERANCE draft would report its own correct solution as wrong.
  const result = await runQueued(() =>
    judgeSubmission({
      language, code, testCases: cases, timeLimitMs: timeLimitMs || 2000, memoryLimitKb: memoryLimitKb || undefined,
      evaluationType, functionSignature, sqlSchema, comparisonMode, floatAbsoluteTolerance, floatRelativeTolerance,
    })
  );
  return {
    passedCases: result.passedCases,
    totalCases: result.totalCases,
    verdict: result.verdict,
    allPassed: result.passedCases === result.totalCases,
    errorSummary: result.errorSummary,
    details: result.details,
  };
}

module.exports = {
  createQuestion, listQuestions, filterOptions, getQuestion, editQuestion, duplicateQuestion, deleteQuestion, uploadImage, removeImage, analytics, previewStarterCode, validateTestCases,
};
