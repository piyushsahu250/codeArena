// InterviewQuestion visibility/ownership logic — mirrors questionVisibility.js's convention for
// the main Question Bank (see docs/KNOWN_ISSUES.md KI-001). instituteId/createdById are nullable
// columns added after this table already had rows in production; null on either column means
// "legacy/shared," visible to every institute and every staff member, exactly like Question.
function instituteWhere(requesterInstituteId) {
  return requesterInstituteId ? { OR: [{ instituteId: requesterInstituteId }, { instituteId: null }] } : {};
}

// Prisma where-fragment for list/search routes (GET /admin/questions). No folder-sharing analog
// exists for InterviewQuestion (unlike Question/QuestionFolderShare), so a STAFF requester's
// creator-level restriction is just "own rows + legacy rows with no recorded creator."
function interviewQuestionVisibilityWhere(req) {
  const institute = instituteWhere(req.requesterInstituteId);
  if (req.user?.role !== "STAFF") return institute;
  return { AND: [institute, { OR: [{ createdById: null }, { createdById: req.user.id }] }] };
}

// Boolean ownership check for a single already-loaded InterviewQuestion row (PATCH/DELETE).
function ownsInterviewQuestionRow(req, row) {
  if (req.requesterInstituteId && row.instituteId && row.instituteId !== req.requesterInstituteId) return false;
  if (req.user?.role !== "STAFF") return true;
  return !row.createdById || row.createdById === req.user.id;
}

module.exports = { instituteWhere, interviewQuestionVisibilityWhere, ownsInterviewQuestionRow };
