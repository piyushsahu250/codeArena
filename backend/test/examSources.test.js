const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/utils/examSources");

const sec = (key, order, maxMarks, questionCount, extra = {}) => ({ key, order, maxMarks, questionCount, navigation: "FREE", answerEditing: "EDITABLE_UNTIL_SECTION_SUBMIT", ...extra });
function good(over = {}) {
  return {
    title: "Drive", mode: "PROCTORED", startAt: "2026-11-10T09:00:00Z", endAt: "2026-11-10T13:00:00Z", durationMin: 180, totalMarks: 100, passingMarks: 40, timingPolicy: "OVERALL_ONLY",
    sections: [
      sec("APTITUDE", 1, 25, 10, { source: { distribution: [{ category: "QUANTITATIVE", count: 4 }, { category: "LOGICAL", count: 3 }, { category: "VERBAL", count: 3 }] } }),
      sec("TECHNICAL", 2, 25, 10, { source: { subjects: [{ subjectId: "s1", count: 6 }, { subjectId: "s2", count: 4 }] } }),
      sec("CODING", 3, 30, 2, { source: { questionIds: ["c1", "c2"] } }),
      sec("AI_INTERVIEW", 4, 20, 5, { interview: { category: "HR", difficulty: "MEDIUM", answerInput: "TYPED_OR_SPEECH", cameraRequired: true, speechToText: true, rubricVersion: "hr-v1" } }),
    ],
    proctoring: { cameraRequired: true, microphoneRequired: true, fullscreenRequired: true, autoSubmitOnExpiry: true, reviewRequired: true, maxWarnings: 3, networkGraceSec: 60, cameraLossPolicy: "WARN", evidenceRetentionDays: 90 },
    ...over,
  };
}
const codes = (def) => S.validateFullBlueprint(def).errors.map((e) => e.code);
const withSection = (def, key, patch) => ({ ...def, sections: def.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) });

test("a complete blueprint with sources is valid", () => {
  const r = S.validateFullBlueprint(good());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test("defaults are filled in without changing anything the administrator set", () => {
  const n = S.normalizeBlueprint(good());
  assert.equal(n.practiceEnabled, false);
  assert.equal(n.resultVisibility, "AFTER_PUBLISH");
  assert.equal(n.sections.find((s) => s.key === "APTITUDE").requireAllAnswered, false);
  assert.equal(n.sections.find((s) => s.key === "AI_INTERVIEW").interview.evaluationMode, "RULES");
  const kept = S.normalizeBlueprint(good({ practiceEnabled: true, resultVisibility: "IMMEDIATE" }));
  assert.equal(kept.practiceEnabled, true);
  assert.equal(kept.resultVisibility, "IMMEDIATE");
  const ai = S.normalizeBlueprint(withSection(good(), "AI_INTERVIEW", { interview: { ...good().sections[3].interview, evaluationMode: "AI" } }));
  assert.equal(ai.sections.find((s) => s.key === "AI_INTERVIEW").interview.evaluationMode, "AI");
  assert.deepEqual(S.normalizeBlueprint(undefined).sections, []);
});

test("aptitude: the topic counts must add up to the section's question count, with known topics", () => {
  const dist = (d) => withSection(good(), "APTITUDE", { source: { distribution: d } });
  assert.ok(codes(dist([{ category: "QUANTITATIVE", count: 4 }])).includes("APTITUDE_COUNT_MISMATCH"));
  assert.ok(codes(dist([{ category: "ALGEBRA", count: 10 }])).includes("APTITUDE_CATEGORY_INVALID"));
  assert.ok(codes(dist([{ category: "QUANTITATIVE", count: 5 }, { category: "QUANTITATIVE", count: 5 }])).includes("APTITUDE_CATEGORY_DUPLICATE"));
  assert.ok(codes(dist([{ category: "QUANTITATIVE", count: 0 }])).includes("APTITUDE_COUNT_INVALID"));
  assert.ok(codes(dist([])).includes("APTITUDE_DISTRIBUTION_REQUIRED"));
  assert.ok(codes(withSection(good(), "APTITUDE", { source: {} })).includes("APTITUDE_DISTRIBUTION_REQUIRED"));
  assert.deepEqual(codes(dist([{ category: "NUMERICAL", count: 5 }, { category: "ANALYTICAL", count: 5 }])), [], "numerical reasoning is quantitative and analytical reasoning is logical");
  assert.ok(codes(withSection(good(), "APTITUDE", { source: { ...good().sections[0].source, difficulty: ["EXTREME"] } })).includes("DIFFICULTY_INVALID"));
  assert.deepEqual(S.normalizeBlueprint(dist([{ category: "NUMERICAL", count: 10 }])).sections[0].source.distribution, [{ category: "QUANTITATIVE", count: 10 }]);
});

test("technical: subjects with counts that add up, no subject twice", () => {
  const subj = (s) => withSection(good(), "TECHNICAL", { source: { subjects: s } });
  assert.ok(codes(subj([{ subjectId: "s1", count: 6 }])).includes("TECHNICAL_COUNT_MISMATCH"));
  assert.ok(codes(subj([{ subjectId: "s1", count: 5 }, { subjectId: "s1", count: 5 }])).includes("TECHNICAL_SUBJECT_DUPLICATE"));
  assert.ok(codes(subj([{ subjectId: "", count: 10 }])).includes("TECHNICAL_SUBJECT_INVALID"));
  assert.ok(codes(subj([{ subjectId: "s1", count: 1.5 }])).includes("TECHNICAL_COUNT_INVALID"));
  assert.ok(codes(subj([])).includes("TECHNICAL_SUBJECTS_REQUIRED"));
});

test("coding: the chosen problems must be unique and match the question count", () => {
  const ids = (list) => withSection(good(), "CODING", { source: { questionIds: list } });
  assert.ok(codes(ids(["c1"])).includes("CODING_COUNT_MISMATCH"));
  assert.ok(codes(ids(["c1", "c1"])).includes("CODING_PROBLEM_DUPLICATE"));
  assert.ok(codes(ids([])).includes("CODING_PROBLEMS_REQUIRED"));
  assert.ok(codes(ids(["c1", 5])).includes("CODING_PROBLEM_INVALID"));
  assert.ok(codes(withSection(good(), "CODING", { source: { questionIds: ["c1", "c2"], allowedLanguages: ["python", "klingon"] } })).includes("LANGUAGES_INVALID"));
  assert.deepEqual(codes(withSection(good(), "CODING", { source: { questionIds: ["c1", "c2"], allowedLanguages: ["python", "java"] } })), []);
});

test("interview: evaluation mode and categories are checked", () => {
  const iv = (patch) => withSection(good(), "AI_INTERVIEW", { ...patch });
  assert.ok(codes(iv({ interview: { ...good().sections[3].interview, evaluationMode: "MAGIC" } })).includes("EVALUATION_MODE_INVALID"));
  assert.ok(codes(iv({ source: { categories: ["SMALLTALK"] } })).includes("INTERVIEW_CATEGORIES_INVALID"));
  assert.deepEqual(codes(iv({ source: { categories: ["HR", "BEHAVIORAL"] } })), []);
});

test("exam-level options are checked", () => {
  assert.ok(codes(good({ practiceEnabled: "yes" })).includes("PRACTICE_FLAG_INVALID"));
  assert.ok(codes(good({ resultVisibility: "NEVER" })).includes("RESULT_VISIBILITY_INVALID"));
  assert.ok(codes(good({ mode: "PRACTICE", practiceEnabled: false, proctoring: undefined })).includes("PRACTICE_ONLY_NEEDS_PRACTICE"));
  assert.ok(codes(withSection(good(), "APTITUDE", { requireAllAnswered: "all" })).includes("REQUIRE_ALL_INVALID"));
});

test("generic and source errors are reported together", () => {
  const r = S.validateFullBlueprint(good({ totalMarks: 90, sections: good().sections.map((s) => (s.key === "CODING" ? { ...s, source: { questionIds: [] } } : s)) }));
  const c = r.errors.map((e) => e.code);
  assert.ok(c.includes("MARKS_MISMATCH") && c.includes("CODING_PROBLEMS_REQUIRED"));
  assert.equal(r.valid, false);
  assert.equal(S.validateFullBlueprint(undefined).valid, false);
});

test("the interview bank categories follow the section's categories", () => {
  const sectionOf = (cats, cat) => ({ source: { categories: cats }, interview: { category: cat } });
  assert.deepEqual(S.interviewBankCategories(sectionOf(undefined, "HR")), ["HR"]);
  assert.deepEqual(S.interviewBankCategories(sectionOf(["SITUATIONAL"], "HR")), ["MANAGERIAL"]);
  assert.deepEqual(S.interviewBankCategories(sectionOf(["HR", "TECHNICAL", "BEHAVIORAL"], "HR")).sort(), ["BEHAVIORAL", "HR", "TECHNICAL"]);
  assert.deepEqual(S.interviewBankCategories(sectionOf(["PROJECT"], "HR")).sort(), ["BEHAVIORAL", "TECHNICAL"]);
  assert.deepEqual(S.interviewBankCategories({}), []);
});
