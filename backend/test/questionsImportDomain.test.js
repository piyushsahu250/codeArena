const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const d = require("../src/modules/questions/questions.import.domain");

const sheetFile = (sheets, name = "q.xlsx") => { const wb = XLSX.utils.book_new(); for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n); return { originalname: name, buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) }; };

test("header matching ignores case, punctuation and spacing, and the first alias wins", () => {
  assert.equal(d.normalizeHeader("  Option  A! "), "option a");
  const map = d.buildHeaderMap(["Question Text", "Answer A", "Choice B", "Correct Option", "Difficulty Level", "Marks", "Extra"]);
  assert.equal(map.description, "Question Text");
  assert.equal(map.optionA, "Answer A");
  assert.equal(map.optionB, "Choice B");
  assert.equal(map.correctAnswer, "Correct Option");
  assert.equal(map.difficulty, "Difficulty Level");
  assert.equal(map.points, "Marks");
  assert.ok(!Object.values(map).includes("Extra"));
});

test("coding headers: the C++ and C starter columns stay distinct", () => {
  const map = d.buildCodingHeaderMap(["Starter Code (Cpp)", "Starter Code (C)", "Starter Code (Java)", "Question Title", "Problem Statement"]);
  assert.equal(map.starterCpp, "Starter Code (Cpp)");
  assert.equal(map.starterC, "Starter Code (C)");
  assert.equal(map.title, "Question Title");
});

test("Roman and Arabic unit numbers normalise to the same text and nothing else changes", () => {
  assert.equal(d.normalizeUnitName("Unit IV"), "unit 4");
  assert.equal(d.normalizeUnitName("  UNIT  4 "), "unit 4");
  assert.equal(d.normalizeUnitName("Unit XX: Data"), "unit 20: data");
  assert.equal(d.normalizeUnitName("Mixed Vision"), "mixed vision", "a word that merely contains the letters is untouched");
  assert.equal(d.normalizeUnitName("Unit 4"), d.normalizeUnitName("unit iv"));
});

test("hidden test cases: pairs split on || and ->, a malformed pair is dropped", () => {
  assert.deepEqual(d.parseHiddenTestCases("5->25||3->9"), [{ input: "5", expected: "25", isHidden: true }, { input: "3", expected: "9", isHidden: true }]);
  assert.deepEqual(d.parseHiddenTestCases(" 1 -> 2 || nonsense || ->x"), [{ input: "1", expected: "2", isHidden: true }, { input: "", expected: "x", isHidden: true }]);
  assert.deepEqual(d.parseHiddenTestCases(""), []);
});

test("type and difficulty aliases", () => {
  assert.equal(d.TYPE_ALIASES["multiple selection"], "MULTISELECT");
  assert.equal(d.TYPE_ALIASES["true/false"], "TRUE_FALSE");
  assert.equal(d.DIFFICULTY_ALIASES.difficult, "HARD");
  assert.equal(d.DIFFICULTY_ALIASES.confusing, undefined, "an unknown difficulty has no alias, so the importer falls back to Medium and records it");
  assert.equal(d.LANGUAGE_ALIASES["c++"], "cpp");
});

test("a spreadsheet cell that starts like a formula is neutralised", () => {
  assert.equal(d.sanitizeForSpreadsheet("=1+1"), "'=1+1");
  assert.equal(d.sanitizeForSpreadsheet("+x"), "'+x");
  assert.equal(d.sanitizeForSpreadsheet("-x"), "'-x");
  assert.equal(d.sanitizeForSpreadsheet("@x"), "'@x");
  assert.equal(d.sanitizeForSpreadsheet("plain"), "plain");
  assert.equal(d.sanitizeForSpreadsheet(null), "");
});

test("an uploaded workbook is read from the sheet that matches the import kind, skipping Instructions", () => {
  const file = sheetFile({ Instructions: [["read me"]], MCQ: [["Question Text"], ["a"], ["b"]], CODING: [["Question Title"], ["c"]] });
  assert.equal(d.parseUploadedFile(file, { coding: false }).rows.length, 2);
  assert.equal(d.parseUploadedFile(file, { coding: true }).rows.length, 1);
  const plain = sheetFile({ Sheet1: [["Question Text"], ["only"]] });
  assert.equal(d.parseUploadedFile(plain, { coding: false }).rows.length, 1);
});

test("combined import reads both sheets and refuses a text file or a file with neither", () => {
  const both = d.parseUploadedFileBothSheets(sheetFile({ MCQ: [["Question Text"], ["a"]], CODING: [["Question Title"], ["c"], ["d"]] }));
  assert.equal(both.mcqRows.length, 1);
  assert.equal(both.codingRows.length, 2);
  assert.match(d.parseUploadedFileBothSheets({ originalname: "x.txt", buffer: Buffer.from("x") }).error, /spreadsheet file/);
  assert.match(d.parseUploadedFileBothSheets(sheetFile({ Other: [["a"], ["b"]] })).error, /Could not find an "MCQ" or "CODING" sheet/);
});

test("error and skipped reasons of the combined import are tagged with their sheet", () => {
  assert.deepEqual(d.tagSheet([{ row: 2, reason: "bad" }], "MCQ"), [{ row: 2, reason: "[MCQ] bad" }]);
  assert.deepEqual(d.tagSheet(undefined, "MCQ"), []);
});

test("the template workbooks have the documented sheets and the example rows", () => {
  const sheets = (type) => XLSX.read(d.templateWorkbook(type).buffer, { type: "buffer" }).SheetNames;
  assert.deepEqual(sheets(undefined), ["Instructions", "MCQ"]);
  assert.deepEqual(sheets("coding"), ["Instructions", "CODING"]);
  assert.deepEqual(sheets("combined"), ["Instructions", "MCQ", "CODING"]);
  assert.equal(d.templateWorkbook("combined").filename, "CodeArena_Question_Upload_Template.xlsx");
  assert.equal(d.templateWorkbook("coding").filename, "coding-question-template.xlsx");
  assert.equal(d.templateWorkbook().filename, "question-bank-template.xlsx");
  assert.equal(d.templateText(true).filename, "coding-question-template.txt");
  assert.match(d.templateText(false).body, /^Notepad Question Upload/);
});

test("the export sheet mirrors the template columns behind a Question ID and letters the correct options", () => {
  const buffer = d.exportWorkbook([
    { questionNumber: 7, description: "=SUM(A1)", options: ["x", "y", "z"], correctAnswer: [0, 2], explanation: null, difficulty: "HARD", subjectRef: { name: "S" }, unitRef: null, subject: null, topic: "T", questionType: "MULTISELECT", points: 5, btlLevel: 3, title: null },
  ]);
  const rows = XLSX.utils.sheet_to_json(XLSX.read(buffer, { type: "buffer" }).Sheets.Questions, { header: 1 });
  assert.deepEqual(rows[0], ["Question ID", ...d.TEMPLATE_HEADERS]);
  assert.equal(rows[1][0], "Q7");
  assert.equal(rows[1][1], "'=SUM(A1)", "a formula-looking text is neutralised");
  assert.equal(rows[1][6], "A,C");
  assert.equal(rows[1][8], "Hard");
  assert.equal(rows[1][9], "S");
  assert.equal(rows[1][12], "Multiple Select");
});
