const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { validateSignature, generateStarterCode, languagesSupportedBy, resolveCodingFields } = require("../utils/functionHarness");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");
const { questionVisibilityWhere, ownsQuestionRow } = require("../utils/questionVisibility");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { safeErrorMessage } = require("../utils/errors");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

const QUESTION_TYPES = ["CODING", "MCQ", "TRUE_FALSE", "MULTISELECT", "SQL"];
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
// Employability & Subject Readiness module — see Question.btlLevel/questionStatus schema comments.
const BTL_LEVELS = [1, 2, 3, 4, 5, 6];
const QUESTION_STATUSES = ["DRAFT", "UNDER_REVIEW", "VERIFIED", "PUBLISHED", "ARCHIVED"];

const TEMPLATE_HEADERS = [
  "Question Name", "Subject", "Topic", "Question Text", "Question Type",
  "Options", "Correct Answer", "Marks", "Difficulty Level", "Explanation",
];

// Coding-question bulk import. A flat spreadsheet cell can't hold a nested test-case list, so
// "Hidden Test Cases" packs multiple cases into one cell as `input->output` pairs separated by
// `||` (e.g. "5->25||3->9||10->100") — documented in the template's own header note + sample row.
// Constraints/Input Format/Output Format map onto Question.constraints/inputFormat/outputFormat.
const CODING_TEMPLATE_HEADERS = [
  "Question Title", "Topic", "Problem Statement", "Difficulty", "Programming Languages",
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
  topic: ["topic"],
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
};
const SUPPORTED_CODING_LANGUAGES = ["java", "python", "cpp", "c", "javascript"];

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

function buildWhere(query, req) {
  const where = { AND: [questionVisibilityWhere(req)] };
  if (query.subject) where.subject = query.subject;
  if (query.topic) where.topic = query.topic;
  if (query.difficulty && DIFFICULTIES.includes(query.difficulty)) where.difficulty = query.difficulty;
  if (query.questionType && QUESTION_TYPES.includes(query.questionType)) where.questionType = query.questionType;
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

// Create a question (any type)
router.post("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      title, description, subject, topic, questionType, difficulty, points, explanation,
      timeLimitMs, starterCode, testCases, options, correctAnswer, folderId,
      evaluationType, functionSignature, starterCodeByLanguage, memoryLimitKb, tags, sqlSchema,
      estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
      edgeCases, problemExplanation, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
      allowDuplicate, subtopic, btlLevel, skillTested, questionStatus, aiGenerated,
    } = req.body;

    if (!description) return res.status(400).json({ error: "Question text is required" });
    const type = QUESTION_TYPES.includes(questionType) ? questionType : "CODING";

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
      include: { _count: { select: { testCases: true } }, createdBy: { select: { id: true, name: true } } },
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
  const visible = questionVisibilityWhere(req);
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
  res.json({
    subjects: subjects.map((s) => s.subject).filter(Boolean).sort(),
    topics: topics.map((t) => t.topic).filter(Boolean).sort(),
    creators: creators.sort((a, b) => a.name.localeCompare(b.name)),
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
  const folder = await prisma.questionFolder.findUnique({ where: { id: req.params.id } });
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
  const folder = await prisma.questionFolder.findUnique({ where: { id: req.params.id } });
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  if (!ownsQuestionRow(req, folder)) return res.status(403).json({ error: "Not your institute's folder" });

  const folderIds = await collectDescendantFolders(folder.id);
  const questions = await prisma.question.findMany({ where: { folderId: { in: folderIds } }, select: { id: true } });
  const blocked = questions.length > 0
    ? await prisma.testQuestion.findMany({ where: { questionId: { in: questions.map((q) => q.id) } }, select: { questionId: true }, distinct: ["questionId"] })
    : [];

  res.json({ questionCount: questions.length, subBankCount: folderIds.length - 1, blockedCount: blocked.length });
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
  const folder = await prisma.questionFolder.findUnique({ where: { id: req.params.id } });
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  if (!ownsQuestionRow(req, folder)) return res.status(403).json({ error: "Not your institute's folder" });

  const folderIds = await collectDescendantFolders(folder.id); // BFS order: root first, deepest last
  const questions = await prisma.question.findMany({ where: { folderId: { in: folderIds } } });

  let deletedQuestionCount = 0;
  const remainingByFolder = new Map();
  for (const q of questions) {
    // A STAFF requester's recursive delete must never touch another staff member's private
    // questions, even ones nested inside a shared/legacy folder the requester is otherwise
    // allowed to delete — skip-and-count exactly like the FK-restrict (P2003/P2014) case below,
    // so that folder simply survives with only the untouched content left in it.
    if (!ownsQuestionRow(req, q)) {
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
  const updatableIds = owned.filter((q) => ownsQuestionRow(req, q)).map((q) => q.id);
  if (updatableIds.length === 0) return res.status(403).json({ error: "None of the selected questions are in your institute's question bank" });

  await prisma.question.updateMany({ where: { id: { in: updatableIds } }, data: { questionStatus } });
  await logAudit({
    req, action: AUDIT_ACTIONS.QUESTION_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
    instituteId: req.requesterInstituteId, details: { bulk: true, count: updatableIds.length, questionStatus },
  });
  res.json({ updatedCount: updatableIds.length, skippedCount: questionIds.length - updatableIds.length });
});

// Bulk-delete: mirrors bulk-move's ownership-filter pattern, but deletes one row at a time
// (not deleteMany) so a mixed selection — some questions attached to a Test, some not —
// partially succeeds instead of the whole batch failing on the first FK-restrict question
// (same per-row P2003/P2014 handling as the single DELETE /:id route below).
router.post("/bulk-delete", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const questionIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : [];
  if (questionIds.length === 0) return res.status(400).json({ error: "No questions selected" });
  const owned = await prisma.question.findMany({ where: { id: { in: questionIds } } });
  const blocked = [];
  let deletedCount = 0;
  for (const q of owned) {
    if (!ownsQuestionRow(req, q)) continue;
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
  const blocked = [];
  let clearedCount = 0;
  for (const q of questions) {
    if (!ownsQuestionRow(req, q)) continue;
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

// Download a sample .xlsx template for bulk question import — quiz types by default,
// or coding questions via ?type=coding.
router.get("/bulk-template", authenticate, requireRole("ADMIN", "STAFF"), (req, res) => {
  const isCoding = req.query.type === "coding";
  let headers, sampleRows, filename;

  if (isCoding) {
    headers = CODING_TEMPLATE_HEADERS;
    sampleRows = [
      [
        "Sum of Two Numbers", "Math", "Read two integers and print their sum.", "Easy", "Java, Python, C++, C",
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
        "Add Two Numbers (Function)", "Math", "Implement a function that returns the sum of two integers.", "Easy", "Java, Python, C++",
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
      ["Capital of France", "Geography", "Europe", "What is the capital of France?", "Multiple Choice", "Paris|London|Berlin|Madrid", "Paris", 5, "Easy", "Paris has been the capital since 987 AD."],
      ["Water boils at 100C", "Science", "Physics", "Water boils at 100°C at sea level.", "True/False", "", "True", 2, "Easy", ""],
      ["Prime numbers", "Math", "Number Theory", "Which of the following are prime numbers?", "Multiple Select", "2|3|4|9", "2,3", 5, "Medium", "2 and 3 are prime; 4 and 9 are not."],
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
        orderBy: { questionNumber: "asc" },
      })
    : await prisma.question.findMany({ where: buildWhere(req.query, req), orderBy: { questionNumber: "asc" } });

  const rows = questions.map((q) => {
    const options = Array.isArray(q.options) ? q.options : [];
    const correctAnswer = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
    return [
      `Q${q.questionNumber}`,
      q.title || "",
      q.subject || "",
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
  subject: ["subject"],
  topic: ["topic"],
  description: ["question text", "question", "text"],
  questionType: ["question type", "type"],
  options: ["options"],
  correctAnswer: ["correct answer", "answer"],
  points: ["marks", "points"],
  difficulty: ["difficulty level", "difficulty"],
  explanation: ["explanation"],
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

// Bulk-import quiz questions (MCQ / True-False / Multiple Select) from .xlsx/.csv.
// Coding questions aren't supported via spreadsheet import — their test cases
// don't map cleanly to flat rows — use the question form for those.
//
// Optional `folderId` in the request body files every created question into that folder (the
// "Save uploaded questions to Question Bank" checkbox on the test-creation page) — the questions
// are always persisted as real rows either way (they have to exist to be attachable to a test),
// omitting folderId just leaves them unfiled rather than skipping creation.
router.post("/bulk-import", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const folderId = req.body.folderId || null;
    if (folderId) {
      const folder = await prisma.questionFolder.findUnique({ where: { id: folderId } });
      if (!folder || !ownsQuestionRow(req, folder)) {
        return res.status(403).json({ error: "That folder isn't in your institute's question bank" });
      }
    }

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Could not read this file. Please upload a valid .xlsx or .csv file." });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    const headerMap = buildHeaderMap(Object.keys(rows[0]));
    if (!headerMap.description || !headerMap.questionType) {
      return res.status(400).json({ error: "Missing required columns. The file must include Question Text and Question Type." });
    }

    const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
    const created = [];
    const skipped = [];
    const errors = [];
    // "import" (from the frontend's duplicate-summary Skip/Import-anyway selector) disables the
    // dedup checks below entirely — every valid row is created regardless of matches.
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const seenDescriptions = new Set(); // within-file duplicate detection, mirrors bulk-import-coding's seenTitles
    const existingDescriptionsByFolder = new Map(); // folderId ("" = unfiled) -> Set of existing descriptions, loaded lazily

    async function existingDescriptions(fId) {
      const key = fId || "";
      if (!existingDescriptionsByFolder.has(key)) {
        const rows = await prisma.question.findMany({
          where: { folderId: fId || null, ...questionVisibilityWhere(req) },
          select: { description: true },
        });
        existingDescriptionsByFolder.set(key, new Set(rows.map((r) => (r.description || "").trim().toLowerCase()).filter(Boolean)));
      }
      return existingDescriptionsByFolder.get(key);
    }

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const title = field(row, "title");
      const description = field(row, "description");
      const typeRaw = field(row, "questionType");

      if (!title && !description && !typeRaw) continue; // blank row

      if (!description) {
        errors.push({ row: rowNum, reason: "Missing Question Text" });
        continue;
      }
      const questionType = TYPE_ALIASES[normalizeHeader(typeRaw)];
      if (!questionType) {
        errors.push({ row: rowNum, reason: `Unrecognized Question Type "${typeRaw}"` });
        continue;
      }
      if (questionType === "CODING") {
        errors.push({ row: rowNum, reason: "Coding questions use the separate coding-question bulk upload (different template/columns), not this one" });
        continue;
      }

      const descKey = description.trim().toLowerCase();
      if (duplicateAction !== "import") {
        if (seenDescriptions.has(descKey)) {
          skipped.push({ row: rowNum, reason: "Duplicate question text within this file" });
          continue;
        }
        const existing = await existingDescriptions(folderId);
        if (existing.has(descKey)) {
          skipped.push({ row: rowNum, reason: "A question with this text already exists in that Question Bank" });
          continue;
        }
      }

      const subject = field(row, "subject");
      const topic = field(row, "topic");
      const optionsRaw = field(row, "options").split("|").map((s) => s.trim()).filter(Boolean);
      const correctAnswerRaw = field(row, "correctAnswer");
      const pointsRaw = field(row, "points");
      const difficultyRaw = field(row, "difficulty");
      const explanation = field(row, "explanation");

      try {
        const normalized = normalizeOptions(questionType, optionsRaw, correctAnswerRaw);
        const question = await prisma.question.create({
          data: {
            title: title || null,
            description,
            subject: subject || null,
            topic: topic || null,
            questionType,
            difficulty: DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)] || "EASY",
            points: Number(pointsRaw) || 10,
            explanation: explanation || null,
            options: normalized.options,
            correctAnswer: normalized.correctAnswer,
            instituteId: req.requesterInstituteId,
            folderId,
            createdById: req.user.id,
          },
        });
        seenDescriptions.add(descKey);
        (await existingDescriptions(folderId)).add(descKey);
        created.push(question);
      } catch (err) {
        errors.push({ row: rowNum, reason: safeErrorMessage(err, "Failed to create question") });
      }
    }

    if (created.length > 0) {
      await logAudit({
        req, action: AUDIT_ACTIONS.QUESTION_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: req.requesterInstituteId, details: { count: created.length, folderId },
      });
    }
    res.json({
      total: rows.length, createdCount: created.length, skippedCount: skipped.length, errorCount: errors.length,
      skipped, errors, created,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk import failed" });
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
router.post("/bulk-import-coding", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const defaultFolderId = req.body.folderId || null;
    if (defaultFolderId) {
      const folder = await prisma.questionFolder.findUnique({ where: { id: defaultFolderId } });
      if (!folder || !ownsQuestionRow(req, folder)) {
        return res.status(403).json({ error: "That folder isn't in your institute's question bank" });
      }
    }

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Could not read this file. Please upload a valid .xlsx or .csv file." });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    const headerMap = buildCodingHeaderMap(Object.keys(rows[0]));
    if (!headerMap.title || !headerMap.description) {
      return res.status(400).json({ error: "Missing required columns. The file must include Question Title and Problem Statement." });
    }

    const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
    const created = [];
    const skipped = [];
    const errors = [];
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const seenTitles = new Set(); // within-file duplicate detection
    const folderIdByName = new Map(); // bank name (lowercased) -> folderId, resolved/created once per name
    const existingTitlesByFolder = new Map(); // folderId ("" = unfiled) -> Set of existing titles, loaded lazily

    async function existingTitles(folderId) {
      const key = folderId || "";
      if (!existingTitlesByFolder.has(key)) {
        const rows = await prisma.question.findMany({
          where: { folderId: folderId || null, questionType: "CODING", ...questionVisibilityWhere(req) },
          select: { title: true },
        });
        existingTitlesByFolder.set(key, new Set(rows.map((r) => (r.title || "").toLowerCase()).filter(Boolean)));
      }
      return existingTitlesByFolder.get(key);
    }

    async function resolveBankFolder(name) {
      if (!name) return defaultFolderId;
      const key = name.toLowerCase();
      if (folderIdByName.has(key)) return folderIdByName.get(key);
      let folder = await prisma.questionFolder.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, ...questionVisibilityWhere(req) },
      });
      if (!folder) {
        folder = await prisma.questionFolder.create({
          data: { name, instituteId: req.requesterInstituteId, createdById: req.user.id },
        });
      }
      folderIdByName.set(key, folder.id);
      return folder.id;
    }

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
        const titles = await existingTitles(folderId);
        if (duplicateAction !== "import" && titles.has(titleKey)) {
          skipped.push({ row: rowNum, reason: `A question titled "${title}" already exists in that Question Bank` });
          continue;
        }

        const resolved = resolveCodingFields({
          evaluationType: isFunctionMode ? "FUNCTION" : "STDIO",
          functionSignature,
          starterCodeByLanguage,
        });

        const question = await prisma.question.create({
          data: {
            title,
            topic: field(row, "topic") || null,
            description,
            questionType: "CODING",
            difficulty,
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
          },
        });
        seenTitles.add(titleKey);
        titles.add(titleKey);
        created.push(question);
      } catch (err) {
        errors.push({ row: rowNum, reason: safeErrorMessage(err, "Failed to create question") });
      }
    }

    if (created.length > 0) {
      await logAudit({
        req, action: AUDIT_ACTIONS.QUESTION_IMPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: req.requesterInstituteId, details: { count: created.length, coding: true },
      });
    }
    res.json({
      total: rows.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      skipped,
      errors,
      created,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

router.get("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const question = await prisma.question.findUnique({
    where: { id: req.params.id },
    include: { testCases: true },
  });
  // 404 (not 403) on a cross-institute id — doesn't confirm whether the id exists at all,
  // consistent with how the list endpoint already just omits rows it can't show.
  if (!question || !ownsQuestionRow(req, question)) return res.status(404).json({ error: "Question not found" });
  res.json(question);
});

// Edit a question (any type)
router.patch("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existing || !ownsQuestionRow(req, existing)) return res.status(404).json({ error: "Question not found" });

    const {
      title, description, subject, topic, questionType, difficulty, points, explanation,
      timeLimitMs, starterCode, testCases, options, correctAnswer, folderId,
      evaluationType, functionSignature, starterCodeByLanguage, memoryLimitKb, tags, sqlSchema,
      estimatedTimeMin, realWorldScenario, constraints, inputFormat, outputFormat, notes,
      edgeCases, problemExplanation, hints, timeComplexity, spaceComplexity, editorial, similarQuestions,
      subtopic, btlLevel, skillTested, questionStatus,
    } = req.body;

    if (folderId !== undefined && folderId !== null && folderId !== existing.folderId) {
      const folder = await prisma.questionFolder.findUnique({ where: { id: folderId } });
      if (!folder || !ownsQuestionRow(req, folder)) {
        return res.status(403).json({ error: "That folder isn't in your institute's question bank" });
      }
    }

    const type = QUESTION_TYPES.includes(questionType) ? questionType : existing.questionType;

    const data = {
      title: title ?? existing.title,
      description: description ?? existing.description,
      subject: subject ?? existing.subject,
      topic: topic ?? existing.topic,
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
      data.sqlSchema = null; // clear a stale value left over if this question used to be type SQL

      if (testCases) {
        if (testCases.filter((tc) => !tc.isHidden).length < 2) {
          return res.status(400).json({ error: "Each coding question needs at least 2 visible sample test cases" });
        }
        if (testCases.filter((tc) => tc.isHidden).length < 10) {
          return res.status(400).json({ error: "Each coding question needs at least 10 hidden test cases for final evaluation" });
        }
        await prisma.testCase.deleteMany({ where: { questionId: existing.id } });
        data.testCases = {
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
        await prisma.testCase.deleteMany({ where: { questionId: existing.id } });
        data.testCases = {
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
    const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existing || !ownsQuestionRow(req, existing)) return res.status(404).json({ error: "Question not found" });
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
