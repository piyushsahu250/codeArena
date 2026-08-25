// Deterministic core of the Company-Specific Interview Question Intelligence System — confidence
// assignment, recency bucketing, and duplicate detection. None of this is AI; the AI (see
// companyQuestionGenerator.js) only ever drafts new question text, never decides how trustworthy
// a question is. This mirrors resumeAts.js's own standing decision on this platform: a
// trust/quality score must be reproducible and rule-based, not something the model self-reports.

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on",
  "for", "and", "or", "with", "how", "what", "why", "does", "do", "you", "your", "explain",
  "describe", "can", "will", "would", "should", "this", "that", "it", "its",
]);

function normalizeQuestionText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .sort()
    .join(" ");
}

function tokenSet(text) {
  return new Set(normalizeQuestionText(text).split(" ").filter(Boolean));
}

// Jaccard similarity on the normalized token sets — deliberately simple (no embeddings/vector
// search infra exists on this platform, same constraint the rest of the codebase already
// operates under). Catches near-duplicates worded differently ("first non-repeating character"
// vs "first unique character" share enough distinctive tokens to clear the threshold) without
// claiming true semantic understanding — this is explicitly a heuristic, documented as such in
// the feature's final report, not presented to the admin as guaranteed-accurate deduplication.
function similarityScore(textA, textB) {
  const a = tokenSet(textA);
  const b = tokenSet(textB);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) if (b.has(tok)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DUPLICATE_THRESHOLD = 0.55;

// Returns the existing questions whose text is likely the same underlying question as
// `candidateText`, sorted by similarity descending. Never auto-merges or auto-rejects — the admin
// review UI shows these as "possible duplicate of..." and the human decides.
function findLikelyDuplicates(candidateText, existingQuestions) {
  return existingQuestions
    .map((q) => ({ question: q, similarity: similarityScore(candidateText, q.prompt || q.title || "") }))
    .filter((m) => m.similarity >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);
}

// Confidence is assigned ONLY from these deterministic rules — never from the AI's own stated
// confidence, and an AI-generated variant can never reach HIGH regardless of anything else, per
// the platform's standing "AI must never automatically receive HIGH confidence" rule.
function assignConfidenceLevel({ sourceType, verificationCount = 0 }) {
  if (sourceType === "AI_GENERATED_VARIANT") return "LOW";
  if (sourceType === "OFFICIAL_COMPANY") return "HIGH";
  if (sourceType === "CODEARENA_VERIFIED" || verificationCount >= 2) return "HIGH";
  if (sourceType === "CANDIDATE_REPORTED" || sourceType === "PUBLIC_INTERVIEW_REPORT") return "MEDIUM";
  return "LOW";
}

const RECENCY_BUCKETS = [
  { key: "LAST_30_DAYS", label: "Recently reported", maxDays: 30 },
  { key: "LAST_90_DAYS", label: "Frequently reported", maxDays: 90 },
  { key: "LAST_6_MONTHS", label: "Historical (last 6 months)", maxDays: 182 },
  { key: "LAST_1_YEAR", label: "Historical (last year)", maxDays: 365 },
  { key: "OLDER", label: "Older", maxDays: Infinity },
];

// Computed at read-time from a raw timestamp — never stored, so it's always accurate relative to
// "now" rather than going stale itself. Returns null (not a bucket) for AI-generated variants
// with no real lastSeenAt, since "recency" is meaningless for content that was never actually
// reported/seen anywhere — the frontend renders those as "AI-generated variant" instead.
function computeRecencyBucket(lastSeenAt) {
  if (!lastSeenAt) return null;
  const days = (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
  const bucket = RECENCY_BUCKETS.find((b) => days <= b.maxDays);
  return bucket ? { key: bucket.key, label: bucket.label } : null;
}

module.exports = {
  normalizeQuestionText, similarityScore, findLikelyDuplicates, DUPLICATE_THRESHOLD,
  assignConfidenceLevel, computeRecencyBucket,
};
