// Section-wise examination: question pools, the frozen manifest, and scoring of a section from the stored answers. Used by exams.attempts.js and exams.admin.js.
// Reuses the existing question banks (InterviewQuestion for aptitude and interview, Question for technical and coding), the existing judge (utils/judgeGateway.js) and the existing
// interview evaluators (utils/interviewEvaluation.js). Nothing here trusts the client: marks and keys come from the database and the frozen manifest.
const crypto = require("crypto");
const prisma = require("../../prisma");
const Q = require("../../utils/examQuestions");
const Src = require("../../utils/examSources");
const Scoring = require("../../utils/examScoring");
const { SECTION_KEYS } = require("../../utils/examBlueprint");
const { instituteWhere } = require("../../utils/questionVisibility");

// An examination that belongs to no institute is open to students of every institute, and a student sees only their own institute's questions plus the shared ones (instituteId null).
// So when such an exam is checked (at publish, or by an administrator who sees everything), only the shared questions can be counted on: GLOBAL_ONLY means exactly that.
// Before this, the check counted every institute's questions, passed, and then a student of one institute was told "not ready" because their own pool was short.
const GLOBAL_ONLY = "__shared_only__";
const visible = (instituteId) => (instituteId === GLOBAL_ONLY ? { instituteId: null } : instituteWhere(instituteId));
const { seededShuffle } = require("../../utils/optionShuffle");
const { evaluateHrAnswer, evaluateTechnicalAnswer } = require("../../utils/interviewEvaluation");

const POOL_LIMIT = 5000; // a bound on how many candidate questions one section reads
const INTERVIEW_RUBRIC_VERSION = "interview-rules-v1";

const sha = (s) => crypto.createHash("sha256").update(String(s ?? "")).digest("hex").slice(0, 16);
const round2 = Scoring.round2;
const sectionOf = (blueprint, key) => (blueprint.sections || []).find((s) => s.key === key);

// ---- pools ------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function aptitudePools(section, instituteId) {
  const diff = section.source?.difficulty;
  const pools = {}; const invalid = [];
  for (const { category } of section.source.distribution) {
    const rows = await prisma.interviewQuestion.findMany({
      where: { category: "APTITUDE", aptitudeCategory: category, isActive: true, generatedForStudentId: null, ...(diff?.length ? { difficulty: { in: diff } } : {}), ...visible(instituteId) },
      select: { id: true, prompt: true, options: true, correctAnswer: true }, take: POOL_LIMIT,
    });
    pools[category] = [];
    for (const r of rows) { const v = Q.validateObjectiveQuestion(r, "APTITUDE"); if (v.valid) pools[category].push(r.id); else invalid.push({ id: r.id, group: category, reason: v.reason }); }
  }
  return { pools, invalid };
}

async function technicalPools(section, instituteId) {
  const diff = section.source?.difficulty;
  const pools = {}; const invalid = [];
  for (const { subjectId } of section.source.subjects) {
    const rows = await prisma.question.findMany({
      where: { subjectId, questionType: { in: Q.OBJECTIVE_TYPES }, questionStatus: "PUBLISHED", ...(diff?.length ? { difficulty: { in: diff } } : {}), ...visible(instituteId) },
      select: { id: true, description: true, options: true, correctAnswer: true, questionType: true }, take: POOL_LIMIT,
    });
    pools[subjectId] = [];
    for (const r of rows) { const v = Q.validateObjectiveQuestion(r, "TECHNICAL"); if (v.valid) pools[subjectId].push(r.id); else invalid.push({ id: r.id, group: subjectId, reason: v.reason }); }
  }
  return { pools, invalid };
}

async function codingRows(section, instituteId) {
  const ids = section.source.questionIds;
  const rows = await prisma.question.findMany({
    where: { id: { in: ids }, questionType: { in: ["CODING", "SQL"] }, questionStatus: "PUBLISHED", ...visible(instituteId) },
    select: { id: true, testCases: { select: { id: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const valid = []; const invalid = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) invalid.push({ id, reason: "NOT_AVAILABLE" });
    else if (!r.testCases.length) invalid.push({ id, reason: "NO_TEST_CASES" });
    else valid.push(id);
  }
  return { valid, invalid };
}

async function interviewPool(section, instituteId) {
  const cats = Src.interviewBankCategories(section);
  const wanted = section.interview?.difficulty;
  const rows = await prisma.interviewQuestion.findMany({
    where: { category: { in: cats }, isActive: true, generatedForStudentId: null, ...visible(instituteId) },
    select: { id: true, prompt: true, difficulty: true }, take: POOL_LIMIT,
  });
  const valid = rows.filter((r) => typeof r.prompt === "string" && r.prompt.trim());
  // difficulty is a preference, not a hard filter (the same soft narrowing the standalone interview uses): matching questions first, the rest only to fill the count
  return { preferred: valid.filter((r) => r.difficulty === wanted).map((r) => r.id), others: valid.filter((r) => r.difficulty !== wanted).map((r) => r.id) };
}

// What a blueprint can actually draw on right now: used at publish time (is there enough, and is every key valid?) and when an attempt starts.
async function availability(blueprint, instituteId) {
  const report = {};
  for (const section of blueprint.sections) {
    if (section.key === "APTITUDE") {
      const { pools, invalid } = await aptitudePools(section, instituteId);
      report.APTITUDE = { groups: section.source.distribution.map((d) => ({ group: d.category, needed: d.count, available: (pools[d.category] || []).length })), invalid, pools };
    } else if (section.key === "TECHNICAL") {
      const { pools, invalid } = await technicalPools(section, instituteId);
      report.TECHNICAL = { groups: section.source.subjects.map((d) => ({ group: d.subjectId, needed: d.count, available: (pools[d.subjectId] || []).length })), invalid, pools };
    } else if (section.key === "CODING") {
      const { valid, invalid } = await codingRows(section, instituteId);
      report.CODING = { groups: [{ group: "problems", needed: section.questionCount, available: valid.length }], invalid, valid };
    } else if (section.key === "AI_INTERVIEW") {
      const p = await interviewPool(section, instituteId);
      report.AI_INTERVIEW = { groups: [{ group: "questions", needed: section.questionCount, available: p.preferred.length + p.others.length }], invalid: [], pool: p };
    }
  }
  const shortages = [];
  for (const [key, r] of Object.entries(report)) for (const g of r.groups) if (g.available < g.needed) shortages.push({ section: key, group: g.group, needed: g.needed, available: g.available });
  const invalidCount = Object.values(report).reduce((a, r) => a + r.invalid.length, 0);
  return { report, shortages, invalidCount };
}

// Builds the frozen assignment for an attempt. Deterministic in `attemptId`.
async function buildManifest({ blueprint, instituteId, attemptId }) {
  const { report, shortages } = await availability(blueprint, instituteId);
  if (shortages.length) return { ok: false, shortages };
  const manifest = {};
  for (const section of blueprint.sections) {
    const key = section.key;
    const marks = Q.splitMarks(section.maxMarks, section.questionCount);
    let chosen;
    if (key === "APTITUDE") {
      chosen = Q.selectByDistribution(report.APTITUDE.pools, section.source.distribution.map((d) => ({ group: d.category, count: d.count })), attemptId).selected;
    } else if (key === "TECHNICAL") {
      chosen = Q.selectByDistribution(report.TECHNICAL.pools, section.source.subjects.map((d) => ({ group: d.subjectId, count: d.count })), attemptId).selected;
    } else if (key === "CODING") {
      chosen = report.CODING.valid.slice(0, section.questionCount).map((id) => ({ id, group: "coding" }));
    } else {
      const p = report.AI_INTERVIEW.pool;
      const first = Q.selectSeeded(p.preferred, section.questionCount, `${attemptId}:interview`);
      const rest = first.length < section.questionCount ? Q.selectSeeded(p.others, section.questionCount - first.length, `${attemptId}:interview:rest`) : [];
      chosen = [...first, ...rest].map((id) => ({ id, group: "interview" }));
    }
    if (section.shuffleQuestions !== false && key !== "CODING") {
      const order = seededShuffle(chosen.map((c) => c.id), `${attemptId}:${key}:order`);
      chosen = order.map((id) => chosen.find((c) => c.id === id));
    }
    manifest[key] = chosen.map((c, i) => ({ ref: c.id, group: c.group, marks: marks[i] }));
  }
  return { ok: true, manifest };
}

// ---- reading the questions of a section ----------------------------------------------------------------------------------------------------------------------
const itemsOf = (attempt, key) => (attempt.manifest?.[key] || []);

async function loadObjectiveRows(key, refs) {
  if (key === "APTITUDE") return prisma.interviewQuestion.findMany({ where: { id: { in: refs } }, select: { id: true, prompt: true, options: true, correctAnswer: true, aptitudeCategory: true, explanation: true, subject: true } });
  return prisma.question.findMany({ where: { id: { in: refs } }, select: { id: true, title: true, description: true, options: true, correctAnswer: true, questionType: true, topic: true, subject: true, explanation: true, subjectRef: { select: { name: true } }, topicRef: { select: { name: true } } } });
}

// The items of one section as the student may see them: no keys, no explanations, no hidden test cases. Options appear in this attempt's own order when the section shuffles them.
async function studentItems(attempt, blueprint, key) {
  const section = sectionOf(blueprint, key);
  const refs = itemsOf(attempt, key).map((i) => i.ref);
  if (!refs.length) return [];
  let rows;
  if (key === "APTITUDE" || key === "TECHNICAL") rows = await loadObjectiveRows(key, refs);
  else if (key === "AI_INTERVIEW") rows = await prisma.interviewQuestion.findMany({ where: { id: { in: refs } }, select: { id: true, prompt: true, category: true, subject: true } });
  else rows = await prisma.question.findMany({ where: { id: { in: refs } }, include: { testCases: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return itemsOf(attempt, key).map((item) => {
    const q = byId.get(item.ref);
    if (!q) return { id: item.ref, marks: item.marks, unavailable: true };
    let sanitized;
    if (key === "AI_INTERVIEW") sanitized = Q.sanitizeInterview(q);
    else if (key === "CODING") sanitized = Q.sanitizeCoding(q, q.testCases.filter((c) => !c.isHidden), section.source?.allowedLanguages);
    else {
      const order = section.shuffleOptions && Array.isArray(q.options) ? Q.optionOrderFor(q.options.length, `${attempt.id}:${q.id}`) : null;
      sanitized = Q.sanitizeObjective(q, key, order);
    }
    return { ...sanitized, marks: item.marks };
  });
}

// ---- judge ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The judge's verdict -> the statuses utils/examScoring.js understands. WRONG_ANSWER and ACCEPTED are both the student's result; anything the judge itself failed at is not.
function judgeStatusOf(evaluation) {
  if (!evaluation || evaluation.status !== "DONE") return { status: "JUDGE_ERROR" };
  const v = evaluation.verdict;
  const base = { passed: evaluation.passedCases, total: evaluation.totalCases };
  if (v === "ACCEPTED" || v === "WRONG_ANSWER" || v === "PARTIAL") return { status: "OK", ...base };
  if (v === "COMPILE_ERROR") return { status: "COMPILE_ERROR", ...base };
  if (v === "RUNTIME_ERROR") return { status: "RUNTIME_ERROR", ...base };
  if (v === "TIME_LIMIT_EXCEEDED") return { status: "TIME_LIMIT_EXCEEDED", ...base };
  if (v === "MEMORY_LIMIT_EXCEEDED") return { status: "MEMORY_LIMIT_EXCEEDED", ...base };
  return { status: "JUDGE_ERROR" };
}

// ---- scoring a section from the stored answers -------------------------------------------------------------------------------------------------------------------
function answerMap(answers) { return new Map(answers.map((a) => [a.itemRef, a])); }

async function scoreObjective(attempt, blueprint, key, answers) {
  const section = sectionOf(blueprint, key);
  const items = itemsOf(attempt, key);
  const rows = await loadObjectiveRows(key, items.map((i) => i.ref));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ans = answerMap(answers);
  const negative = section.negativeMarking?.enabled ? section.negativeMarking.perWrong : 0;
  const scored = items.map((item) => {
    const q = byId.get(item.ref);
    const options = q?.options;
    const keyIdx = q ? Q.correctIndices(options, q.correctAnswer) : null;
    const a = ans.get(item.ref);
    let selected = a?.payload?.selected ?? null;
    if (selected !== null && section.shuffleOptions && Array.isArray(options)) selected = Q.toOriginalIndices(selected, Q.optionOrderFor(options.length, `${attempt.id}:${item.ref}`));
    const topic = key === "APTITUDE" ? q?.aptitudeCategory : (q?.topicRef?.name || q?.topic || null);
    const subject = key === "TECHNICAL" ? (q?.subjectRef?.name || q?.subject || null) : null;
    return { topic, subject, marks: item.marks, selected, correct: keyIdx, negativePerWrong: negative };
  });
  return Scoring.summarizeObjectiveSection({ key, maxMarks: section.maxMarks, items: scored });
}

async function scoreCoding(attempt, blueprint, answers) {
  const section = sectionOf(blueprint, "CODING");
  const ans = answerMap(answers);
  const problems = itemsOf(attempt, "CODING").map((item) => {
    const a = ans.get(item.ref);
    const ev = a?.evaluation;
    const submitted = !!ev;
    return { id: item.ref, maxMarks: item.marks, submitted, judge: submitted ? judgeStatusOf(ev) : undefined };
  });
  return Scoring.summarizeCodingSection({ maxMarks: section.maxMarks, problems });
}

// Deterministic interview scoring with the existing evaluators (HR/behavioural/managerial: communication heuristics; technical: keyword coverage). Same rubric every time.
function ruleEvaluate(question, text) {
  const technical = question.category === "TECHNICAL" || question.category === "SYSTEM_DESIGN";
  const r = technical ? evaluateTechnicalAnswer(text, question.expectedKeywords || []) : evaluateHrAnswer(text, question.expectedKeywords || []);
  return { status: "DONE", method: "RULES", rubricVersion: INTERVIEW_RUBRIC_VERSION, scorePct: r.score, breakdown: r.breakdown, evaluatedAt: new Date().toISOString() };
}

async function scoreInterview(attempt, blueprint, answers) {
  const section = sectionOf(blueprint, "AI_INTERVIEW");
  const items = itemsOf(attempt, "AI_INTERVIEW");
  const rows = await prisma.interviewQuestion.findMany({ where: { id: { in: items.map((i) => i.ref) } }, select: { id: true, prompt: true, category: true, expectedKeywords: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ans = answerMap(answers);
  const turns = items.map((item) => {
    const a = ans.get(item.ref);
    const text = a?.payload?.text || "";
    const answered = text.trim().length > 0;
    if (!answered) return { id: item.ref, maxMarks: item.marks, answered: false, skipped: true };
    const ev = a.evaluation;
    let evaluation;
    if (ev?.status === "DONE" && typeof ev.marks === "number") evaluation = { status: "DONE", score: ev.marks, confidence: ev.confidence ?? null };
    else if (ev?.status === "DONE" && typeof ev.scorePct === "number") evaluation = { status: "DONE", score: round2((item.marks * ev.scorePct) / 100), confidence: null };
    else if (ev?.status === "FAILED") evaluation = { status: "FAILED" };
    else if (ev?.status === "PENDING") evaluation = { status: "PENDING" };
    else evaluation = { status: "PENDING" }; // answered but not evaluated yet
    return { id: item.ref, maxMarks: item.marks, answered: true, skipped: false, evaluation, _q: byId.get(item.ref) };
  });
  return Scoring.summarizeInterviewSection({ maxMarks: section.maxMarks, turns });
}

module.exports = {
  GLOBAL_ONLY,
  POOL_LIMIT, INTERVIEW_RUBRIC_VERSION, sha, round2, sectionOf, itemsOf, availability, buildManifest, studentItems, loadObjectiveRows, judgeStatusOf, ruleEvaluate,
  scoreObjective, scoreCoding, scoreInterview, answerMap, SECTION_KEYS,
};
