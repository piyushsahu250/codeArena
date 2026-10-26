// Question-bank rules that need no database: the allowed values, the list filter, how a create or edit request becomes the stored fields, and the messages. The
// type-specific parts (coding, SQL, numerical, quiz) throw a ServiceError with the same status and message the routes this replaced answered with.
// Behaviour is that of the routes this replaced (see backend/test/snapshots/questions-contract.json).
const { ServiceError } = require("../../utils/serviceError");
const { questionVisibilityWhere } = require("../../utils/questionVisibility");
const { normalizeOptions } = require("../../utils/mcqOptions");
const { normalizeExpectedNumeric } = require("../../utils/numericAnswer");
const { resolveCodingFields } = require("../../utils/functionHarness");

const QUESTION_TYPES = ["CODING", "MCQ", "TRUE_FALSE", "MULTISELECT", "SQL", "NUMERICAL"];
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
// Employability and Subject Readiness fields: see Question.btlLevel and Question.questionStatus in the schema.
const BTL_LEVELS = [1, 2, 3, 4, 5, 6];
const QUESTION_STATUSES = ["DRAFT", "UNDER_REVIEW", "VERIFIED", "PUBLISHED", "ARCHIVED"];
// The authoring-time allowlist; judge.js compareOutputs() defines what each mode does at grading time.
const COMPARISON_MODES = ["EXACT", "TRIM", "IGNORE_TRAILING_SPACES", "TOKEN", "FLOAT_TOLERANCE"];

const SUBMISSION_HISTORY_BLOCK_MESSAGE =
  "This question already has student submissions and can't be permanently deleted. Set its Review Status to Archived instead to remove it from future use while preserving those records.";
const USED_IN_TEST_MESSAGE = "This question is used in one or more tests and can't be deleted.";

// A database RESTRICT violation (a question still referenced by a test) reaches Prisma as an unknown request error with NO code, so the P2003 / P2014 checks the
// delete routes relied on never matched and such a delete answered 500 instead of the intended message. The Postgres text is the reliable signal.
function isReferencedByRestrict(err) {
  if (!err) return false;
  if (err.code === "P2003" || err.code === "P2014") return true;
  return /violates RESTRICT setting of foreign key constraint/i.test(String(err.message || ""));
}

// Module Coding Test questions live in the same table but are a separate authoring surface with no folder, institute or creator of their own, which the
// "null means shared" visibility convention would otherwise leak into every institute's bank. Excluded here unconditionally.
function buildWhere(query, req) {
  const where = { AND: [questionVisibilityWhere(req), { moduleCodingTestId: null }] };
  if (query.subject) where.subject = query.subject;
  if (query.topic) where.topic = query.topic;
  if (query.subjectId === "__none__") where.subjectId = null;
  else if (query.subjectId) where.subjectId = query.subjectId;
  if (query.unitId === "__none__") where.unitId = null;
  else if (query.unitId) where.unitId = query.unitId;
  if (query.topicId) where.topicId = query.topicId;
  if (query.difficulty && DIFFICULTIES.includes(query.difficulty)) where.difficulty = query.difficulty;
  if (query.questionType && QUESTION_TYPES.includes(query.questionType)) where.questionType = query.questionType;
  if (query.btlLevel && BTL_LEVELS.includes(Number(query.btlLevel))) where.btlLevel = Number(query.btlLevel);
  if (query.folderId === "__none__") where.folderId = null;
  else if (query.folderId) where.folderId = query.folderId;
  if (query.createdById) where.createdById = query.createdById;
  if (query.questionStatus && QUESTION_STATUSES.includes(query.questionStatus)) where.questionStatus = query.questionStatus;
  if (query.aiGenerated === "true") where.aiGenerated = true;
  if (query.q) {
    where.AND.push({
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { subject: { contains: query.q, mode: "insensitive" } },
        { topic: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  return where;
}

// "BTL-3" / "3" / "Level 3" / "" becomes 3 / null. Throws only on a value that is present but does not resolve to 1-6: someone who typed something meant to set a
// level, so a garbled value should surface as a row error rather than import with no level at all.
function parseBtlLevel(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/[1-6]/);
  if (!m) throw new Error(`Invalid BTL "${raw}" — use 1-6 (or BTL-1 .. BTL-6)`);
  return Number(m[0]);
}

const label = (q) => q.title || q.description.slice(0, 60);
const countVisible = (cases) => cases.filter((tc) => !tc.isHidden).length;
const countHidden = (cases) => cases.filter((tc) => tc.isHidden).length;
const testCaseRows = (cases, { sql = false } = {}) => cases.map((tc) => ({ input: sql ? tc.input || "" : tc.input, expected: tc.expected, isHidden: tc.isHidden ?? true, explanation: tc.explanation || null }));

// ---- the fields common to every type, for a create ----
function createBase(body, resolved, actor) {
  const { title, description, subject, topic, difficulty, points, explanation, folderId, estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
    edgeCases, problemExplanation, hints, timeComplexity, spaceComplexity, editorial, similarQuestions, subtopic, btlLevel, skillTested, questionStatus, aiGenerated } = body;
  const type = QUESTION_TYPES.includes(body.questionType) ? body.questionType : "CODING";
  return {
    type,
    data: {
      title: title || null,
      description,
      subject: subject || null,
      topic: topic || null,
      subjectId: resolved.subjectId,
      unitId: resolved.unitId,
      topicId: resolved.topicId,
      questionType: type,
      difficulty: difficulty || "EASY",
      points: points ?? 10,
      explanation: explanation || null,
      instituteId: actor.requesterInstituteId,
      folderId: folderId || null,
      createdById: actor.user.id,
      estimatedTimeMin: estimatedTimeMin ?? null,
      realWorldScenario: realWorldScenario || null,
      constraints: constraints || null,
      inputFormat: inputFormat || null,
      outputFormat: outputFormat || null,
      notes: notes || null,
      edgeCases: edgeCases || null,
      problemExplanation: problemExplanation || null,
      hints: hints ?? undefined,
      timeComplexity: timeComplexity || null,
      spaceComplexity: spaceComplexity || null,
      editorial: editorial ?? undefined,
      similarQuestions: similarQuestions ?? undefined,
      // A question with no btlLevel stays ineligible for a Readiness blueprint but fully usable everywhere else.
      subtopic: subtopic || null,
      btlLevel: BTL_LEVELS.includes(Number(btlLevel)) ? Number(btlLevel) : null,
      skillTested: skillTested || null,
      aiGenerated: !!aiGenerated,
      // AI-drafted content must pass a review before it can reach a live assessment, so it defaults to DRAFT; human-authored content defaults to PUBLISHED.
      questionStatus: QUESTION_STATUSES.includes(questionStatus) ? questionStatus : (aiGenerated ? "DRAFT" : "PUBLISHED"),
    },
  };
}

// ---- the type-specific fields for a create. Returns the fields to add; `cases` is what the starter-code guard is later checked against ----
function createCoding(body) {
  const { timeLimitMs, starterCode, testCases, evaluationType, functionSignature, starterCodeByLanguage, referenceSolution, memoryLimitKb, tags, comparisonMode, floatAbsoluteTolerance, floatRelativeTolerance } = body;
  const cases = testCases || [];
  // Visible samples drive the student's Run button; hidden cases are what the final Submit score is based on (see gradeAttempt.js).
  if (countVisible(cases) < 2) throw new ServiceError(400, "Each coding question needs at least 2 visible sample test cases");
  if (countHidden(cases) < 5) throw new ServiceError(400, "Each coding question needs at least 5 hidden test cases for final evaluation");
  if (comparisonMode !== undefined && !COMPARISON_MODES.includes(comparisonMode)) throw new ServiceError(400, `comparisonMode must be one of: ${COMPARISON_MODES.join(", ")}`);
  const data = {
    timeLimitMs: timeLimitMs ?? 2000,
    memoryLimitKb: memoryLimitKb || null,
    starterCode: starterCode || "",
    tags: Array.isArray(tags) && tags.length > 0 ? tags : undefined,
    comparisonMode: COMPARISON_MODES.includes(comparisonMode) ? comparisonMode : "TRIM",
  };
  // Only meaningful for FLOAT_TOLERANCE but stored regardless, so switching a question to it later needs no migration for already-sane defaults.
  if (typeof floatAbsoluteTolerance === "number" && floatAbsoluteTolerance >= 0) data.floatAbsoluteTolerance = floatAbsoluteTolerance;
  if (typeof floatRelativeTolerance === "number" && floatRelativeTolerance >= 0) data.floatRelativeTolerance = floatRelativeTolerance;
  const resolved = resolveCodingFields({ evaluationType, functionSignature, starterCodeByLanguage, testCases: cases });
  data.evaluationType = resolved.evaluationType;
  data.functionSignature = resolved.functionSignature;
  if (resolved.starterCodeByLanguage) data.starterCodeByLanguage = resolved.starterCodeByLanguage;
  if (referenceSolution && typeof referenceSolution === "object") data.referenceSolution = referenceSolution;
  data.testCases = { create: testCaseRows(cases) };
  return { data, cases };
}

function createSql(body) {
  const { sqlSchema, timeLimitMs, testCases } = body;
  if (!sqlSchema || !sqlSchema.trim()) throw new ServiceError(400, "SQL questions need setup SQL (schema + seed data)");
  const cases = testCases || [];
  if (countVisible(cases) < 1) throw new ServiceError(400, "Each SQL question needs at least 1 visible sample test case");
  // Each SQL hidden case carries its own additional setup SQL; the same 5-hidden-case minimum as coding applies.
  if (countHidden(cases) < 5) throw new ServiceError(400, "Each SQL question needs at least 5 hidden test cases for final evaluation");
  return { data: { sqlSchema, timeLimitMs: timeLimitMs ?? 3000, testCases: { create: testCaseRows(cases, { sql: true }) } } };
}

const toleranceError = () => new ServiceError(400, "Tolerance must be a non-negative number (use 0 for an exact match)");

function createNumerical(body) {
  const { numericAnswer, numericTolerance } = body;
  const { numericAnswer: normVal, numericAnswerDisplay } = normalizeExpectedNumeric(numericAnswer);
  const tol = Number(numericTolerance);
  if (numericTolerance !== undefined && numericTolerance !== null && numericTolerance !== "" && (!Number.isFinite(tol) || tol < 0)) throw toleranceError();
  return { data: { numericAnswer: normVal, numericAnswerDisplay, numericTolerance: Number.isFinite(tol) && tol > 0 ? tol : 0 } };
}

function createQuiz(type, body) {
  const normalized = normalizeOptions(type, body.options, body.correctAnswer);
  return { data: { options: normalized.options, correctAnswer: normalized.correctAnswer } };
}

// ---- an edit: the fields common to every type ----
function editBase(body, existing, resolved, actor) {
  const { title, description, subject, topic, difficulty, points, explanation, folderId, estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
    edgeCases, problemExplanation, hints, timeComplexity, spaceComplexity, editorial, similarQuestions, subtopic, btlLevel, skillTested, questionStatus } = body;
  const keep = (value, current) => (value !== undefined ? value : current);
  const type = QUESTION_TYPES.includes(body.questionType) ? body.questionType : existing.questionType;
  return {
    type,
    data: {
      updatedById: actor.user.id,
      title: title ?? existing.title,
      description: description ?? existing.description,
      subject: subject ?? existing.subject,
      topic: topic ?? existing.topic,
      subjectId: resolved.subjectId,
      unitId: resolved.unitId,
      topicId: resolved.topicId,
      questionType: type,
      difficulty: difficulty || existing.difficulty,
      points: points ?? existing.points,
      explanation: explanation ?? existing.explanation,
      folderId: keep(folderId, existing.folderId),
      estimatedTimeMin: keep(estimatedTimeMin, existing.estimatedTimeMin),
      realWorldScenario: keep(realWorldScenario, existing.realWorldScenario),
      constraints: keep(constraints, existing.constraints),
      inputFormat: keep(inputFormat, existing.inputFormat),
      outputFormat: keep(outputFormat, existing.outputFormat),
      notes: keep(notes, existing.notes),
      edgeCases: keep(edgeCases, existing.edgeCases),
      problemExplanation: keep(problemExplanation, existing.problemExplanation),
      hints: keep(hints, existing.hints),
      timeComplexity: keep(timeComplexity, existing.timeComplexity),
      spaceComplexity: keep(spaceComplexity, existing.spaceComplexity),
      editorial: keep(editorial, existing.editorial),
      similarQuestions: keep(similarQuestions, existing.similarQuestions),
      subtopic: subtopic !== undefined ? (subtopic || null) : existing.subtopic,
      btlLevel: btlLevel !== undefined ? (BTL_LEVELS.includes(Number(btlLevel)) ? Number(btlLevel) : null) : existing.btlLevel,
      skillTested: skillTested !== undefined ? (skillTested || null) : existing.skillTested,
      questionStatus: questionStatus !== undefined ? (QUESTION_STATUSES.includes(questionStatus) ? questionStatus : existing.questionStatus) : existing.questionStatus,
    },
  };
}

function editCoding(body, existing, data) {
  const { timeLimitMs, starterCode, testCases, evaluationType, functionSignature, starterCodeByLanguage, referenceSolution, memoryLimitKb, tags, comparisonMode, floatAbsoluteTolerance, floatRelativeTolerance } = body;
  if (comparisonMode !== undefined && !COMPARISON_MODES.includes(comparisonMode)) throw new ServiceError(400, `comparisonMode must be one of: ${COMPARISON_MODES.join(", ")}`);
  data.timeLimitMs = timeLimitMs ?? existing.timeLimitMs;
  data.memoryLimitKb = memoryLimitKb !== undefined ? (memoryLimitKb || null) : existing.memoryLimitKb;
  data.starterCode = starterCode ?? existing.starterCode;
  data.comparisonMode = comparisonMode !== undefined ? comparisonMode : existing.comparisonMode;
  data.floatAbsoluteTolerance = typeof floatAbsoluteTolerance === "number" && floatAbsoluteTolerance >= 0 ? floatAbsoluteTolerance : existing.floatAbsoluteTolerance;
  data.floatRelativeTolerance = typeof floatRelativeTolerance === "number" && floatRelativeTolerance >= 0 ? floatRelativeTolerance : existing.floatRelativeTolerance;
  data.tags = tags !== undefined ? (Array.isArray(tags) && tags.length > 0 ? tags : null) : undefined;
  data.options = null;
  data.correctAnswer = null;

  const resolved = resolveCodingFields({
    evaluationType: evaluationType !== undefined ? evaluationType : existing.evaluationType,
    functionSignature: functionSignature !== undefined ? functionSignature : existing.functionSignature,
    starterCodeByLanguage: starterCodeByLanguage !== undefined ? starterCodeByLanguage : existing.starterCodeByLanguage,
    testCases: Array.isArray(testCases) ? testCases : undefined, // checked against the signature only when the cases are part of this edit
  });
  data.evaluationType = resolved.evaluationType;
  data.functionSignature = resolved.functionSignature;
  if (resolved.starterCodeByLanguage) data.starterCodeByLanguage = resolved.starterCodeByLanguage;
  if (referenceSolution !== undefined) data.referenceSolution = referenceSolution && typeof referenceSolution === "object" ? referenceSolution : null;
  data.sqlSchema = null; // clear a stale value left over if this question used to be SQL

  if (testCases) {
    if (countVisible(testCases) < 2) throw new ServiceError(400, "Each coding question needs at least 2 visible sample test cases");
    if (countHidden(testCases) < 5) throw new ServiceError(400, "Each coding question needs at least 5 hidden test cases for final evaluation");
    // Nested inside the same update() rather than a separate up-front deleteMany: a later 400 (the VERIFIED gate) after the cases were already wiped would
    // otherwise leave the question with none in the database.
    data.testCases = { deleteMany: {}, create: testCaseRows(testCases) };
  }
}

function editSql(body, existing, data) {
  const { sqlSchema, timeLimitMs, testCases } = body;
  data.sqlSchema = sqlSchema !== undefined ? sqlSchema : existing.sqlSchema;
  data.timeLimitMs = timeLimitMs ?? existing.timeLimitMs;
  data.options = null;
  data.correctAnswer = null;
  // Clear stale values left over if this question used to be CODING.
  data.memoryLimitKb = null;
  data.starterCode = null;
  data.starterCodeByLanguage = null;
  data.tags = null;
  data.evaluationType = "STDIO";
  data.functionSignature = null;
  if (testCases) {
    if (countVisible(testCases) < 1) throw new ServiceError(400, "Each SQL question needs at least 1 visible sample test case");
    if (countHidden(testCases) < 5) throw new ServiceError(400, "Each SQL question needs at least 5 hidden test cases for final evaluation");
    data.testCases = { deleteMany: {}, create: testCaseRows(testCases, { sql: true }) };
  }
}

function editNumerical(body, data) {
  const { numericAnswer, numericTolerance } = body;
  // Re-parse the expected answer only when this request supplies one: an edit of, say, difficulty keeps the stored answer.
  if (numericAnswer !== undefined && numericAnswer !== null && String(numericAnswer).trim() !== "") {
    const { numericAnswer: normVal, numericAnswerDisplay } = normalizeExpectedNumeric(numericAnswer);
    data.numericAnswer = normVal;
    data.numericAnswerDisplay = numericAnswerDisplay;
  }
  if (numericTolerance !== undefined) {
    const tol = Number(numericTolerance);
    if (numericTolerance !== null && numericTolerance !== "" && (!Number.isFinite(tol) || tol < 0)) throw toleranceError();
    data.numericTolerance = Number.isFinite(tol) && tol > 0 ? tol : 0;
  }
  data.options = null;
  data.correctAnswer = null;
  data.sqlSchema = null;
  data.evaluationType = "STDIO";
  data.functionSignature = null;
}

function editQuiz(type, body, existing, data) {
  // The duplicate-option check applies only when this request supplies options: an unrelated edit of a legacy question must not become unsavable over options
  // nobody asked to change.
  const normalized = normalizeOptions(type, body.options ?? existing.options, body.correctAnswer ?? existing.correctAnswer, { checkDuplicates: body.options !== undefined });
  data.options = normalized.options;
  data.correctAnswer = normalized.correctAnswer;
  data.sqlSchema = null;
  data.evaluationType = "STDIO";
  data.functionSignature = null;
}

module.exports = {
  QUESTION_TYPES, DIFFICULTIES, BTL_LEVELS, QUESTION_STATUSES, COMPARISON_MODES, SUBMISSION_HISTORY_BLOCK_MESSAGE, USED_IN_TEST_MESSAGE,
  isReferencedByRestrict, buildWhere, parseBtlLevel, label, countVisible, countHidden, testCaseRows,
  createBase, createCoding, createSql, createNumerical, createQuiz, editBase, editCoding, editSql, editNumerical, editQuiz,
};

// ---- folders and bulk operations ----
// Whether filing `folderId` under `newParentId` would put a folder inside itself or inside one of its own sub-banks. `parentOf(id)` resolves a folder's parent id. A
// folder loop makes the recursive delete and delete-preview walk forever, so it must never be stored.
async function wouldCreateFolderLoop(folderId, newParentId, parentOf) {
  const seen = new Set();
  let current = newParentId;
  while (current) {
    if (current === folderId || seen.has(current)) return true;
    seen.add(current);
    current = await parentOf(current);
  }
  return false;
}

const BLOCKED_BY_HISTORY = "Has student submissions — archive instead";
const BLOCKED_BY_TEST = "Used in one or more tests";
const blockedEntry = (q, reason) => ({ id: q.id, title: q.title || q.description.slice(0, 60), reason });

// The row for a copy of `q` in another bank. The image columns are excluded: only the database row is copied, so a copy that kept the same imageKey would delete
// the original's image from storage when its own image was removed or the copy deleted.
function copiedQuestionData(q, actor, folderId) {
  const { id, questionNumber, createdAt, testCases, folderId: _f, instituteId: _i, createdById: _c, imageKey: _ik, imageMimeType: _imt, ...rest } = q;
  return {
    ...rest,
    instituteId: actor.requesterInstituteId,
    folderId,
    createdById: actor.user.id,
    testCases: { create: testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation })) },
  };
}

// Visibility of a folder's sharing to the requester: an institute-bound requester only manages their own institute's banks, and a STAFF requester only the ones
// they created. Returns the refusal message, or null.
function sharingRefusal(actor, folder, staffMessage) {
  if (actor.requesterInstituteId && folder.instituteId && folder.instituteId !== actor.requesterInstituteId) return "You can only manage question banks under your own institute";
  if (actor.user.role === "STAFF" && folder.createdById !== actor.user.id) return staffMessage;
  return null;
}

Object.assign(module.exports, { wouldCreateFolderLoop, BLOCKED_BY_HISTORY, BLOCKED_BY_TEST, blockedEntry, copiedQuestionData, sharingRefusal });
