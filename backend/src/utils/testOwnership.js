// Staff-level Test ownership/authorization — mirrors questionVisibility.js's shape
// (questionVisibilityWhere / ownsQuestionRow) applied to Test instead of Question.
//
// Simpler than the Question version: Test.createdById is non-nullable (every test that exists
// today already has a real owner — see backend/scripts/backfillTestSubjectUnit.js's comments),
// so there's no "legacy null-creator = still shared" branch to carry here. A STAFF requester can
// access a test iff they created it OR it was explicitly shared with them via TestShare — see
// schema.prisma's TestShare model. This is layered on TOP OF, never instead of, the existing
// institute check (req.requesterInstituteId vs test.instituteId) already enforced inline in
// routes/tests.js — ADMIN authorization is untouched by this file.

// Prisma where-fragment: ANDed onto an existing institute-scoped where clause in list/search
// routes. Returns {} (no-op) for non-STAFF roles, since Admin visibility stays institute-only.
function staffTestAccessWhere(req) {
  if (req.user?.role !== "STAFF") return {};
  return { OR: [{ createdById: req.user.id }, { shares: { some: { staffId: req.user.id } } }] };
}

// Boolean check for a single already-loaded Test row (must include `shares: { select: { staffId: true } }`
// in the query that fetched it). Always true for non-STAFF roles.
function canStaffAccessTest(req, test) {
  if (req.user?.role !== "STAFF") return true;
  if (test.createdById === req.user.id) return true;
  return (test.shares || []).some((s) => s.staffId === req.user.id);
}

module.exports = { staffTestAccessWhere, canStaffAccessTest };
