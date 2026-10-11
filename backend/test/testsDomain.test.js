const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/tests/tests.domain");

const tq = (id, difficulty = "EASY", order = 0, extra = {}) => ({ questionId: id, order, question: { id, difficulty, questionType: "MCQ", options: ["a", "b", "c"], ...extra } });

test("question rows default to 900 seconds and no AI help, keeping the given order", () => {
  const rows = d.questionCreateData(["a", "b"], { a: "60" }, { b: true });
  assert.deepEqual(rows, [{ questionId: "a", order: 0, timeLimitSec: 60, aiAllowed: false }, { questionId: "b", order: 1, timeLimitSec: 900, aiAllowed: true }]);
  assert.deepEqual(d.questionCreateData(undefined), []);
});

test("a fixed test gives every student every question; shuffling keeps the same set", () => {
  const t = { questions: [tq("q1", "EASY", 0), tq("q2", "EASY", 1), tq("q3", "EASY", 2)], questionSelectionMode: "FIXED", shuffleQuestions: false, shuffleOptions: false };
  assert.deepEqual(d.buildAttemptOrder(t).questionOrder, ["q1", "q2", "q3"]);
  const shuffled = d.buildAttemptOrder({ ...t, shuffleQuestions: true }).questionOrder;
  assert.deepEqual([...shuffled].sort(), ["q1", "q2", "q3"]);
});

test("a random test draws exactly the promised count, honouring the difficulty mix", () => {
  const bank = [...Array(5)].map((_, i) => tq(`e${i}`, "EASY", i)).concat([...Array(5)].map((_, i) => tq(`h${i}`, "HARD", 5 + i)));
  const t = { questions: bank, questionSelectionMode: "RANDOM", randomQuestionsPerStudent: 4, difficultyDistribution: { easy: 1, medium: 0, hard: 3 }, shuffleQuestions: false };
  for (let i = 0; i < 20; i++) {
    const ids = d.buildAttemptOrder(t).questionOrder;
    assert.equal(ids.length, 4);
    assert.equal(ids.filter((x) => x.startsWith("e")).length, 1);
    assert.equal(ids.filter((x) => x.startsWith("h")).length, 3);
  }
  const short = d.buildAttemptOrder({ ...t, difficultyDistribution: { easy: 0, medium: 5, hard: 0 } }).questionOrder;
  assert.equal(short.length, 4, "a pool with too few questions is topped up from the rest of the bank");
});

test("option order is built only for questions that have options, and only when option shuffling is on", () => {
  const t = { questions: [tq("m"), tq("c", "EASY", 1, { questionType: "CODING" })], questionSelectionMode: "FIXED", shuffleQuestions: false, shuffleOptions: true };
  const { optionOrder } = d.buildAttemptOrder(t);
  assert.deepEqual(Object.keys(optionOrder), ["m"]);
  assert.deepEqual([...optionOrder.m].sort(), [0, 1, 2]);
  assert.equal(d.buildAttemptOrder({ ...t, shuffleOptions: false }).optionOrder, null);
});

test("random configuration is validated with the same messages", () => {
  assert.doesNotThrow(() => d.validateRandomConfig("FIXED", undefined, undefined, 0));
  assert.throws(() => d.validateRandomConfig("RANDOM", 0, null, 10), /how many questions/);
  assert.throws(() => d.validateRandomConfig("RANDOM", 11, null, 10), /exceed the bank size \(10\)/);
  assert.throws(() => d.validateRandomConfig("RANDOM", 5, { easy: 1, medium: 1, hard: 1 }, 10), /must add up to questions per student \(5\)/);
  assert.doesNotThrow(() => d.validateRandomConfig("RANDOM", 3, { easy: 1, medium: 1, hard: 1 }, 10));
});

test("scheduled publishing accepts only a future moment on an unpublished test; null clears", () => {
  const now = Date.parse("2026-10-10T10:00:00Z");
  const draft = { isPublished: false, scheduledPublishAt: null };
  assert.equal(d.resolveScheduledPublishAt(draft, undefined, now).value, null);
  assert.equal(d.resolveScheduledPublishAt({ ...draft, scheduledPublishAt: "x" }, undefined, now).value, "x", "not sent: unchanged");
  assert.equal(d.resolveScheduledPublishAt(draft, null, now).value, null);
  assert.match(d.resolveScheduledPublishAt(draft, "2026-10-10T09:00:00Z", now).error, /future/);
  assert.match(d.resolveScheduledPublishAt(draft, "not a date", now).error, /future/);
  assert.match(d.resolveScheduledPublishAt({ ...draft, isPublished: true }, "2026-10-11T09:00:00Z", now).error, /already published/);
  assert.equal(d.resolveScheduledPublishAt(draft, "2026-10-11T09:00:00Z", now).value.toISOString(), "2026-10-11T09:00:00.000Z");
});

test("a duplicate starts unpublished, belongs to the person who copied it and keeps questions and groups", () => {
  const original = {
    title: "Unit 1", code: "C", description: null, instructions: null, durationMin: 30, passingMarks: 5, showResults: true, startTime: new Date(1), endTime: new Date(2),
    subject: "S", unit: "U", program: null, instituteId: "i1", createdById: "owner",
    questions: [{ questionId: "q1", order: 0, timeLimitSec: 60 }], academicGroups: [{ academicGroupId: "g1" }],
  };
  const copy = d.buildDuplicateData(original, "me");
  assert.equal(copy.title, "Copy of Unit 1");
  assert.equal(copy.isPublished, false);
  assert.equal(copy.createdById, "me");
  assert.equal(copy.instituteId, "i1");
  assert.deepEqual(copy.questions.create, [{ questionId: "q1", order: 0, timeLimitSec: 60 }]);
  assert.deepEqual(copy.academicGroups.create, [{ academicGroupId: "g1" }]);
});

test("editing keeps stored values for anything not sent and bumps the version", () => {
  const existing = {
    title: "T", code: "C", description: "D", instructions: "I", company: null, subject: "S", unit: "U", program: null, durationMin: 30, passingMarks: 4, showResults: true,
    startTime: new Date(1), endTime: new Date(2), requireFullscreen: true, requireWebcam: false, requireMicrophone: false, attendanceMandatory: false, shuffleQuestions: true, shuffleOptions: false,
  };
  const r = { instituteId: "i", subject: { subjectId: null, unitId: null }, sec: { data: { securityLevel: "STANDARD" } }, mode: "FIXED", bankFolderId: null, perStudent: null, distribution: null, scheduledPublishAt: null };
  const same = d.buildUpdateData(existing, {}, r);
  assert.equal(same.title, "T");
  assert.equal(same.durationMin, 30);
  assert.equal(same.passingMarks, 4);
  assert.deepEqual(same.version, { increment: 1 });
  const changed = d.buildUpdateData(existing, { title: "N", passingMarks: "", durationMin: "45", code: "  ", showResults: false }, r);
  assert.equal(changed.title, "N");
  assert.equal(changed.passingMarks, null);
  assert.equal(changed.durationMin, 45);
  assert.equal(changed.code, null);
  assert.equal(changed.showResults, false);
});

test("publish transitions drive the audit entry", () => {
  assert.equal(d.publishTransition(false, true), "PUBLISHED");
  assert.equal(d.publishTransition(true, false), "UNPUBLISHED");
  assert.equal(d.publishTransition(true, true), null);
  assert.equal(d.publishTransition(false, false), null);
});

test("institute checks: strict treats a platform-wide test as outside an institute-bound requester, loose does not", () => {
  const bound = { requesterInstituteId: "A" };
  assert.equal(d.outsideInstitute(bound, { instituteId: "B" }, true), true);
  assert.equal(d.outsideInstitute(bound, { instituteId: "B" }, false), true);
  assert.equal(d.outsideInstitute(bound, { instituteId: null }, true), true);
  assert.equal(d.outsideInstitute(bound, { instituteId: null }, false), false);
  assert.equal(d.outsideInstitute(bound, { instituteId: "A" }, true), false);
  assert.equal(d.outsideInstitute({ requesterInstituteId: null }, { instituteId: "B" }, true), false, "a platform-level requester is never outside");
});

test("the recipient preview adds up: grouped students plus the ungrouped remainder", () => {
  const info = new Map([["g1", { batch: "2026", section: "A", department: { name: "CSE" }, institute: { name: "Inst" } }]]);
  const out = d.recipientBreakdown(10, [{ academicGroupId: "g1", _count: 6 }, { academicGroupId: null, _count: 4 }], info);
  assert.deepEqual(out.breakdown, [{ academicGroupId: "g1", count: 6, institute: "Inst", batch: "2026", branch: "CSE", section: "A" }]);
  assert.equal(out.ungroupedCount, 4);
});
