// Question-bank import and export rules that need no database: the template files and their column names, the header aliases a spreadsheet may use, how an uploaded
// file is read into rows, the Roman-numeral unit matching, and how the export sheet is built. The templates and alias tables are exactly the ones the routes this
// replaced served; the contract snapshot (backend/test/snapshots/question-import-export-contract.json) reads every template back.
const XLSX = require("xlsx");
const { parseNotepadMcqText, parseNotepadCodingText } = require("../../utils/bulkQuestionParser");


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

// The sample workbook a staff member downloads, quiz types by default, coding with type "coding", or both sheets with type "combined". The Instructions sheet comes
// first (the tab seen when the file opens); parseUploadedFile() skips it by name, not by position.
function templateWorkbook(type) {
  const isCoding = type === "coding";
  const isCombined = type === "combined";
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
  return { buffer, filename };
}

// The Notepad (.txt) template: one question type per file by design, so there is no combined text template.
function templateText(coding) {
  return { body: coding ? CODING_TXT_TEMPLATE : MCQ_TXT_TEMPLATE, filename: coding ? "coding-question-template.txt" : "question-bank-template.txt" };
}

// The export sheet. Column order and shape mirror TEMPLATE_HEADERS exactly (separate Option A-D and a letter-based Correct Option) so an exported file re-uploads
// cleanly through the same bulk import without being reshaped first.
function exportWorkbook(questions) {
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
  return buffer;
}

module.exports = {
  TEMPLATE_HEADERS, CODING_TEMPLATE_HEADERS, CODING_IMPORT_HEADER_ALIASES, IMPORT_HEADER_ALIASES, TYPE_ALIASES, DIFFICULTY_ALIASES, DIFFICULTY_LABELS, TYPE_LABELS, LANGUAGE_ALIASES,
  EMPTY_BULK_RESULT, normalizeUnitName, normalizeHeader, buildHeaderMap, buildCodingHeaderMap, parseHiddenTestCases, parseUploadedFile, parseUploadedFileBothSheets, tagSheet,
  sanitizeForSpreadsheet, templateWorkbook, templateText, exportWorkbook,
};
