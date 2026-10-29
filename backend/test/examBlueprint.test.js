const { test } = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/utils/examBlueprint");

const sec = (key, order, maxMarks, questionCount, extra = {}) => ({ key, order, maxMarks, questionCount, navigation: "FREE", answerEditing: "EDITABLE_UNTIL_SECTION_SUBMIT", ...extra });
const interview = (over = {}) => ({ category: "HR", difficulty: "MEDIUM", answerInput: "TYPED_OR_SPEECH", cameraRequired: true, speechToText: true, rubricVersion: "hr-v1", ...over });
function good(over = {}) {
  return {
    title: "Campus drive, round 1", mode: "PROCTORED", startAt: "2026-11-10T09:00:00Z", endAt: "2026-11-10T13:00:00Z", durationMin: 180, graceSec: 30,
    totalMarks: 100, passingMarks: 40, timingPolicy: "OVERALL_ONLY",
    sections: [sec("APTITUDE", 1, 25, 20), sec("TECHNICAL", 2, 25, 20), sec("CODING", 3, 30, 2), sec("AI_INTERVIEW", 4, 20, 5, { interview: interview() })],
    proctoring: { cameraRequired: true, microphoneRequired: true, fullscreenRequired: true, autoSubmitOnExpiry: true, reviewRequired: true, maxWarnings: 3, networkGraceSec: 60, cameraLossPolicy: "WARN", evidenceRetentionDays: 90 },
    ...over,
  };
}
const codes = (def) => B.validateExamBlueprint(def).errors.map((e) => e.code);
const withSection = (def, key, patch) => ({ ...def, sections: def.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) });

test("a complete, consistent blueprint is valid", () => {
  const r = B.validateExamBlueprint(good());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test("nothing, or a non-object, is invalid and does not throw", () => {
  for (const bad of [undefined, null, "x", 42]) assert.equal(B.validateExamBlueprint(bad).valid, false);
  assert.ok(codes({}).length > 3);
});

test("the four sections are required: a missing or duplicate one is refused", () => {
  const noCoding = good({ sections: good().sections.filter((s) => s.key !== "CODING") });
  assert.ok(codes(noCoding).includes("SECTION_MISSING"));
  const dup = good({ sections: [...good().sections, sec("APTITUDE", 1, 10, 5)] });
  assert.ok(codes(dup).includes("SECTION_DUPLICATE"));
  assert.ok(codes(good({ sections: [...good().sections, { key: "BONUS", order: 5, maxMarks: 1, questionCount: 1 }] })).includes("SECTION_KEY_INVALID"));
  assert.ok(codes(good({ sections: undefined })).includes("SECTIONS_REQUIRED"));
});

test("section marks must add up to the total, with at most two decimals", () => {
  assert.ok(codes(good({ totalMarks: 110 })).includes("MARKS_MISMATCH"));
  assert.ok(codes(withSection(good(), "CODING", { maxMarks: 31 })).includes("MARKS_MISMATCH"));
  assert.ok(codes(withSection(good(), "CODING", { maxMarks: 0 })).includes("SECTION_MARKS_INVALID"));
  assert.ok(codes(withSection(good(), "CODING", { maxMarks: 30.005 })).includes("SECTION_MARKS_INVALID"));
  // decimal marks add up exactly (compared in hundredths, so floating point cannot cause a false mismatch): 33.33 + 33.33 + 33.33 + 0.01 = 100.00
  const decimals = good({ totalMarks: 100, sections: [sec("APTITUDE", 1, 33.33, 20), sec("TECHNICAL", 2, 33.33, 20), sec("CODING", 3, 33.33, 2), sec("AI_INTERVIEW", 4, 0.01, 5, { interview: interview() })] });
  assert.ok(!codes(decimals).includes("MARKS_MISMATCH"));
  assert.ok(codes({ ...decimals, totalMarks: 100.01 }).includes("MARKS_MISMATCH"));
});

test("a proctored examination runs the sections in the fixed order; a practice one may reorder", () => {
  const swapped = good({ sections: [sec("APTITUDE", 2, 25, 20), sec("TECHNICAL", 1, 25, 20), sec("CODING", 3, 30, 2), sec("AI_INTERVIEW", 4, 20, 5, { interview: interview() })] });
  assert.ok(codes(swapped).includes("ORDER_NOT_FIXED"));
  const practice = { ...swapped, mode: "PRACTICE", proctoring: undefined };
  assert.ok(!codes(practice).includes("ORDER_NOT_FIXED"));
  const dupOrder = good({ sections: good().sections.map((s) => ({ ...s, order: 1 })) });
  assert.ok(codes(dupOrder).includes("ORDER_DUPLICATE"));
  assert.ok(codes(withSection(good(), "CODING", { order: 9 })).includes("ORDER_INVALID"));
});

test("the schedule must make sense: end after start, and the duration must fit in the window", () => {
  assert.ok(codes(good({ endAt: "2026-11-10T08:00:00Z" })).includes("END_BEFORE_START"));
  assert.ok(codes(good({ endAt: "2026-11-10T11:00:00Z" })).includes("DURATION_EXCEEDS_WINDOW"));
  assert.ok(codes(good({ startAt: undefined })).includes("START_REQUIRED"));
  assert.ok(codes(good({ endAt: "garbage" })).includes("END_REQUIRED"));
  for (const d of [4, 601, 90.5, "180", null]) assert.ok(codes(good({ durationMin: d })).includes("DURATION_INVALID"), String(d));
  assert.ok(codes(good({ graceSec: 601 })).includes("GRACE_INVALID"));
});

test("timing: section durations only with the section policy, all present, and not more than the total", () => {
  assert.ok(codes(withSection(good(), "CODING", { durationMin: 60 })).includes("SECTION_DURATION_CONFLICT"), "a section duration under an overall-only policy");
  const perSection = (ds, total = 180) => good({ durationMin: total, timingPolicy: "OVERALL_AND_SECTION", sections: good().sections.map((s, i) => ({ ...s, durationMin: ds[i] })) });
  assert.deepEqual(codes(perSection([40, 40, 60, 40])), []);
  assert.ok(codes(perSection([40, 40, 60, undefined])).includes("SECTION_DURATION_REQUIRED"));
  assert.ok(codes(perSection([60, 60, 60, 60])).includes("SECTION_TIME_EXCEEDS_TOTAL"));
  const slack = B.validateExamBlueprint(perSection([30, 30, 60, 30]));
  assert.equal(slack.valid, true);
  assert.ok(slack.warnings.some((w) => w.code === "UNALLOCATED_TIME"));
  assert.ok(codes(good({ timingPolicy: "SOMETHING" })).includes("TIMING_POLICY_INVALID"));
});

test("navigation and answer-editing policies must be chosen from the known ones", () => {
  assert.ok(codes(withSection(good(), "APTITUDE", { navigation: "ANY" })).includes("NAVIGATION_INVALID"));
  assert.ok(codes(withSection(good(), "APTITUDE", { answerEditing: undefined })).includes("ANSWER_EDITING_INVALID"));
  assert.ok(codes(withSection(good(), "CODING", { questionCount: 11 })).includes("QUESTION_COUNT_INVALID"));
  assert.ok(codes(withSection(good(), "APTITUDE", { questionCount: 0 })).includes("QUESTION_COUNT_INVALID"));
});

test("negative marking: only multiple-choice sections, and never more than a right answer earns", () => {
  assert.deepEqual(codes(withSection(good(), "APTITUDE", { negativeMarking: { enabled: true, perWrong: 1 } })), []);
  assert.ok(codes(withSection(good(), "APTITUDE", { negativeMarking: { enabled: true, perWrong: 1.5 } })).includes("NEGATIVE_MARKING_TOO_LARGE"), "25 marks / 20 questions = 1.25 per question");
  assert.ok(codes(withSection(good(), "APTITUDE", { negativeMarking: { enabled: true } })).includes("NEGATIVE_MARKING_INVALID"));
  assert.ok(codes(withSection(good(), "CODING", { negativeMarking: { enabled: true, perWrong: 1 } })).includes("NEGATIVE_MARKING_NOT_ALLOWED"));
  assert.ok(codes(withSection(good(), "AI_INTERVIEW", { negativeMarking: { enabled: true, perWrong: 1 } })).includes("NEGATIVE_MARKING_NOT_ALLOWED"));
  assert.deepEqual(codes(withSection(good(), "CODING", { negativeMarking: { enabled: false } })), [], "switched off is fine anywhere");
});

test("passing criteria: exactly one of marks or percent, within range", () => {
  assert.ok(codes(good({ passingMarks: 40, passingPercent: 40 })).includes("PASSING_AMBIGUOUS"));
  assert.ok(codes(good({ passingMarks: undefined })).includes("PASSING_REQUIRED"));
  assert.ok(codes(good({ passingMarks: 101 })).includes("PASSING_MARKS_INVALID"));
  assert.ok(codes(good({ passingMarks: -1 })).includes("PASSING_MARKS_INVALID"));
  assert.deepEqual(codes(good({ passingMarks: undefined, passingPercent: 40 })), []);
  assert.ok(codes(good({ passingMarks: undefined, passingPercent: 101 })).includes("PASSING_PERCENT_INVALID"));
});

test("the interview section needs its category, difficulty, input, camera, speech and rubric, without contradictions", () => {
  const withInterview = (patch) => withSection(good(), "AI_INTERVIEW", { interview: interview(patch) });
  assert.ok(codes(withInterview({ category: "SMALLTALK" })).includes("INTERVIEW_CATEGORY_INVALID"));
  assert.ok(codes(withInterview({ difficulty: undefined })).includes("INTERVIEW_DIFFICULTY_INVALID"));
  assert.ok(codes(withInterview({ answerInput: "TELEPATHY" })).includes("INTERVIEW_INPUT_INVALID"));
  assert.ok(codes(withInterview({ cameraRequired: "yes" })).includes("INTERVIEW_CAMERA_INVALID"));
  assert.ok(codes(withInterview({ speechToText: undefined })).includes("INTERVIEW_STT_INVALID"));
  assert.ok(codes(withInterview({ rubricVersion: "" })).includes("INTERVIEW_RUBRIC_REQUIRED"));
  assert.ok(codes(withInterview({ speechToText: true, answerInput: "TYPED" })).includes("INTERVIEW_STT_CONFLICT"));
  assert.ok(codes(withInterview({ speechToText: false, answerInput: "SPEECH" })).includes("INTERVIEW_STT_CONFLICT"));
  assert.ok(codes(withSection(good(), "AI_INTERVIEW", { interview: undefined })).includes("INTERVIEW_CATEGORY_INVALID"));
});

test("proctoring settings are required and range-checked for a proctored examination", () => {
  assert.ok(codes(good({ proctoring: undefined })).includes("PROCTORING_REQUIRED"));
  const pr = (patch) => good({ proctoring: { ...good().proctoring, ...patch } });
  assert.ok(codes(pr({ maxWarnings: 0 })).includes("WARNING_THRESHOLD_INVALID"));
  assert.ok(codes(pr({ maxWarnings: 11 })).includes("WARNING_THRESHOLD_INVALID"));
  assert.ok(codes(pr({ networkGraceSec: 601 })).includes("NETWORK_GRACE_INVALID"));
  assert.ok(codes(pr({ cameraLossPolicy: "IGNORE" })).includes("CAMERA_POLICY_INVALID"));
  assert.ok(codes(pr({ evidenceRetentionDays: -1 })).includes("RETENTION_INVALID"));
  assert.ok(codes(pr({ cameraRequired: "yes" })).includes("PROCTORING_FLAG_INVALID"));
  assert.ok(codes(pr({ cameraRequired: false })).includes("CAMERA_INCONSISTENT"), "the interview needs the camera but readiness would not check it");
  const mic = B.validateExamBlueprint(pr({ microphoneRequired: false }));
  assert.equal(mic.valid, true);
  assert.ok(mic.warnings.some((w) => w.code === "MIC_NOT_REQUIRED"));
});

test("practice is always unofficial; a proctored examination is always official", () => {
  assert.ok(codes(good({ mode: "PRACTICE", official: true })).includes("PRACTICE_OFFICIAL"));
  assert.deepEqual(codes(good({ mode: "PRACTICE", official: false, proctoring: undefined })), []);
  assert.ok(codes(good({ official: false })).includes("PROCTORED_NOT_OFFICIAL"));
  assert.ok(codes(good({ mode: "EXAM" })).includes("MODE_INVALID"));
});

test("title is required and bounded", () => {
  assert.ok(codes(good({ title: "   " })).includes("TITLE_REQUIRED"));
  assert.ok(codes(good({ title: "x".repeat(201) })).includes("TITLE_TOO_LONG"));
});

test("an invalid examination cannot be published, a valid one can, and not while attempts are under way", () => {
  assert.equal(B.canPublish(good()).ok, true);
  const bad = B.canPublish(good({ totalMarks: 1 }));
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "INVALID_CONFIGURATION");
  assert.ok(bad.errors.length > 0);
  const live = B.canPublish(good(), { activeAttemptCount: 3 });
  assert.equal(live.ok, false);
  assert.equal(live.reason, "ACTIVE_ATTEMPTS_EXIST");
});

test("editing a published examination with attempts under way cannot change what they depend on", () => {
  const published = good({ description: "old" });
  assert.deepEqual(B.lockedFieldsChanged(published, { ...published, description: "new text" }), [], "a description edit is harmless");
  assert.deepEqual(B.lockedFieldsChanged(published, { ...published, durationMin: 120 }), ["durationMin"]);
  assert.deepEqual(B.lockedFieldsChanged(published, withSection(published, "CODING", { questionCount: 3 })), ["sections"]);
  assert.deepEqual(B.lockedFieldsChanged(published, { ...published, mode: "PRACTICE" }), ["mode"]);
  assert.deepEqual(B.lockedFieldsChanged(published, { ...published, proctoring: { ...published.proctoring, maxWarnings: 9 } }), ["proctoring"]);
  assert.deepEqual(B.lockedFieldsChanged(published, published), []);
});

test("the four sections are lettered A to D in a fixed order", () => {
  assert.deepEqual(B.SECTION_KEYS, ["APTITUDE", "TECHNICAL", "CODING", "AI_INTERVIEW"]);
  assert.match(B.SECTION_LABELS.AI_INTERVIEW, /Section D/);
});
