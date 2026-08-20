const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { validateSignature, generateStarterCode, languagesSupportedBy, resolveCodingFields } = require("../utils/functionHarness");
const { spreadsheetFileFilter, spreadsheetOrTextFileFilter } = require("../utils/uploadFilters");
const { parseNotepadMcqText, parseNotepadCodingText } = require("../utils/bulkQuestionParser");
const { questionVisibilityWhere, ownsQuestionRow } = require("../utils/questionVisibility");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { safeErrorMessage } = require("../utils/errors");
const { validateQuestionForVerification } = require("../utils/questionValidation");
const { canStaffUseSubject, resolveSubjectUnitTopic } = require("../utils/subjectAccess");
const { judgeSubmission } = require("../utils/judge");
const { runQueued } = require("../utils/queue");
const { cached } = require("../utils/cache");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });
// Question bulk-import specifically also accepts .txt (Notepad format) — every other bulk-upload
// route on the platform keeps using the spreadsheet-only `upload` above.
const uploadQuestionFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetOrTextFileFilter });

const QUESTION_TYPES = ["CODING", "MCQ", "TRUE_FALSE", "MULTISELECT", "SQL"];
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
// Employability & Subject Readiness module — see Question.btlLevel/questionStatus schema comments.
const BTL_LEVELS = [1, 2, 3, 4, 5, 6];
const QUESTION_STATUSES = ["DRAFT", "UNDER_REVIEW", "VERIFIED", "PUBLISHED", "ARCHIVED"];

const TEMPLATE_HEADERS = [
  "Question Name", "Subject", "Unit", "Topic", "Question Text", "Question Type",
  "Options", "Correct Answer", "Marks", "Difficulty Level", "BTL", "Explanation",
];

// Coding-question bulk import. A flat spreadsheet cell can't hold a nested test-case list, so
// "Hidden Test Cases" packs multiple cases into one cell as `input->output` pairs separated by
// `||` (e.g. "5->25||3->9||10->100") — documented in the template's own header note + sample row.
// Constraints/Input Format/Output Format map onto Question.constraints/inputFormat/outputFormat.
const CODING_TEMPLATE_HEADERS = [
  "Question Title", "Subject", "Unit", "Topic", "Subtopic", "Problem Statement", "Difficulty", "BTL", "Programming Languages",
  "Time Limit (seconds)", "Memory Limit (MB)", "Marks", "Constraints", "Input Format", "Output Format",
  "Sample Input 1", "Sample Output 1", "Sample Explanation 1",
  "Sample Input 2", "Sample Output 2", "Sample Explanation 2",
  "Hidden Test Cases (input->output pairs, separated by ||)",
  "Evaluation Mode (STDIO or Function)", "Function Name", "Return Type", "Parameters (name:type, comma separated)",
  "Starter Code (Java)", "Starter Code (Python)", "Starter Code (Cpp)", "Starter Code (C)",
  "Tags", "Question Bank",
];

const CODING_IMPORT_HEADER_ALIASES = {
  title: ["question title", "title", "question name", "name"],
  subject: ["subject", "subject course", "subject/course"],
  unit: ["unit"],
  topic: ["topic"],
  subtopic: ["subtopic"],
  description: ["problem statement", "question text", "description"],
  difficulty: ["difficulty", "difficulty level"],
  languages: ["programming languages", "languages"],
  timeLimitSec: ["time limit seconds", "time limit s", "time limit"],
  memoryLimitMb: ["memory limit mb", "memory limit"],
  points: ["marks", "points"],
  constraints: ["constraints"],
  inputFormat: ["input format"],
  outputFormat: ["output format"],
  sampleInput1: ["sample input 1"],
  sampleOutput1: ["sample output 1"],
  sampleExplanation1: ["sample explanation 1"],
  sampleInput2: ["sample input 2"],
  sampleOutput2: ["sample output 2"],
  sampleExplanation2: ["sample explanation 2"],
  hiddenTestCases: ["hidden test cases input output pairs separated by", "hidden test cases"],
  evaluationMode: ["evaluation mode stdio or function", "evaluation mode"],
  functionName: ["function name"],
  returnType: ["return type"],
  functionParams: ["parameters name type comma separated", "parameters"],
  starterJava: ["starter code java"],
  starterPython: ["starter code python"],
  // "C++" and "C" would both normalize to the same string ("starter code c") once normalizeHeader
  // strips the "++" as non-alphanumeric — the template header text uses "Cpp" instead specifically
  // to keep these two distinguishable.
  starterCpp: ["starter code cpp", "starter code c++"],
  starterC: ["starter code c"],
  tags: ["tags"],
  questionBank: ["question bank"],
  btl: ["btl", "btl level", "bloom s taxonomy level"],
};
const SUPPORTED_CODING_LANGUAGES = ["java", "python", "cpp", "c", "javascript"];

// "BTL-3" / "3" / "Level 3" / "" -> 3 / null. Throws only on a value that's present but doesn't
// resolve to 1-6 — an admin who typed something is telling us they meant to set a level, so a
// garbled value should surface as a row error rather than silently import with no BTL at all.
function parseBtlLevel(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/[1-6]/);
  if (!m) throw new Error(`Invalid BTL "${raw}" — use 1-6 (or BTL-1 .. BTL-6)`);
  return Number(m[0]);
}

// Normalizes/validates the type-specific fields (options + correctAnswer) for
// MCQ / TRUE_FALSE / MULTISELECT questions. Returns { options, correctAnswer }
// or throws a descriptive error.
function normalizeOptions(questionType, rawOptions, rawCorrectAnswer) {
  if (questionType === "TRUE_FALSE") {
    const options = ["True", "False"];
    const idx = normalizeCorrectIndices(rawCorrectAnswer, options, false)[0];
    if (idx === undefined) throw new Error("True/False questions need a correct answer of True or False");
    return { options, correctAnswer: [idx] };
  }

  const options = (Array.isArray(rawOptions) ? rawOptions : [])
    .map((o) => String(o ?? "").trim())
    .filter(Boolean);
  if (options.length < 2) throw new Error("Provide at least 2 options");

  const isMulti = questionType === "MULTISELECT";
  const correctAnswer = normalizeCorrectIndices(rawCorrectAnswer, options, isMulti);
  if (correctAnswer.length === 0) throw new Error("Select at least one correct answer");
  if (!isMulti && correctAnswer.length > 1) throw new Error("Multiple Choice questions can only have one correct answer");

  return { options, correctAnswer };
}

// Accepts correctAnswer as an array of 0-based indices (from the app UI) or
// as text (from spreadsheet import: option text or 1-based numbers, comma/pipe separated).
function normalizeCorrectIndices(raw, options, isMulti) {
  let tokens;
  if (Array.isArray(raw)) {
    tokens = raw;
  } else {
    tokens = String(raw ?? "").split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  }

  const indices = tokens
    .map((t) => {
      if (typeof t === "number") return t;
      const s = String(t).trim();
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        // Heuristic: treat as a 1-based option number if in range, else 0-based index
        if (n >= 1 && n <= options.length) return n - 1;
        if (n >= 0 && n < options.length) return n;
        return -1;
      }
      return options.findIndex((o) => o.trim().toLowerCase() === s.toLowerCase());
    })
    .filter((i) => i >= 0 && i < options.length);

  const unique = [...new Set(indices)];
  return isMulti ? unique : unique.slice(0, 1);
}

// Bulk-upload counterpart to resolveSubjectUnitTopic (utils/subjectAccess.js) — resolves plain-text Subject/Unit/
// Topic column values to real rows, enforcing the same authorization + "Unit must belong to
// Subject" rule (spec section 8's exact rejection example: a Unit named the same as one under a
// different Subject is rejected, not silently accepted). Topic is create-if-missing (case-
// insensitive), matching the manual /subjects/units/:id/topics route, since it's optional/
// lightweight by design — unlike Subject/Unit, which must already exist (see "Subject-First
// Workflow", spec section 9: pick from what's already configured, don't type a new one mid-upload).
async function resolveSubjectUnitTopicByName(req, { subjectName, unitName, topicName }) {
  if (!subjectName) return { error: "Subject is required" };
  if (!unitName) return { error: "Unit is required" };
  const institute = req.requesterInstituteId ? { OR: [{ instituteId: req.requesterInstituteId }, { instituteId: null }] } : {};
  const subject = await prisma.subject.findFirst({ where: { ...institute, name: { equals: subjectName, mode: "insensitive" } } });
  if (!subject || !(await canStaffUseSubject(req, subject.id))) {
    return { error: `Subject "${subjectName}" not found or you're not authorized to use it` };
  }
  const unit = await prisma.unit.findFirst({ where: { subjectId: subject.id, name: { equals: unitName, mode: "insensitive" } } });
  if (!unit) {
    return { error: `"${unitName}" does not belong to Subject "${subjectName}"` };
  }
  let topicId = null;
  if (topicName) {
    let topic = await prisma.topic.findFirst({ where: { unitId: unit.id, name: { equals: topicName, mode: "insensitive" } } });
    if (!topic) topic = await prisma.topic.create({ data: { unitId: unit.id, name: topicName } });
    topicId = topic.id;
  }
  return { subjectId: subject.id, unitId: unit.id, topicId };
}

// A hard delete must never destroy the record of a question a student has already been graded on
// (spec: "Do not permanently delete challenges that already have student submissions ... use
// archive/soft delete where appropriate"). Every delete route below already relies on Prisma's own
// FK-restrict errors (P2003/P2014, e.g. "used in a Test") to block a delete — but that mechanism
// does NOT cover every place a question can carry real student work: Submission.questionId and
// ModuleCodingSubmission.questionId are plain columns with no enforced FK to Question at all (a
// hard delete would silently succeed and orphan them), and ModuleCodingAttemptQuestion's FK is
// onDelete: Cascade (a hard delete would silently wipe the record of what an already-graded Module
// Coding attempt was assigned, instead of being blocked like TestQuestion is). This check runs
// before every hard-delete path in this file and flags any question with such history so the
// caller can refuse the delete — pointing the admin at Review Status "Archived" instead — rather
// than silently losing it.
async function questionIdsWithSubmissionHistory(questionIds) {
  if (!questionIds || questionIds.length === 0) return new Set();
  const [submissions, moduleCodingSubmissions, moduleCodingAttemptQuestions, dailyChallenges, weeklyChallenges] = await Promise.all([
    prisma.submission.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] }),
    prisma.moduleCodingSubmission.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] }),
    prisma.moduleCodingAttemptQuestion.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] }),
    prisma.dailyChallenge.findMany({ where: { questionId: { in: questionIds }, submissions: { some: {} } }, select: { questionId: true } }),
    prisma.weeklyChallenge.findMany({ where: { questionId: { in: questionIds }, submissions: { some: {} } }, select: { questionId: true } }),
  ]);
  const ids = new Set();
  for (const row of [...submissions, ...moduleCodingSubmissions, ...moduleCodingAttemptQuestions, ...dailyChallenges, ...weeklyChallenges]) {
    ids.add(row.questionId);
  }
  return ids;
}

const SUBMISSION_HISTORY_BLOCK_MESSAGE =
  "This question already has student submissions and can't be permanently deleted. Set its Review Status to Archived instead to remove it from future use while preserving those records.";

function buildWhere(query, req) {
  // Module Coding Test questions live in this same Question table (moduleCodingTestId set) but
  // are a completely separate authoring surface (see routes/moduleCoding.js's admin CRUD) — they
  // carry no folder/institute/creator of their own (instituteId/createdById/folderId all null),
  // which questionVisibilityWhere's "null = shared, visible to everyone" convention would
  // otherwise let leak straight into every institute's general Question Bank list/export/search,
  // mixed in with real standalone bank questions. Excluded here unconditionally.
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

// ADMIN/STAFF: live preview of the starter code a signature would generate, while authoring a
// Function-based question — same generator resolveCodingFields uses at save time, so what's
// previewed here is guaranteed to match what actually gets saved and judged.
router.post("/preview-starter-code", authenticate, requireRole("ADMIN", "STAFF"), (req, res) => {
  try {
    const { functionSignature } = req.body;
    validateSignature(functionSignature);
    const supported = languagesSupportedBy(functionSignature);
    const starterCodeByLanguage = {};
    for (const lang of supported) starterCodeByLanguage[lang] = generateStarterCode(lang, functionSignature);
    res.json({ starterCodeByLanguage, supportedLanguages: supported });
  } catch (err) {
    res.status(400).json({ error: safeErrorMessage(err, "Invalid function signature") });
  }
});

// ADMIN/STAFF: run a question's reference solution through the judge against its own test cases,
// before the question is ever shown to a student. Same judgeSubmission()+runQueued() pipeline a
// real student submission goes through — the only way to actually confirm every expected output is
// correct (a structural check like questionValidation.js's can't catch a wrong expected value, an
// infinite loop, or a test case that doesn't match the function signature). One language at a time,
// mirroring how starter code is authored/previewed per-language.
router.post("/validate-test-cases", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  try {
    const { language, code, testCases, evaluationType, functionSignature, sqlSchema, timeLimitMs, memoryLimitKb } = req.body;
    if (!language || !code || !code.trim()) {
      return res.status(400).json({ error: "A reference solution is required to validate" });
    }
    const cases = Array.isArray(testCases) ? testCases : [];
    if (cases.length === 0) return res.status(400).json({ error: "No test cases to validate against" });

    const result = await runQueued(() =>
      judgeSubmission({
        language, code, testCases: cases,
        timeLimitMs: timeLimitMs || 2000,
        memoryLimitKb: memoryLimitKb || undefined,
        evaluationType, functionSignature, sqlSchema,
      })
    );

    res.json({
      passedCases: result.passedCases,
      totalCases: result.totalCases,
      verdict: result.verdict,
      allPassed: result.passedCases === result.totalCases,
      errorSummary: result.errorSummary,
      details: result.details,
    });
  } catch (err) {
    if (err.queueBusy) {
      return res.status(503).json({ error: "Code execution is currently busy. Please try again shortly.", queueBusy: true });
    }
    res.status(400).json({ error: safeErrorMessage(err, "Could not validate test cases") });
  }
});

// Institute-wide (or Staff-own-content) question bank health: counts by status/type/difficulty,
// plus real attempt-based stats — attempts, avg score, pass rate, avg runtime — computed with
// Prisma groupBy/aggregate directly against Submission rows, never by loading and summing rows in
// JS. Bounded to the 3000 most-recently-created CODING/SQL questions in scope for the attempt-stats
// half, the same cap other institute-wide analytics routes in this codebase use (see
// readiness.js/resultManagement.js "bound unbounded analytics query" fixes) so a Super Admin
// viewing a huge global bank never triggers an unbounded Submission scan. Submission rows only
// come from Formal Test coding questions (see Submission schema comment) — Practice/Module/
// Interview coding runs live in separate, unrelated tables, so this reflects formal-assessment
// performance specifically, not every place a question has ever been attempted.
async function computeQuestionAnalytics(req) {
  const where = questionVisibilityWhere(req);

  const [byStatus, byType, byDifficulty, total] = await Promise.all([
    prisma.question.groupBy({ by: ["questionStatus"], where, _count: true }),
    prisma.question.groupBy({ by: ["questionType"], where, _count: true }),
    prisma.question.groupBy({ by: ["difficulty"], where, _count: true }),
    prisma.question.count({ where }),
  ]);

  const scopedQuestions = await prisma.question.findMany({
    where: { ...where, questionType: { in: ["CODING", "SQL"] } },
    select: { id: true, title: true, description: true, subject: true, topic: true },
    take: 3000,
    orderBy: { createdAt: "desc" },
  });
  const idToQuestion = new Map(scopedQuestions.map((q) => [q.id, q]));
  const ids = scopedQuestions.map((q) => q.id);

  const perQuestion = ids.length > 0
    ? await prisma.submission.groupBy({
        by: ["questionId"],
        where: { questionId: { in: ids } },
        _count: true,
        _avg: { score: true, timeMs: true },
        _sum: { passedCases: true, totalCases: true },
      })
    : [];

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

  const mostDifficult = withStats.filter((q) => q.attempts >= 3 && q.passRate !== null)
    .sort((a, b) => a.passRate - b.passRate).slice(0, 10);
  const mostAttempted = [...withStats].sort((a, b) => b.attempts - a.attempts).slice(0, 10);

  return {
    totals: {
      total,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.questionStatus, r._count])),
      byType: Object.fromEntries(byType.map((r) => [r.questionType, r._count])),
      byDifficulty: Object.fromEntries(byDifficulty.map((r) => [r.difficulty, r._count])),
    },
    attempts: {
      questionsAttempted: withStats.length,
      totalAttempts,
      avgScore: Math.round(avgScoreOverall * 10) / 10,
    },
    mostDifficult,
    mostAttempted,
  };
}

// ADMIN/STAFF: see the computeQuestionAnalytics() comment above for scope and methodology.
router.get("/analytics/summary", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteKey = req.requesterInstituteId || "all";
    const data = await cached(`questionAnalytics:${instituteKey}:${req.user.role}:${req.user.id}`, 60 * 1000, () => computeQuestionAnalytics(req));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err, "Failed to load question analytics") });
  }
});

// Create a question (any type)
router.post("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      title, description, subject, topic, questionType, difficulty, points, explanation,
      timeLimitMs, starterCode, testCases, options, correctAnswer, folderId,
      evaluationType, functionSignature, starterCodeByLanguage, referenceSolution, memoryLimitKb, tags, sqlSchema,
      estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
      edgeCases, problemExplanation, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
      allowDuplicate, subtopic, btlLevel, skillTested, questionStatus, aiGenerated,
      subjectId, unitId, topicId,
    } = req.body;

    if (!description) return res.status(400).json({ error: "Question text is required" });
    const type = QUESTION_TYPES.includes(questionType) ? questionType : "CODING";

    const resolvedSubject = await resolveSubjectUnitTopic(req, { subjectId, unitId, topicId });
    if (resolvedSubject.error) return res.status(400).json({ error: resolvedSubject.error });

    if (folderId) {
      const folder = await prisma.questionFolder.findUnique({ where: { id: folderId } });
      if (!folder || !ownsQuestionRow(req, folder)) {
        return res.status(403).json({ error: "That folder isn't in your institute's question bank" });
      }
    }

    if (!allowDuplicate) {
      const duplicate = await prisma.question.findFirst({
        where: {
          ...questionVisibilityWhere(req),
          folderId: folderId || null,
          // Subject+Unit-scoped — "Java Unit 1" and "DBMS Unit 1" must never be cross-flagged as
          // duplicates of each other just because the question text happens to match (spec section 13).
          subjectId: resolvedSubject.subjectId,
          unitId: resolvedSubject.unitId,
          description: { equals: description.trim(), mode: "insensitive" },
        },
      });
      if (duplicate) {
        return res.status(409).json({
          duplicate: true,
          existing: { id: duplicate.id, title: duplicate.title, description: duplicate.description },
        });
      }
    }

    const data = {
      title: title || null,
      description,
      subject: subject || null,
      topic: topic || null,
      subjectId: resolvedSubject.subjectId,
      unitId: resolvedSubject.unitId,
      topicId: resolvedSubject.topicId,
      questionType: type,
      difficulty: difficulty || "EASY",
      points: points ?? 10,
      explanation: explanation || null,
      instituteId: req.requesterInstituteId,
      folderId: folderId || null,
      createdById: req.user.id,
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
      // Employability & Subject Readiness module fields — all optional; a question with no
      // btlLevel set simply stays ineligible for a Readiness blueprint (see
      // utils/readinessBlueprint.js) while remaining fully usable everywhere else.
      subtopic: subtopic || null,
      btlLevel: BTL_LEVELS.includes(Number(btlLevel)) ? Number(btlLevel) : null,
      skillTested: skillTested || null,
      aiGenerated: !!aiGenerated,
      // An AI-drafted question that arrives with no explicit review status defaults to DRAFT, not
      // PUBLISHED — CRITICAL RULE: AI-generated content must pass through a review step before it
      // can appear in a live assessment, never auto-publish. A human-authored question with no
      // status still defaults to PUBLISHED as before, unchanged from pre-RA8 behavior.
      questionStatus: QUESTION_STATUSES.includes(questionStatus) ? questionStatus : (aiGenerated ? "DRAFT" : "PUBLISHED"),
    };

    if (type === "CODING") {
      const cases = testCases || [];
      // Every coding question needs both — visible samples for the student-facing Run button,
      // and hidden cases the final Submit score is actually based on (see gradeAttempt.js /
      // gradeModuleCodingAttempt.js). Mirrors the same requirement already enforced on
      // Module Coding Test questions in moduleCoding.js.
      if (cases.filter((tc) => !tc.isHidden).length < 2) {
        return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases" });
      }
      if (cases.filter((tc) => tc.isHidden).length < 10) {
        return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation" });
      }
      data.timeLimitMs = timeLimitMs ?? 2000;
      data.memoryLimitKb = memoryLimitKb || null;
      data.starterCode = starterCode || "";
      data.tags = Array.isArray(tags) && tags.length > 0 ? tags : undefined;
      const resolved = resolveCodingFields({ evaluationType, functionSignature, starterCodeByLanguage });
      data.evaluationType = resolved.evaluationType;
      data.functionSignature = resolved.functionSignature;
      if (resolved.starterCodeByLanguage) data.starterCodeByLanguage = resolved.starterCodeByLanguage;
      if (referenceSolution && typeof referenceSolution === "object") data.referenceSolution = referenceSolution;
      data.testCases = {
        create: cases.map((tc) => ({
          input: tc.input,
          expected: tc.expected,
          isHidden: tc.isHidden ?? true,
          explanation: tc.explanation || null,
        })),
      };
    } else if (type === "SQL") {
      if (!sqlSchema || !sqlSchema.trim()) {
        return res.status(400).json({ error: "SQL questions need setup SQL (schema + seed data)" });
      }
      const cases = testCases || [];
      if (cases.filter((tc) => !tc.isHidden).length < 1) {
        return res.status(400).json({ error: "Each SQL question needs at least 1 visible sample test case" });
      }
      // SQL hidden cases each carry their own additional setup SQL (see the sqlSchema comment on
      // the Question model) — authoring 10+ meaningfully distinct ones is a much heavier lift than
      // for STDIO/FUNCTION cases, so the bar is raised less far here (1 -> 5) rather than to the
      // general 10 used for CODING questions below.
      if (cases.filter((tc) => tc.isHidden).length < 5) {
        return res.status(400).json({ error: "Each SQL question needs at least 5 hidden test cases for final evaluation" });
      }
      data.sqlSchema = sqlSchema;
      data.timeLimitMs = timeLimitMs ?? 3000;
      data.testCases = {
        create: cases.map((tc) => ({
          input: tc.input || "",
          expected: tc.expected,
          isHidden: tc.isHidden ?? true,
          explanation: tc.explanation || null,
        })),
      };
    } else {
      const normalized = normalizeOptions(type, options, correctAnswer);
      data.options = normalized.options;
      data.correctAnswer = normalized.correctAnswer;
    }

    const question = await prisma.question.create({ data, include: { testCases: true } });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { questionId: question.id, title: question.title || question.description.slice(0, 60) },
    });
    res.json(question);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to create question") });
  }
});

// Question Bank: list with search + filters. Paginated — an institute's bank can run into the
// thousands of questions, and rendering/transferring the whole thing on every load doesn't scale.
router.get("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const where = buildWhere(req.query, req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: {
        _count: { select: { testCases: true } },
        createdBy: { select: { id: true, name: true } },
        subjectRef: { select: { id: true, name: true } },
        unitRef: { select: { id: true, name: true } },
        topicRef: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.question.count({ where }),
  ]);
  res.json({ rows: questions, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

// Distinct subjects/topics/creators — powers the filter dropdowns. Scoped the same way the list
// is, so the dropdowns never surface a value that only exists in another institute's bank.
router.get("/meta/filters", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  // Same moduleCodingTestId exclusion as buildWhere() above — without it, Module Coding Test
  // questions (no folder/subject/unit of their own) inflate "Needs Subject Assignment" and the
  // review-queue counts with rows that were never meant to be classified in this Question Bank.
  const visible = { ...questionVisibilityWhere(req), moduleCodingTestId: null };
  // A STAFF requester only ever sees their own + legacy content anyway (see
  // questionVisibilityWhere), so surfacing other creators' identities here would be pointless —
  // skip the query rather than compute a list nobody's Question Bank view can act on.
  const [subjects, topics, creatorIds] = await Promise.all([
    prisma.question.findMany({ where: { ...visible, subject: { not: null } }, select: { subject: true }, distinct: ["subject"] }),
    prisma.question.findMany({ where: { ...visible, topic: { not: null } }, select: { topic: true }, distinct: ["topic"] }),
    req.user.role === "STAFF"
      ? Promise.resolve([])
      : prisma.question.findMany({ where: { ...visible, createdById: { not: null } }, select: { createdById: true }, distinct: ["createdById"] }),
  ]);
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds.map((c) => c.createdById) } }, select: { id: true, name: true } })
    : [];
  // "Needs classification" — questions predating the Subject/Unit taxonomy (subjectId null) or
  // backfilled with a Subject but no reliable signal to infer a Unit from (unitId null) — spec
  // section 15's explicit "flag for admin review" instruction, surfaced as a filter here.
  const [needsClassificationCount, noSubjectCount] = await Promise.all([
    prisma.question.count({ where: { ...visible, OR: [{ subjectId: null }, { unitId: null }] } }),
    // Separate, narrower count (subjectId null only) — powers the root-level "Needs Subject
    // Assignment" tile in the Subject/Unit tree view, distinct from needsClassificationCount above
    // which also includes questions that have a Subject but no Unit yet.
    prisma.question.count({ where: { ...visible, subjectId: null } }),
  ]);
  res.json({
    // Legacy free-text lists — kept for filtering/displaying pre-migration questions that still
    // only carry the old subject/topic strings (see Question.subject's schema comment).
    subjects: subjects.map((s) => s.subject).filter(Boolean).sort(),
    topics: topics.map((t) => t.topic).filter(Boolean).sort(),
    creators: creators.sort((a, b) => a.name.localeCompare(b.name)),
    needsClassificationCount,
    noSubjectCount,
  });
});

// =========================== Question Bank folders ===========================
// Defined before the generic "/:id" route below so Express doesn't match "/folders" as an id.
// Folders nest via parentId (e.g. "Fox Solutions" > "Aptitude" > "Percentages") — the frontend
// builds the tree client-side from this flat list plus each row's parentId.

router.get("/folders", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const folders = await prisma.questionFolder.findMany({
    where: questionVisibilityWhere(req),
    include: { _count: { select: { questions: true, children: true } } },
    orderBy: { name: "asc" },
  });
  res.json(folders);
});

router.post("/folders", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Folder name is required" });
  const { category, description, parentId } = req.body;
  if (parentId) {
    const parent = await prisma.questionFolder.findUnique({ where: { id: parentId } });
    if (!parent || !ownsQuestionRow(req, parent)) {
      return res.status(403).json({ error: "That parent folder isn't in your institute's question bank" });
    }
  }
  try {
    const folder = await prisma.questionFolder.create({
      data: { name, category: category || null, description: description || null, parentId: parentId || null, instituteId: req.requesterInstituteId, createdById: req.user.id },
    });
    res.json(folder);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A folder with this name already exists" });
    console.error(err);
    res.status(500).json({ error: "Failed to create folder" });
  }
});

router.patch("/folders/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const folder = await prisma.questionFolder.findUnique({
    where: { id: req.params.id },
    include: { shares: { select: { staffId: true } } },
  });
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  if (!ownsQuestionRow(req, folder)) return res.status(403).json({ error: "Not your institute's folder" });
  const data = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: "Folder name is required" });
    data.name = name;
  }
  if (req.body.category !== undefined) data.category = req.body.category || null;
  if (req.body.description !== undefined) data.description = req.body.description || null;
  if (req.body.parentId !== undefined) {
    if (req.body.parentId === folder.id) return res.status(400).json({ error: "A folder can't be its own parent" });
    data.parentId = req.body.parentId || null;
  }
  try {
    const updated = await prisma.questionFolder.update({ where: { id: folder.id }, data });
    res.json(updated);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A folder with this name already exists" });
    console.error(err);
    res.status(500).json({ error: "Failed to update folder" });
  }
});

// BFS-orders a folder's full descendant tree, root first — used by both the delete-preview and
// the recursive delete below so their notion of "everything inside this folder" always matches.
async function collectDescendantFolders(rootId) {
  const order = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.questionFolder.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    const childIds = children.map((c) => c.id);
    if (childIds.length === 0) break;
    order.push(...childIds);
    frontier = childIds;
  }
  return order;
}

// Powers the folder-delete confirmation dialog's exact-counts requirement — walks the whole
// sub-tree and reports how many questions/sub-banks actually exist, plus how many of those
// questions are attached to a Test and therefore can't be deleted (see DELETE below).
router.get("/folders/:id/delete-preview", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const folder = await prisma.questionFolder.findUnique({
    where: { id: req.params.id },
    include: { shares: { select: { staffId: true } } },
  });
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  if (!ownsQuestionRow(req, folder)) return res.status(403).json({ error: "Not your institute's folder" });

  const folderIds = await collectDescendantFolders(folder.id);
  const questions = await prisma.question.findMany({ where: { folderId: { in: folderIds } }, select: { id: true } });
  const questionIds = questions.map((q) => q.id);
  // Two independent reasons a question can survive the delete below: attached to a Test
  // (FK-restrict) or carrying real student submission/attempt history (the history guard added
  // to the recursive delete route) — union both so this preview's count actually matches what
  // the delete is about to do, rather than only accounting for the Test case.
  const [testBlocked, historyBlockedIds] = await Promise.all([
    questionIds.length > 0
      ? prisma.testQuestion.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true }, distinct: ["questionId"] })
      : [],
    questionIdsWithSubmissionHistory(questionIds),
  ]);
  const blockedIds = new Set([...testBlocked.map((b) => b.questionId), ...historyBlockedIds]);

  res.json({ questionCount: questions.length, subBankCount: folderIds.length - 1, blockedCount: blockedIds.size });
});

// Replaces the earlier "folder must be empty" block. Recursively deletes every question in
// this folder's entire sub-tree (skipping any attached to a Test — same P2003/P2014 handling
// as the single-question DELETE /:id route below), then deletes the folders themselves
// bottom-up: a folder is only removed once it has zero remaining questions AND zero remaining
// child folders, so a branch containing a test-attached question survives — along with every
// ancestor above it — instead of being silently cascade-deleted out from under that question
// (QuestionFolder.parent is onDelete: Cascade at the DB level, which this per-row approach
// deliberately avoids triggering on any folder that still holds real content).
router.delete("/folders/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const folder = await prisma.questionFolder.findUnique({
    where: { id: req.params.id },
    include: { shares: { select: { staffId: true } } },
  });
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  if (!ownsQuestionRow(req, folder)) return res.status(403).json({ error: "Not your institute's folder" });

  const folderIds = await collectDescendantFolders(folder.id); // BFS order: root first, deepest last
  const questions = await prisma.question.findMany({ where: { folderId: { in: folderIds } } });
  const withHistory = await questionIdsWithSubmissionHistory(questions.map((q) => q.id));

  let deletedQuestionCount = 0;
  const remainingByFolder = new Map();
  for (const q of questions) {
    // A STAFF requester's recursive delete must never touch another staff member's private
    // questions, even ones nested inside a shared/legacy folder the requester is otherwise
    // allowed to delete — skip-and-count exactly like the FK-restrict (P2003/P2014) case below,
    // so that folder simply survives with only the untouched content left in it. A question with
    // real student submission history (see questionIdsWithSubmissionHistory) is skipped the same
    // way — never hard-deleted just because it happened to be inside a folder someone deleted.
    if (!ownsQuestionRow(req, q) || withHistory.has(q.id)) {
      remainingByFolder.set(q.folderId, (remainingByFolder.get(q.folderId) || 0) + 1);
      continue;
    }
    try {
      await prisma.question.delete({ where: { id: q.id } });
      deletedQuestionCount++;
    } catch (err) {
      if (err.code === "P2003" || err.code === "P2014") {
        remainingByFolder.set(q.folderId, (remainingByFolder.get(q.folderId) || 0) + 1);
      } else {
        throw err;
      }
    }
  }

  const folderRows = await prisma.questionFolder.findMany({ where: { id: { in: folderIds } } });
  const folderById = new Map(folderRows.map((f) => [f.id, f]));
  const parentOf = new Map(folderRows.map((f) => [f.id, f.parentId]));
  const hasRemainingChild = new Map();

  let deletedFolderCount = 0;
  // Reversed BFS order = deepest folders first, so a folder's children are always resolved
  // before the folder itself is considered for deletion.
  for (const id of [...folderIds].reverse()) {
    // Same staff-ownership guard as questions above — a sub-folder another staff member created
    // (nested under a shared/legacy parent the requester CAN otherwise delete) is left in place
    // even if it's now empty, since it's still theirs to keep or remove.
    const notOwned = !ownsQuestionRow(req, folderById.get(id));
    const deletable = !notOwned && !(remainingByFolder.get(id) > 0) && !hasRemainingChild.get(id);
    if (deletable) {
      await prisma.questionFolder.delete({ where: { id } });
      deletedFolderCount++;
    } else {
      const parentId = parentOf.get(id);
      if (parentId) hasRemainingChild.set(parentId, true);
    }
  }

  if (deletedQuestionCount > 0) {
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { bulk: true, count: deletedQuestionCount, folderId: folder.id },
    });
  }

  res.json({
    deletedFolderCount,
    deletedQuestionCount,
    skippedQuestionCount: questions.length - deletedQuestionCount,
    fullyDeleted: deletedFolderCount === folderIds.length,
  });
});

// Explicit Question Bank (folder) sharing — grants named STAFF accounts full view/manage access
// to a folder (and every question filed in it) without opening it to the whole institute. Only
// the folder's own creator or an Admin may grant/revoke — mirrors tests.js's /:id/shares exactly.
router.get("/folders/:id/shares", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const folder = await prisma.questionFolder.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true, instituteId: true } });
  if (!folder) return res.status(404).json({ error: "Question bank not found" });
  if (req.requesterInstituteId && folder.instituteId && folder.instituteId !== req.requesterInstituteId) {
    return res.status(403).json({ error: "You can only manage question banks under your own institute" });
  }
  if (req.user.role === "STAFF" && folder.createdById !== req.user.id) {
    return res.status(403).json({ error: "Only the question bank's creator can view its sharing" });
  }
  const shares = await prisma.questionFolderShare.findMany({
    where: { folderId: folder.id },
    include: { staff: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(shares);
});

router.post("/folders/:id/shares", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { staffIds = [] } = req.body;
    const folder = await prisma.questionFolder.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, createdById: true, instituteId: true } });
    if (!folder) return res.status(404).json({ error: "Question bank not found" });
    if (req.requesterInstituteId && folder.instituteId && folder.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage question banks under your own institute" });
    }
    if (req.user.role === "STAFF" && folder.createdById !== req.user.id) {
      return res.status(403).json({ error: "Only the question bank's creator can share it" });
    }
    if (staffIds.length > 0) {
      // Never trust the client's staffIds as-is — validate every target is a real STAFF account
      // in the requester's own institute before writing anything.
      const staffRows = await prisma.user.findMany({
        where: { id: { in: staffIds }, role: "STAFF", ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}) },
        select: { id: true },
      });
      if (staffRows.length !== staffIds.length) {
        return res.status(400).json({ error: "One or more selected staff members are not valid for this institute" });
      }
      await prisma.questionFolderShare.createMany({
        data: staffIds.map((staffId) => ({ folderId: folder.id, staffId, sharedByUserId: req.user.id, sharedByName: req.user.name })),
        skipDuplicates: true,
      });
      await logAudit({
        req, action: AUDIT_ACTIONS.QUESTION_BANK_SHARED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: folder.instituteId, details: { folderId: folder.id, folderName: folder.name, sharedWithCount: staffIds.length },
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to share question bank" });
  }
});

router.delete("/folders/:id/shares/:staffId", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const folder = await prisma.questionFolder.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, createdById: true, instituteId: true } });
    if (!folder) return res.status(404).json({ error: "Question bank not found" });
    if (req.requesterInstituteId && folder.instituteId && folder.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage question banks under your own institute" });
    }
    if (req.user.role === "STAFF" && folder.createdById !== req.user.id) {
      return res.status(403).json({ error: "Only the question bank's creator can revoke sharing" });
    }
    await prisma.questionFolderShare.deleteMany({ where: { folderId: folder.id, staffId: req.params.staffId } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to revoke access" });
  }
});

// Merge :id (source) into targetId — reassigns all of source's questions and direct child
// folders to the target, then deletes source. Used to consolidate near-duplicate banks
// (e.g. two folders both named roughly "Java Basics" created by different staff).
router.post("/folders/:id/merge", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const sourceId = req.params.id;
  const targetId = req.body.targetId;
  if (!targetId || targetId === sourceId) return res.status(400).json({ error: "Choose a different target folder to merge into" });
  const [source, target] = await Promise.all([
    prisma.questionFolder.findUnique({ where: { id: sourceId } }),
    prisma.questionFolder.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target) return res.status(404).json({ error: "Folder not found" });
  if (!ownsQuestionRow(req, source) || !ownsQuestionRow(req, target)) {
    return res.status(403).json({ error: "Not your institute's folder" });
  }
  // Merge deletes the source folder outright afterward, so — unlike the recursive delete above —
  // there's no clean way to partially merge: a question/child-folder excluded from the reassign
  // would either get silently dumped into Uncategorized (Question.folderId is onDelete: SetNull)
  // or the source's organization would be destroyed out from under another staff member's content
  // without their consent. Block the whole operation instead if the source isn't entirely the
  // requester's own (+ legacy/shared) content.
  const [sourceQuestions, sourceChildFolders] = await Promise.all([
    prisma.question.findMany({ where: { folderId: sourceId } }),
    prisma.questionFolder.findMany({ where: { parentId: sourceId } }),
  ]);
  const hasForeignContent = sourceQuestions.some((q) => !ownsQuestionRow(req, q)) || sourceChildFolders.some((f) => !ownsQuestionRow(req, f));
  if (hasForeignContent) {
    return res.status(403).json({ error: "This question bank contains another staff member's questions or sub-banks and can't be merged" });
  }
  await prisma.$transaction([
    prisma.question.updateMany({ where: { folderId: sourceId }, data: { folderId: targetId } }),
    prisma.questionFolder.updateMany({ where: { parentId: sourceId }, data: { parentId: targetId } }),
    prisma.questionFolder.delete({ where: { id: sourceId } }),
  ]);
  res.json({ success: true });
});

// Bulk-move: file multiple existing questions into a folder (or clear to Uncategorized) in one
// call — the running-list counterpart to per-question folderId edits via PATCH /questions/:id.
router.post("/bulk-move", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
  if (questionIds.length === 0) return res.status(400).json({ error: "No questions selected" });
  const folderId = req.body.folderId || null;
  if (folderId) {
    const folder = await prisma.questionFolder.findUnique({ where: { id: folderId } });
    if (!folder || !ownsQuestionRow(req, folder)) {
      return res.status(403).json({ error: "That folder isn't in your institute's question bank" });
    }
  }
  const owned = await prisma.question.findMany({ where: { id: { in: questionIds } } });
  const movableIds = owned.filter((q) => ownsQuestionRow(req, q)).map((q) => q.id);
  if (movableIds.length === 0) return res.status(403).json({ error: "None of the selected questions are in your institute's question bank" });
  await prisma.question.updateMany({ where: { id: { in: movableIds } }, data: { folderId } });
  res.json({ movedCount: movableIds.length, skippedCount: questionIds.length - movableIds.length });
});

// Bulk "Assign Subject/Unit" — the working tool for clearing the backfill script's "needs
// classification" backlog (spec section 15) without opening each question's edit form. Same
// ownership-filter-then-updateMany pattern as bulk-move, plus the same
// resolveSubjectUnitTopic validation/authorization every other Subject/Unit write goes through.
router.post("/bulk-assign-subject", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
  if (questionIds.length === 0) return res.status(400).json({ error: "No questions selected" });
  const resolved = await resolveSubjectUnitTopic(req, {
    subjectId: req.body.subjectId, unitId: req.body.unitId, topicId: req.body.topicId,
  });
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  const owned = await prisma.question.findMany({ where: { id: { in: questionIds } } });
  const updatableIds = owned.filter((q) => ownsQuestionRow(req, q)).map((q) => q.id);
  if (updatableIds.length === 0) return res.status(403).json({ error: "None of the selected questions are in your institute's question bank" });
  await prisma.question.updateMany({
    where: { id: { in: updatableIds } },
    data: { subjectId: resolved.subjectId, unitId: resolved.unitId, topicId: resolved.topicId },
  });
  await logAudit({
    req, action: AUDIT_ACTIONS.QUESTION_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
    instituteId: req.requesterInstituteId, details: { bulk: true, type: "subject_assigned", count: updatableIds.length, subjectId: resolved.subjectId, unitId: resolved.unitId },
  });
  res.json({ updatedCount: updatableIds.length, skippedCount: questionIds.length - updatableIds.length });
});

// Bulk review-status transition — powers the Question Bank's review queue (filter by Draft/Under
// Review, select a batch, Verify or Archive in one action) instead of opening each question's
// edit form individually. Same ownership-filter-then-updateMany pattern as bulk-move; no FK
// constraints on questionStatus so a plain updateMany is safe here (unlike bulk-delete).
router.post("/bulk-status", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
  const questionStatus = req.body.questionStatus;
  if (questionIds.length === 0) return res.status(400).json({ error: "No questions selected" });
  if (!QUESTION_STATUSES.includes(questionStatus)) return res.status(400).json({ error: "Invalid review status" });

  const owned = await prisma.question.findMany({ where: { id: { in: questionIds } } });
  const updatable = owned.filter((q) => ownsQuestionRow(req, q));
  if (updatable.length === 0) return res.status(403).json({ error: "None of the selected questions are in your institute's question bank" });

  // Structural gate before a CODING/SQL question can become VERIFIED (spec: validate before an
  // assessment becomes official). Blocked questions are simply excluded from this batch's status
  // change rather than failing the whole request — the admin still sees exactly which ones and why.
  let blocked = [];
  let finalized = updatable;
  if (questionStatus === "VERIFIED") {
    const gradable = updatable.filter((q) => q.questionType === "CODING" || q.questionType === "SQL");
    if (gradable.length > 0) {
      const cases = await prisma.testCase.findMany({ where: { questionId: { in: gradable.map((q) => q.id) } } });
      const casesByQuestion = new Map();
      for (const tc of cases) {
        if (!casesByQuestion.has(tc.questionId)) casesByQuestion.set(tc.questionId, []);
        casesByQuestion.get(tc.questionId).push(tc);
      }
      for (const q of gradable) {
        const reasons = validateQuestionForVerification(q, casesByQuestion.get(q.id) || []);
        if (reasons.length > 0) blocked.push({ id: q.id, title: q.title || q.description.slice(0, 60), reasons });
      }
      const blockedIds = new Set(blocked.map((b) => b.id));
      finalized = updatable.filter((q) => !blockedIds.has(q.id));
    }
  }

  if (finalized.length > 0) {
    await prisma.question.updateMany({ where: { id: { in: finalized.map((q) => q.id) } }, data: { questionStatus, updatedById: req.user.id } });
  }
  await logAudit({
    req, action: AUDIT_ACTIONS.QUESTION_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
    instituteId: req.requesterInstituteId, details: { bulk: true, count: finalized.length, questionStatus, blockedCount: blocked.length },
  });
  res.json({ updatedCount: finalized.length, skippedCount: questionIds.length - finalized.length, blocked });
});

// Bulk-delete: mirrors bulk-move's ownership-filter pattern, but deletes one row at a time
// (not deleteMany) so a mixed selection — some questions attached to a Test, some not —
// partially succeeds instead of the whole batch failing on the first FK-restrict question
// (same per-row P2003/P2014 handling as the single DELETE /:id route below).
router.post("/bulk-delete", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
  if (questionIds.length === 0) return res.status(400).json({ error: "No questions selected" });
  const owned = await prisma.question.findMany({ where: { id: { in: questionIds } } });
  const withHistory = await questionIdsWithSubmissionHistory(owned.map((q) => q.id));
  const blocked = [];
  let deletedCount = 0;
  for (const q of owned) {
    if (!ownsQuestionRow(req, q)) continue;
    if (withHistory.has(q.id)) {
      blocked.push({ id: q.id, title: q.title || q.description.slice(0, 60), reason: "Has student submissions — archive instead" });
      continue;
    }
    try {
      await prisma.question.delete({ where: { id: q.id } });
      deletedCount++;
    } catch (err) {
      if (err.code === "P2003" || err.code === "P2014") {
        blocked.push({ id: q.id, title: q.title || q.description.slice(0, 60), reason: "Used in one or more tests" });
      } else {
        throw err;
      }
    }
  }
  const skippedCount = questionIds.length - deletedCount - blocked.length;
  if (deletedCount > 0) {
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { bulk: true, count: deletedCount },
    });
  }
  res.json({ deletedCount, skippedCount, blocked });
});

// Bulk-copy: clones questions (including test cases) into a DIFFERENT question bank — Copy
// exists specifically to duplicate into another bank, so a question already in the target
// folder is skipped rather than cloned into itself (which would just create the exact
// duplicates the new duplicate-detection elsewhere in this file is trying to prevent).
router.post("/bulk-copy", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
  const folderId = req.body.folderId || null;
  if (questionIds.length === 0) return res.status(400).json({ error: "No questions selected" });
  if (!folderId) return res.status(400).json({ error: "A destination question bank is required" });

  const folder = await prisma.questionFolder.findUnique({ where: { id: folderId } });
  if (!folder || !ownsQuestionRow(req, folder)) {
    return res.status(403).json({ error: "That folder isn't in your institute's question bank" });
  }

  const owned = await prisma.question.findMany({ where: { id: { in: questionIds } }, include: { testCases: true } });
  let copiedCount = 0;
  let skippedCount = questionIds.length - owned.length;
  for (const q of owned) {
    if (!ownsQuestionRow(req, q) || q.folderId === folderId) { skippedCount++; continue; }
    const { id, questionNumber, createdAt, testCases, folderId: _f, instituteId: _i, createdById: _c, ...rest } = q;
    await prisma.question.create({
      data: {
        ...rest,
        instituteId: req.requesterInstituteId,
        folderId,
        createdById: req.user.id,
        testCases: { create: testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation })) },
      },
    });
    copiedCount++;
  }
  res.json({ copiedCount, skippedCount });
});

// Deletes every DIRECT question in this folder (not descendant sub-banks — matches the
// existing folder-detail view's own scoping, where the question list/Select All only ever
// shows direct children). Same per-row FK-restrict handling as bulk-delete; the folder itself
// is left untouched.
router.post("/folders/:id/clear", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const folder = await prisma.questionFolder.findUnique({ where: { id: req.params.id } });
  if (!folder || !ownsQuestionRow(req, folder)) return res.status(404).json({ error: "Question bank not found" });

  const questions = await prisma.question.findMany({ where: { folderId: folder.id } });
  const withHistory = await questionIdsWithSubmissionHistory(questions.map((q) => q.id));
  const blocked = [];
  let clearedCount = 0;
  for (const q of questions) {
    if (!ownsQuestionRow(req, q)) continue;
    if (withHistory.has(q.id)) {
      blocked.push({ id: q.id, title: q.title || q.description.slice(0, 60), reason: "Has student submissions — archive instead" });
      continue;
    }
    try {
      await prisma.question.delete({ where: { id: q.id } });
      clearedCount++;
    } catch (err) {
      if (err.code === "P2003" || err.code === "P2014") {
        blocked.push({ id: q.id, title: q.title || q.description.slice(0, 60), reason: "Used in one or more tests" });
      } else {
        throw err;
      }
    }
  }
  const skippedCount = questions.length - clearedCount - blocked.length;
  res.json({ clearedCount, skippedCount, blocked });
});

// Notepad/.txt sample templates — hand-written (not generated from the xlsx sample data) so the
// field order and wording match exactly what a staff member typing into Notepad would see,
// including the platform's actual minimums (2 sample cases + 10 hidden cases for coding) spelled
// out as a comment rather than left implicit.
const MCQ_TXT_TEMPLATE = `Notepad Question Upload — Multiple Choice / True-False / Multiple Select
One question per block, separated by a blank line. Each field is a "Label:" line — the value can
continue on the next line(s) until the next label. Question Type: is optional (auto-detected: two
options "True"/"False" -> True/False; more than one Correct Answer letter -> Multiple Select;
otherwise Multiple Choice) — only add it if you want to force a specific type. Correct Answer
accepts an option letter (A/B/C/D) or the option's exact text.

Question Type:
MCQ

Subject:
DSA

Unit:
Unit 1

Topic:
Arrays

Question:
Which data structure follows FIFO?

Option A:
Stack

Option B:
Queue

Option C:
Tree

Option D:
Graph

Correct Answer:
B

Marks:
1

Difficulty:
Easy

BTL:
BTL-1

Explanation:
Queue follows the First In First Out principle.

--------------------------------------------------

Question:
What is the time complexity of binary search?

Option A:
O(n)

Option B:
O(log n)

Option C:
O(n^2)

Option D:
O(1)

Correct Answer:
B

Difficulty:
Medium

BTL:
BTL-3

Subject:
DSA

Unit:
Unit 1

Topic:
Searching

Explanation:
Binary search repeatedly divides the search space in half.
`;

const CODING_TXT_TEMPLATE = `Notepad Question Upload — Coding
One question per block, separated by a line of at least 3 dashes (---). Each field is a LABEL:
line — the value can continue on the next line(s) until the next label. This platform requires
2 visible sample cases (SAMPLE_INPUT/SAMPLE_OUTPUT and SAMPLE_INPUT_2/SAMPLE_OUTPUT_2) plus at
least 10 hidden cases inside TEST_CASES (each as an INPUT: / OUTPUT: pair) — fewer than that will
be rejected, same as the spreadsheet template.

QUESTION: Write a program to find the maximum element in an array.
LANGUAGE: C++, Java, Python
INPUT_FORMAT: First line contains N. Second line contains N integers.
OUTPUT_FORMAT: Print the maximum value.
CONSTRAINTS: 1 <= N <= 100000
SAMPLE_INPUT: 5
10 20 5 40 15
SAMPLE_OUTPUT: 40
SAMPLE_INPUT_2: 3
1 2 3
SAMPLE_OUTPUT_2: 3
DIFFICULTY: Medium
BTL: BTL-3
SUBJECT: DSA
UNIT: Unit 1
TOPIC: Arrays
TEST_CASES:
INPUT: 4
7 2 9 4
OUTPUT: 9
INPUT: 1
5
OUTPUT: 5
INPUT: 6
-1 -5 -3 -2 -9 -4
OUTPUT: -1
INPUT: 5
0 0 0 0 0
OUTPUT: 0
INPUT: 2
1000000 999999
OUTPUT: 1000000
INPUT: 4
3 3 3 3
OUTPUT: 3
INPUT: 7
1 2 3 4 5 6 7
OUTPUT: 7
INPUT: 3
-10 -20 -30
OUTPUT: -10
INPUT: 5
100 50 100 25 100
OUTPUT: 100
INPUT: 2
-5 5
OUTPUT: 5
`;

// Download a sample template for bulk question import — quiz types by default, or coding
// questions via ?type=coding; .xlsx by default, or Notepad/.txt via ?format=txt.
router.get("/bulk-template", authenticate, requireRole("ADMIN", "STAFF"), (req, res) => {
  const isCoding = req.query.type === "coding";

  if (req.query.format === "txt") {
    const body = isCoding ? CODING_TXT_TEMPLATE : MCQ_TXT_TEMPLATE;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${isCoding ? "coding-question-template.txt" : "question-bank-template.txt"}`);
    return res.send(body);
  }

  let headers, sampleRows, filename;

  if (isCoding) {
    headers = CODING_TEMPLATE_HEADERS;
    sampleRows = [
      [
        "Sum of Two Numbers", "Java", "Unit 1", "Math", "Addition", "Read two integers and print their sum.", "Easy", "BTL-3", "Java, Python, C++, C",
        2, 256, 10, "1 <= a, b <= 10^9", "Two space-separated integers a and b on one line", "A single integer: a + b",
        "2 3", "5", "2 + 3 = 5",
        "10 20", "30", "",
        "4 6->10||100 200->300||-5 5->0",
        "STDIO", "", "", "",
        "import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    int a = sc.nextInt(), b = sc.nextInt();\n    System.out.println(a + b);\n  }\n}",
        "a, b = map(int, input().split())\nprint(a + b)",
        "#include <iostream>\nusing namespace std;\nint main() {\n  int a, b; cin >> a >> b;\n  cout << a + b;\n}",
        "#include <stdio.h>\nint main() {\n  int a, b; scanf(\"%d %d\", &a, &b);\n  printf(\"%d\", a + b);\n}",
        "Math, Basics", "Java Coding Bank",
      ],
      [
        // FUNCTION-mode test case inputs use one line per parameter (never space-separated on one
        // line, unlike STDIO) — a two-scalar-parameter signature like add(a, b) needs "2\n3", not
        // "2 3", matching exactly what functionHarness.js's generated driver parses per parameter.
        "Add Two Numbers (Function)", "Java", "Unit 1", "Math", "Implement a function that returns the sum of two integers.", "Easy", "BTL-3", "Java, Python, C++",
        2, 256, 10, "1 <= a, b <= 10^9", "N/A — function parameters, not stdin", "N/A — return value, not stdout",
        "2\n3", "5", "2 + 3 = 5",
        "10\n20", "30", "",
        "4\n6->10||100\n200->300||-5\n5->0",
        "Function", "add", "int", "a:int, b:int",
        "", "", "", "",
        "Math, Basics", "Java Coding Bank",
      ],
    ];
    filename = "coding-question-template.xlsx";
  } else {
    headers = TEMPLATE_HEADERS;
    sampleRows = [
      ["Capital of France", "Geography", "Unit 1", "Europe", "What is the capital of France?", "Multiple Choice", "Paris|London|Berlin|Madrid", "Paris", 5, "Easy", "BTL-1", "Paris has been the capital since 987 AD."],
      ["Water boils at 100C", "Science", "Unit 1", "Physics", "Water boils at 100°C at sea level.", "True/False", "", "True", 2, "Easy", "BTL-1", ""],
      ["Prime numbers", "Math", "Unit 2", "Number Theory", "Which of the following are prime numbers?", "Multiple Select", "2|3|4|9", "2,3", 5, "Medium", "BTL-2", "2 and 3 are prime; 4 and 9 are not."],
    ];
    filename = "question-bank-template.xlsx";
  }

  const sheet = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Questions");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(buffer);
});

// Export the current (optionally filtered) question bank to .xlsx
// An explicit `questionIds` param (comma-separated or repeated) overrides the filter-based
// selection entirely — powers "Export selected" from the bulk action bar without a new endpoint.
router.get("/export", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questions = req.query.questionIds
    ? await prisma.question.findMany({
        where: {
          id: { in: Array.isArray(req.query.questionIds) ? req.query.questionIds : String(req.query.questionIds).split(",").map((s) => s.trim()).filter(Boolean) },
          ...questionVisibilityWhere(req),
        },
        include: { subjectRef: { select: { name: true } }, unitRef: { select: { name: true } } },
        orderBy: { questionNumber: "asc" },
      })
    : await prisma.question.findMany({
        where: buildWhere(req.query, req),
        include: { subjectRef: { select: { name: true } }, unitRef: { select: { name: true } } },
        orderBy: { questionNumber: "asc" },
      });

  const rows = questions.map((q) => {
    const options = Array.isArray(q.options) ? q.options : [];
    const correctAnswer = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
    return [
      `Q${q.questionNumber}`,
      q.title || "",
      q.subjectRef?.name || q.subject || "",
      q.unitRef?.name || "",
      q.topic || "",
      q.description,
      TYPE_LABELS[q.questionType] || q.questionType,
      options.join("|"),
      correctAnswer.map((i) => options[i]).filter(Boolean).join(","),
      q.points,
      DIFFICULTY_LABELS[q.difficulty] || q.difficulty,
      q.explanation || "",
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([["Question ID", ...TEMPLATE_HEADERS], ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Questions");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  await logAudit({
    req, action: AUDIT_ACTIONS.QUESTION_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
    instituteId: req.requesterInstituteId, details: { count: questions.length },
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=question-bank-export.xlsx");
  res.send(buffer);
});

const TYPE_LABELS = { CODING: "Coding", MCQ: "Multiple Choice", TRUE_FALSE: "True/False", MULTISELECT: "Multiple Select" };
const DIFFICULTY_LABELS = { EASY: "Easy", MEDIUM: "Medium", HARD: "Hard" };
const TYPE_ALIASES = {
  "multiple choice": "MCQ", mcq: "MCQ",
  "true false": "TRUE_FALSE", "true/false": "TRUE_FALSE", truefalse: "TRUE_FALSE",
  "multiple select": "MULTISELECT", "multi select": "MULTISELECT", multiselect: "MULTISELECT",
  coding: "CODING",
};
const DIFFICULTY_ALIASES = { easy: "EASY", medium: "MEDIUM", hard: "HARD" };

const IMPORT_HEADER_ALIASES = {
  title: ["question name", "name"],
  subject: ["subject", "subject course", "subject/course"],
  unit: ["unit"],
  topic: ["topic"],
  description: ["question text", "question", "text"],
  questionType: ["question type", "type"],
  options: ["options"],
  correctAnswer: ["correct answer", "answer"],
  points: ["marks", "points"],
  difficulty: ["difficulty level", "difficulty"],
  explanation: ["explanation"],
  btl: ["btl", "btl level", "bloom s taxonomy level"],
};

function normalizeHeader(str) {
  return String(str || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildHeaderMap(headers) {
  const map = {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(IMPORT_HEADER_ALIASES)) {
      if (!map[field] && aliases.includes(norm)) map[field] = header;
    }
  }
  return map;
}

// Reads an uploaded bulk-import file into the header-keyed row shape buildHeaderMap()/field()
// expect — branches purely on file extension: .txt goes through the Notepad-format parser
// (bulkQuestionParser.js), everything else goes through the existing XLSX.read path unchanged.
// Both produce plain objects keyed by header text, so nothing downstream needs to know which
// format a row came from.
function parseUploadedFile(file, { coding }) {
  const ext = String(file.originalname || "").toLowerCase().split(".").pop();
  if (ext === "txt") {
    const text = file.buffer.toString("utf-8");
    const rows = coding ? parseNotepadCodingText(text) : parseNotepadMcqText(text);
    return { rows, error: null };
  }
  try {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return { rows: sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [], error: null };
  } catch {
    return { rows: null, error: "Could not read this file. Please upload a valid .xlsx, .csv, or .txt file." };
  }
}

// Shared core for quiz-type (MCQ/TRUE_FALSE/MULTISELECT) bulk import — used by all three routes
// below (immediate file import, preview, and confirm-after-preview) so there is exactly one place
// that decides what's valid, what's a duplicate, and what gets written. `commit: false` (preview)
// runs every check and resolves subject/unit/BTL/options exactly as commit: true does, it just
// never calls prisma.question.create — so a preview can never diverge from what confirming the
// same rows would actually do. Duplicate-detection re-queries the DB fresh every call (never
// trusts a cached "was valid at preview time" flag), so a confirm always reflects current state
// even if something else changed in between.
async function runQuizBulkImport(req, { rows, folderId, duplicateAction }, commit) {
  const headerMap = buildHeaderMap(Object.keys(rows[0] || {}));
  if (!headerMap.description || !headerMap.questionType) {
    return { error: "Missing required columns. The file must include Question Text and Question Type." };
  }

  const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
  const created = [];
  const skipped = [];
  const errors = [];
  const seenDescriptions = new Set();
  const existingDescriptionsByScope = new Map();

  async function existingDescriptions(fId, subjectId, unitId) {
    const key = `${fId || ""}::${subjectId || ""}::${unitId || ""}`;
    if (!existingDescriptionsByScope.has(key)) {
      const rows = await prisma.question.findMany({
        where: { folderId: fId || null, subjectId: subjectId || null, unitId: unitId || null, ...questionVisibilityWhere(req) },
        select: { description: true },
      });
      existingDescriptionsByScope.set(key, new Set(rows.map((r) => (r.description || "").trim().toLowerCase()).filter(Boolean)));
    }
    return existingDescriptionsByScope.get(key);
  }

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const row = rows[i];
    const title = field(row, "title");
    const description = field(row, "description");
    const typeRaw = field(row, "questionType");

    if (!title && !description && !typeRaw) continue; // blank row

    if (!description) { errors.push({ row: rowNum, reason: "Missing Question Text" }); continue; }
    const questionType = TYPE_ALIASES[normalizeHeader(typeRaw)];
    if (!questionType) { errors.push({ row: rowNum, reason: `Unrecognized Question Type "${typeRaw}"` }); continue; }
    if (questionType === "CODING") {
      errors.push({ row: rowNum, reason: "Coding questions use the separate coding-question bulk upload (different template/columns), not this one" });
      continue;
    }

    const subject = field(row, "subject");
    const unit = field(row, "unit");
    const topic = field(row, "topic");
    const resolvedSubject = await resolveSubjectUnitTopicByName(req, { subjectName: subject, unitName: unit, topicName: topic });
    if (resolvedSubject.error) { errors.push({ row: rowNum, reason: resolvedSubject.error }); continue; }

    const descKey = description.trim().toLowerCase();
    if (duplicateAction !== "import") {
      if (seenDescriptions.has(descKey)) {
        skipped.push({ row: rowNum, reason: "Duplicate question text within this file" });
        continue;
      }
      const existing = await existingDescriptions(folderId, resolvedSubject.subjectId, resolvedSubject.unitId);
      if (existing.has(descKey)) {
        skipped.push({ row: rowNum, reason: "A question with this text already exists under that Subject/Unit" });
        continue;
      }
    }

    const optionsRaw = field(row, "options").split("|").map((s) => s.trim()).filter(Boolean);
    const correctAnswerRaw = field(row, "correctAnswer");
    const pointsRaw = field(row, "points");
    const difficultyRaw = field(row, "difficulty");
    const explanation = field(row, "explanation");

    try {
      const normalized = normalizeOptions(questionType, optionsRaw, correctAnswerRaw);
      const btlLevel = parseBtlLevel(field(row, "btl"));
      const data = {
        title: title || null,
        description,
        subject: subject || null,
        topic: topic || null,
        subjectId: resolvedSubject.subjectId,
        unitId: resolvedSubject.unitId,
        topicId: resolvedSubject.topicId,
        questionType,
        difficulty: DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)] || "EASY",
        btlLevel,
        points: Number(pointsRaw) || 10,
        explanation: explanation || null,
        options: normalized.options,
        correctAnswer: normalized.correctAnswer,
        instituteId: req.requesterInstituteId,
        folderId,
        createdById: req.user.id,
      };
      if (commit) {
        const question = await prisma.question.create({ data });
        created.push(question);
      } else {
        created.push({ row: rowNum, title: title || null, description, questionType, difficulty: data.difficulty, btlLevel });
      }
      seenDescriptions.add(descKey);
      (await existingDescriptions(folderId, resolvedSubject.subjectId, resolvedSubject.unitId)).add(descKey);
    } catch (err) {
      errors.push({ row: rowNum, reason: safeErrorMessage(err, "Failed to create question") });
    }
  }

  if (commit && created.length > 0) {
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { count: created.length, folderId },
    });
  }
  // Only present (and only meaningful) on a preview — the exact original row data the frontend
  // should re-post to /bulk-import/confirm once the staff member is happy with the summary.
  // Built from `created`'s row numbers (commit: false pushes a {row, ...} marker there instead of
  // an actual Question) rather than re-deriving "was this row valid" from scratch, so it can never
  // drift from what the counts above actually say passed.
  const validRows = commit ? undefined : created.map((c) => rows[c.row - 2]);

  return {
    total: rows.length, createdCount: created.length, skippedCount: skipped.length, errorCount: errors.length,
    skipped, errors, created, validRows,
  };
}

async function resolveFolderForBulkImport(req, folderId) {
  if (!folderId) return null;
  const folder = await prisma.questionFolder.findUnique({ where: { id: folderId } });
  if (!folder || !ownsQuestionRow(req, folder)) {
    const err = new Error("That folder isn't in your institute's question bank");
    err.status = 403;
    throw err;
  }
  return folderId;
}

// Bulk-import quiz questions (MCQ / True-False / Multiple Select) from .xlsx/.csv/.txt, writing
// directly. Kept for backward compatibility (existing integrations/scripts) — the in-app upload
// UI uses /bulk-import/preview + /bulk-import/confirm below instead, per the platform's
// Preview -> Validate -> Confirm requirement, so a staff member always sees what will be created
// before anything is actually written.
router.post("/bulk-import", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, uploadQuestionFile.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(req.file, { coding: false });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runQuizBulkImport(req, { rows, folderId, duplicateAction }, true);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

// Preview step: parses + validates a .xlsx/.csv/.txt file exactly as /bulk-import would, but
// never writes to the database. Returns the same counts/errors/skipped summary plus `validRows`
// (the original row data for everything that passed) for the frontend to show a Preview screen
// and then re-post to /bulk-import/confirm once the staff member confirms.
router.post("/bulk-import/preview", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, uploadQuestionFile.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(req.file, { coding: false });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runQuizBulkImport(req, { rows, folderId, duplicateAction }, false);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Preview failed" });
  }
});

// Confirm step: takes the `validRows` a preview call returned (JSON body, not a file) and
// actually creates them — re-running every validation/duplicate check fresh against current DB
// state rather than trusting the preview's snapshot, since something else may have changed in the
// meantime. This is the only place either preview or confirm ever calls prisma.question.create.
router.post("/bulk-import/confirm", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: "No rows to import" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runQuizBulkImport(req, { rows, folderId, duplicateAction }, true);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});

const LANGUAGE_ALIASES = {
  java: "java", python: "python", py: "python",
  cpp: "cpp", "c++": "cpp", "cplusplus": "cpp",
  c: "c", javascript: "javascript", js: "javascript",
};

function buildCodingHeaderMap(headers) {
  const map = {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(CODING_IMPORT_HEADER_ALIASES)) {
      if (!map[field] && aliases.includes(norm)) map[field] = header;
    }
  }
  return map;
}

// "5->25||3->9" -> [{input:"5",expected:"25"},{input:"3",expected:"9"}]. A malformed pair (no
// "->") is silently dropped rather than failing the whole row — the row is flagged separately if
// too few valid pairs survive to meet the hidden-case minimum.
function parseHiddenTestCases(raw) {
  return String(raw || "")
    .split("||")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("->");
      if (idx === -1) return null;
      return { input: pair.slice(0, idx).trim(), expected: pair.slice(idx + 2).trim(), isHidden: true };
    })
    .filter(Boolean);
}

// Bulk-import CODING questions from .xlsx/.csv — see CODING_TEMPLATE_HEADERS for the column
// layout and the module-level comment above it for the hidden-test-case cell format. Each row can
// name its own destination Question Bank (created if it doesn't exist yet); a row with no bank
// name falls back to the `folderId` sent with the upload (the same "Save to Question Bank" picker
// used for quiz bulk-import), and no bank at all leaves the question unfiled.
// Shared core for CODING bulk import — same "one function, commit true/false" design as
// runQuizBulkImport above, for the same reason (a preview must run exactly the logic a confirm
// would). The one side-effect a plain validation pass would normally cause — auto-creating a
// named Question Bank folder that doesn't exist yet (resolveBankFolder below) — is suppressed
// when commit is false, since Preview must never write anything; the folder is created for real
// only when this same function is called again with commit: true at confirm time.
async function runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction }, commit) {
  const headerMap = buildCodingHeaderMap(Object.keys(rows[0] || {}));
  if (!headerMap.title || !headerMap.description) {
    return { error: "Missing required columns. The file must include Question Title and Problem Statement." };
  }

  const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
  const created = [];
  const skipped = [];
  const errors = [];
  const seenTitles = new Set();
  const folderIdByName = new Map();
  const existingTitlesByScope = new Map();

  async function existingTitles(folderId, subjectId, unitId) {
    const key = `${folderId || ""}::${subjectId || ""}::${unitId || ""}`;
    if (!existingTitlesByScope.has(key)) {
      const rows = await prisma.question.findMany({
        where: { folderId: folderId || null, subjectId: subjectId || null, unitId: unitId || null, questionType: "CODING", ...questionVisibilityWhere(req) },
        select: { title: true },
      });
      existingTitlesByScope.set(key, new Set(rows.map((r) => (r.title || "").toLowerCase()).filter(Boolean)));
    }
    return existingTitlesByScope.get(key);
  }

  async function resolveBankFolder(name) {
    if (!name) return defaultFolderId;
    const key = name.toLowerCase();
    if (folderIdByName.has(key)) return folderIdByName.get(key);
    let folder = await prisma.questionFolder.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, ...questionVisibilityWhere(req) },
    });
    if (!folder && commit) {
      folder = await prisma.questionFolder.create({
        data: { name, instituteId: req.requesterInstituteId, createdById: req.user.id },
      });
    }
    // Preview + folder doesn't exist yet: no id to cache/return — existingTitles(null, ...) below
    // is still correct (a not-yet-created folder trivially has no existing questions in it).
    const id = folder?.id || null;
    if (id) folderIdByName.set(key, id);
    return id;
  }

  {
    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const title = field(row, "title");
      const description = field(row, "description");

      if (!title && !description) continue; // blank row
      if (!title) { errors.push({ row: rowNum, reason: "Missing Question Title" }); continue; }
      if (!description) { errors.push({ row: rowNum, reason: "Missing Problem Statement" }); continue; }

      const titleKey = title.toLowerCase();
      if (duplicateAction !== "import" && seenTitles.has(titleKey)) {
        skipped.push({ row: rowNum, reason: `Duplicate title within this file: "${title}"` });
        continue;
      }

      const resolvedSubject = await resolveSubjectUnitTopicByName(req, {
        subjectName: field(row, "subject"), unitName: field(row, "unit"), topicName: field(row, "topic"),
      });
      if (resolvedSubject.error) {
        errors.push({ row: rowNum, reason: resolvedSubject.error });
        continue;
      }

      const difficultyRaw = field(row, "difficulty");
      if (difficultyRaw && !DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)]) {
        errors.push({ row: rowNum, reason: `Invalid Difficulty "${difficultyRaw}" — use Easy, Medium, or Hard` });
        continue;
      }
      const difficulty = DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)] || "EASY";

      const timeLimitSecRaw = field(row, "timeLimitSec");
      const timeLimitSec = timeLimitSecRaw ? Number(timeLimitSecRaw) : 2;
      if (!Number.isFinite(timeLimitSec) || timeLimitSec <= 0) {
        errors.push({ row: rowNum, reason: `Invalid Time Limit "${timeLimitSecRaw}"` });
        continue;
      }

      const memoryLimitMbRaw = field(row, "memoryLimitMb");
      let memoryLimitKb = null;
      if (memoryLimitMbRaw) {
        const mb = Number(memoryLimitMbRaw);
        if (!Number.isFinite(mb) || mb <= 0) {
          errors.push({ row: rowNum, reason: `Invalid Memory Limit "${memoryLimitMbRaw}"` });
          continue;
        }
        memoryLimitKb = Math.round(mb * 1024);
      }

      const languagesRaw = field(row, "languages");
      const requestedLanguages = languagesRaw.split(/[,|]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const unsupported = requestedLanguages.filter((l) => !LANGUAGE_ALIASES[l]);
      if (requestedLanguages.length > 0 && unsupported.length === requestedLanguages.length) {
        errors.push({ row: rowNum, reason: `Unsupported language(s): ${unsupported.join(", ")}` });
        continue;
      }

      const sample1In = field(row, "sampleInput1"), sample1Out = field(row, "sampleOutput1");
      const sample2In = field(row, "sampleInput2"), sample2Out = field(row, "sampleOutput2");
      if (!sample1In || !sample1Out || !sample2In || !sample2Out) {
        errors.push({ row: rowNum, reason: "Each coding question needs 2 complete sample test cases (input + output)" });
        continue;
      }
      const hiddenCases = parseHiddenTestCases(field(row, "hiddenTestCases"));
      if (hiddenCases.length < 10) {
        errors.push({ row: rowNum, reason: `Needs at least 10 hidden test cases — found ${hiddenCases.length} (check the "input->output||input->output" format)` });
        continue;
      }

      const starterCodeByLanguage = {};
      const javaCode = field(row, "starterJava");
      const pyCode = field(row, "starterPython");
      const cppCode = field(row, "starterCpp");
      const cCode = field(row, "starterC");
      if (javaCode) starterCodeByLanguage.java = javaCode;
      if (pyCode) starterCodeByLanguage.python = pyCode;
      if (cppCode) starterCodeByLanguage.cpp = cppCode;
      if (cCode) starterCodeByLanguage.c = cCode;
      // The Programming Languages column previously only validated that the text was recognizable
      // and then discarded it — the declared list now actually filters which starter-code columns
      // get saved, so an admin's language selection has a real effect instead of silently doing
      // nothing while whatever starter-code columns happened to be filled in got saved regardless.
      if (requestedLanguages.length > 0) {
        const canonical = new Set(requestedLanguages.map((l) => LANGUAGE_ALIASES[l]).filter(Boolean));
        for (const lang of Object.keys(starterCodeByLanguage)) {
          if (!canonical.has(lang)) delete starterCodeByLanguage[lang];
        }
      }

      const tags = field(row, "tags").split(",").map((s) => s.trim()).filter(Boolean);
      const bankName = field(row, "questionBank");

      // "Function" mode: resolveCodingFields() validates the signature and auto-generates starter
      // code for every language it supports, overriding whatever the Starter Code columns held —
      // same guarantee CreateQuestion.jsx's admin form relies on, so a bulk-imported FUNCTION
      // question can never drift from what its own signature actually produces.
      const evaluationModeRaw = normalizeHeader(field(row, "evaluationMode"));
      const isFunctionMode = evaluationModeRaw === "function" || evaluationModeRaw === "functionbased";
      let functionSignature = null;
      if (isFunctionMode) {
        const paramsRaw = field(row, "functionParams");
        const params = paramsRaw
          ? paramsRaw.split(",").map((pair) => {
              const [name, type] = pair.split(":").map((s) => (s || "").trim());
              return { name, type };
            })
          : [];
        functionSignature = { methodName: field(row, "functionName"), returnType: field(row, "returnType"), params };
      }

      try {
        const folderId = await resolveBankFolder(bankName);
        const titles = await existingTitles(folderId, resolvedSubject.subjectId, resolvedSubject.unitId);
        if (duplicateAction !== "import" && titles.has(titleKey)) {
          skipped.push({ row: rowNum, reason: `A question titled "${title}" already exists under that Subject/Unit` });
          continue;
        }

        const resolved = resolveCodingFields({
          evaluationType: isFunctionMode ? "FUNCTION" : "STDIO",
          functionSignature,
          starterCodeByLanguage,
        });
        const btlLevel = parseBtlLevel(field(row, "btl"));

        const data = {
          title,
          topic: field(row, "topic") || null,
          subtopic: field(row, "subtopic") || null,
          subjectId: resolvedSubject.subjectId,
          unitId: resolvedSubject.unitId,
          topicId: resolvedSubject.topicId,
          description,
          questionType: "CODING",
          difficulty,
          btlLevel,
          points: Number(field(row, "points")) || 10,
          timeLimitMs: Math.round(timeLimitSec * 1000),
          memoryLimitKb,
          evaluationType: resolved.evaluationType,
          functionSignature: resolved.functionSignature,
          starterCode: Object.values(resolved.starterCodeByLanguage || starterCodeByLanguage)[0] || "",
          starterCodeByLanguage: Object.keys(resolved.starterCodeByLanguage || starterCodeByLanguage).length > 0 ? (resolved.starterCodeByLanguage || starterCodeByLanguage) : undefined,
          tags: tags.length > 0 ? tags : undefined,
          constraints: field(row, "constraints") || null,
          inputFormat: field(row, "inputFormat") || null,
          outputFormat: field(row, "outputFormat") || null,
          instituteId: req.requesterInstituteId,
          folderId,
          createdById: req.user.id,
          testCases: {
            create: [
              { input: sample1In, expected: sample1Out, isHidden: false, explanation: field(row, "sampleExplanation1") || null },
              { input: sample2In, expected: sample2Out, isHidden: false, explanation: field(row, "sampleExplanation2") || null },
              ...hiddenCases,
            ],
          },
        };
        if (commit) {
          const question = await prisma.question.create({ data });
          created.push(question);
        } else {
          created.push({ row: rowNum, title, description, difficulty, btlLevel });
        }
        seenTitles.add(titleKey);
        titles.add(titleKey);
      } catch (err) {
        errors.push({ row: rowNum, reason: safeErrorMessage(err, "Failed to create question") });
      }
    }
  }

  if (commit && created.length > 0) {
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { count: created.length, coding: true },
    });
  }
  const validRows = commit ? undefined : created.map((c) => rows[c.row - 2]);
  return {
    total: rows.length, createdCount: created.length, skippedCount: skipped.length, errorCount: errors.length,
    skipped, errors, created, validRows,
  };
}

// Bulk-import CODING questions from .xlsx/.csv/.txt, writing directly — kept for backward
// compatibility, same as /bulk-import above. The in-app upload UI uses
// /bulk-import-coding/preview + /bulk-import-coding/confirm instead.
router.post("/bulk-import-coding", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, uploadQuestionFile.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const defaultFolderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(req.file, { coding: true });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction }, true);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

router.post("/bulk-import-coding/preview", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, uploadQuestionFile.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const defaultFolderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(req.file, { coding: true });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction }, false);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Preview failed" });
  }
});

router.post("/bulk-import-coding/confirm", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: "No rows to import" });
    const defaultFolderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction }, true);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});

// Duplicate: clone a single question (incl. test cases) right where it already lives — the
// single-row counterpart to bulk-copy above. Unlike bulk-copy (which exists to move a question
// into a DIFFERENT bank, and deliberately skips a same-folder target to avoid exact
// self-duplicates), Duplicate exists to give an admin a near-identical starting point in the SAME
// bank, e.g. "Two Sum" -> "Two Sum (Copy)" as a base for a variant question. Was previously
// missing entirely — an admin's only way to get a near-copy was Export then re-import (quiz types
// only; coding questions have no import path at all — see bulk-import's rejection above) or
// retyping the whole question by hand.
router.post("/:id/duplicate", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const original = await prisma.question.findUnique({ where: { id: req.params.id }, include: { testCases: true } });
    if (!original || !ownsQuestionRow(req, original)) return res.status(404).json({ error: "Question not found" });

    const { id, questionNumber, createdAt, testCases, createdById: _c, instituteId: _i, ...rest } = original;
    const clone = await prisma.question.create({
      data: {
        ...rest,
        title: rest.title ? `${rest.title} (Copy)` : rest.title,
        // A duplicate is unreviewed content until an admin re-checks it, regardless of the
        // original's own review status — same "never auto-publish unreviewed content" rule
        // applied to AI-generated questions elsewhere in this file.
        questionStatus: "DRAFT",
        instituteId: req.requesterInstituteId,
        createdById: req.user.id,
        testCases: {
          create: testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden, explanation: tc.explanation || null })),
        },
      },
      include: { testCases: true },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { questionId: clone.id, title: clone.title || clone.description.slice(0, 60), duplicatedFrom: original.id },
    });
    res.json(clone);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to duplicate question") });
  }
});

router.get("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const question = await prisma.question.findUnique({
    where: { id: req.params.id },
    include: { testCases: true, folder: { include: { shares: { select: { staffId: true } } } } },
  });
  // 404 (not 403) on a cross-institute id — doesn't confirm whether the id exists at all,
  // consistent with how the list endpoint already just omits rows it can't show.
  if (!question || !ownsQuestionRow(req, question)) return res.status(404).json({ error: "Question not found" });
  res.json(question);
});

// Edit a question (any type)
router.patch("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: { folder: { include: { shares: { select: { staffId: true } } } } },
    });
    if (!existing || !ownsQuestionRow(req, existing)) return res.status(404).json({ error: "Question not found" });

    const {
      title, description, subject, topic, questionType, difficulty, points, explanation,
      timeLimitMs, starterCode, testCases, options, correctAnswer, folderId,
      evaluationType, functionSignature, starterCodeByLanguage, referenceSolution, memoryLimitKb, tags, sqlSchema,
      estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
      edgeCases, problemExplanation, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
      subtopic, btlLevel, skillTested, questionStatus,
      subjectId, unitId, topicId,
    } = req.body;

    if (folderId !== undefined && folderId !== null && folderId !== existing.folderId) {
      const folder = await prisma.questionFolder.findUnique({
        where: { id: folderId },
        include: { shares: { select: { staffId: true } } },
      });
      if (!folder || !ownsQuestionRow(req, folder)) {
        return res.status(403).json({ error: "That folder isn't in your institute's question bank" });
      }
    }

    // Classification (Subject/Unit/Topic) is only re-validated when the caller actually sends it —
    // an edit that doesn't touch classification (e.g. fixing a typo) doesn't force reclassifying a
    // legacy "Needs classification" question. Any UI built against this route going forward
    // (CreateQuestion.jsx) always sends the current subjectId/unitId, so this branch runs on every
    // save from the new picker while leaving old, unrelated PATCH callers unaffected.
    let resolvedSubject = { subjectId: existing.subjectId, unitId: existing.unitId, topicId: existing.topicId };
    if (subjectId !== undefined || unitId !== undefined) {
      resolvedSubject = await resolveSubjectUnitTopic(req, {
        subjectId: subjectId !== undefined ? subjectId : existing.subjectId,
        unitId: unitId !== undefined ? unitId : existing.unitId,
        topicId: topicId !== undefined ? topicId : existing.topicId,
      });
      if (resolvedSubject.error) return res.status(400).json({ error: resolvedSubject.error });
    }

    const type = QUESTION_TYPES.includes(questionType) ? questionType : existing.questionType;

    const data = {
      updatedById: req.user.id,
      title: title ?? existing.title,
      description: description ?? existing.description,
      subject: subject ?? existing.subject,
      topic: topic ?? existing.topic,
      subjectId: resolvedSubject.subjectId,
      unitId: resolvedSubject.unitId,
      topicId: resolvedSubject.topicId,
      questionType: type,
      difficulty: difficulty || existing.difficulty,
      points: points ?? existing.points,
      explanation: explanation ?? existing.explanation,
      folderId: folderId !== undefined ? folderId : existing.folderId,
      estimatedTimeMin: estimatedTimeMin !== undefined ? estimatedTimeMin : existing.estimatedTimeMin,
      realWorldScenario: realWorldScenario !== undefined ? realWorldScenario : existing.realWorldScenario,
      constraints: constraints !== undefined ? constraints : existing.constraints,
      inputFormat: inputFormat !== undefined ? inputFormat : existing.inputFormat,
      outputFormat: outputFormat !== undefined ? outputFormat : existing.outputFormat,
      notes: notes !== undefined ? notes : existing.notes,
      edgeCases: edgeCases !== undefined ? edgeCases : existing.edgeCases,
      problemExplanation: problemExplanation !== undefined ? problemExplanation : existing.problemExplanation,
      hints: hints !== undefined ? hints : existing.hints,
      timeComplexity: timeComplexity !== undefined ? timeComplexity : existing.timeComplexity,
      spaceComplexity: spaceComplexity !== undefined ? spaceComplexity : existing.spaceComplexity,
      editorial: editorial !== undefined ? editorial : existing.editorial,
      similarQuestions: similarQuestions !== undefined ? similarQuestions : existing.similarQuestions,
      subtopic: subtopic !== undefined ? (subtopic || null) : existing.subtopic,
      btlLevel: btlLevel !== undefined ? (BTL_LEVELS.includes(Number(btlLevel)) ? Number(btlLevel) : null) : existing.btlLevel,
      skillTested: skillTested !== undefined ? (skillTested || null) : existing.skillTested,
      questionStatus: questionStatus !== undefined ? (QUESTION_STATUSES.includes(questionStatus) ? questionStatus : existing.questionStatus) : existing.questionStatus,
    };

    if (type === "CODING") {
      data.timeLimitMs = timeLimitMs ?? existing.timeLimitMs;
      data.memoryLimitKb = memoryLimitKb !== undefined ? (memoryLimitKb || null) : existing.memoryLimitKb;
      data.starterCode = starterCode ?? existing.starterCode;
      data.tags = tags !== undefined ? (Array.isArray(tags) && tags.length > 0 ? tags : null) : undefined;
      data.options = null;
      data.correctAnswer = null;

      const resolved = resolveCodingFields({
        evaluationType: evaluationType !== undefined ? evaluationType : existing.evaluationType,
        functionSignature: functionSignature !== undefined ? functionSignature : existing.functionSignature,
        starterCodeByLanguage: starterCodeByLanguage !== undefined ? starterCodeByLanguage : existing.starterCodeByLanguage,
      });
      data.evaluationType = resolved.evaluationType;
      data.functionSignature = resolved.functionSignature;
      if (resolved.starterCodeByLanguage) data.starterCodeByLanguage = resolved.starterCodeByLanguage;
      if (referenceSolution !== undefined) {
        data.referenceSolution = referenceSolution && typeof referenceSolution === "object" ? referenceSolution : null;
      }
      data.sqlSchema = null; // clear a stale value left over if this question used to be type SQL

      if (testCases) {
        if (testCases.filter((tc) => !tc.isHidden).length < 2) {
          return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases" });
        }
        if (testCases.filter((tc) => tc.isHidden).length < 10) {
          return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation" });
        }
        // Nested deleteMany+create inside the SAME update() call below, rather than a separate
        // prisma.testCase.deleteMany() executed here — keeps the replace atomic with the update. A
        // separate up-front deleteMany left a real corruption window: the VERIFIED-status gate a
        // few lines down can still return 400 (e.g. a bad FUNCTION signature) AFTER test cases were
        // already wiped but BEFORE prisma.question.update() ever ran to recreate them, leaving the
        // question with zero test cases in the DB. Nesting both inside `data` means neither runs
        // unless update() itself is actually reached.
        data.testCases = {
          deleteMany: {},
          create: testCases.map((tc) => ({ input: tc.input, expected: tc.expected, isHidden: tc.isHidden ?? true, explanation: tc.explanation || null })),
        };
      }
    } else if (type === "SQL") {
      data.sqlSchema = sqlSchema !== undefined ? sqlSchema : existing.sqlSchema;
      data.timeLimitMs = timeLimitMs ?? existing.timeLimitMs;
      data.options = null;
      data.correctAnswer = null;
      // Clear stale values left over if this question used to be type CODING.
      data.memoryLimitKb = null;
      data.starterCode = null;
      data.starterCodeByLanguage = null;
      data.tags = null;
      data.evaluationType = "STDIO";
      data.functionSignature = null;

      if (testCases) {
        if (testCases.filter((tc) => !tc.isHidden).length < 1) {
          return res.status(400).json({ error: "Each SQL question needs at least 1 visible sample test case" });
        }
        if (testCases.filter((tc) => tc.isHidden).length < 5) {
          return res.status(400).json({ error: "Each SQL question needs at least 5 hidden test cases for final evaluation" });
        }
        // See the identical comment in the CODING branch above — nested inside `data` rather than
        // a separate up-front deleteMany, so the VERIFIED-status gate below can never leave this
        // question's test cases wiped without a replacement.
        data.testCases = {
          deleteMany: {},
          create: testCases.map((tc) => ({ input: tc.input || "", expected: tc.expected, isHidden: tc.isHidden ?? true, explanation: tc.explanation || null })),
        };
      }
    } else {
      const normalized = normalizeOptions(type, options ?? existing.options, correctAnswer ?? existing.correctAnswer);
      data.options = normalized.options;
      data.correctAnswer = normalized.correctAnswer;
      // Clear stale values left over if this question used to be type CODING or SQL.
      data.sqlSchema = null;
      data.evaluationType = "STDIO";
      data.functionSignature = null;
    }

    if (data.questionStatus === "VERIFIED" && (type === "CODING" || type === "SQL")) {
      const effectiveCases = testCases || await prisma.testCase.findMany({ where: { questionId: existing.id } });
      const reasons = validateQuestionForVerification({ ...existing, ...data }, effectiveCases);
      if (reasons.length > 0) {
        return res.status(400).json({ error: "Cannot mark as VERIFIED — this question isn't ready yet", reasons });
      }
    }

    const question = await prisma.question.update({ where: { id: existing.id }, data, include: { testCases: true } });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { questionId: question.id, title: question.title || question.description.slice(0, 60) },
    });
    res.json(question);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: safeErrorMessage(err, "Failed to update question") });
  }
});

router.delete("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: { folder: { include: { shares: { select: { staffId: true } } } } },
    });
    if (!existing || !ownsQuestionRow(req, existing)) return res.status(404).json({ error: "Question not found" });
    const withHistory = await questionIdsWithSubmissionHistory([existing.id]);
    if (withHistory.has(existing.id)) {
      return res.status(409).json({ error: SUBMISSION_HISTORY_BLOCK_MESSAGE });
    }
    await prisma.question.delete({ where: { id: req.params.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { questionId: existing.id, title: existing.title || existing.description.slice(0, 60) },
    });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "This question is used in one or more tests and can't be deleted." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

module.exports = router;
