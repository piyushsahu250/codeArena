const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/tests/tests.domain");

test("an institute-bound requester is limited to their own institute's students; a platform requester is not", () => {
  assert.deepEqual(d.studentInstituteWhere("inst-1"), { student: { instituteId: "inst-1" } });
  assert.deepEqual(d.studentInstituteWhere(null), {});
  assert.deepEqual(d.studentInstituteWhere(undefined), {});
});

const attempt = (id, name, score, status, extra = {}) => ({
  id, totalScore: score, status, tabSwitchCount: 0, startedAt: new Date("2026-10-10T10:00:00Z"), submittedAt: status === "IN_PROGRESS" ? null : new Date("2026-10-10T10:30:00Z"),
  student: { name, email: `${name}@x.test`, rollNumber: extra.roll ?? null, registrationNumber: null }, submissions: extra.subs || [],
});

test("export rows: ranked over the list, scored out of each attempt's own questions, pass or fail only once finished", () => {
  const attempts = [attempt("a", "Asha", 8, "SUBMITTED", { roll: "R-10", subs: [{ questionId: "q1" }, { questionId: "q1" }, { questionId: "q2" }] }), attempt("b", "Bo", 3, "IN_PROGRESS", { roll: "R-20" })];
  const bases = new Map([["a", { maxScore: 10, expectedCount: 2 }], ["b", { maxScore: 0, expectedCount: 2 }]]);
  const rows = d.resultExportRows(attempts, bases, { passingMarks: 5 }, "");
  assert.equal(rows[0].Rank, 1);
  assert.equal(rows[0]["Percentage (%)"], 80);
  assert.equal(rows[0].Result, "Pass");
  assert.equal(rows[0].Attempted, 2, "two saved rows for one question count once");
  assert.equal(rows[1].Result, "", "an unfinished attempt has no pass or fail");
  assert.equal(rows[1]["Percentage (%)"], "", "no percentage when the maximum is zero");
  assert.equal(rows[1].Status, "In progress");
  assert.equal(d.resultExportRows(attempts, bases, { passingMarks: null }, "")[0].Result, "");
});

test("a roll-number filter narrows the rows but keeps each person's rank", () => {
  const attempts = [attempt("a", "Asha", 8, "SUBMITTED", { roll: "R-10" }), attempt("b", "Bo", 3, "SUBMITTED", { roll: "R-20" })];
  const bases = new Map([["a", { maxScore: 10, expectedCount: 1 }], ["b", { maxScore: 10, expectedCount: 1 }]]);
  const rows = d.resultExportRows(attempts, bases, { passingMarks: 5 }, " r-20 ");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Student, "Bo");
  assert.equal(rows[0].Rank, 2);
  assert.equal(rows[0].Result, "Fail");
});

test("export file names are safe and never empty", () => {
  assert.equal(d.exportFilename("Unit 1: Arrays & Strings!"), "Unit-1-Arrays-Strings");
  assert.equal(d.exportFilename("!!!"), "test-results");
  assert.equal(d.exportFilename(null), "test-results");
  assert.equal(d.exportFilename("x".repeat(200)).length, 80);
});

test("question analytics: distinct students at their best score, hardest first, review flag needs enough attempts", () => {
  const tqs = [
    { questionId: "easy", question: { questionNumber: 1, title: "Easy", points: 2, questionType: "MCQ" } },
    { questionId: "hard", question: { questionNumber: 2, title: "Hard", points: 4, questionType: "CODING" } },
    { questionId: "none", question: { questionNumber: 3, title: "Untouched", points: 2, questionType: "MCQ" } },
  ];
  const subs = [
    { questionId: "easy", studentId: "s1", score: 0 }, { questionId: "easy", studentId: "s1", score: 2 }, { questionId: "easy", studentId: "s2", score: 2 },
    ...["s1", "s2", "s3", "s4", "s5"].map((s) => ({ questionId: "hard", studentId: s, score: s === "s5" ? 4 : 1 })),
  ];
  const rows = d.questionAnalyticsRows(tqs, subs);
  assert.deepEqual(rows.map((r) => r.questionId), ["none", "hard", "easy"], "untouched first, then lowest correct rate");
  const easy = rows.find((r) => r.questionId === "easy");
  assert.deepEqual([easy.attempted, easy.fullyCorrect, easy.correctRate, easy.avgScorePercent], [2, 2, 1, 100], "a student's best score counts once");
  const hard = rows.find((r) => r.questionId === "hard");
  assert.deepEqual([hard.attempted, hard.fullyCorrect, hard.correctRate], [5, 1, 0.2]);
  assert.equal(hard.reviewRecommended, false, "exactly 20% is not under 20%");
  const few = d.questionAnalyticsRows([tqs[1]], [{ questionId: "hard", studentId: "s1", score: 0 }]);
  assert.equal(few[0].reviewRecommended, false, "one attempt is too few to flag");
  const many = d.questionAnalyticsRows([tqs[1]], ["a", "b", "c", "d", "e", "f"].map((s) => ({ questionId: "hard", studentId: s, score: 0 })));
  assert.equal(many[0].reviewRecommended, true);
});

test("a reattempt audit entry keeps what the deleted attempt held", () => {
  const out = d.reattemptAuditDetails({ id: "s", name: "Asha", rollNumber: "R1" }, { id: "t", title: "Unit 1" }, { status: "SUBMITTED", totalScore: 7, submittedAt: new Date("2026-10-10T10:30:00Z"), tabSwitchCount: 2 });
  assert.equal(out.previousAttemptScore, 7);
  assert.equal(out.previousAttemptStatus, "SUBMITTED");
  assert.equal(out.previousTabSwitchCount, 2);
  assert.equal(out.studentRollNumber, "R1");
  assert.equal(out.testTitle, "Unit 1");
});
