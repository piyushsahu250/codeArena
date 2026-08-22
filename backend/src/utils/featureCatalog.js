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
// NOTE on "Compiler": the spec's example mentions a standalone "Compiler" feature that
// "Coding Challenge" depends on. It is deliberately NOT included as its own gateable key here —
// the only place a compiler toggle could act is the shared judge.js execution path, which also
// serves regular graded Tests and Module Coding Tests. Gating that path institute-wide risks
// stranding a student mid-scored-attempt if a feature toggle is flipped, which is a much larger
// blast radius than this feature-visibility pass is scoped to take on safely. Coding Challenge is
// gated on its own here, with no compiler dependency; see the final report for this as an
// explicit, documented scope decision rather than an oversight.
const FEATURE_CATALOG = [
  { key: "lms", label: "LMS", category: "Learning" },
  { key: "attendance", label: "Attendance", category: "Attendance" },
  { key: "question_bank", label: "Question Bank", category: "Assessment" },
  { key: "coding_challenge", label: "Coding Challenge", category: "Coding" },
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
