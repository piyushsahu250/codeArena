const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/questions/questions.domain");

const adminReq = (over = {}) => ({ requesterInstituteId: "i1", user: { id: "u1", role: "INSTITUTE_ADMIN" }, ...over });
const cases = (visible, hidden) => [...Array.from({ length: visible }, (_, i) => ({ input: `${i}`, expected: `${i}`, isHidden: false })), ...Array.from({ length: hidden }, (_, i) => ({ input: `h${i}`, expected: `${i}`, isHidden: true }))];
const status = (fn) => { try { fn(); return null; } catch (e) { return e.status; } };
const message = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

test("a delete blocked by a database RESTRICT is recognised even though Prisma gives it no error code", () => {
  const raw = { name: "PrismaClientUnknownRequestError", message: 'ERROR: update or delete on table "Question" violates RESTRICT setting of foreign key constraint "TestQuestion_questionId_fkey" on table "TestQuestion"' };
  assert.equal(d.isReferencedByRestrict(raw), true);
  assert.equal(d.isReferencedByRestrict({ code: "P2003" }), true);
  assert.equal(d.isReferencedByRestrict({ code: "P2014" }), true);
  assert.equal(d.isReferencedByRestrict(new Error("connection reset")), false);
  assert.equal(d.isReferencedByRestrict(null), false);
});

test("the list filter always excludes module-coding questions and applies only recognised values", () => {
  const w = d.buildWhere({ difficulty: "HARD", questionType: "NOPE", btlLevel: "9", questionStatus: "DRAFT", aiGenerated: "true", folderId: "__none__", subjectId: "s1", unitId: "__none__" }, adminReq());
  assert.deepEqual(w.AND[1], { moduleCodingTestId: null });
  assert.equal(w.difficulty, "HARD");
  assert.ok(!("questionType" in w), "an unknown type is ignored");
  assert.ok(!("btlLevel" in w), "an out-of-range level is ignored");
  assert.equal(w.questionStatus, "DRAFT");
  assert.equal(w.aiGenerated, true);
  assert.equal(w.folderId, null);
  assert.equal(w.subjectId, "s1");
  assert.equal(w.unitId, null);
});

test("text search covers title, description, subject and topic", () => {
  const w = d.buildWhere({ q: "tree" }, adminReq());
  assert.equal(w.AND.length, 3);
  assert.equal(w.AND[2].OR.length, 4);
});

test("a STAFF requester's list is narrowed to their own, legacy and shared content", () => {
  const w = d.buildWhere({}, adminReq({ user: { id: "s1", role: "STAFF" } }));
  assert.ok(JSON.stringify(w.AND[0]).includes('"createdById":"s1"'));
});

test("BTL level parsing accepts a bare number or a label and rejects garbage", () => {
  assert.equal(d.parseBtlLevel(""), null);
  assert.equal(d.parseBtlLevel("3"), 3);
  assert.equal(d.parseBtlLevel("BTL-5"), 5);
  assert.equal(d.parseBtlLevel("Level 2"), 2);
  assert.throws(() => d.parseBtlLevel("high"), /Invalid BTL/);
});

test("coding create: 2 visible and 5 hidden cases are required, the comparison mode must be known", () => {
  assert.equal(status(() => d.createCoding({ testCases: cases(1, 5) })), 400);
  assert.match(message(() => d.createCoding({ testCases: cases(1, 5) })), /at least 2 visible/);
  assert.match(message(() => d.createCoding({ testCases: cases(2, 4) })), /at least 5 hidden/);
  assert.match(message(() => d.createCoding({ testCases: cases(2, 5), comparisonMode: "FUZZY" })), /comparisonMode must be one of: EXACT, TRIM/);
  const ok = d.createCoding({ testCases: cases(2, 5), comparisonMode: "TOKEN", timeLimitMs: 1500, tags: ["a"], floatAbsoluteTolerance: 0.5 });
  assert.equal(ok.data.comparisonMode, "TOKEN");
  assert.equal(ok.data.timeLimitMs, 1500);
  assert.equal(ok.data.floatAbsoluteTolerance, 0.5);
  assert.equal(ok.data.testCases.create.length, 7);
  assert.equal(d.createCoding({ testCases: cases(2, 5) }).data.comparisonMode, "TRIM");
  assert.equal(d.createCoding({ testCases: cases(2, 5) }).data.timeLimitMs, 2000);
});

test("SQL create needs setup SQL, 1 visible and 5 hidden cases", () => {
  assert.match(message(() => d.createSql({ sqlSchema: " ", testCases: cases(1, 5) })), /setup SQL/);
  assert.match(message(() => d.createSql({ sqlSchema: "x", testCases: cases(0, 5) })), /at least 1 visible/);
  assert.match(message(() => d.createSql({ sqlSchema: "x", testCases: cases(1, 4) })), /at least 5 hidden/);
  const ok = d.createSql({ sqlSchema: "x", testCases: [{ expected: "1", isHidden: false }, ...cases(0, 5)] });
  assert.equal(ok.data.timeLimitMs, 3000);
  assert.equal(ok.data.testCases.create[0].input, "", "a SQL case without input stores an empty string");
});

test("numerical create validates the tolerance", () => {
  assert.equal(d.createNumerical({ numericAnswer: "3.5", numericTolerance: 0.1 }).data.numericTolerance, 0.1);
  assert.equal(d.createNumerical({ numericAnswer: "3.5" }).data.numericTolerance, 0);
  assert.match(message(() => d.createNumerical({ numericAnswer: "1", numericTolerance: -1 })), /non-negative/);
  assert.throws(() => d.createNumerical({}));
});

test("quiz create: options and the correct answer are normalised and checked", () => {
  assert.deepEqual(d.createQuiz("MCQ", { options: ["a", "b"], correctAnswer: [1] }).data, { options: ["a", "b"], correctAnswer: [1] });
  assert.deepEqual(d.createQuiz("TRUE_FALSE", { correctAnswer: ["False"] }).data, { options: ["True", "False"], correctAnswer: [1] });
  assert.throws(() => d.createQuiz("MCQ", { options: ["a", "a"], correctAnswer: [0] }), /unique/);
  assert.throws(() => d.createQuiz("MCQ", { options: ["a", "b"], correctAnswer: [0, 1] }), /only have one correct answer/);
});

test("create base: AI drafts default to DRAFT, others to PUBLISHED, an unknown type becomes coding", () => {
  const actor = { requesterInstituteId: "i1", user: { id: "u1" } };
  const r = { subjectId: "s", unitId: "u", topicId: null };
  assert.equal(d.createBase({ description: "x", aiGenerated: true }, r, actor).data.questionStatus, "DRAFT");
  assert.equal(d.createBase({ description: "x" }, r, actor).data.questionStatus, "PUBLISHED");
  assert.equal(d.createBase({ description: "x", questionStatus: "WHATEVER" }, r, actor).data.questionStatus, "PUBLISHED");
  assert.equal(d.createBase({ description: "x", questionType: "POEM" }, r, actor).type, "CODING");
  assert.equal(d.createBase({ description: "x", btlLevel: 9 }, r, actor).data.btlLevel, null);
  assert.equal(d.createBase({ description: "x" }, r, actor).data.points, 10);
  assert.equal(d.createBase({ description: "x" }, r, actor).data.instituteId, "i1");
});

test("edit base keeps every field the request does not send", () => {
  const existing = { title: "T", description: "D", subject: "S", topic: "P", difficulty: "HARD", points: 5, explanation: "E", folderId: "f", estimatedTimeMin: 3, hints: ["h"], subtopic: "st", btlLevel: 2, skillTested: "k", questionStatus: "VERIFIED", questionType: "MCQ" };
  const { type, data } = d.editBase({}, existing, { subjectId: "s", unitId: "u", topicId: null }, { user: { id: "u9" } });
  assert.equal(type, "MCQ");
  assert.equal(data.title, "T");
  assert.equal(data.difficulty, "HARD");
  assert.equal(data.folderId, "f");
  assert.deepEqual(data.hints, ["h"]);
  assert.equal(data.btlLevel, 2);
  assert.equal(data.questionStatus, "VERIFIED");
  assert.equal(data.updatedById, "u9");
  const edited = d.editBase({ folderId: null, questionStatus: "WHATEVER", btlLevel: 9, difficulty: "EASY" }, existing, { subjectId: "s", unitId: "u", topicId: null }, { user: { id: "u9" } });
  assert.equal(edited.data.folderId, null, "a folder can be cleared");
  assert.equal(edited.data.questionStatus, "VERIFIED", "an unknown status keeps the old one");
  assert.equal(edited.data.btlLevel, null, "an unknown level clears it");
});

test("coding edit replaces test cases atomically inside the update and enforces the minimums", () => {
  const existing = { timeLimitMs: 2000, memoryLimitKb: null, starterCode: "", comparisonMode: "TRIM", floatAbsoluteTolerance: null, floatRelativeTolerance: null, evaluationType: "STDIO", functionSignature: null, starterCodeByLanguage: null };
  const data = {};
  d.editCoding({ testCases: cases(2, 5) }, existing, data);
  assert.deepEqual(Object.keys(data.testCases).sort(), ["create", "deleteMany"]);
  assert.equal(data.sqlSchema, null);
  assert.equal(data.options, null);
  assert.equal(status(() => d.editCoding({ testCases: cases(1, 5) }, existing, {})), 400);
  assert.equal(status(() => d.editCoding({ testCases: cases(2, 2) }, existing, {})), 400);
  assert.equal(status(() => d.editCoding({ comparisonMode: "FUZZY" }, existing, {})), 400);
  const untouched = {};
  d.editCoding({}, existing, untouched);
  assert.ok(!("testCases" in untouched), "no test cases sent means none are touched");
});

test("numerical edit keeps the stored answer unless a new one is sent", () => {
  const data = {};
  d.editNumerical({ numericTolerance: 0.5 }, data);
  assert.ok(!("numericAnswer" in data));
  assert.equal(data.numericTolerance, 0.5);
  const both = {};
  d.editNumerical({ numericAnswer: "42", numericTolerance: 0 }, both);
  assert.equal(Number(both.numericAnswer), 42);
  assert.throws(() => d.editNumerical({ numericTolerance: "abc" }, {}), /non-negative/);
});

test("quiz edit checks duplicate options only when options are sent", () => {
  const existing = { options: ["a", "a"], correctAnswer: [0] };
  const data = {};
  d.editQuiz("MCQ", {}, existing, data);
  assert.deepEqual(data.options, ["a", "a"], "a legacy duplicate is not rejected by an unrelated edit");
  assert.throws(() => d.editQuiz("MCQ", { options: ["a", "a"] }, existing, {}), /unique/);
});

test("labels fall back to the start of the question text", () => {
  assert.equal(d.label({ title: "T", description: "long" }), "T");
  assert.equal(d.label({ title: null, description: "x".repeat(100) }).length, 60);
});

test("a folder loop is detected before it can be stored", async () => {
  const parents = { a: null, b: "a", c: "b", x: null, loop1: "loop2", loop2: "loop1" };
  const parentOf = async (id) => parents[id] ?? null;
  assert.equal(await d.wouldCreateFolderLoop("a", "c", parentOf), true, "under one of its own sub-banks");
  assert.equal(await d.wouldCreateFolderLoop("a", "a", parentOf), true, "under itself");
  assert.equal(await d.wouldCreateFolderLoop("c", "a", parentOf), false, "up the tree is fine");
  assert.equal(await d.wouldCreateFolderLoop("a", "x", parentOf), false, "under an unrelated folder");
  assert.equal(await d.wouldCreateFolderLoop("a", null, parentOf), false, "to the top level");
  assert.equal(await d.wouldCreateFolderLoop("a", "loop1", parentOf), true, "an existing loop is never walked forever");
});

test("a copy of a question carries the test cases but never the image reference", () => {
  const actor = { requesterInstituteId: "i2", user: { id: "u2" } };
  const q = { id: "q1", questionNumber: 7, createdAt: "t", folderId: "f1", instituteId: "i1", createdById: "u1", imageKey: "key", imageMimeType: "image/png", title: "T", testCases: [{ input: "1", expected: "2", isHidden: true, explanation: "e" }] };
  const out = d.copiedQuestionData(q, actor, "f2");
  assert.equal(out.folderId, "f2");
  assert.equal(out.instituteId, "i2");
  assert.equal(out.createdById, "u2");
  assert.ok(!("imageKey" in out) && !("imageMimeType" in out) && !("id" in out) && !("questionNumber" in out));
  assert.equal(out.testCases.create.length, 1);
  assert.equal(out.title, "T");
});

test("sharing is refused outside the institute and, for staff, outside their own banks", () => {
  const folder = { instituteId: "i1", createdById: "u1" };
  assert.equal(d.sharingRefusal({ requesterInstituteId: "i2", user: { role: "INSTITUTE_ADMIN", id: "a" } }, folder, "x"), "You can only manage question banks under your own institute");
  assert.equal(d.sharingRefusal({ requesterInstituteId: "i1", user: { role: "STAFF", id: "u2" } }, folder, "creator only"), "creator only");
  assert.equal(d.sharingRefusal({ requesterInstituteId: "i1", user: { role: "STAFF", id: "u1" } }, folder, "x"), null);
  assert.equal(d.sharingRefusal({ requesterInstituteId: "i1", user: { role: "INSTITUTE_ADMIN", id: "a" } }, folder, "x"), null);
  assert.equal(d.sharingRefusal({ requesterInstituteId: "i2", user: { role: "INSTITUTE_ADMIN", id: "a" } }, { instituteId: null, createdById: "u1" }, "x"), null, "a platform-level folder");
});

test("blocked entries name the question and the reason", () => {
  assert.deepEqual(d.blockedEntry({ id: "1", title: null, description: "d".repeat(80) }, d.BLOCKED_BY_TEST), { id: "1", title: "d".repeat(60), reason: "Used in one or more tests" });
  assert.equal(d.blockedEntry({ id: "1", title: "T", description: "x" }, d.BLOCKED_BY_HISTORY).reason, "Has student submissions — archive instead");
});
