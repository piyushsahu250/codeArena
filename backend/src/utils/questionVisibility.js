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

// Prisma where-fragment for list/search/duplicate-check routes. The third OR branch is explicit
// folder sharing (QuestionFolderShare, schema.prisma) — a STAFF requester also sees any question
// filed in a folder that's been explicitly shared with them, on top of their own + legacy rows.
// This is a plain relation filter (Question -> folder -> shares), so it needs no pre-fetched data
// and works everywhere this function is already called.
function questionVisibilityWhere(req) {
  const institute = instituteWhere(req.requesterInstituteId);
  if (req.user?.role !== "STAFF") return institute;
  return { AND: [institute, { OR: [{ createdById: null }, { createdById: req.user.id }, { folder: { shares: { some: { staffId: req.user.id } } } }] }] };
}

// Same rule as questionVisibilityWhere, but for querying QuestionFolder rows directly rather than
// Question rows filed inside a folder — QuestionFolder has its own `shares` relation (see schema),
// not a `folder.shares` path, so it can't reuse questionVisibilityWhere's fragment as-is.
function questionFolderVisibilityWhere(req) {
  const institute = instituteWhere(req.requesterInstituteId);
  if (req.user?.role !== "STAFF") return institute;
  return { AND: [institute, { OR: [{ createdById: null }, { createdById: req.user.id }, { shares: { some: { staffId: req.user.id } } }] }] };
}

// Boolean ownership check for a single already-loaded Question or QuestionFolder row. Shared-
// folder access additionally requires the row to have been fetched with the relevant relation —
// `folder: { include: { shares: { select: { staffId: true } } } }` for a Question row, or
// `shares: { select: { staffId: true } }` for a QuestionFolder row itself. A row fetched without
// that relation simply can't see shared access here (row.folder?.shares / row.shares is
// undefined) — same result as before this existed, not a new gap, just not yet wired into every
// call site of this widely-used function.
function ownsQuestionRow(req, row) {
  if (req.requesterInstituteId && row.instituteId !== req.requesterInstituteId) return false;
  if (req.user?.role !== "STAFF") return true;
  if (!row.createdById || row.createdById === req.user.id) return true;
  const shares = row.folder?.shares || row.shares;
  return Array.isArray(shares) && shares.some((s) => s.staffId === req.user.id);
}

module.exports = { instituteWhere, questionVisibilityWhere, questionFolderVisibilityWhere, ownsQuestionRow };
