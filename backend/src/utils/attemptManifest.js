// Single source of truth for "which questions does this attempt consist of" and "what is it scored out of".
//
// An attempt's manifest is TestAttempt.questionOrder (the question ids drawn for that student, locked at start; see tests.js POST /:id/start). Everything that
// reports a total for an attempt -- results, exports, dashboards, rankings -- must derive it from here, never from the number of answers received, the number of
// questions that happened to render, or the test's CURRENT question list (which an admin may edit after students have started, and which in RANDOM mode holds the
// whole bank rather than one student's draw).
//
// Distinct counts, never to be mixed up:
//   configured  what the test is set to give a student           (FIXED: test.questions.length, RANDOM: randomQuestionsPerStudent)
//   expected    what this attempt was assigned (manifest length)  <- the denominator for "out of N questions"
//   delivered   what the server actually sent to the student's browser
//   answered    questions with a saved answer
//   evaluated   questions that have a scored outcome
const prisma = require("../prisma");

const MANIFEST_VERSION = 1;

function configuredCount(test) {
  return test.questionSelectionMode === "RANDOM" && test.randomQuestionsPerStudent ? Number(test.randomQuestionsPerStudent) : (test.questions || []).length;
}

// Checked before an attempt is created. `test.questions` is the test's question list (each with questionId); `questionOrder` is the drawn id list.
// Never "fixes" anything: a bad configuration is reported so someone authorised can correct it, instead of silently starting a shorter assessment.
function validateManifest(test, questionOrder) {
  const configured = configuredCount(test);
  const available = (test.questions || []).length;
  const errors = [];
  if (!Array.isArray(questionOrder) || questionOrder.length === 0) errors.push("EMPTY");
  else {
    if (new Set(questionOrder).size !== questionOrder.length) errors.push("DUPLICATE_IDS");
    const pool = new Set((test.questions || []).map((tq) => tq.questionId));
    if (questionOrder.some((id) => !pool.has(id))) errors.push("NOT_IN_TEST");
    if (questionOrder.length !== configured) errors.push("COUNT_MISMATCH");
  }
  let message = null;
  if (errors.length) {
    message = errors.includes("COUNT_MISMATCH") && test.questionSelectionMode === "RANDOM"
      ? `This assessment is set to give each student ${configured} questions, but only ${available} valid questions are available. Please ask your faculty to correct the assessment before you start.`
      : "This assessment's question set is not valid right now. Please ask your faculty to check the assessment before you start.";
  }
  return { ok: errors.length === 0, errors, message, configuredCount: configured, availableCount: available, deliveredCount: Array.isArray(questionOrder) ? questionOrder.length : 0 };
}

const hasManifest = (attempt) => Array.isArray(attempt?.questionOrder) && attempt.questionOrder.length > 0;

// Points per question id, read from the Question table so that a question later removed from the test still counts for the attempts that were given it.
async function loadPoints(client, ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await client.question.findMany({ where: { id: { in: unique } }, select: { id: true, points: true } });
  return new Map(rows.map((q) => [q.id, q.points || 0]));
}

// Batch: for attempts shaped { id, testId, questionOrder }, returns Map(attemptId -> { expectedCount, maxScore, source, missingQuestionCount }).
// Attempts that predate manifests (no questionOrder) fall back to the test's question list and are marked source "LEGACY_TEST_CONFIG".
async function scoreBases(client, attempts) {
  const legacyTestIds = [...new Set(attempts.filter((a) => !hasManifest(a)).map((a) => a.testId))];
  const legacyByTest = new Map();
  if (legacyTestIds.length) {
    const tests = await client.test.findMany({ where: { id: { in: legacyTestIds } }, select: { id: true, questions: { select: { questionId: true } } } });
    for (const t of tests) legacyByTest.set(t.id, t.questions.map((q) => q.questionId));
  }
  const idsOf = (a) => (hasManifest(a) ? a.questionOrder : legacyByTest.get(a.testId) || []);
  const points = await loadPoints(client, attempts.flatMap(idsOf));
  const out = new Map();
  for (const a of attempts) {
    const ids = idsOf(a);
    out.set(a.id, {
      expectedCount: ids.length,
      maxScore: ids.reduce((s, id) => s + (points.get(id) || 0), 0),
      source: hasManifest(a) ? "MANIFEST" : "LEGACY_TEST_CONFIG",
      missingQuestionCount: ids.filter((id) => !points.has(id)).length,
    });
  }
  return out;
}

async function scoreBase(client, attempt) {
  return (await scoreBases(client, [attempt])).get(attempt.id);
}

// Structured, greppable record of any disagreement between the counts for one attempt. Returns true when they all agree.
function logCountMismatch(context, { attemptId, testId, expected, manifest, delivered }) {
  if (expected === manifest && manifest === delivered) return true;
  console.error(JSON.stringify({ event: "assessment_count_mismatch", context, attemptId, testId, expected, manifest, delivered, at: new Date().toISOString() }));
  return false;
}

module.exports = { MANIFEST_VERSION, configuredCount, validateManifest, hasManifest, loadPoints, scoreBases, scoreBase, logCountMismatch };
