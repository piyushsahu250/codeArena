const prisma = require("../prisma");

// Staff-level Subject authorization — mirrors questionVisibility.js/testOwnership.js's shape
// exactly. A Staff member may use a Subject iff they created it OR an Admin has explicitly
// granted them access via StaffSubjectAssignment (spec: "Backend permission must enforce this.
// Do not rely only on frontend dropdown filtering."). ADMIN is always unrestricted (institute
// scoping is enforced separately, inline, wherever these are called).

// Set<string> of Subject IDs a STAFF requester may use, or null for ADMIN (unrestricted).
async function staffAuthorizedSubjectIds(req) {
  if (req.user?.role !== "STAFF") return null;
  const [created, assigned] = await Promise.all([
    prisma.subject.findMany({ where: { createdById: req.user.id }, select: { id: true } }),
    prisma.staffSubjectAssignment.findMany({ where: { staffId: req.user.id }, select: { subjectId: true } }),
  ]);
  return new Set([...created.map((s) => s.id), ...assigned.map((a) => a.subjectId)]);
}

// Boolean check for a single subjectId. Always true for non-STAFF roles.
async function canStaffUseSubject(req, subjectId) {
  if (req.user?.role !== "STAFF") return true;
  if (!subjectId) return false;
  const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { createdById: true } });
  if (!subject) return false;
  if (subject.createdById === req.user.id) return true;
  const assignment = await prisma.staffSubjectAssignment.findUnique({
    where: { staffId_subjectId: { staffId: req.user.id, subjectId } },
  });
  return !!assignment;
}

// Validates & authorizes a Subject/Unit/(optional)Topic combination — the spec's mandatory
// Subject+Unit requirement plus its staff-authorization requirement ("Backend permission must
// enforce this. Do not rely only on frontend dropdown filtering."), shared by Question authoring
// (routes/questions.js) and Test creation (routes/tests.js) so the rule can never drift between
// the two call sites.
async function resolveSubjectUnitTopic(req, { subjectId, unitId, topicId }) {
  if (!subjectId || !unitId) return { error: "Subject and Unit are required" };
  if (!(await canStaffUseSubject(req, subjectId))) return { error: "You aren't authorized to use this subject" };
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit || unit.subjectId !== subjectId) return { error: "That Unit does not belong to the selected Subject" };
  if (topicId) {
    const topic = await prisma.topic.findUnique({ where: { id: topicId } });
    if (!topic || topic.unitId !== unitId) return { error: "That Topic does not belong to the selected Unit" };
  }
  return { subjectId, unitId, topicId: topicId || null };
}

module.exports = { staffAuthorizedSubjectIds, canStaffUseSubject, resolveSubjectUnitTopic };
