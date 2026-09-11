// Deterministic, zero-AI-cost near-duplicate text detection — used by aiQuestions.js's duplicate
// check to catch "same question, reworded" the way an exact-text match (Question.description
// case-insensitive equality, still the first and cheapest check) never can. Confirmed live
// (2026-09-11): a real batch generated two Easy MCQs both titled "Java File Extension" whose
// actual question wording differed just enough that the exact match missed the second one
// entirely — this closes exactly that gap.
//
// Deliberately NOT an AI call: spec section 45's "avoid unnecessary AI API calls, deterministic
// validation first" applies squarely here — word-overlap similarity is cheap, has no external
// dependency, and catches the actual observed failure mode (reworded, not paraphrased-beyond-
// recognition) without spending a generation's already-doubled AI budget on a second-guess call
// for every single candidate in scope.
"use strict";

// Words common enough in ordinary English/CS-question phrasing that they inflate similarity
// between two genuinely different questions without saying anything about content. Deliberately
// small and conservative -- this only needs to strip noise, not build a real NLP pipeline.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "at", "by", "for", "with", "as", "from", "into",
  "and", "or", "but", "if", "then", "than", "so", "not", "no",
  "this", "that", "these", "those", "it", "its", "which", "what", "who", "whom",
  "how", "when", "where", "why", "does", "do", "did", "can", "will", "would", "should",
  "following", "given", "consider", "assume", "suppose", "you", "your", "we", "one",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Jaccard similarity over token SETS (not multisets) — order-independent by design, since "same
// question with reordered wording" is exactly what spec section 23 asks to catch. Returns 0-1;
// 0 when either side has no meaningful tokens at all (never divides by zero, never a false 1.0
// "everything is a duplicate of nothing").
function jaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DEFAULT_THRESHOLD = 0.6;

// Two independent signals, either one sufficient: an exact (case/whitespace-insensitive) TITLE
// match is treated as conclusive on its own even if the body wording differs a lot (a real author
// -- human or AI -- essentially never reuses the exact same title for a genuinely different
// question); otherwise falls back to body-text Jaccard similarity crossing the threshold. Returns
// { isMatch, similarity, reason } rather than a bare boolean, so the caller can show staff exactly
// why something was flagged instead of an unexplained warning.
function checkNearDuplicate(a, b, { threshold = DEFAULT_THRESHOLD } = {}) {
  const titleA = String(a.title || "").trim().toLowerCase();
  const titleB = String(b.title || "").trim().toLowerCase();
  if (titleA && titleB && titleA === titleB) {
    return { isMatch: true, similarity: 1, reason: "identical title" };
  }
  const similarity = jaccardSimilarity(a.description, b.description);
  return { isMatch: similarity >= threshold, similarity, reason: similarity >= threshold ? `${Math.round(similarity * 100)}% word overlap` : null };
}

module.exports = { tokenize, jaccardSimilarity, checkNearDuplicate, DEFAULT_THRESHOLD };
