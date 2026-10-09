// Pure rules for importing "codearena-interview-import/1" research files as PENDING
// InterviewQuestionDrafts. No database access here: validate, map and plan only, so the same code
// drives the dry-run report, the apply step and the unit tests. Nothing in this module can publish
// a question — the only target is the draft table, and a human approves each draft afterwards.

const crypto = require("crypto");
const { similarityScore, DUPLICATE_THRESHOLD } = require("./companyQuestionIntelligence");

const SCHEMA = "codearena-interview-import/1";
const QTYPES = new Set(["CODING", "MCQ", "MULTI_SELECT", "TECHNICAL", "BEHAVIORAL", "HR"]);
const DIFFS = new Set(["EASY", "MEDIUM", "HARD"]);
const EVIDENCE = {
  A_DOCUMENTED: { sourceType: "OFFICIAL_COMPANY", maxConfidence: "HIGH" },
  B_CANDIDATE_REPORTED: { sourceType: "PUBLIC_INTERVIEW_REPORT", maxConfidence: "MEDIUM" },
  C_INFERRED_FROM_JD: { sourceType: "INFERRED_FROM_JD", maxConfidence: "LOW" },
  D_PRACTICE: { sourceType: "ORIGINAL_PRACTICE", maxConfidence: "LOW" },
};
const CONF_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const EXPERIENCE = { FRESHER: "FRESHER", YEARS_0_1: "ENTRY_LEVEL", YEARS_1_3: "JUNIOR", YEARS_3_5: "MID_LEVEL", YEARS_5_PLUS: "SENIOR" };
const PLACEHOLDER = /examplecorp|example\s*file|do not import/i;

const blank = (v) => v === null || v === undefined || (typeof v === "string" && !v.trim());
const list = (v) => (Array.isArray(v) ? v : []);

function minConfidence(a, b) {
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

function aptitudeCategoryFor(topic) {
  const t = String(topic || "").toLowerCase();
  if (/verbal|english|grammar|vocab/.test(t)) return "VERBAL";
  if (/numer|quant|math|percent|arithmetic/.test(t)) return "QUANTITATIVE";
  if (/reason|logic|series|syllog|direction|puzzle/.test(t)) return "LOGICAL";
  if (/data interp/.test(t)) return "DATA_INTERPRETATION";
  return null;
}

function parseSourceDate(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1)));
}

// ---------- validation ----------
function validateFile(data, fileName = "") {
  const errors = [];
  const warnings = [];
  const err = (w, m) => errors.push(`${w}: ${m}`);
  const warn = (w, m) => warnings.push(`${w}: ${m}`);

  if (!data || typeof data !== "object") return { errors: ["file: not a JSON object"], warnings };
  if (data.schema_version !== SCHEMA) err("schema_version", `must be '${SCHEMA}'`);
  const res = data.research || {};
  if (/^EXAMPLE/i.test(fileName) || PLACEHOLDER.test(`${res.company} ${res.researcher}`)) {
    err("file", "placeholder/example file — refusing to import");
    return { errors, warnings };
  }
  for (const k of ["company", "role", "experience_level", "hiring_region"]) if (blank(res[k])) err(`research.${k}`, "missing");
  if (!(res.experience_level in EXPERIENCE)) err("research.experience_level", `unknown value '${res.experience_level}'`);

  const sourceIds = new Set();
  for (const s of list(data.sources)) {
    if (blank(s.source_id) || sourceIds.has(s.source_id)) err("sources", `bad or duplicate source_id '${s.source_id}'`);
    sourceIds.add(s.source_id);
    if (blank(s.url)) err(`sources[${s.source_id}]`, "url missing");
    if (blank(s.published_on)) warn(`sources[${s.source_id}]`, "published_on missing");
    if (blank(s.title)) warn(`sources[${s.source_id}]`, "title missing");
  }
  const roundIds = new Set(list(data.rounds).map((r) => r.round_id));
  for (const r of list(data.rounds)) {
    for (const sid of list(r.source_ids)) if (!sourceIds.has(sid)) err(`rounds[${r.round_id}]`, `unknown source ${sid}`);
    if (["DOCUMENTED", "REPORTED"].includes(r.evidence) && !list(r.source_ids).length) err(`rounds[${r.round_id}]`, `${r.evidence} round needs sources`);
  }
  if (!list(data.questions).length) err("questions", "none");

  const unsupported = new Map();
  const seen = new Set();
  const used = new Set();
  for (const q of list(data.questions)) {
    const w = `questions[${q.question_id}]`;
    if (blank(q.question_id) || seen.has(q.question_id)) err(w, "missing or duplicate question_id");
    seen.add(q.question_id);
    if (!roundIds.has(q.round_id)) err(w, `unknown round ${q.round_id}`);
    if (!QTYPES.has(q.question_type)) err(w, `bad question_type ${q.question_type}`);
    if (!DIFFS.has(q.difficulty)) err(w, `bad difficulty ${q.difficulty}`);
    if (blank(q.prompt)) err(w, "prompt missing");
    const ev = EVIDENCE[q.evidence_class];
    if (!ev) err(w, `bad evidence_class ${q.evidence_class}`);
    const sids = list(q.source_ids);
    sids.forEach((s) => { used.add(s); if (!sourceIds.has(s)) err(w, `unknown source ${s}`); });
    if (ev && q.evidence_class !== "D_PRACTICE" && !sids.length) err(w, "A/B/C question needs a source");
    if (q.evidence_class === "D_PRACTICE" && (sids.length || q.times_reported > 0)) err(w, "practice question cannot cite sources or reports");
    if (q.verification_status === "VERIFIED") {
      const ok = q.evidence_class === "A_DOCUMENTED" || (q.evidence_class === "B_CANDIDATE_REPORTED" && q.times_reported >= 2);
      if (!ok) err(w, "VERIFIED is not supported by the evidence class / report count");
    }
    if (q.question_type === "MCQ") {
      const m = q.mcq || {};
      if (!Array.isArray(m.options) || m.options.length < 2) err(w, "mcq.options missing");
      else if (!Array.isArray(m.correct_options) || m.correct_options.length !== 1 || !(m.correct_options[0] >= 0 && m.correct_options[0] < m.options.length)) err(w, "MCQ needs exactly one valid correct option");
      if (!aptitudeCategoryFor(q.topic)) unsupported.set(q.question_id, "technical MCQ: the draft model only supports aptitude-style options");
    }
    if (q.question_type === "MULTI_SELECT") unsupported.set(q.question_id, "MULTI_SELECT is not supported by the draft model");
    if (q.question_type === "CODING") {
      const c = q.coding || {};
      if (list(c.samples).length < 2) err(w, "coding needs at least 2 samples");
      if (list(c.samples).some((s) => blank(s.input) || blank(s.output))) err(w, "coding sample missing input/output");
    }
    if (blank(q.expected_answer)) err(w, "expected_answer missing");
    if (!list(q.rubric).length) warn(w, "rubric empty");
  }
  for (const s of sourceIds) if (!used.has(s) && !list(data.rounds).some((r) => list(r.source_ids).includes(s))) warn("sources", `${s} unused`);
  return { errors, warnings, unsupported };
}

// ---------- mapping ----------
function mapQuestion(data, q, fileName) {
  const res = data.research;
  const sources = new Map(list(data.sources).map((s) => [s.source_id, s]));
  const round = list(data.rounds).find((r) => r.round_id === q.round_id) || {};
  const ev = EVIDENCE[q.evidence_class];
  const qSources = list(q.source_ids).map((id) => sources.get(id)).filter(Boolean);
  const primary = qSources.find((s) => s.kind !== "JOB_DESCRIPTION") || qSources[0] || null;

  let category;
  let aptitudeCategory = null;
  if (q.question_type === "MCQ") { category = "APTITUDE"; aptitudeCategory = aptitudeCategoryFor(q.topic); }
  else if (q.question_type === "CODING") category = "CODING";
  else if (q.question_type === "BEHAVIORAL") category = "BEHAVIORAL";
  else if (q.question_type === "HR") category = "HR";
  else category = "TECHNICAL";

  const coding = q.coding || {};
  const mcq = q.mcq || {};
  const payload = {
    category,
    subject: q.topic,
    company: res.company,
    aptitudeCategory,
    difficulty: q.difficulty,
    title: category === "CODING" ? q.subtopic : null,
    prompt: q.prompt,
    expectedKeywords: list(q.key_concepts),
    modelAnswer: category === "APTITUDE" ? null : q.expected_answer,
    options: category === "APTITUDE" ? mcq.options : null,
    correctAnswer: category === "APTITUDE" ? mcq.correct_options[0] : null,
    explanation: category === "APTITUDE" ? mcq.explanation : null,
    testCases: category === "CODING" ? list(coding.samples).map((s) => ({ input: s.input, expected: s.output, isHidden: false })) : null,
    tags: list(q.tags),
    evaluationType: "STDIO",
    estimatedTimeMin: q.suggested_time_min || null,
    constraints: category === "CODING" ? coding.constraints || null : null,
    inputFormat: category === "CODING" ? coding.input_format || null : null,
    outputFormat: category === "CODING" ? coding.output_format || null : null,
    edgeCases: category === "CODING" ? list(coding.edge_cases).join("; ") || null : null,
    problemExplanation: category === "CODING" ? coding.problem_statement || null : null,
    role: res.role,
    experienceLevel: EXPERIENCE[res.experience_level],
    sourceType: ev.sourceType,
    sourceUrl: primary ? primary.url : null,
    sourceDate: primary ? parseSourceDate(primary.published_on) : null,
    confidenceLevel: minConfidence(q.confidence, ev.maxConfidence),
    verificationCount: q.times_reported || 0,
    roundName: round.name || null,
    importKey: `${SCHEMA}:${q.question_id}`,
    researchMeta: {
      schema: SCHEMA,
      file: fileName,
      questionId: q.question_id,
      roundId: q.round_id,
      evidenceClass: q.evidence_class,
      verificationStatusInFile: q.verification_status,
      confidenceInFile: q.confidence,
      originalityStatus: q.originality_status,
      timesReported: q.times_reported || 0,
      relevanceToRole: q.relevance_to_role,
      rubric: list(q.rubric),
      followUps: list(q.follow_ups),
      commonMistakes: list(q.common_mistakes),
      notes: q.notes || "",
      sources: qSources,
      researchedOn: res.researched_on,
      researcher: res.researcher,
      limitations: list(res.limitations),
      behavioral: q.behavioral || undefined,
      coding: category === "CODING" ? { expectedAlgorithm: coding.expected_algorithm, timeComplexity: coding.time_complexity, spaceComplexity: coding.space_complexity, hiddenTestCategories: list(coding.hidden_test_categories) } : undefined,
      mcq: category === "APTITUDE" ? { distractorNotes: mcq.distractor_notes || "" } : undefined,
    },
  };
  return payload;
}

function contentHash(payload) {
  const { researchMeta, ...rest } = payload;
  return crypto.createHash("sha256").update(JSON.stringify({ rest, researchMeta })).digest("hex");
}

// ---------- planning ----------
// existing: [{ id, prompt, title, company, kind: "question" | "draft", status?, importKey?, importHash? }]
// Returns one plan row per file question. Never writes anything.
function planImport(files, existing) {
  const rows = [];
  const byKey = new Map(existing.filter((e) => e.importKey).map((e) => [e.importKey, e]));
  const accepted = [];
  for (const { fileName, data } of files) {
    const { errors, warnings, unsupported } = validateFile(data, fileName);
    if (errors.length) {
      rows.push({ fileName, questionId: null, action: "FILE_REJECTED", reasons: errors, warnings });
      continue;
    }
    for (const q of data.questions) {
      if (unsupported.has(q.question_id)) { rows.push({ fileName, questionId: q.question_id, action: "UNSUPPORTED_TYPE", reasons: [unsupported.get(q.question_id)] }); continue; }
      const payload = mapQuestion(data, q, fileName);
      const hash = contentHash(payload);
      const row = { fileName, questionId: q.question_id, category: payload.category, sourceType: payload.sourceType, confidenceLevel: payload.confidenceLevel, payload, hash, reasons: [], flags: [] };

      const same = byKey.get(payload.importKey);
      if (same) {
        if (same.importHash === hash) row.action = "SKIP_ALREADY_IMPORTED";
        else if (same.kind === "draft" && same.status === "PENDING") { row.action = "UPDATE_PENDING_DRAFT"; row.reasons.push(`draft ${same.id} is still pending and the file content changed`); row.existingId = same.id; }
        else { row.action = "NEEDS_REVISION_REVIEW"; row.reasons.push(`${same.kind} ${same.id} (${same.status || "live"}) differs from the file; it is not touched`); row.existingId = same.id; }
        rows.push(row);
        continue;
      }
      const text = payload.prompt;
      const dup = [...existing, ...accepted]
        .filter((e) => !e.importKey || e.importKey !== payload.importKey)
        .map((e) => ({ e, s: similarityScore(text, e.prompt || e.title || "") }))
        .filter((m) => m.s >= DUPLICATE_THRESHOLD)
        .sort((a, b) => b.s - a.s)[0];
      if (dup) {
        row.action = "POSSIBLE_DUPLICATE";
        row.reasons.push(`${Math.round(dup.s * 100)}% similar to ${dup.e.kind || "file question"} ${dup.e.id}${dup.e.company ? ` (${dup.e.company})` : ""}: "${String(dup.e.prompt || dup.e.title).slice(0, 90)}"`);
        row.existingId = dup.e.id;
        rows.push(row);
        continue;
      }
      row.action = "CREATE_PENDING_DRAFT";
      if (payload.category === "CODING") row.flags.push("needs 5 hidden test cases before it can be approved");
      if (payload.confidenceLevel !== q.confidence) row.flags.push(`confidence capped ${q.confidence} -> ${payload.confidenceLevel}`);
      accepted.push({ id: q.question_id, kind: "file question", prompt: text, company: data.research.company });
      rows.push(row);
    }
    for (const w of warnings) rows.push({ fileName, questionId: null, action: "FILE_WARNING", reasons: [w] });
  }
  return rows;
}

function summarize(rows) {
  const counts = {};
  for (const r of rows) { if (r.action !== "FILE_WARNING") counts[r.action] = (counts[r.action] || 0) + 1; }
  return counts;
}

module.exports = { SCHEMA, validateFile, mapQuestion, contentHash, planImport, summarize, aptitudeCategoryFor, parseSourceDate, minConfidence };
