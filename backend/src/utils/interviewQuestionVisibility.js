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

// READ access to a single row (analytics etc.): a row owned by another institute is hidden; shared/legacy rows (no instituteId) are
// readable by everyone, as in the list.
function canSeeInterviewQuestionRow(req, row) {
  if (req.requesterInstituteId && row.instituteId && row.instituteId !== req.requesterInstituteId) return false;
  if (req.user?.role !== "STAFF") return true;
  return !row.createdById || row.createdById === req.user.id;
}

// WRITE access (edit / delete) -- audit item T-3b. A row with no instituteId is a shared/legacy (platform-owned) question: only a
// platform-level account (no instituteId) may change or delete it, because every institute's students see it. An institute-bound
// caller may change only rows owned by their own institute, and a STAFF member only rows they created (or that have no recorded creator).
function ownsInterviewQuestionRow(req, row) {
  if (!req.requesterInstituteId) return true;
  if (!row.instituteId || row.instituteId !== req.requesterInstituteId) return false;
  if (req.user?.role !== "STAFF") return true;
  return !row.createdById || row.createdById === req.user.id;
}

module.exports = { instituteWhere, interviewQuestionVisibilityWhere, ownsInterviewQuestionRow, canSeeInterviewQuestionRow };
