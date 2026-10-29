// Section-wise examination: scoring, result aggregation and the proctoring summary. Pure functions, unit-tested in test/examScoring.test.js.
//
// Rules this file enforces:
//  - marks come from the server's own answer keys and judge results, never from a client value;
//  - a judge failure or an AI evaluation that failed or is still pending is NOT a zero: the section stays PENDING, and the examination result stays EVALUATION_PENDING,
//    so no misleading final score is produced (and a failed component can be retried);
//  - a result is final only when every section is final; until then the figures are marked provisional and pass/fail is not decided;
//  - a proctoring event is an observation: only an event a human reviewer CONFIRMED is reported as a confirmed violation.
const { SECTION_KEYS } = require("./examBlueprint");

const round2 = (n) => Math.round(n * 100) / 100;
const pct = (obtained, max) => (max > 0 ? round2((obtained / max) * 100) : 0);

// ---- Section A / B: multiple choice -------------------------------------------------------------------------------------------------------------------------------
const norm = (v) => (Array.isArray(v) ? [...new Set(v.map(String))].sort() : v === null || v === undefined || v === "" ? [] : [String(v)]);

// selected/correct: a single option or an array (multiple select: all-or-nothing, no partial credit). An empty answer is "unanswered" and never costs negative marks.
function scoreMcq({ selected, correct, marks, negativePerWrong = 0 }) {
  const s = norm(selected);
  const c = norm(correct);
  if (!c.length) return { outcome: "KEY_MISSING", score: null }; // an item without a valid key is excluded from the score and reported, never scored from a guess
  if (!s.length) return { outcome: "UNANSWERED", score: 0 };
  const same = s.length === c.length && s.every((x, i) => x === c[i]);
  return same ? { outcome: "CORRECT", score: marks } : { outcome: "INCORRECT", score: -Math.abs(negativePerWrong) };
}

// items: [{ topic, subject?, marks, selected, correct, negativePerWrong }] -> section figures with topic (and subject) breakdowns.
function summarizeObjectiveSection({ key, maxMarks, items, floorAtZero = true }) {
  let obtained = 0, correct = 0, incorrect = 0, unanswered = 0, keyMissing = 0;
  const byTopic = {}; const bySubject = {};
  const bump = (bucket, name, scored) => {
    if (!name) return;
    const b = (bucket[name] ||= { maxMarks: 0, obtained: 0, correct: 0, total: 0 });
    b.maxMarks += scored.marks; b.obtained += scored.score; b.total += 1; if (scored.outcome === "CORRECT") b.correct += 1;
  };
  for (const it of items) {
    const r = scoreMcq(it);
    if (r.outcome === "KEY_MISSING") { keyMissing += 1; continue; }
    obtained += r.score;
    if (r.outcome === "CORRECT") correct += 1; else if (r.outcome === "INCORRECT") incorrect += 1; else unanswered += 1;
    bump(byTopic, it.topic, { marks: it.marks, score: r.score, outcome: r.outcome });
    bump(bySubject, it.subject, { marks: it.marks, score: r.score, outcome: r.outcome });
  }
  if (floorAtZero) obtained = Math.max(0, obtained);
  obtained = Math.min(round2(obtained), maxMarks);
  const finish = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { ...v, obtained: round2(v.obtained), maxMarks: round2(v.maxMarks), percent: pct(v.obtained, v.maxMarks) }]));
  return {
    key, maxMarks, obtained, percent: pct(obtained, maxMarks), status: "FINAL",
    questions: items.length, correct, incorrect, unanswered, attempted: correct + incorrect, keyMissing, // keyMissing > 0 means items were excluded and need an administrator
    byTopic: finish(byTopic), bySubject: finish(bySubject),
  };
}

// ---- Section C: coding (the judge decides, never an AI opinion) -------------------------------------------------------------------------------------------------
const STUDENT_JUDGE_STATUSES = Object.freeze(["OK", "COMPILE_ERROR", "RUNTIME_ERROR", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED"]);
// problems: [{ id, maxMarks, submitted, judge: { status: "OK"|"COMPILE_ERROR"|"RUNTIME_ERROR"|"JUDGE_ERROR"|"TIMEOUT_INFRA", passed, total } }]
// Marks are proportional to hidden test cases passed. COMPILE_ERROR / RUNTIME_ERROR are the student's result (0 for the failed cases). JUDGE_ERROR (the judge itself failed)
// is not: the problem is PENDING and is judged again, so a judge outage never turns a correct solution into a wrong one.
function summarizeCodingSection({ key = "CODING", maxMarks, problems }) {
  let obtained = 0, solved = 0, attempted = 0, passed = 0, failed = 0, compileFailures = 0, runtimeFailures = 0, pending = 0;
  const perProblem = [];
  for (const p of problems) {
    if (!p.submitted) { perProblem.push({ id: p.id, maxMarks: p.maxMarks, obtained: 0, status: "NOT_ATTEMPTED" }); continue; }
    attempted += 1;
    const j = p.judge || {};
    // Only these are the STUDENT's result. Anything else (the judge failed, timed out as infrastructure, returned nothing, or "OK" without any test totals) is not.
    const studentResult = STUDENT_JUDGE_STATUSES.includes(j.status) && (j.status !== "OK" || (Number.isFinite(j.total) && j.total > 0));
    if (!studentResult) {
      pending += 1;
      perProblem.push({ id: p.id, maxMarks: p.maxMarks, obtained: null, status: "JUDGE_PENDING" });
      continue;
    }
    if (j.status === "COMPILE_ERROR") compileFailures += 1;
    if (j.status === "RUNTIME_ERROR") runtimeFailures += 1;
    const total = Math.max(0, Number.isFinite(j.total) ? j.total : 0); // a compile error may report no totals: 0 passed, nothing to count
    const ok = Math.min(Math.max(0, j.passed || 0), total);
    passed += ok; failed += total - ok;
    const score = total > 0 ? round2((p.maxMarks * ok) / total) : 0;
    obtained += score;
    if (total > 0 && ok === total) solved += 1;
    perProblem.push({ id: p.id, maxMarks: p.maxMarks, obtained: score, status: j.status === "OK" ? (ok === total ? "SOLVED" : "PARTIAL") : j.status, testsPassed: ok, testsTotal: total });
  }
  obtained = Math.min(round2(obtained), maxMarks);
  return {
    key, maxMarks, obtained: pending ? null : obtained, provisionalObtained: obtained, percent: pending ? null : pct(obtained, maxMarks),
    status: pending ? "PENDING" : "FINAL", pendingItems: pending,
    problems: problems.length, attempted, solved, testsPassed: passed, testsFailed: failed, compileFailures, runtimeFailures, perProblem,
  };
}

// ---- Section D: AI interview ----------------------------------------------------------------------------------------------------------------------------------------------
// turns: [{ id, maxMarks, answered, skipped, evaluation: { status: "DONE"|"PENDING"|"FAILED", score, confidence? } }]
// A DONE evaluation must carry a valid score (0..maxMarks); a malformed one is treated as FAILED (retry), never clamped or zeroed. A skipped question is a final 0.
// PENDING and FAILED keep the whole section PENDING: an AI outage never lowers a student's marks.
function summarizeInterviewSection({ key = "AI_INTERVIEW", maxMarks, turns }) {
  let obtained = 0, answered = 0, skipped = 0, pending = 0, failed = 0;
  const perQuestion = [];
  for (const t of turns) {
    if (t.skipped || !t.answered) { skipped += 1; perQuestion.push({ id: t.id, maxMarks: t.maxMarks, obtained: 0, status: "SKIPPED" }); continue; }
    answered += 1;
    const ev = t.evaluation || { status: "PENDING" };
    const valid = ev.status === "DONE" && typeof ev.score === "number" && Number.isFinite(ev.score) && ev.score >= 0 && ev.score <= t.maxMarks;
    if (valid) { obtained += ev.score; perQuestion.push({ id: t.id, maxMarks: t.maxMarks, obtained: round2(ev.score), status: "SCORED", confidence: ev.confidence ?? null }); continue; }
    if (ev.status === "FAILED" || ev.status === "DONE") { failed += 1; perQuestion.push({ id: t.id, maxMarks: t.maxMarks, obtained: null, status: "EVALUATION_FAILED" }); }
    else { pending += 1; perQuestion.push({ id: t.id, maxMarks: t.maxMarks, obtained: null, status: "EVALUATION_PENDING" }); }
  }
  obtained = Math.min(round2(obtained), maxMarks);
  const open = pending + failed;
  return {
    key, maxMarks, obtained: open ? null : obtained, provisionalObtained: obtained, percent: open ? null : pct(obtained, maxMarks),
    status: open ? "PENDING" : "FINAL", pendingItems: pending, failedItems: failed, questions: turns.length, answered, skipped, perQuestion,
  };
}

// ---- proctoring summary --------------------------------------------------------------------------------------------------------------------------------------------------------
// events: [{ type, category?, severity, requiresReview, reviewStatus: "PENDING"|"DISMISSED"|"CONFIRMED"|null }]
function summarizeProctoringEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const byCategory = {};
  let reviewRequiredPending = 0, reviewed = 0, confirmedViolations = 0, dismissed = 0;
  for (const e of list) {
    const cat = e.category || e.type || "UNKNOWN";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (e.reviewStatus === "CONFIRMED") { confirmedViolations += 1; reviewed += 1; }
    else if (e.reviewStatus === "DISMISSED") { dismissed += 1; reviewed += 1; }
    else if (e.requiresReview) reviewRequiredPending += 1;
  }
  return {
    total: list.length, byCategory, reviewRequiredPending, reviewed, dismissed,
    confirmedViolations, // only what a reviewer confirmed; an automatically detected event is never counted here
    reviewStatus: reviewRequiredPending > 0 ? "REVIEW_PENDING" : list.length ? "NO_OPEN_REVIEW" : "NO_EVENTS",
  };
}

// ---- the one consolidated result --------------------------------------------------------------------------------------------------------------------------------------
// sections: the four section summaries above (any order). passing: { passingMarks } or { passingPercent }. policy: { reviewRequired }.
// Status: EVALUATION_PENDING (a section is pending: figures are provisional, pass/fail undecided) -> UNDER_REVIEW (all sections final, but review is required and open)
// -> COMPLETED (final). Publishing is a separate, explicit step (canPublishResult).
function buildExamResult({ sections, totalMarks, passing, proctoring, policy = {} }) {
  const byKey = Object.fromEntries((sections || []).map((s) => [s.key, s]));
  const missing = SECTION_KEYS.filter((k) => !byKey[k]);
  if (missing.length) return { ok: false, code: "SECTIONS_MISSING", message: `The result needs all four sections; missing: ${missing.join(", ")}.` };
  const sumMax = round2(SECTION_KEYS.reduce((a, k) => a + byKey[k].maxMarks, 0));
  if (Math.abs(sumMax - totalMarks) > 0.005) return { ok: false, code: "MARKS_MISMATCH", message: `The sections add up to ${sumMax} but the examination total is ${totalMarks}.` };

  const pendingKeys = SECTION_KEYS.filter((k) => byKey[k].status !== "FINAL");
  const obtained = round2(SECTION_KEYS.reduce((a, k) => a + (byKey[k].status === "FINAL" ? byKey[k].obtained : byKey[k].provisionalObtained ?? 0), 0));
  const final = pendingKeys.length === 0;
  const percent = pct(obtained, totalMarks);

  let passed = null;
  if (final) {
    if (passing?.passingMarks !== undefined && passing?.passingMarks !== null) passed = obtained >= passing.passingMarks;
    else if (passing?.passingPercent !== undefined && passing?.passingPercent !== null) passed = percent >= passing.passingPercent;
  }

  const finalKeys = SECTION_KEYS.filter((k) => byKey[k].status === "FINAL");
  const strongest = finalKeys.length ? finalKeys.reduce((a, k) => (byKey[k].percent > byKey[a].percent ? k : a)) : null;
  const weakest = finalKeys.length > 1 ? finalKeys.reduce((a, k) => (byKey[k].percent < byKey[a].percent ? k : a)) : null;

  let status = "EVALUATION_PENDING";
  if (final) status = policy.reviewRequired && proctoring?.reviewRequiredPending > 0 ? "UNDER_REVIEW" : "COMPLETED";

  return {
    ok: true, status, final, provisional: !final, pendingSections: pendingKeys,
    totalMarks, obtained, percent, passed, // passed stays null until every section is final
    sections: SECTION_KEYS.map((k) => ({ key: k, maxMarks: byKey[k].maxMarks, obtained: byKey[k].obtained, percent: byKey[k].percent, status: byKey[k].status })),
    strongestSection: strongest, weakestSection: weakest,
  };
}

// A result may be published only when it is final and no required review is open. A provisional or pending result is never publishable, so no misleading score goes out.
function canPublishResult(result, { reviewOpen = false } = {}) {
  if (!result || !result.ok) return { ok: false, code: "NO_RESULT" };
  if (!result.final) return { ok: false, code: "EVALUATION_PENDING", message: "Some sections are still being evaluated." };
  if (result.status === "UNDER_REVIEW" || reviewOpen) return { ok: false, code: "UNDER_REVIEW", message: "Proctoring events are waiting for review." };
  if (result.status !== "COMPLETED") return { ok: false, code: "NOT_COMPLETED" };
  return { ok: true };
}

module.exports = { scoreMcq, summarizeObjectiveSection, summarizeCodingSection, summarizeInterviewSection, summarizeProctoringEvents, buildExamResult, canPublishResult, round2 };
