// Section-wise examination: the analysis part of the consolidated report. Pure functions, unit-tested in test/examReport.test.js.
// Everything here is derived from the section summaries and evaluations that were actually stored. Nothing is estimated or invented: a section that is pending or failed produces
// a "pending" note, never a finding, and a topic is only called weak or strong when the student actually answered questions in it.
const STRONG_AT = 70;
const WEAK_BELOW = 50;

const label = (s) => String(s || "").replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// byTopic: { name: { maxMarks, obtained, correct, total, percent } } -> strengths and weaknesses, most extreme first.
function topicInsights(byTopic, { minItems = 1 } = {}) {
  const entries = Object.entries(byTopic || {}).filter(([, v]) => v && v.total >= minItems && v.maxMarks > 0);
  const strengths = entries.filter(([, v]) => v.percent >= STRONG_AT).sort((a, b) => b[1].percent - a[1].percent).map(([name, v]) => ({ name, percent: v.percent, correct: v.correct, total: v.total }));
  const weaknesses = entries.filter(([, v]) => v.percent < WEAK_BELOW).sort((a, b) => a[1].percent - b[1].percent).map(([name, v]) => ({ name, percent: v.percent, correct: v.correct, total: v.total }));
  return { strengths, weaknesses };
}

// Averages the rubric dimensions over the interview answers that were evaluated (AI evaluations carry `dimensions`; rule-based ones carry a `breakdown`).
function aggregateInterviewDimensions(evaluations) {
  const sums = {}; const counts = {};
  for (const ev of evaluations || []) {
    if (!ev || ev.status !== "DONE") continue;
    const dims = ev.dimensions || ev.breakdown;
    if (!dims || typeof dims !== "object") continue;
    for (const [k, v] of Object.entries(dims)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      sums[k] = (sums[k] || 0) + v; counts[k] = (counts[k] || 0) + 1;
    }
  }
  const out = {};
  for (const k of Object.keys(sums)) out[k] = Math.round((sums[k] / counts[k]) * 10) / 10;
  return out;
}

function interviewInsights(dimensions) {
  const entries = Object.entries(dimensions || {});
  return {
    strengths: entries.filter(([, v]) => v >= STRONG_AT).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
    weaknesses: entries.filter(([, v]) => v < WEAK_BELOW).sort((a, b) => a[1] - b[1]).map(([name, value]) => ({ name, value })),
  };
}

// sections: the four stored section summaries (by key). interviewDimensions: from aggregateInterviewDimensions. Returns recommendations tied to the specific evidence.
function buildRecommendations({ sections, interviewDimensions }) {
  const recs = [];
  const by = Object.fromEntries((sections || []).map((s) => [s.key, s]));
  for (const key of ["APTITUDE", "TECHNICAL"]) {
    const s = by[key];
    if (!s || s.status !== "FINAL" || s.notReached) continue;
    const { weaknesses } = topicInsights(key === "TECHNICAL" && s.bySubject && Object.keys(s.bySubject).length ? s.bySubject : s.byTopic);
    for (const w of weaknesses.slice(0, 3)) recs.push({ section: key, area: w.name, reason: `${w.correct} of ${w.total} correct (${w.percent}%) in ${label(w.name)}.`, action: `Practise ${label(w.name)} questions.` });
    if (s.unanswered > 0 && s.questions > 0 && s.unanswered / s.questions >= 0.25) recs.push({ section: key, area: "Time management", reason: `${s.unanswered} of ${s.questions} questions were left unanswered.`, action: "Practise answering within the time limit." });
  }
  const c = by.CODING;
  if (c && c.status === "FINAL" && !c.notReached) {
    const unsolved = (c.perProblem || []).filter((p) => p.status !== "SOLVED" && p.status !== "NOT_ATTEMPTED");
    for (const p of unsolved.slice(0, 3)) recs.push({ section: "CODING", area: `Problem ${p.id}`, reason: p.testsTotal ? `${p.testsPassed} of ${p.testsTotal} test cases passed.` : `The submission ended with ${label(p.status)}.`, action: "Review the failing cases and resubmit in practice." });
    if (c.compileFailures > 0) recs.push({ section: "CODING", area: "Compilation", reason: `${c.compileFailures} submission(s) did not compile.`, action: "Practise the syntax of your chosen language." });
    if (c.attempted < c.problems) recs.push({ section: "CODING", area: "Coverage", reason: `${c.problems - c.attempted} of ${c.problems} problems were not attempted.`, action: "Practise starting every problem, even with a partial solution." });
  }
  const d = by.AI_INTERVIEW;
  if (d && d.status === "FINAL" && !d.notReached) {
    const { weaknesses } = interviewInsights(interviewDimensions);
    for (const w of weaknesses.slice(0, 3)) recs.push({ section: "AI_INTERVIEW", area: label(w.name), reason: `Average ${w.value} out of 100 across the evaluated answers.`, action: `Practise improving ${label(w.name).toLowerCase()} in mock interviews.` });
    if (d.skipped > 0) recs.push({ section: "AI_INTERVIEW", area: "Completeness", reason: `${d.skipped} of ${d.questions} questions were not answered.`, action: "Practise giving a complete answer to every interview question." });
  }
  return recs;
}

// Lists what could not be evaluated yet, so the report says so instead of showing a number.
function pendingIndicators(sections) {
  const out = [];
  for (const s of sections || []) {
    if (s.status === "FINAL") continue;
    if (s.key === "CODING") out.push({ section: s.key, kind: "JUDGE_PENDING", count: s.pendingItems || 0, message: `${s.pendingItems || 0} coding submission(s) are waiting for the code judge. Your code is saved.` });
    else if (s.key === "AI_INTERVIEW") {
      if (s.pendingItems) out.push({ section: s.key, kind: "EVALUATION_PENDING", count: s.pendingItems, message: `${s.pendingItems} interview answer(s) are waiting to be evaluated. Your answers are saved.` });
      if (s.failedItems) out.push({ section: s.key, kind: "EVALUATION_FAILED", count: s.failedItems, message: `${s.failedItems} interview answer(s) could not be evaluated yet. Your answers are saved and the evaluation can be retried.` });
    } else out.push({ section: s.key, kind: "PENDING", count: 1, message: "This section is not final yet." });
  }
  return out;
}

module.exports = { STRONG_AT, WEAK_BELOW, topicInsights, aggregateInterviewDimensions, interviewInsights, buildRecommendations, pendingIndicators };
