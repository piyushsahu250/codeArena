// Section-wise examination: question rules. Pure functions (no database), unit-tested in test/examQuestions.test.js.
//   - which questions may be used (a valid answer key is mandatory: nothing is ever scored from a guess),
//   - deterministic selection (the same attempt always gets the same questions),
//   - exact splitting of a section's marks across its items,
//   - validation of the answer a student saves,
//   - what a student may see (never an answer key, never a hidden test case).
const { seededShuffle } = require("./optionShuffle");

const APTITUDE_CATEGORIES = Object.freeze(["QUANTITATIVE", "LOGICAL", "VERBAL", "DATA_INTERPRETATION"]);
// The aptitude bank (InterviewQuestion, category APTITUDE) has four categories. Numerical reasoning belongs to QUANTITATIVE and analytical reasoning to LOGICAL.
const APTITUDE_ALIASES = Object.freeze({ NUMERICAL: "QUANTITATIVE", ANALYTICAL: "LOGICAL" });
// The interview bank (InterviewQuestion) has HR, TECHNICAL, BEHAVIORAL and MANAGERIAL (situational and leadership) questions; the exam's interview categories map onto them.
const INTERVIEW_CATEGORY_MAP = Object.freeze({ HR: ["HR"], TECHNICAL: ["TECHNICAL"], BEHAVIORAL: ["BEHAVIORAL"], SITUATIONAL: ["MANAGERIAL"], PROJECT: ["TECHNICAL", "BEHAVIORAL"], ROLE_SPECIFIC: ["TECHNICAL"] });
const OBJECTIVE_TYPES = Object.freeze(["MCQ", "MULTISELECT", "TRUE_FALSE"]);
const MAX_ANSWER_CHARS = 20000;
const MAX_CODE_CHARS = 100000;
const CODE_LANGUAGES = Object.freeze(["python", "java", "cpp", "c", "javascript", "sql"]);

const isNonEmptyString = (s) => typeof s === "string" && s.trim().length > 0;
const isIndex = (n, len) => Number.isInteger(n) && n >= 0 && n < len;

// ---- answer keys ------------------------------------------------------------------------------------------------------------------------------------------------------------
// Returns the correct option indices as a sorted array of ORIGINAL indices, or null when the key cannot be trusted (missing, out of range, duplicated).
function correctIndices(options, correctAnswer) {
  if (!Array.isArray(options)) return null;
  const raw = Array.isArray(correctAnswer) ? correctAnswer : correctAnswer === null || correctAnswer === undefined ? [] : [correctAnswer];
  if (!raw.length || !raw.every((n) => isIndex(n, options.length))) return null;
  const set = [...new Set(raw)].sort((a, b) => a - b);
  return set.length === raw.length ? set : null;
}

// kind: "APTITUDE" (an InterviewQuestion) or "TECHNICAL" (a Question). A question without a valid, unambiguous key is excluded from selection and reported at publish time.
function validateObjectiveQuestion(q, kind) {
  if (!q) return { valid: false, reason: "MISSING" };
  const options = q.options;
  if (!Array.isArray(options) || options.length < 2) return { valid: false, reason: "OPTIONS_MISSING" };
  if (!options.every(isNonEmptyString)) return { valid: false, reason: "OPTION_EMPTY" };
  const lowered = options.map((o) => o.trim().toLowerCase());
  if (new Set(lowered).size !== lowered.length) return { valid: false, reason: "DUPLICATE_OPTIONS" }; // two identical options make the key ambiguous
  const key = correctIndices(options, q.correctAnswer);
  if (!key) return { valid: false, reason: "KEY_INVALID" };
  if (kind === "APTITUDE" || q.questionType === "MCQ" || q.questionType === "TRUE_FALSE") {
    if (key.length !== 1) return { valid: false, reason: "SINGLE_ANSWER_EXPECTED" };
  }
  if (q.questionType === "TRUE_FALSE" && options.length !== 2) return { valid: false, reason: "TRUE_FALSE_NEEDS_TWO_OPTIONS" };
  const text = kind === "APTITUDE" ? q.prompt : q.description;
  if (!isNonEmptyString(text)) return { valid: false, reason: "TEXT_MISSING" };
  return { valid: true, reason: null, key };
}

// ---- marks ------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Splits `maxMarks` over `count` items in hundredths so the parts add up to EXACTLY maxMarks (the last items absorb the remainder): 10 marks over 3 items is 3.34, 3.33, 3.33.
function splitMarks(maxMarks, count) {
  if (!Number.isInteger(count) || count < 1) return [];
  const total = Math.round(maxMarks * 100);
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

// ---- selection --------------------------------------------------------------------------------------------------------------------------------------------------------------
// Deterministic: the same seed (the attempt id) always yields the same questions in the same order, so a refresh or a recovery never changes the paper.
function selectSeeded(ids, count, seed) {
  const unique = [...new Set(ids)].sort(); // sort first so the result does not depend on database row order
  return seededShuffle(unique, String(seed)).slice(0, count);
}

// distribution: [{ group, count }]; pools: { [group]: [id, ...] }. Returns the selected ids per group (in distribution order) and any shortage.
function selectByDistribution(pools, distribution, seed) {
  const selected = [];
  const shortages = [];
  const used = new Set();
  for (const { group, count } of distribution) {
    const available = (pools[group] || []).filter((id) => !used.has(id));
    const picked = selectSeeded(available, count, `${seed}:${group}`);
    picked.forEach((id) => { used.add(id); selected.push({ id, group }); });
    if (picked.length < count) shortages.push({ group, needed: count, available: picked.length });
  }
  return { selected, shortages };
}

// The presentation order of an item's options for one attempt: a fixed permutation per (attempt, question). `order[i]` is the ORIGINAL index shown at position i.
function optionOrderFor(optionCount, seed) {
  return seededShuffle(Array.from({ length: optionCount }, (_, i) => i), String(seed));
}
function toOriginalIndices(selected, order) {
  const map = (pos) => (Number.isInteger(pos) && pos >= 0 && pos < order.length ? order[pos] : null);
  if (Array.isArray(selected)) return selected.map(map);
  return map(selected);
}

// ---- answers ----------------------------------------------------------------------------------------------------------------------------------------------------------------
// The payload a student may save for an item. Returns { ok: true, value } or { ok: false, code, message }. Nothing the client sends is trusted beyond its shape.
function normalizeAnswerPayload(sectionKey, payload, ctx = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, code: "PAYLOAD_INVALID", message: "The answer is missing." };
  if (sectionKey === "APTITUDE" || sectionKey === "TECHNICAL") {
    const optionCount = ctx.optionCount;
    const sel = payload.selected;
    if (sel === null || sel === undefined) return { ok: true, value: { selected: null } }; // clearing a choice
    const list = Array.isArray(sel) ? sel : [sel];
    if (!list.every((n) => isIndex(n, optionCount))) return { ok: false, code: "SELECTION_INVALID", message: "That option does not exist." };
    if (new Set(list).size !== list.length) return { ok: false, code: "SELECTION_INVALID", message: "An option was chosen twice." };
    if (!ctx.multiple && list.length > 1) return { ok: false, code: "SELECTION_INVALID", message: "Only one option can be chosen." };
    return { ok: true, value: { selected: ctx.multiple ? [...list].sort((a, b) => a - b) : list[0] } };
  }
  if (sectionKey === "AI_INTERVIEW") {
    if (typeof payload.text !== "string") return { ok: false, code: "TEXT_REQUIRED", message: "The answer text is missing." };
    if (payload.text.length > MAX_ANSWER_CHARS) return { ok: false, code: "TEXT_TOO_LONG", message: `The answer is too long (limit ${MAX_ANSWER_CHARS} characters).` };
    return { ok: true, value: { text: payload.text, input: payload.input === "SPEECH" ? "SPEECH" : "TYPED" } };
  }
  if (sectionKey === "CODING") {
    if (typeof payload.code !== "string") return { ok: false, code: "CODE_REQUIRED", message: "The code is missing." };
    if (payload.code.length > MAX_CODE_CHARS) return { ok: false, code: "CODE_TOO_LONG", message: `The code is too long (limit ${MAX_CODE_CHARS} characters).` };
    const language = String(payload.language || "").toLowerCase();
    if (!CODE_LANGUAGES.includes(language)) return { ok: false, code: "LANGUAGE_INVALID", message: "That programming language is not supported." };
    if (ctx.allowedLanguages && ctx.allowedLanguages.length && !ctx.allowedLanguages.includes(language)) return { ok: false, code: "LANGUAGE_NOT_ALLOWED", message: "That language is not allowed in this examination." };
    return { ok: true, value: { code: payload.code, language } };
  }
  return { ok: false, code: "SECTION_INVALID", message: "Unknown section." };
}

function isAnswerNonEmpty(sectionKey, payload) {
  if (!payload) return false;
  if (sectionKey === "APTITUDE" || sectionKey === "TECHNICAL") return Array.isArray(payload.selected) ? payload.selected.length > 0 : payload.selected !== null && payload.selected !== undefined;
  if (sectionKey === "AI_INTERVIEW") return typeof payload.text === "string" && payload.text.trim().length > 0;
  if (sectionKey === "CODING") return typeof payload.code === "string" && payload.code.trim().length > 0;
  return false;
}

// ---- what a student may see ----------------------------------------------------------------------------------------------------------------------------------------------
// Never: correctAnswer, explanation (until the result is released), expectedKeywords, modelAnswer, hidden test cases, referenceSolution.
function sanitizeObjective(q, kind, order) {
  const options = Array.isArray(q.options) ? q.options : [];
  const shown = order && order.length === options.length ? order.map((i) => options[i]) : options;
  return {
    id: q.id, kind, text: kind === "APTITUDE" ? q.prompt : q.description, title: q.title || null,
    options: shown, multiple: q.questionType === "MULTISELECT", category: kind === "APTITUDE" ? q.aptitudeCategory : null,
    topic: q.topic || null,
  };
}
function sanitizeInterview(q) {
  return { id: q.id, kind: "AI_INTERVIEW", text: q.prompt, category: q.category, subject: q.subject || null };
}
function sanitizeCoding(q, visibleCases, allowedLanguages) {
  return {
    id: q.id, kind: "CODING", title: q.title || `Problem ${q.questionNumber ?? ""}`.trim(), text: q.description,
    inputFormat: q.inputFormat || null, outputFormat: q.outputFormat || null, constraints: q.constraints || null, notes: q.notes || null,
    timeLimitMs: q.timeLimitMs, memoryLimitKb: q.memoryLimitKb || null, evaluationType: q.evaluationType, functionSignature: q.functionSignature || null,
    starterCode: q.starterCode || null, starterCodeByLanguage: q.starterCodeByLanguage || null, questionType: q.questionType,
    samples: (visibleCases || []).map((c) => ({ input: c.input, expected: c.expected, explanation: c.explanation || null })),
    languages: allowedLanguages && allowedLanguages.length ? allowedLanguages : null,
  };
}

module.exports = {
  APTITUDE_CATEGORIES, APTITUDE_ALIASES, INTERVIEW_CATEGORY_MAP, OBJECTIVE_TYPES, CODE_LANGUAGES, MAX_ANSWER_CHARS, MAX_CODE_CHARS,
  correctIndices, validateObjectiveQuestion, splitMarks, selectSeeded, selectByDistribution, optionOrderFor, toOriginalIndices,
  normalizeAnswerPayload, isAnswerNonEmpty, sanitizeObjective, sanitizeInterview, sanitizeCoding,
};
