const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { requireFeature } = require("../middleware/featureGate");
const { resolveCodingFields } = require("../utils/functionHarness");
const { spreadsheetFileFilter, spreadsheetOrTextFileFilter } = require("../utils/uploadFilters");
const { parseNotepadMcqText, parseNotepadCodingText, splitLetterList, resolveCorrectLetterToken } = require("../utils/bulkQuestionParser");
const { questionVisibilityWhere, questionFolderVisibilityWhere, ownsQuestionRow } = require("../utils/questionVisibility");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { safeErrorMessage } = require("../utils/errors");
const { normalizeOptions } = require("../utils/mcqOptions");
const questionImages = require("../utils/questionImages");
const { extractImageZip, validateZipImage } = require("../utils/bulkImageZip");
const { canStaffUseSubject, resolveSubjectUnitTopic, staffAuthorizedSubjectIds } = require("../utils/subjectAccess");
const { cached, invalidate } = require("../utils/cache");
const { buildWhere, parseBtlLevel } = require("../modules/questions/questions.domain");

const router = express.Router();

// GET /analytics (below) caches its result per institute+user for 60s, but with ~25 separate
// question/folder mutation routes in this file (create, bulk-move/status/delete/copy, several
// bulk-import variants, folder CRUD/merge/share/clear, patch/delete, image upload/delete) none of
// them invalidated it -- confirmed as a live bug class 2026-09-23 alongside the same gap in
// several other cached routes. Rather than hand-instrument every one of those routes individually
// (error-prone, and silently stops covering any new mutation route added here later), this single
// router-level hook invalidates the cache after any non-GET request that actually succeeds --
// covers every mutation in this file uniformly, present and future.
router.use((req, res, next) => {
  if (req.method !== "GET") {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) invalidate("questionAnalytics:");
      return originalJson(body);
    };
  }
  next();
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });
// Bulk import with an OPTIONAL "images ZIP" alongside the spreadsheet -- a row's "Image File Name"
// column names a file the ZIP must actually contain (see utils/bulkImageZip.js). Two named fields
// instead of `.single(...)` because a bulk-import request can legitimately carry both files at
// once; fileFilter branches on fieldname since "file" and "imagesZip" accept different formats.
// 20MB cap (vs. 5MB for the spreadsheet alone) -- a ZIP of even a few dozen diagrams adds up
// quickly; utils/bulkImageZip.js enforces its own tighter per-file/total-uncompressed limits on
// top of this multer-level cap on the compressed upload itself.
const uploadQuestionFileWithImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "imagesZip") {
      cb(null, /\.zip$/i.test(file.originalname || ""));
      return;
    }
    spreadsheetOrTextFileFilter(req, file, cb);
  },
}).fields([{ name: "file", maxCount: 1 }, { name: "imagesZip", maxCount: 1 }]);
// Confirm-step counterpart: no spreadsheet re-upload (the validated row data is posted as JSON/
// form fields instead — see the /confirm routes below), just the same images ZIP again, since the
// preview step never uploads any image to S3 and the actual bytes only ever existed in that ZIP.
// When the request isn't multipart at all (the common, image-free case — still a plain JSON
// POST, unchanged from before this feature existed), multer/busboy no-ops and simply calls
// next() without touching req.body, so this is safe to apply unconditionally.
const uploadImagesZipOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.zip$/i.test(file.originalname || "")),
}).fields([{ name: "imagesZip", maxCount: 1 }]);


// Column order matches what a faculty member actually fills in first (the question + its options),
// with the rarely-touched/advanced columns (Question Type, Marks, BTL, Question Name) trailing —
// Question Type is optional and auto-detected per row when left blank (True/False when there are
// exactly two True/False options; Multiple Select when Correct Option names more than one letter;
// Multiple Choice otherwise), only needed to force a type explicitly. Separate Option A-D/Correct
// Option (a plain letter) replaces the old single packed "Options"/"Correct Answer" columns as the
// default template shape — runQuizBulkImport still accepts the old packed shape too, so an
// existing file built against the previous template keeps working unchanged.
const TEMPLATE_HEADERS = [
  "Question Text", "Option A", "Option B", "Option C", "Option D", "Correct Option",
  "Explanation", "Difficulty Level", "Subject", "Unit", "Topic",
  "Question Type", "Marks", "BTL", "Question Name",
  // Optional. Names a file that must exist (matched by filename, not by folder path) inside a
  // ZIP of images uploaded alongside this spreadsheet — see the Bulk Upload page's "Images (ZIP)"
  // picker. Leave blank for a question with no diagram/figure. A referenced file that isn't
  // actually found in the ZIP is a row ERROR, never a silently-imported question with no image.
  "Image File Name",
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
  // See TEMPLATE_HEADERS's identical column for the full rationale — same optional
  // matched-against-the-uploaded-ZIP convention, here for a coding question's own diagram/figure.
  "Image File Name",
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
  imageFileName: ["image file name", "image filename", "image name", "image", "picture", "diagram", "figure"],
};
const SUPPORTED_CODING_LANGUAGES = ["java", "python", "cpp", "c", "javascript"];


// normalizeOptions/normalizeCorrectIndices moved to utils/mcqOptions.js (2026-09) so they're a
// pure, dependency-free module regression tests can require directly — see that file's own header
// comment and backend/test/mcqOptions.test.js. Nothing about their behavior changed in the move.

// Real course spreadsheets overwhelmingly label chapters with Roman numerals ("Unit II", "Chapter
// IV") while whoever actually created the Unit row in the CMS often typed the Arabic form ("Unit
// 2", "Chapter 4") or vice versa — objectively the same unit, but a bare case-insensitive string
// match (below) treats them as unrelated and fails EVERY row in the file with the same opaque
// "does not belong to Subject" error (the exact wall-of-identical-errors pattern that led to
// runQuizBulkImport's structureHint fix elsewhere in this file). This normalizes only a single
// whitespace-bounded Roman-numeral token (I-XX — generous for how deep any real course goes) to
// its Arabic form, so "Unit IV: Data Structures" and "Unit 4: Data Structures" collapse to the same
// canonical string while every other part of the name (and any name with no numeral at all) is
// left untouched — it can never coerce two genuinely different units into matching each other.
const ROMAN_TO_ARABIC = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20,
};
function normalizeUnitName(raw) {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return s.replace(/\b([ivx]+)\b/g, (m) => (ROMAN_TO_ARABIC[m] != null ? String(ROMAN_TO_ARABIC[m]) : m));
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
  // findMany, not findFirst: the same Subject name can legitimately exist twice — once shared
  // (instituteId null) and once owned by a specific institute (e.g. two different "Java" rows).
  // findFirst with no orderBy picked whichever one Postgres happened to return first, and if THAT
  // one wasn't the requester's to use while the other genuinely was, every row in the file failed
  // with "not found or not authorized" even though a usable "Java" subject existed the whole time.
  // Try the requester's own institute's copy before the shared one — it's the more specific,
  // almost-certainly-intended match — and only fall through to the generic error if literally none
  // of the same-named candidates are usable.
  const subjectCandidates = await prisma.subject.findMany({
    where: { ...institute, name: { equals: subjectName, mode: "insensitive" } },
    orderBy: { instituteId: { sort: "desc", nulls: "last" } }, // requester's own institute (non-null) before the shared (null) one
  });
  let subject = null;
  for (const candidate of subjectCandidates) {
    if (await canStaffUseSubject(req, candidate.id)) { subject = candidate; break; }
  }
  if (!subject) {
    // Same self-diagnosing-error treatment as the Unit mismatch below: list what this requester
    // can actually use instead of leaving them to guess-and-retry blind. Scoped to their own
    // authorized subjects (staffAuthorizedSubjectIds — null/unrestricted for ADMIN-tier roles), so
    // this never reveals a subject they don't already have access to.
    const authorizedIds = await staffAuthorizedSubjectIds(req);
    const availableWhere = authorizedIds ? { ...institute, id: { in: [...authorizedIds] } } : institute;
    const available = await prisma.subject.findMany({
      where: availableWhere, select: { name: true }, distinct: ["name"], orderBy: { name: "asc" }, take: 20,
    });
    const list = available.map((s) => `"${s.name}"`).join(", ") || "(no subjects configured for you yet)";
    return { error: `Subject "${subjectName}" not found or you're not authorized to use it. Subjects available to you: ${list}` };
  }
  let unit = await prisma.unit.findFirst({ where: { subjectId: subject.id, name: { equals: unitName, mode: "insensitive" } } });
  if (!unit) {
    // Exact match failed — try Roman<->Arabic numeral normalization next. Only auto-resolved when
    // it's unambiguous (exactly one configured unit normalizes to the same string).
    const wantedNormalized = normalizeUnitName(unitName);
    const candidates = await prisma.unit.findMany({ where: { subjectId: subject.id } });
    const normalizedMatches = candidates.filter((u) => normalizeUnitName(u.name) === wantedNormalized);
    if (normalizedMatches.length === 1) {
      unit = normalizedMatches[0];
    } else if (normalizedMatches.length === 0) {
      // No existing Unit matches even loosely — auto-create it under this Subject, the same
      // create-if-missing convention Topic already uses one level below. Unit used to be a hard
      // "must already exist, configure it through the UI first" requirement, which meant a
      // Subject with zero Units configured yet rejected every single bulk-upload row outright —
      // confirmed live 2026-09-11: a staff member bulk-uploading 20 Cybersecurity questions
      // against "Unit 4" hit exactly this wall because the Cybersecurity subject had no Units
      // configured at all. Deterministic and safe: it creates a Unit with the exact name the
      // staff member typed, under the Subject they already confirmed access to — never guesses
      // at a DIFFERENT existing Unit, which is exactly what the Roman-numeral branch above and
      // the ambiguous-match branch below still exist to handle carefully instead.
      unit = await prisma.unit.create({ data: { subjectId: subject.id, name: unitName } });
    } else {
      // Genuinely ambiguous — more than one existing Unit already normalizes to the same string
      // (e.g. both "Unit 4" and "UNIT-4" exist as separate rows already). Auto-creating a third
      // would only add to that mess; this is exactly the case that still needs a human decision,
      // so it still hard-errors rather than guessing.
      const available = candidates.map((u) => `"${u.name}"`).join(", ");
      return { error: `"${unitName}" matches multiple existing units for Subject "${subjectName}": ${available}. Please use one of those exact names.` };
    }
  }
  let topicId = null;
  if (topicName) {
    let topic = await prisma.topic.findFirst({ where: { unitId: unit.id, name: { equals: topicName, mode: "insensitive" } } });
    if (!topic) topic = await prisma.topic.create({ data: { unitId: unit.id, name: topicName } });
    topicId = topic.id;
  }
  return { subjectId: subject.id, unitId: unit.id, topicId };
}




// Notepad/.txt sample templates — hand-written (not generated from the xlsx sample data) so the
// field order and wording match exactly what a staff member typing into Notepad would see,
// including the platform's actual minimums (2 sample cases + 5 hidden cases for coding) spelled
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
least 5 hidden cases inside TEST_CASES (each as an INPUT: / OUTPUT: pair) — fewer than that will
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
`;

const MCQ_TEMPLATE_ROWS = [
  // Question Text, Option A-D, Correct Option, Explanation, Difficulty, Subject, Unit, Topic,
  // [optional:] Question Type, Marks, BTL, Question Name, Image File Name — order matches TEMPLATE_HEADERS.
  ["DELETE THESE 3 EXAMPLE ROWS BEFORE UPLOADING — they're here only to show the format", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["What is 2 + 3?", "4", "5", "6", "7", "B", "2 + 3 = 5.", "Easy", "Java", "Java Basics", "Operators", "", "", "", "", ""],
  ["Water boils at 100°C at sea level.", "True", "False", "", "", "A", "", "Easy", "Science", "Unit 1", "Physics", "", "", "", "", ""],
  ["Which of the following are prime numbers?", "2", "3", "4", "9", "A,B", "2 and 3 are prime; 4 and 9 are not.", "Medium", "Math", "Unit 2", "Number Theory", "Multiple Select", 5, 2, "", ""],
];
const CODING_TEMPLATE_ROWS = [
  [
    "Sum of Two Numbers", "Java", "Unit 1", "Math", "Addition", "Read two integers and print their sum.", "Easy", "BTL-3", "Java, Python, C++, C",
    2, 256, 10, "1 <= a, b <= 10^9", "Two space-separated integers a and b on one line", "A single integer: a + b",
    "2 3", "5", "2 + 3 = 5",
    "10 20", "30", "",
    "4 6->10||100 200->300||-5 5->0||0 0->0||1000000000 1000000000->2000000000",
    "STDIO", "", "", "",
    "import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    int a = sc.nextInt(), b = sc.nextInt();\n    System.out.println(a + b);\n  }\n}",
    "a, b = map(int, input().split())\nprint(a + b)",
    "#include <iostream>\nusing namespace std;\nint main() {\n  int a, b; cin >> a >> b;\n  cout << a + b;\n}",
    "#include <stdio.h>\nint main() {\n  int a, b; scanf(\"%d %d\", &a, &b);\n  printf(\"%d\", a + b);\n}",
    "Math, Basics", "Java Coding Bank", "",
  ],
  [
    // FUNCTION-mode test case inputs use one line per parameter (never space-separated on one
    // line, unlike STDIO) — a two-scalar-parameter signature like add(a, b) needs "2\n3", not
    // "2 3", matching exactly what functionHarness.js's generated driver parses per parameter.
    "Add Two Numbers (Function)", "Java", "Unit 1", "Math", "Implement a function that returns the sum of two integers.", "Easy", "BTL-3", "Java, Python, C++",
    2, 256, 10, "1 <= a, b <= 10^9", "N/A — function parameters, not stdin", "N/A — return value, not stdout",
    "2\n3", "5", "2 + 3 = 5",
    "10\n20", "30", "",
    "4\n6->10||100\n200->300||-5\n5->0||0\n0->0||1000000000\n1000000000->2000000000",
    "Function", "add", "int", "a:int, b:int",
    "", "", "", "",
    "Math, Basics", "Java Coding Bank", "",
  ],
];

// Download a sample template for bulk question import — quiz types by default, coding questions
// via ?type=coding, or ?type=combined (both MCQ and CODING sheets in one workbook, for a faculty
// member who'd rather download once — the two are still uploaded separately, matching each
// sheet's own bulk-import route). .xlsx by default, or Notepad/.txt via ?format=txt (combined
// isn't offered for .txt — the Notepad format is one question-type per file by design).
router.get("/bulk-template", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), requireFeature("question_bank"), (req, res) => {
  const isCoding = req.query.type === "coding";
  const isCombined = req.query.type === "combined";

  if (req.query.format === "txt") {
    const body = isCoding ? CODING_TXT_TEMPLATE : MCQ_TXT_TEMPLATE;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${isCoding ? "coding-question-template.txt" : "question-bank-template.txt"}`);
    return res.send(body);
  }

  const workbook = XLSX.utils.book_new();
  // Instructions sheet FIRST (the tab a faculty member sees when the file first opens) — deliberately
  // short; the goal is "glance at this once," not another document to read. parseUploadedFile()
  // skips this sheet by name (not by position), so its being first here doesn't affect parsing.
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Instructions"],
    ["1. Do not change column names."],
    ["2. One question per row."],
    [isCombined ? "3. MCQ sheet: Correct Option must be A/B/C/D. Coding sheet: Difficulty must be Easy/Medium/Hard." : isCoding ? "3. Difficulty must be Easy, Medium, or Hard." : "3. Correct Option must be A, B, C, or D (or A,B for Multiple Select)."],
    ["4. Do not leave Question Text blank."],
    ["5. Do not add formulas or macros."],
    ["6. Save as .xlsx before uploading."],
    ["7. Delete the example rows on each sheet before uploading your own questions."],
    ["8. Image File Name is optional. If a question needs a diagram/figure, put the image's exact filename there (e.g. triangle.png) and also upload a ZIP containing that file on the Bulk Upload page's \"Images (ZIP)\" picker. A filename that isn't found in the ZIP is rejected as an error, not imported without its image."],
  ]);
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");

  if (isCombined || !isCoding) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...MCQ_TEMPLATE_ROWS]), "MCQ");
  }
  if (isCombined || isCoding) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([CODING_TEMPLATE_HEADERS, ...CODING_TEMPLATE_ROWS]), "CODING");
  }
  const filename = isCombined ? "CodeArena_Question_Upload_Template.xlsx" : isCoding ? "coding-question-template.xlsx" : "question-bank-template.xlsx";
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.send(buffer);
});

// Export the current (optionally filtered) question bank to .xlsx
// An explicit `questionIds` param (comma-separated or repeated) overrides the filter-based
// selection entirely — powers "Export selected" from the bulk action bar without a new endpoint.
router.get("/export", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), async (req, res) => {
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

  const optionLetters = ["A", "B", "C", "D", "E", "F"];
  const rows = questions.map((q) => {
    const options = Array.isArray(q.options) ? q.options : [];
    const correctAnswer = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
    // Column order/shape mirrors TEMPLATE_HEADERS exactly (separate Option A-D + a letter-based
    // Correct Option) so an exported file re-uploads cleanly through the same bulk-import path
    // without needing to be reshaped first.
    return [
      sanitizeForSpreadsheet(q.description),
      sanitizeForSpreadsheet(options[0] || ""), sanitizeForSpreadsheet(options[1] || ""),
      sanitizeForSpreadsheet(options[2] || ""), sanitizeForSpreadsheet(options[3] || ""),
      correctAnswer.map((i) => optionLetters[i]).filter(Boolean).join(","),
      sanitizeForSpreadsheet(q.explanation || ""),
      DIFFICULTY_LABELS[q.difficulty] || q.difficulty,
      sanitizeForSpreadsheet(q.subjectRef?.name || q.subject || ""),
      sanitizeForSpreadsheet(q.unitRef?.name || ""),
      sanitizeForSpreadsheet(q.topic || ""),
      TYPE_LABELS[q.questionType] || q.questionType,
      q.points,
      q.btlLevel || "",
      sanitizeForSpreadsheet(q.title || ""),
    ];
  });

  const sheet = XLSX.utils.aoa_to_sheet([["Question ID", ...TEMPLATE_HEADERS], ...rows.map((r, i) => [`Q${questions[i].questionNumber}`, ...r])]);
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
  "true false": "TRUE_FALSE", "true/false": "TRUE_FALSE", truefalse: "TRUE_FALSE", "true or false": "TRUE_FALSE",
  // "Multiple Selection" (the exact wording used in this platform's own bulk-upload spec/UI copy)
  // was previously NOT recognized here at all — normalizeHeader collapses it to "multiple
  // selection", one word off from the only variants that were mapped ("multiple select"/"multi
  // select"/"multiselect"), so a staff member typing the type name exactly as the template's own
  // section header spells it got every single row rejected as an unrecognized Question Type.
  "multiple select": "MULTISELECT", "multi select": "MULTISELECT", multiselect: "MULTISELECT", "multiple selection": "MULTISELECT",
  coding: "CODING",
};
const DIFFICULTY_ALIASES = {
  easy: "EASY", simple: "EASY", basic: "EASY", beginner: "EASY",
  medium: "MEDIUM", moderate: "MEDIUM", intermediate: "MEDIUM", average: "MEDIUM",
  hard: "HARD", difficult: "HARD", tough: "HARD", advanced: "HARD", expert: "HARD",
};

const IMPORT_HEADER_ALIASES = {
  title: ["question name", "name"],
  subject: ["subject", "subject course", "subject/course", "course"],
  unit: ["unit", "module"],
  topic: ["topic", "chapter"],
  description: ["question text", "question", "text", "question description"],
  questionType: ["question type", "type"],
  options: ["options"],
  // Separate Option A/B/.../F columns — the simple-template alternative to the packed "Options"
  // column above (both are supported; a row using either shape works, see optionsFromRow() below).
  // Recognizes several column-naming conventions a college's own existing spreadsheet might already
  // use (spec: "Answer A"/"Choice A" as well as "Option A"), so a faculty member's own file doesn't
  // need reformatting first.
  optionA: ["option a", "answer a", "choice a"],
  optionB: ["option b", "answer b", "choice b"],
  optionC: ["option c", "answer c", "choice c"],
  optionD: ["option d", "answer d", "choice d"],
  optionE: ["option e", "answer e", "choice e"],
  optionF: ["option f", "answer f", "choice f"],
  // "correct options" (plural) is the Multi-Selection template's own designated header — without
  // it here, a Multi-Selection file using the exact column name the platform's own template spec
  // calls for went completely undetected (every row's correct-answer column silently empty).
  correctAnswer: ["correct answer", "answer", "correct option", "correct options", "correct"],
  points: ["marks", "points"],
  difficulty: ["difficulty level", "difficulty", "level"],
  explanation: ["explanation", "solution"],
  btl: ["btl", "btl level", "bloom s taxonomy level"],
  imageFileName: ["image file name", "image filename", "image name", "image", "picture", "diagram", "figure"],
};

// Formula-injection defense for exported spreadsheets — a question's free-text fields (title,
// description, options, explanation, subject/unit/topic names) are all faculty/staff-authored
// content, not developer-authored, so a cell that happens to start with =, +, -, or @ would
// otherwise be interpreted as a live formula by Excel/Sheets/LibreOffice's CSV/text importers when
// the exported file is later reopened or re-uploaded elsewhere. Prefixing with a single quote is
// the standard mitigation (Excel/Sheets/LibreOffice all treat a leading ' as "force text," not
// part of the displayed value) and is harmless for any value that didn't need it.
function sanitizeForSpreadsheet(value) {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

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
    // The Combined template (bulk-template?type=combined) has BOTH an "MCQ" and a "CODING" sheet
    // in one workbook — whichever import route the file was posted to (this route always knows
    // which, via `coding`) must read the sheet actually matching that, not just "whatever comes
    // first," or a combined file uploaded through the wrong-numbered route would silently parse
    // the other question type's columns as if they were its own. Falls back to "first non-
    // Instructions sheet" for a plain single-sheet file (our own non-combined templates, or a
    // faculty member's own spreadsheet that was never one of our templates at all).
    const wanted = coding ? ["coding", "code"] : ["mcq", "questions", "quiz"];
    const sheetName = workbook.SheetNames.find((n) => wanted.includes(normalizeHeader(n)))
      || workbook.SheetNames.find((n) => normalizeHeader(n) !== "instructions")
      || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return { rows: sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [], error: null };
  } catch {
    return { rows: null, error: "Could not read this file. Please upload a valid .xlsx, .csv, or .txt file." };
  }
}

// Reads the optional "imagesZip" field a bulk-import request may carry (see
// uploadQuestionFileWithImages/uploadImagesZipOnly above) and extracts it via
// utils/bulkImageZip.js. Returns { imageZip: null, error: null } when no zip was uploaded at all
// -- a perfectly normal case, most bulk uploads have no images -- or { imageZip, error } once one
// was. `imageZip` is the exact shape runQuizBulkImport/runCodingBulkImport expect.
function extractImageZipFromRequest(req) {
  const zipFile = req.files?.imagesZip?.[0];
  if (!zipFile) return { imageZip: null, error: null };
  const { filesByName, error } = extractImageZip(zipFile.buffer);
  if (error) return { imageZip: null, error };
  return { imageZip: { filesByName }, error: null };
}

// Shared core for quiz-type (MCQ/TRUE_FALSE/MULTISELECT) bulk import — used by all three routes
// below (immediate file import, preview, and confirm-after-preview) so there is exactly one place
// that decides what's valid, what's a duplicate, and what gets written. `commit: false` (preview)
// runs every check and resolves subject/unit/BTL/options exactly as commit: true does, it just
// never calls prisma.question.create — so a preview can never diverge from what confirming the
// same rows would actually do. Duplicate-detection re-queries the DB fresh every call (never
// trusts a cached "was valid at preview time" flag), so a confirm always reflects current state
// even if something else changed in between.
// `imageZip` is the { filesByName } map from utils/bulkImageZip.js's extractImageZip, or null if
// no images ZIP was uploaded alongside this file at all. A row naming an Image File Name when
// imageZip is null is exactly as much an error as one naming a file the zip doesn't contain --
// spec: never import a question as if its image exists when it doesn't.
async function runQuizBulkImport(req, { rows, folderId, duplicateAction, imageZip }, commit) {
  const headers = Object.keys(rows[0] || {});
  const headerMap = buildHeaderMap(headers);
  // Question Type is optional (auto-detected per row when the column/value is absent — see below);
  // only Question Text is a genuinely hard requirement to import anything at all.
  if (!headerMap.description) {
    return { error: "Missing required column. The file must include Question Text." };
  }
  // A column that didn't map to anything this importer recognizes (a stray "Teacher Notes",
  // "Comments", a leftover column from a different template) is never a reason to fail the whole
  // upload — its data is simply never read. Surfaced once, file-level, so a staff member can
  // confirm that was deliberate rather than silently wondering where a column went.
  const mappedHeaders = new Set(Object.values(headerMap));
  const unknownColumns = headers.filter((h) => !mappedHeaders.has(h));

  const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
  const created = [];
  const skipped = [];
  const errors = [];
  // Deterministic, safe corrections actually applied while reading a row (whitespace/case/
  // punctuation normalization only — never anything that could change what the row means) are
  // recorded here so the preview can show staff exactly what was auto-fixed, per spec: "never
  // silently change content" means never HIDING that a change happened, not never normalizing
  // formatting at all. See recordAutoFix() below.
  const autoFixed = [];
  let unrecognizedTypeCount = 0;
  let attemptedRowCount = 0; // non-blank rows actually evaluated -- the denominator for structureHint below
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
    attemptedRowCount++;

    if (!description) { errors.push({ row: rowNum, reason: "Missing Question Text" }); continue; }

    // Simple template: separate Option A/B/.../F columns, preferred over the packed "Options"
    // column when any are present — the faculty-facing redesign this replaces pipe-delimited
    // options with. Falls back to "Options" untouched for any existing file/template still using
    // the old packed column, so nothing already relying on it breaks.
    const separateOptions = ["optionA", "optionB", "optionC", "optionD", "optionE", "optionF"]
      .map((k) => field(row, k)).filter((v) => v !== "");
    const optionsRaw = separateOptions.length > 0
      ? separateOptions
      : field(row, "options").split("|").map((s) => s.trim()).filter(Boolean);
    // Correct Option as a letter (A/B/C/D, case-insensitive, with an optional "Option "/"Answer "/
    // "Choice " prefix, optional surrounding "()", and an optional trailing "." or ")" -- covers
    // " a ", "a", "A.", "a)", "(A)", "option a", etc., all deterministically the same single
    // answer) resolves against optionsRaw's own position — A is whichever option ended up first
    // regardless of which column shape supplied it. Multiple Selection's "A,C,D" convention (and
    // its "A, C, D" / "A C D" / "A+C+D" variants -- see splitLetterList above) is split into
    // per-letter tokens first; anything that isn't a recognizable single letter (option text, a
    // 1-based number) is passed through untouched to normalizeCorrectIndices, which already
    // handles those.
    const correctAnswerFieldRaw = field(row, "correctAnswer");
    let letterFixApplied = false; // true only when a token was actually resolved as an A-F letter reference
    const correctAnswerRaw = (splitLetterList(correctAnswerFieldRaw) || correctAnswerFieldRaw.split(/[,|]/))
      .map((tok) => {
        const resolved = resolveCorrectLetterToken(tok);
        if (resolved !== null) { letterFixApplied = true; return resolved; }
        return String(tok).trim();
      })
      .join(",");
    // Recorded ONLY when a genuine letter-reference token was resolved (never for a free-text
    // answer, which is passed through completely untouched above and can never set this flag) AND
    // the resulting string actually differs from what was typed -- e.g. " a , c " -> "1,3",
    // "A." -> "1". This is purely a transparency log (spec: "never silently change content" means
    // the staff member reviewing the preview can always see exactly what was auto-fixed and why),
    // not a second source of truth -- correctAnswerRaw above is what's actually used either way.
    if (letterFixApplied && correctAnswerRaw !== correctAnswerFieldRaw.trim()) {
      autoFixed.push({ row: rowNum, field: "Correct Option(s)", before: correctAnswerFieldRaw.trim(), after: correctAnswerRaw });
    }
    const pointsRaw = field(row, "points");
    const difficultyRaw = field(row, "difficulty");
    const explanation = field(row, "explanation");

    // Question Type is optional — the simple template has no such column at all. Auto-detected the
    // same way the Notepad upload format already does: exactly 2 options that are literally
    // True/False -> True/False; more than one Correct Option token -> Multiple Select; otherwise
    // Multiple Choice. An explicit Question Type column, when present, always wins.
    let questionType = typeRaw ? TYPE_ALIASES[normalizeHeader(typeRaw)] : undefined;
    if (!questionType && !typeRaw) {
      const isTrueFalse = optionsRaw.length === 2 && optionsRaw.every((o) => /^(true|false)$/i.test(o));
      const correctCount = correctAnswerRaw.split(",").map((s) => s.trim()).filter(Boolean).length;
      questionType = isTrueFalse ? "TRUE_FALSE" : correctCount > 1 ? "MULTISELECT" : "MCQ";
    }
    if (!questionType) {
      unrecognizedTypeCount++;
      // Confirmed live: a user's own spreadsheet (not our template) can have a "Question Type"-
      // named column whose actual data is really something else (options text, a topic name, etc.)
      // — the raw cell value dumped in full made a wall of unreadable text out of one bad column
      // mapping. Truncated here, and the accepted values spelled out, so one row's error is
      // actually readable; the systemic case (every/most rows wrong the same way -> structureHint
      // below) is what actually explains what's going on.
      const shown = typeRaw.length > 40 ? `${typeRaw.slice(0, 40)}…` : typeRaw;
      errors.push({ row: rowNum, reason: `Unrecognized Question Type "${shown}" — expected MCQ, True/False, or Multiple Select` });
      continue;
    }
    if (questionType === "CODING") {
      errors.push({ row: rowNum, reason: "Coding questions use the separate coding-question bulk upload (different template/columns), not this one" });
      continue;
    }

    const subject = field(row, "subject");
    const unit = field(row, "unit");
    const topic = field(row, "topic");
    const resolvedSubject = await resolveSubjectUnitTopicByName(req, { subjectName: subject, unitName: unit, topicName: topic });
    if (resolvedSubject.error) { errors.push({ row: rowNum, reason: resolvedSubject.error }); continue; }

    // An unrecognized (non-blank) Difficulty is auto-corrected to Medium rather than blocking the
    // row outright — confirmed live 2026-09-11: a real generated question bank used values like
    // "Confusing"/"Difficult" that don't cleanly map to Easy/Medium/Hard, and rejecting every one
    // of those rows meant the only way to import anything was hand-editing the spreadsheet first.
    // "Difficult"/"Tough"/etc. are now recognized aliases (see DIFFICULTY_ALIASES) and resolve
    // exactly like "Hard" always did; only a value that STILL doesn't match anything recognizable
    // falls back to Medium. Never silent, though — recorded in autoFixed exactly like every other
    // correction here, so a staff member reviewing the preview can see it happened and fix it
    // properly later if Medium wasn't the right call for that specific question.
    if (difficultyRaw && !DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)]) {
      autoFixed.push({ row: rowNum, field: "Difficulty", before: difficultyRaw, after: "Medium (unrecognized value)" });
    }

    // Optional image attachment. A row that names one is validated up front (same "clear error,
    // never a silent partial import" treatment as every other required field) -- never created
    // as if the image existed when it didn't, per spec.
    const imageFileNameRaw = field(row, "imageFileName");
    let imageBuffer = null;
    let imageMime = null;
    if (imageFileNameRaw) {
      if (commit && !questionImages.isConfigured()) {
        errors.push({ row: rowNum, reason: "Image storage isn't configured on this server yet — remove the Image File Name or try again later" });
        continue;
      }
      if (!imageZip) {
        errors.push({ row: rowNum, reason: `Image "${imageFileNameRaw}" was referenced but no images ZIP was uploaded alongside this file` });
        continue;
      }
      const basename = imageFileNameRaw.split("/").pop().split("\\").pop();
      const found = imageZip.filesByName.get(basename.toLowerCase());
      const { mime, error: imageError } = validateZipImage(found, imageFileNameRaw);
      if (imageError) {
        errors.push({ row: rowNum, reason: imageError });
        continue;
      }
      imageBuffer = found;
      imageMime = mime;
    }

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
        // Blank cell (no difficulty given at all) still defaults to Easy, unchanged; a non-blank
        // but unrecognized value defaults to Medium instead, matching the autoFixed message above.
        difficulty: DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)] || (difficultyRaw ? "MEDIUM" : "EASY"),
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
        let question = await prisma.question.create({ data });
        if (imageBuffer) {
          // Uploaded only now, after the question row itself exists (S3 keys are namespaced by
          // question id) and only ever for a REAL commit -- a preview never touches S3 at all, so
          // cancelling out of a preview never leaves an orphaned upload behind.
          try {
            const imageKey = await questionImages.uploadQuestionImage(question.id, imageBuffer, imageMime);
            question = await prisma.question.update({ where: { id: question.id }, data: { imageKey, imageMimeType: imageMime } });
          } catch (imgErr) {
            // The question itself was already created successfully -- an image upload failure
            // (S3 hiccup, not configured on this server) shouldn't un-create it or silently
            // pretend the whole row failed. Surfaced as a warning-shaped error entry instead so
            // staff can see it and re-attach the image via the question's own Edit screen.
            errors.push({ row: rowNum, reason: `Question created, but its image failed to upload: ${safeErrorMessage(imgErr, "unknown error")}` });
          }
        }
        created.push(question);
      } else {
        created.push({ row: rowNum, title: title || null, description, questionType, difficulty: data.difficulty, btlLevel, hasImage: !!imageBuffer });
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

  // Confirmed live: a real upload where every one of 30 rows failed with "Unrecognized Question
  // Type" (the actual cell value was clearly Options text, not a type) produced 30 near-identical
  // giant error lines and no indication of WHY -- the header-name matching found a "Question Type"
  // column, but that column's data in the user's own file doesn't line up with our template's
  // column order. One clear, file-level diagnostic here (surfaced as a banner above the per-row
  // list, not buried in it) turns "30 walls of red text" into one fixable takeaway.
  let structureHint = null;
  if (attemptedRowCount >= 3 && unrecognizedTypeCount === attemptedRowCount) {
    structureHint = "Every row in this file has an unrecognized Question Type. This almost always means your spreadsheet's columns don't match our template's order (e.g. a column is missing, extra, or shifted) rather than 30 individual typos. Download the template below and copy your data into it column-by-column, or reorder your existing columns to match it exactly.";
  } else if (attemptedRowCount >= 5 && unrecognizedTypeCount / attemptedRowCount >= 0.8) {
    structureHint = "Most rows in this file have an unrecognized Question Type. Check that your Question Type column only contains MCQ, True/False, or Multiple Select, and that your columns are in the same order as our template.";
  }

  return {
    total: rows.length, createdCount: created.length, skippedCount: skipped.length, errorCount: errors.length,
    skipped, errors, created, validRows, structureHint,
    autoFixedCount: autoFixed.length, autoFixed, unknownColumns,
    // On preview, `created` holds the lightweight {row, ..., hasImage} marker; on a real commit
    // it holds the actual created Question rows, which carry imageKey once the S3 upload inside
    // the commit branch above succeeded — either shape is covered here.
    imagesValidatedCount: created.filter((c) => c.hasImage || c.imageKey).length,
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
router.post("/bulk-import", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadQuestionFileWithImages, async (req, res) => {
  try {
    const file = req.files?.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(file, { coding: false });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runQuizBulkImport(req, { rows, folderId, duplicateAction, imageZip }, true);
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
router.post("/bulk-import/preview", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadQuestionFileWithImages, async (req, res) => {
  try {
    const file = req.files?.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(file, { coding: false });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runQuizBulkImport(req, { rows, folderId, duplicateAction, imageZip }, false);
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
// uploadImagesZipOnly no-ops (does not touch req.body) on a plain JSON POST -- the overwhelmingly
// common image-free case, completely unchanged from before this feature existed. Only a request
// that actually re-attaches the images ZIP arrives as multipart, in which case `rows` (and
// `folderId`/`duplicateAction`) arrive as plain string form fields rather than already-parsed
// JSON -- see rows parsing below.
router.post("/bulk-import/confirm", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadImagesZipOnly, async (req, res) => {
  try {
    let rows;
    try {
      rows = Array.isArray(req.body.rows) ? req.body.rows : JSON.parse(req.body.rows || "[]");
    } catch {
      return res.status(400).json({ error: "Invalid rows payload" });
    }
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "No rows to import" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runQuizBulkImport(req, { rows, folderId, duplicateAction, imageZip }, true);
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
async function runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction, imageZip }, commit) {
  const codingHeaders = Object.keys(rows[0] || {});
  const headerMap = buildCodingHeaderMap(codingHeaders);
  if (!headerMap.title || !headerMap.description) {
    return { error: "Missing required columns. The file must include Question Title and Problem Statement." };
  }
  // Same file-level "we ignored this column" notice as the quiz importer — see its own comment.
  const mappedCodingHeaders = new Set(Object.values(headerMap));
  const unknownColumns = codingHeaders.filter((h) => !mappedCodingHeaders.has(h));

  const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
  const created = [];
  const skipped = [];
  const errors = [];
  // Same deterministic-corrections transparency log as the quiz importer — see its own comment.
  const autoFixed = [];
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
      where: { name: { equals: name, mode: "insensitive" }, ...questionFolderVisibilityWhere(req) },
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
      // Same auto-fix-not-block treatment as the quiz importer's identical column — see its own
      // comment for the full rationale (a value like "Confusing" that doesn't recognizably map to
      // Easy/Medium/Hard now falls back to Medium and is logged, rather than rejecting the row).
      if (difficultyRaw && !DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)]) {
        autoFixed.push({ row: rowNum, field: "Difficulty", before: difficultyRaw, after: "Medium (unrecognized value)" });
      }
      const difficulty = DIFFICULTY_ALIASES[normalizeHeader(difficultyRaw)] || (difficultyRaw ? "MEDIUM" : "EASY");

      // Optional image attachment -- same validate-up-front, never-import-as-if-it-existed
      // treatment as the quiz importer's identical block (see its own comment for the full
      // rationale).
      const imageFileNameRaw = field(row, "imageFileName");
      let imageBuffer = null;
      let imageMime = null;
      if (imageFileNameRaw) {
        if (commit && !questionImages.isConfigured()) {
          errors.push({ row: rowNum, reason: "Image storage isn't configured on this server yet — remove the Image File Name or try again later" });
          continue;
        }
        if (!imageZip) {
          errors.push({ row: rowNum, reason: `Image "${imageFileNameRaw}" was referenced but no images ZIP was uploaded alongside this file` });
          continue;
        }
        const basename = imageFileNameRaw.split("/").pop().split("\\").pop();
        const found = imageZip.filesByName.get(basename.toLowerCase());
        const { mime, error: imageError } = validateZipImage(found, imageFileNameRaw);
        if (imageError) {
          errors.push({ row: rowNum, reason: imageError });
          continue;
        }
        imageBuffer = found;
        imageMime = mime;
      }

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
      if (hiddenCases.length < 5) {
        errors.push({ row: rowNum, reason: `Needs at least 5 hidden test cases — found ${hiddenCases.length} (check the "input->output||input->output" format)` });
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
          let question = await prisma.question.create({ data });
          if (imageBuffer) {
            try {
              const imageKey = await questionImages.uploadQuestionImage(question.id, imageBuffer, imageMime);
              question = await prisma.question.update({ where: { id: question.id }, data: { imageKey, imageMimeType: imageMime } });
            } catch (imgErr) {
              errors.push({ row: rowNum, reason: `Question created, but its image failed to upload: ${safeErrorMessage(imgErr, "unknown error")}` });
            }
          }
          created.push(question);
        } else {
          created.push({ row: rowNum, title, description, difficulty, btlLevel, hasImage: !!imageBuffer });
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
    skipped, errors, created, validRows, unknownColumns,
    autoFixedCount: autoFixed.length, autoFixed,
    imagesValidatedCount: created.filter((c) => c.hasImage || c.imageKey).length,
  };
}

// Bulk-import CODING questions from .xlsx/.csv/.txt, writing directly — kept for backward
// compatibility, same as /bulk-import above. The in-app upload UI uses
// /bulk-import-coding/preview + /bulk-import-coding/confirm instead.
router.post("/bulk-import-coding", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadQuestionFileWithImages, async (req, res) => {
  try {
    const file = req.files?.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const defaultFolderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(file, { coding: true });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction, imageZip }, true);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

router.post("/bulk-import-coding/preview", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadQuestionFileWithImages, async (req, res) => {
  try {
    const file = req.files?.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const defaultFolderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { rows, error } = parseUploadedFile(file, { coding: true });
    if (error) return res.status(400).json({ error });
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction, imageZip }, false);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Preview failed" });
  }
});

router.post("/bulk-import-coding/confirm", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadImagesZipOnly, async (req, res) => {
  try {
    let rows;
    try {
      rows = Array.isArray(req.body.rows) ? req.body.rows : JSON.parse(req.body.rows || "[]");
    } catch {
      return res.status(400).json({ error: "Invalid rows payload" });
    }
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "No rows to import" });
    const defaultFolderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    const result = await runCodingBulkImport(req, { rows, defaultFolderId, duplicateAction, imageZip }, true);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});

// Reads a workbook's "MCQ" and "CODING" sheets independently (as opposed to parseUploadedFile's
// single-sheet pick) — the combined-import counterpart to the Combined Template download
// (bulk-template?type=combined), which is the ONLY thing that put both sheets in one file to
// begin with. No Notepad/.txt equivalent by design (see BulkQuestionImport.jsx's own comment on
// why): a combined upload always requires a real spreadsheet.
function parseUploadedFileBothSheets(file) {
  const ext = String(file.originalname || "").toLowerCase().split(".").pop();
  if (ext === "txt") {
    return { error: "Combined import needs a spreadsheet file (.xlsx/.csv) with separate MCQ and CODING sheets — Notepad format only holds one question type per file. Use the Quiz or Coding option instead for a .txt upload." };
  }
  try {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const mcqSheetName = workbook.SheetNames.find((n) => ["mcq", "questions", "quiz"].includes(normalizeHeader(n)));
    const codingSheetName = workbook.SheetNames.find((n) => ["coding", "code"].includes(normalizeHeader(n)));
    if (!mcqSheetName && !codingSheetName) {
      return { error: 'Could not find an "MCQ" or "CODING" sheet in this file. Combined import expects the Combined Template\'s sheet names — download it below and copy your data in.' };
    }
    const mcqRows = mcqSheetName ? XLSX.utils.sheet_to_json(workbook.Sheets[mcqSheetName], { defval: "" }) : [];
    const codingRows = codingSheetName ? XLSX.utils.sheet_to_json(workbook.Sheets[codingSheetName], { defval: "" }) : [];
    return { mcqRows, codingRows, error: null };
  } catch {
    return { error: "Could not read this file. Please upload a valid .xlsx or .csv file." };
  }
}

const EMPTY_BULK_RESULT = { total: 0, createdCount: 0, skippedCount: 0, errorCount: 0, skipped: [], errors: [], created: [], validRows: [], autoFixedCount: 0, autoFixed: [], unknownColumns: [], imagesValidatedCount: 0 };

// Tags each error/skipped-row reason with which sheet it came from — MCQ and CODING each number
// their own rows starting at 2, so "Row 5" alone would be ambiguous once the two sheets' issues
// are merged into one list.
function tagSheet(rows, label) {
  return (rows || []).map((r) => ({ ...r, reason: `[${label}] ${r.reason}` }));
}

// Combined import: one upload, both sheets — the real gap a Combined Template download alone
// doesn't close. Without this, importing a Combined-Template file meant uploading it twice (once
// under Quiz, once under Coding), with nothing telling a staff member the file even had a second
// sheet worth importing; easy to silently import only the MCQs and never notice the CODING sheet
// was skipped. Runs both sheets' existing, unmodified import logic (runQuizBulkImport /
// runCodingBulkImport) side by side and merges the two summaries into one preview/result.
router.post("/bulk-import-combined/preview", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadQuestionFileWithImages, async (req, res) => {
  try {
    const file = req.files?.file?.[0];
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { mcqRows, codingRows, error } = parseUploadedFileBothSheets(file);
    if (error) return res.status(400).json({ error });
    if (mcqRows.length === 0 && codingRows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows in either sheet." });
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    // Preview only reads — safe to run concurrently, unlike confirm below. Both sheets share the
    // one uploaded images ZIP -- an image referenced from either an MCQ or a Coding row is looked
    // up in the exact same file.
    const [mcqResult, codingResult] = await Promise.all([
      mcqRows.length ? runQuizBulkImport(req, { rows: mcqRows, folderId, duplicateAction, imageZip }, false) : EMPTY_BULK_RESULT,
      codingRows.length ? runCodingBulkImport(req, { rows: codingRows, defaultFolderId: folderId, duplicateAction, imageZip }, false) : EMPTY_BULK_RESULT,
    ]);
    if (mcqResult.error) return res.status(400).json({ error: `MCQ sheet: ${mcqResult.error}` });
    if (codingResult.error) return res.status(400).json({ error: `CODING sheet: ${codingResult.error}` });
    res.json({
      total: mcqResult.total + codingResult.total,
      createdCount: mcqResult.createdCount + codingResult.createdCount,
      skippedCount: mcqResult.skippedCount + codingResult.skippedCount,
      errorCount: mcqResult.errorCount + codingResult.errorCount,
      mcqCount: mcqResult.createdCount,
      codingCount: codingResult.createdCount,
      errors: [...tagSheet(mcqResult.errors, "MCQ"), ...tagSheet(codingResult.errors, "Coding")],
      skipped: [...tagSheet(mcqResult.skipped, "MCQ"), ...tagSheet(codingResult.skipped, "Coding")],
      structureHint: mcqResult.structureHint || null,
      autoFixedCount: (mcqResult.autoFixedCount || 0) + (codingResult.autoFixedCount || 0),
      // tagSheet (above) assumes a `.reason` field, which autoFixed entries don't have (they carry
      // field/before/after instead) -- tagged via the `field` label itself instead, so it still
      // reads clearly ("[MCQ] Correct Option(s)") without producing a bogus "undefined" reason.
      autoFixed: [
        ...(mcqResult.autoFixed || []).map((f) => ({ ...f, field: `[MCQ] ${f.field}` })),
        ...(codingResult.autoFixed || []).map((f) => ({ ...f, field: `[Coding] ${f.field}` })),
      ],
      unknownColumns: [...new Set([...(mcqResult.unknownColumns || []), ...(codingResult.unknownColumns || [])])],
      imagesValidatedCount: (mcqResult.imagesValidatedCount || 0) + (codingResult.imagesValidatedCount || 0),
      // Kept separate (not flattened into one `validRows`) so confirm can route each half back
      // through the import logic that actually knows how to create that question type.
      mcqValidRows: mcqResult.validRows || [],
      codingValidRows: codingResult.validRows || [],
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Preview failed" });
  }
});

router.post("/bulk-import-combined/confirm", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, requireFeature("question_bank"), uploadImagesZipOnly, async (req, res) => {
  try {
    let mcqRows, codingRows;
    try {
      mcqRows = Array.isArray(req.body.mcqRows) ? req.body.mcqRows : JSON.parse(req.body.mcqRows || "[]");
      codingRows = Array.isArray(req.body.codingRows) ? req.body.codingRows : JSON.parse(req.body.codingRows || "[]");
    } catch {
      return res.status(400).json({ error: "Invalid rows payload" });
    }
    if (!Array.isArray(mcqRows)) mcqRows = [];
    if (!Array.isArray(codingRows)) codingRows = [];
    if (mcqRows.length === 0 && codingRows.length === 0) return res.status(400).json({ error: "No rows to import" });
    const folderId = await resolveFolderForBulkImport(req, req.body.folderId || null);
    const { imageZip, error: zipError } = extractImageZipFromRequest(req);
    if (zipError) return res.status(400).json({ error: zipError });
    const duplicateAction = req.body.duplicateAction === "import" ? "import" : "skip";
    // Sequential, not Promise.all: both halves write real rows via prisma.question.create, and
    // this is a rare, small-volume action — no reason to risk interleaved writes for it.
    const mcqResult = mcqRows.length ? await runQuizBulkImport(req, { rows: mcqRows, folderId, duplicateAction, imageZip }, true) : EMPTY_BULK_RESULT;
    const codingResult = codingRows.length ? await runCodingBulkImport(req, { rows: codingRows, defaultFolderId: folderId, duplicateAction, imageZip }, true) : EMPTY_BULK_RESULT;
    if (mcqResult.error) return res.status(400).json({ error: `MCQ sheet: ${mcqResult.error}` });
    if (codingResult.error) return res.status(400).json({ error: `CODING sheet: ${codingResult.error}` });
    res.json({
      total: mcqResult.total + codingResult.total,
      createdCount: mcqResult.createdCount + codingResult.createdCount,
      // Confirmed missing 2026-09-30: every other bulk-import confirm route (quiz-only,
      // coding-only, and this same combined route's own preview) reports skippedCount/skipped —
      // this one silently dropped them, so a Combined-template confirm with duplicate rows told
      // staff "N created" with zero indication some rows were skipped as dupes, unlike every other
      // path. Same shape as preview's skippedCount/skipped above.
      skippedCount: mcqResult.skippedCount + codingResult.skippedCount,
      errorCount: mcqResult.errorCount + codingResult.errorCount,
      mcqCount: mcqResult.createdCount,
      codingCount: codingResult.createdCount,
      created: [...(mcqResult.created || []), ...(codingResult.created || [])],
      skipped: [...tagSheet(mcqResult.skipped, "MCQ"), ...tagSheet(codingResult.skipped, "Coding")],
      errors: [...tagSheet(mcqResult.errors, "MCQ"), ...tagSheet(codingResult.errors, "Coding")],
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Import failed" });
  }
});


// The authoring half (create, list, read one, edit, duplicate, delete, images, analytics, authoring helpers) lives in modules/questions. Mounted LAST so the literal
// paths above ("/folders", "/bulk-template", "/export", ...) are matched before that module's "/:id" routes.
router.use(require("../modules/questions/questions.routes"));

module.exports = router;
