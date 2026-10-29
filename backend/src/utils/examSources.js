// Section-wise examination: where each section's questions come from, and the blueprint fields beyond utils/examBlueprint.js. Pure functions, unit-tested in
// test/examSources.test.js. `validateFullBlueprint` is what the admin API calls on every save and on publish: the generic rules (marks, timing, order, proctoring, passing
// criteria) plus these source rules.
const B = require("./examBlueprint");
const Q = require("./examQuestions");

const RESULT_VISIBILITY = Object.freeze(["AFTER_PUBLISH", "IMMEDIATE"]);
const EVALUATION_MODES = Object.freeze(["RULES", "AI"]);

const isInt = (n, min, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(n) && n >= min && n <= max;
const isId = (s) => typeof s === "string" && s.trim().length > 0 && s.length <= 100;

// Fills defaults so every stored blueprint has the same shape. Never changes a value the administrator set.
function normalizeBlueprint(def) {
  const d = { ...def };
  if (d.practiceEnabled === undefined) d.practiceEnabled = false;
  if (!d.resultVisibility) d.resultVisibility = "AFTER_PUBLISH";
  d.sections = (Array.isArray(d.sections) ? d.sections : []).map((s) => {
    const section = { ...s };
    if (section.requireAllAnswered === undefined) section.requireAllAnswered = false;
    if (section.key === "APTITUDE" && section.source?.distribution) {
      section.source = { ...section.source, distribution: section.source.distribution.map((x) => ({ ...x, category: Q.APTITUDE_ALIASES[x.category] || x.category })) };
    }
    if (section.key === "AI_INTERVIEW") section.interview = { evaluationMode: "RULES", ...(section.interview || {}) };
    return section;
  });
  return d;
}

function validateBlueprintSources(def) {
  const errors = [];
  const err = (path, code, message) => errors.push({ path, code, message });
  const sections = Array.isArray(def?.sections) ? def.sections : [];

  if (def?.practiceEnabled !== undefined && typeof def.practiceEnabled !== "boolean") err("practiceEnabled", "PRACTICE_FLAG_INVALID", "Practice availability must be on or off.");
  if (def?.resultVisibility !== undefined && !RESULT_VISIBILITY.includes(def.resultVisibility)) err("resultVisibility", "RESULT_VISIBILITY_INVALID", `Result visibility must be one of ${RESULT_VISIBILITY.join(", ")}.`);
  if (def?.mode === "PRACTICE" && def.practiceEnabled === false) err("practiceEnabled", "PRACTICE_ONLY_NEEDS_PRACTICE", "A practice-mode examination must allow practice.");

  sections.forEach((s, i) => {
    const p = `sections[${i}]`;
    if (!s || typeof s !== "object") return;
    if (s.requireAllAnswered !== undefined && typeof s.requireAllAnswered !== "boolean") err(`${p}.requireAllAnswered`, "REQUIRE_ALL_INVALID", "Whether every question must be answered must be on or off.");
    const src = s.source || {};

    if (s.key === "APTITUDE") {
      const norm = (c) => Q.APTITUDE_ALIASES[c] || c;
      const dist = Array.isArray(src.distribution) ? src.distribution : null;
      if (!dist || !dist.length) { err(`${p}.source.distribution`, "APTITUDE_DISTRIBUTION_REQUIRED", "Choose the aptitude topics and how many questions come from each."); return; }
      const seen = new Set();
      let sum = 0;
      dist.forEach((x, j) => {
        const cat = norm(x?.category);
        if (!Q.APTITUDE_CATEGORIES.includes(cat)) err(`${p}.source.distribution[${j}].category`, "APTITUDE_CATEGORY_INVALID", `Aptitude topic must be one of ${Q.APTITUDE_CATEGORIES.join(", ")} (numerical reasoning is quantitative, analytical reasoning is logical).`);
        else if (seen.has(cat)) err(`${p}.source.distribution[${j}].category`, "APTITUDE_CATEGORY_DUPLICATE", "A topic is listed twice.");
        else seen.add(cat);
        if (!isInt(x?.count, 1, 200)) err(`${p}.source.distribution[${j}].count`, "APTITUDE_COUNT_INVALID", "The number of questions must be a whole number from 1 to 200.");
        else sum += x.count;
      });
      if (Number.isInteger(s.questionCount) && sum !== s.questionCount) err(`${p}.source.distribution`, "APTITUDE_COUNT_MISMATCH", `The topic counts add up to ${sum}, but the section has ${s.questionCount} questions.`);
      if (src.difficulty !== undefined && (!Array.isArray(src.difficulty) || !src.difficulty.every((d) => B.DIFFICULTIES.includes(d)))) err(`${p}.source.difficulty`, "DIFFICULTY_INVALID", `Difficulty must be a list of ${B.DIFFICULTIES.join(", ")}.`);
    }

    if (s.key === "TECHNICAL") {
      const subjects = Array.isArray(src.subjects) ? src.subjects : null;
      if (!subjects || !subjects.length) { err(`${p}.source.subjects`, "TECHNICAL_SUBJECTS_REQUIRED", "Choose the subjects and how many questions come from each."); return; }
      const seen = new Set();
      let sum = 0;
      subjects.forEach((x, j) => {
        if (!isId(x?.subjectId)) err(`${p}.source.subjects[${j}].subjectId`, "TECHNICAL_SUBJECT_INVALID", "Choose a subject from the question bank.");
        else if (seen.has(x.subjectId)) err(`${p}.source.subjects[${j}].subjectId`, "TECHNICAL_SUBJECT_DUPLICATE", "A subject is listed twice.");
        else seen.add(x.subjectId);
        if (!isInt(x?.count, 1, 200)) err(`${p}.source.subjects[${j}].count`, "TECHNICAL_COUNT_INVALID", "The number of questions must be a whole number from 1 to 200.");
        else sum += x.count;
      });
      if (Number.isInteger(s.questionCount) && sum !== s.questionCount) err(`${p}.source.subjects`, "TECHNICAL_COUNT_MISMATCH", `The subject counts add up to ${sum}, but the section has ${s.questionCount} questions.`);
      if (src.difficulty !== undefined && (!Array.isArray(src.difficulty) || !src.difficulty.every((d) => B.DIFFICULTIES.includes(d)))) err(`${p}.source.difficulty`, "DIFFICULTY_INVALID", `Difficulty must be a list of ${B.DIFFICULTIES.join(", ")}.`);
    }

    if (s.key === "CODING") {
      const ids = Array.isArray(src.questionIds) ? src.questionIds : null;
      if (!ids || !ids.length) { err(`${p}.source.questionIds`, "CODING_PROBLEMS_REQUIRED", "Choose the coding problems for this examination."); return; }
      if (!ids.every(isId)) err(`${p}.source.questionIds`, "CODING_PROBLEM_INVALID", "A coding problem is not a valid question.");
      if (new Set(ids).size !== ids.length) err(`${p}.source.questionIds`, "CODING_PROBLEM_DUPLICATE", "A coding problem is listed twice.");
      if (Number.isInteger(s.questionCount) && ids.length !== s.questionCount) err(`${p}.source.questionIds`, "CODING_COUNT_MISMATCH", `${ids.length} problems are chosen, but the section has ${s.questionCount} questions.`);
      if (src.allowedLanguages !== undefined && (!Array.isArray(src.allowedLanguages) || !src.allowedLanguages.every((l) => Q.CODE_LANGUAGES.includes(l)))) err(`${p}.source.allowedLanguages`, "LANGUAGES_INVALID", `Languages must be a list of ${Q.CODE_LANGUAGES.join(", ")}.`);
    }

    if (s.key === "AI_INTERVIEW") {
      const iv = s.interview || {};
      if (iv.evaluationMode !== undefined && !EVALUATION_MODES.includes(iv.evaluationMode)) err(`${p}.interview.evaluationMode`, "EVALUATION_MODE_INVALID", `Evaluation mode must be one of ${EVALUATION_MODES.join(", ")}.`);
      if (src.categories !== undefined && (!Array.isArray(src.categories) || !src.categories.every((c) => Object.keys(Q.INTERVIEW_CATEGORY_MAP).includes(c)))) err(`${p}.source.categories`, "INTERVIEW_CATEGORIES_INVALID", `Interview categories must be a list of ${Object.keys(Q.INTERVIEW_CATEGORY_MAP).join(", ")}.`);
    }
  });
  return errors;
}

// The complete check used by the admin API: generic rules + source rules, on the normalised blueprint.
function validateFullBlueprint(def) {
  const normalized = normalizeBlueprint(def || {});
  const generic = B.validateExamBlueprint(normalized);
  const sourceErrors = validateBlueprintSources(normalized);
  const errors = [...generic.errors, ...sourceErrors];
  return { valid: errors.length === 0, errors, warnings: generic.warnings, normalized };
}

// The interview categories (in the interview bank) an AI_INTERVIEW section draws from.
function interviewBankCategories(section) {
  const cats = (section?.source?.categories && section.source.categories.length ? section.source.categories : [section?.interview?.category]).filter(Boolean);
  return [...new Set(cats.flatMap((c) => Q.INTERVIEW_CATEGORY_MAP[c] || []))];
}

module.exports = { RESULT_VISIBILITY, EVALUATION_MODES, normalizeBlueprint, validateBlueprintSources, validateFullBlueprint, interviewBankCategories };
