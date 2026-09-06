// Concept Mastery (LMS master-spec section 21: "Track mastery for individual concepts... Show:
// Strong / Developing / Needs Practice").
//
// Scoped deliberately to what the platform actually, currently tracks: PracticeQuestion.tags
// (already populated on every CODING practice question — confirmed live, 28/28 tagged) joined
// against PracticeRunLog (one row per "Submit" click). Every other practice-question type (MCQ/
// FILL_BLANK/DEBUG/OUTPUT_PREDICTION) is graded via POST /practice/:id/check, which does not
// persist any attempt history anywhere on this platform — there is nothing to compute a concept
// score from for those types, so this intentionally only covers CODING practice. Extending it to
// non-coding types would require adding an attempt-history table for them first; not done here.
//
// A concept's mastery is: (distinct CODING practice questions under that tag this student has
// ever solved) / (distinct CODING practice questions under that tag this student has ever
// attempted). Below MIN_ATTEMPTED_FOR_RATING distinct questions attempted, the tag is reported as
// INSUFFICIENT_DATA rather than a percentage — a single lucky/unlucky attempt should not produce
// a confident-looking "100%" or "0%" (spec section 43: "Avoid fake or misleading analytics").
const MIN_ATTEMPTED_FOR_RATING = 2;

function classify(percent) {
  if (percent >= 80) return "STRONG";
  if (percent >= 50) return "DEVELOPING";
  return "NEEDS_PRACTICE";
}

async function computeConceptMastery(prisma, studentId) {
  const logs = await prisma.practiceRunLog.findMany({
    where: { studentId },
    select: { questionId: true, verdict: true },
  });
  if (logs.length === 0) return [];

  const questionIds = [...new Set(logs.map((l) => l.questionId))];
  const questions = await prisma.practiceQuestion.findMany({
    where: { id: { in: questionIds } },
    select: { id: true, tags: true },
  });
  const tagsByQuestion = new Map(questions.map((q) => [q.id, Array.isArray(q.tags) ? q.tags : []]));
  const solvedQuestionIds = new Set(logs.filter((l) => l.verdict === "ACCEPTED").map((l) => l.questionId));

  const byTag = new Map(); // tag -> { attempted: Set<questionId>, solved: Set<questionId> }
  for (const qId of questionIds) {
    for (const tag of tagsByQuestion.get(qId) || []) {
      if (!byTag.has(tag)) byTag.set(tag, { attempted: new Set(), solved: new Set() });
      byTag.get(tag).attempted.add(qId);
      if (solvedQuestionIds.has(qId)) byTag.get(tag).solved.add(qId);
    }
  }

  const result = [...byTag.entries()].map(([tag, { attempted, solved }]) => {
    const attemptedCount = attempted.size;
    const solvedCount = solved.size;
    const rated = attemptedCount >= MIN_ATTEMPTED_FOR_RATING;
    const percent = rated ? Math.round((solvedCount / attemptedCount) * 100) : null;
    return { tag, attemptedCount, solvedCount, percent, strength: rated ? classify(percent) : "INSUFFICIENT_DATA" };
  });

  // Strongest first (matches the spec's own example ordering: Variables 90%, Conditions 85%, ...,
  // OOP 20%); unrated tags (not enough attempts yet) sort last regardless of their raw percent.
  result.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
  return result;
}

// The weakest RATED concept (never INSUFFICIENT_DATA) below the "developing" bar — used by
// learningRecommendations.js for the "X is currently your weakest concept" nudge (spec section
// 23). Returns null if nothing is rated yet or nothing is below STRONG.
function weakestRatedConcept(mastery) {
  const rated = mastery.filter((m) => m.strength !== "INSUFFICIENT_DATA");
  if (rated.length === 0) return null;
  const weakest = rated[rated.length - 1]; // already sorted strongest-first
  return weakest.strength === "STRONG" ? null : weakest;
}

module.exports = { computeConceptMastery, weakestRatedConcept, MIN_ATTEMPTED_FOR_RATING };
