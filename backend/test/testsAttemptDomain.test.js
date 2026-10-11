const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/tests/tests.domain");

test("staff roles are exactly the four that may manage tests; clerks and students are not", () => {
  for (const r of ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"]) assert.equal(d.isStaffRole(r), true, r);
  for (const r of ["STUDENT", "CLERK", undefined]) assert.equal(d.isStaffRole(r), false, String(r));
});

test("the staff list is limited to the requester's institute and, for staff, to tests they own or were shared", () => {
  const own = { OR: [{ createdById: "u" }, { shares: { some: { staffId: "u" } } }] };
  const w = d.staffListWhere("inst-1", own);
  assert.equal(w.AND.length, 2);
  assert.deepEqual(w.AND[1], own);
  const branches = w.AND[0].OR;
  assert.equal(branches.length, 3);
  assert.deepEqual(branches[2].OR, [{ instituteId: null }, { instituteId: "inst-1" }], "an open-to-all test shows only if it is platform-wide or belongs to this institute");
  assert.deepEqual(d.staffListWhere(null, {}).AND, [{}, {}], "a platform-level requester is not institute-limited");
});

test("a student sees question content only while the attempt runs, or after it finished and the window closed", () => {
  const test1 = { endTime: new Date(Date.now() + 3600000) };
  const ended = { endTime: new Date(Date.now() - 3600000) };
  assert.equal(d.questionsVisible(null, test1), false);
  assert.equal(d.questionsVisible({ status: "IN_PROGRESS" }, test1), true);
  assert.equal(d.questionsVisible({ status: "SUBMITTED" }, test1), false, "finished but the window is still open: no questions yet");
  assert.equal(d.questionsVisible({ status: "SUBMITTED" }, ended), true);
  assert.equal(d.questionsVisible(null, ended), false, "no attempt: never");
});

test("the pre-start summary counts the questions, hides marks for a random test and lists the types", () => {
  const qs = [{ question: { points: 2, questionType: "MCQ" } }, { question: { points: 3, questionType: "CODING" } }, { question: { points: 2, questionType: "MCQ" } }];
  assert.deepEqual(d.questionSummaryOf({ questions: qs, questionSelectionMode: "FIXED" }), { count: 3, maxMarks: 7, types: ["MCQ", "CODING"] });
  assert.deepEqual(d.questionSummaryOf({ questions: qs, questionSelectionMode: "RANDOM", randomQuestionsPerStudent: 2 }), { count: 2, maxMarks: null, types: ["MCQ", "CODING"] });
});

test("an attempt keeps its locked order, and a question removed from the test later stays visible to that student", () => {
  const onTest = [{ questionId: "a", question: { id: "a" } }, { questionId: "b", question: { id: "b" } }];
  const { ordered, missing, stillMissing } = d.orderForAttempt(onTest, ["b", "x", "a", "gone"], [{ id: "x" }]);
  assert.deepEqual(ordered.map((tq) => tq.questionId), ["b", "x", "a"]);
  assert.deepEqual(missing, ["x", "gone"]);
  assert.deepEqual(stillMissing, ["gone"], "only a hard-deleted question is truly unavailable");
});

test("option order is applied per question and never touches a question without a stored order", () => {
  const qs = [{ questionId: "a", question: { options: ["w", "x", "y"] } }, { questionId: "b", question: { options: ["p", "q"] } }];
  d.applyOptionOrder(qs, { a: [2, 0, 1] });
  assert.deepEqual(qs[0].question.options, ["y", "w", "x"]);
  assert.deepEqual(qs[1].question.options, ["p", "q"]);
  assert.doesNotThrow(() => d.applyOptionOrder(qs, null));
});

test("start window: not before the start, a new attempt after the end needs a grant, a resume after the end is refused", () => {
  const t = { startTime: new Date("2026-10-10T10:00:00Z"), endTime: new Date("2026-10-10T12:00:00Z") };
  assert.deepEqual(d.startWindow(new Date("2026-10-10T09:00:00Z"), t, null), { failure: "Test has not started yet" });
  assert.deepEqual(d.startWindow(new Date("2026-10-10T11:00:00Z"), t, null), {});
  assert.deepEqual(d.startWindow(new Date("2026-10-10T13:00:00Z"), t, null), { needsGrant: true });
  assert.deepEqual(d.startWindow(new Date("2026-10-10T13:00:00Z"), t, { id: "x" }), { failure: "Test window has closed" });
  assert.deepEqual(d.startWindow(new Date("2026-10-10T11:00:00Z"), t, { id: "x" }), {}, "resuming inside the window is fine");
});

test("only penalised violations add strikes, and the third one forces the submit", () => {
  const a = { tabSwitchCount: 0 };
  assert.deepEqual(d.violationOutcome(a, { severity: "INTERRUPTION", penalized: false }), { severity: "INTERRUPTION", penalized: false, tabSwitchCount: 0, autoSubmitted: false });
  assert.equal(d.violationOutcome({ tabSwitchCount: 1 }, { severity: "CONFIRMED_VIOLATION", penalized: true }).tabSwitchCount, 2);
  assert.equal(d.violationOutcome({ tabSwitchCount: 1 }, { severity: "CONFIRMED_VIOLATION", penalized: true }).autoSubmitted, false);
  assert.equal(d.violationOutcome({ tabSwitchCount: d.MAX_TAB_VIOLATIONS - 1 }, { severity: "CONFIRMED_VIOLATION", penalized: true }).autoSubmitted, true);
  assert.equal(d.violationOutcome({ tabSwitchCount: 5 }, { severity: "NORMAL", penalized: false }).autoSubmitted, false, "an unpenalised event never submits, whatever the count");
});
