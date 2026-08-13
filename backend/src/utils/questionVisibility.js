// Shared Question Bank visibility/ownership logic, used by both routes/questions.js and
// routes/exports.js so the two never drift apart on what "can this requester see/touch this row"
// means.
//
// Institute-level (unchanged from the original questions.js convention): a null
// req.requesterInstituteId (the platform-level Super Admin) sees every institute's questions/
// folders unfiltered. An institute-scoped requester sees their own institute's rows PLUS legacy/
// shared rows (instituteId: null) — see the schema comment on Question.instituteId /
// QuestionFolder.instituteId for why nulls stay visible rather than becoming invisible to
// everyone but the Super Admin.
//
// Creator-level (new): on top of the institute boundary, a STAFF requester (never ADMIN — an
// institute-scoped Admin keeps full visibility across their whole institute's Question Bank, per
// spec) is further restricted to rows they created themselves, PLUS legacy rows with no recorded
// creator (createdById: null) — the exact same "null = still shared" convention as the institute
// check above, just applied to a second column, so content that predates per-creator tracking (or
// predates a staff member's own account) doesn't vanish for everyone the moment this ships.
function instituteWhere(requesterInstituteId) {
  return requesterInstituteId ? { OR: [{ instituteId: requesterInstituteId }, { instituteId: null }] } : {};
}

// Prisma where-fragment for list/search/duplicate-check routes.
function questionVisibilityWhere(req) {
  const institute = instituteWhere(req.requesterInstituteId);
  if (req.user?.role !== "STAFF") return institute;
  return { AND: [institute, { OR: [{ createdById: null }, { createdById: req.user.id }] }] };
}

// Boolean ownership check for a single already-loaded Question or QuestionFolder row (both share
// the same instituteId/createdById column shape, so this works for either model).
function ownsQuestionRow(req, row) {
  if (req.requesterInstituteId && row.instituteId !== req.requesterInstituteId) return false;
  if (req.user?.role === "STAFF" && row.createdById && row.createdById !== req.user.id) return false;
  return true;
}

module.exports = { instituteWhere, questionVisibilityWhere, ownsQuestionRow };
