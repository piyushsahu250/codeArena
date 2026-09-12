// Pure semantic-similarity check (spec §35: "Prevent same question, same concept repeatedly,
// semantically identical questions"). Deliberately a lightweight token-overlap heuristic, not an
// embedding-model call — a real embedding/vector-similarity check would be a genuine improvement,
// but adds a second AI call (cost + latency) on every single generated question; this catches the
// common case (the LLM proposing a near-restatement of something already asked) as a defensive
// backstop AFTER the prompt already instructs the model not to repeat itself, not as the only line
// of defense.
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2); // drop short stopword-ish tokens ("is","a","of"...)
}

function jaccardSimilarity(a, b) {
  const setA = new Set(normalize(a));
  const setB = new Set(normalize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) if (setB.has(tok)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// >=0.6 token-overlap is treated as "the same question again" — high enough that two genuinely
// different questions on the same topic (which necessarily share domain vocabulary, e.g. two
// distinct questions both mentioning "polymorphism" and "Java") don't false-positive, but a
// near-verbatim restatement does.
const SIMILARITY_THRESHOLD = 0.6;

function isDuplicateQuestion(newText, previousTexts) {
  return (previousTexts || []).some((prev) => jaccardSimilarity(newText, prev) >= SIMILARITY_THRESHOLD);
}

module.exports = { isDuplicateQuestion, jaccardSimilarity, SIMILARITY_THRESHOLD };
