// Static catalog of togglable platform features — kept in code (not a DB table) since the set of
// features is a code-level concept (new features ship with new routes/UI, not through an admin
// form), while per-institute *state* for each key lives in the FeatureSetting table. Adding a
// feature here just means new institutes/existing institutes without an explicit row default to
// `enabled: true` for it (see featureAccess.js) — no migration needed to introduce a new key.
//
// `key` must stay a stable internal identifier (never rename once shipped — it's the DB value in
// FeatureSetting.featureKey and any historical AuditLog.details). `dependsOn` is enforced one level
// deep by featureAccess.js/routes/features.js (Section 23 of the spec: disabling a dependency warns
// the admin and the dependent feature is treated as unavailable even if its own row says enabled).
// NOTE on "Compiler": added as its own gateable key, but scoped deliberately narrowly. The shared
// judge.js execution path also serves regular graded Tests (submissions.js) -- that surface is
// NEVER gated by this flag, at any point, to guarantee an admin toggle can never interrupt a
// student mid-scored-attempt. Everywhere this flag IS enforced, it only gates the creation of a
// brand-new attempt/session (Module Coding Test's start route) or an ad-hoc, no-fixed-session
// action (Practice, Daily/Weekly Challenge run/submit) -- never a call operating on an
// already-existing attemptId. That is what makes "disable for new sessions, existing sessions
// continue" true by construction rather than by a separate session-status flag: an attempt that
// already exists was, by definition, started before any such gate could apply to it again.
const FEATURE_CATALOG = [
  { key: "lms", label: "LMS", category: "Learning" },
  { key: "attendance", label: "Attendance", category: "Attendance" },
  { key: "question_bank", label: "Question Bank", category: "Assessment" },
  { key: "compiler", label: "Compiler", category: "Coding" },
  { key: "coding_challenge", label: "Coding Challenge", category: "Coding", dependsOn: "compiler" },
  { key: "talent_pool", label: "Talent Pool", category: "Assessment" },
  { key: "readiness_test", label: "Readiness Test", category: "Assessment" },
  { key: "ai_mock_interview", label: "AI Mock Interview", category: "AI" },
  { key: "ai_draftview", label: "AI DraftView", category: "AI", dependsOn: "ai_mock_interview" },
  { key: "certificates", label: "Certificates", category: "Certificates" },
  { key: "export_center", label: "Export Center", category: "Reports" },
];

const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);
const FEATURE_KEY_SET = new Set(FEATURE_KEYS);
const CATEGORIES = [...new Set(FEATURE_CATALOG.map((f) => f.category))];

function isValidFeatureKey(key) {
  return FEATURE_KEY_SET.has(key);
}

module.exports = { FEATURE_CATALOG, FEATURE_KEYS, CATEGORIES, isValidFeatureKey };
