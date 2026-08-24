const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { instituteWhere } = require("../utils/questionVisibility");
const { staffAuthorizedSubjectIds, canStaffUseSubject } = require("../utils/subjectAccess");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();

// Only the creator (STAFF) or any ADMIN may edit/delete a Subject/Unit — distinct from
// canStaffUseSubject, which governs who may merely USE a subject (author questions/tests under
// it). A staff member explicitly granted access via StaffSubjectAssignment can use the subject
// but not rename/delete it — that stays with the creator or an Admin.
function canManageSubject(req, subject) {
  if (req.user.role !== "STAFF") return true;
  return subject.createdById === req.user.id;
}

// =========================== Subjects ===========================

// Institute-scoped list with unit/question counts, powering both the Question Bank dashboard's
// primary Subject -> Unit tree (spec section 5) and SubjectUnitPicker's dropdown. STAFF sees only
// subjects they're authorized for — an unauthorized subject is never sent to the client, let
// alone selectable (spec section 10: "Backend permission must enforce this. Do not rely only on
// frontend dropdown filtering.").
router.get("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const where = { ...instituteWhere(req.requesterInstituteId) };
    if (req.user.role === "STAFF") {
      const allowed = await staffAuthorizedSubjectIds(req);
      where.id = { in: [...allowed] };
    }
    const subjects = await prisma.subject.findMany({
      where,
      include: {
        units: {
          include: { _count: { select: { questions: true, topics: true } } },
          orderBy: [{ order: "asc" }, { name: "asc" }],
        },
        _count: { select: { questions: true, tests: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json(subjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load subjects" });
  }
});

router.post("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Subject name is required" });
  const code = req.body.code ? String(req.body.code).trim() : null;
  try {
    // Own creation is always usable immediately (see subjectAccess.js's canStaffUseSubject) —
    // no StaffSubjectAssignment row needed for the creator, only for OTHER staff granted access.
    const subject = await prisma.subject.create({
      data: { name, code, instituteId: req.requesterInstituteId, createdById: req.user.id },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_BANK_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { type: "subject_created", subjectId: subject.id, name },
    });
    res.json(subject);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A subject with this name already exists" });
    console.error(err);
    res.status(500).json({ error: "Failed to create subject" });
  }
});

router.patch("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
    return res.status(404).json({ error: "Subject not found" });
  }
  if (!canManageSubject(req, subject)) return res.status(403).json({ error: "Only the creator or an Admin can edit this subject" });
  const data = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: "Subject name is required" });
    data.name = name;
  }
  if (req.body.code !== undefined) data.code = req.body.code ? String(req.body.code).trim() : null;
  try {
    const updated = await prisma.subject.update({ where: { id: subject.id }, data });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_BANK_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { type: "subject_updated", subjectId: subject.id },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A subject with this name already exists" });
    console.error(err);
    res.status(500).json({ error: "Failed to update subject" });
  }
});

router.delete("/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
    return res.status(404).json({ error: "Subject not found" });
  }
  if (!canManageSubject(req, subject)) return res.status(403).json({ error: "Only the creator or an Admin can delete this subject" });
  // Mirrors QuestionFolder's "must be empty" delete convention — a Subject with content still
  // classified under it can't be silently orphaned; the admin/staff must reassign or remove that
  // content first. Question.subjectId/unitId cascade to SetNull (not delete) on Subject deletion
  // at the DB level, so this check is a UX safeguard, not a data-integrity requirement.
  const [questionCount, testCount] = await Promise.all([
    prisma.question.count({ where: { subjectId: subject.id } }),
    prisma.test.count({ where: { subjectId: subject.id } }),
  ]);
  if (questionCount > 0 || testCount > 0) {
    return res.status(409).json({
      error: `Cannot delete — ${questionCount} question(s) and ${testCount} test(s) are still classified under this subject. Reassign or remove them first.`,
    });
  }
  try {
    await prisma.subject.delete({ where: { id: subject.id } });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_BANK_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { type: "subject_deleted", subjectId: subject.id, name: subject.name },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete subject" });
  }
});

// =========================== Units ===========================

router.get("/:id/units", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  if (!(await canStaffUseSubject(req, subject.id))) {
    return res.status(403).json({ error: "You aren't authorized for this subject" });
  }
  const units = await prisma.unit.findMany({
    where: { subjectId: subject.id },
    include: { _count: { select: { questions: true, topics: true } } },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  res.json(units);
});

router.post("/:id/units", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  // Explicit institute compare, on top of canStaffUseSubject's creator/assignment check below —
  // matches the direct-compare convention used everywhere else authorization is enforced on this
  // platform (readiness.js, questions.js, tests.js), rather than relying solely on the indirect
  // guarantee that a cross-institute staff member would never legitimately hold a
  // StaffSubjectAssignment for this subject in the first place.
  if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
    return res.status(403).json({ error: "You aren't authorized for this subject" });
  }
  if (!(await canStaffUseSubject(req, subject.id))) return res.status(403).json({ error: "You aren't authorized for this subject" });
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Unit name is required" });

  // Case-insensitive pre-check — the DB's @@unique([subjectId, name]) constraint below is
  // case-sensitive, so without this "Unit 1" and "unit 1" could both be created for the same
  // Subject. Checked before insert so the error message is clean ("Unit 1 already exists for
  // DSA") rather than the P2002 fallback further down (kept as a safety net for a race between
  // two concurrent creates, not the primary path).
  const existing = await prisma.unit.findFirst({ where: { subjectId: subject.id, name: { equals: name, mode: "insensitive" } } });
  if (existing) return res.status(409).json({ error: `"${name}" already exists for ${subject.name}.` });

  // order defaults to a leading number parsed from the name ("Unit 3" -> 3) so units display in
  // the order staff actually intend (numeric, not alphabetical: "Unit 2" before "Unit 10") without
  // requiring staff to manually set an order field. Falls back to appending after the current
  // highest unit for this subject when the name has no leading number.
  let order = Number(req.body.order) || 0;
  if (!order) {
    const leadingNumber = name.match(/\d+/);
    if (leadingNumber) {
      order = Number(leadingNumber[0]);
    } else {
      const maxOrder = await prisma.unit.aggregate({ where: { subjectId: subject.id }, _max: { order: true } });
      order = (maxOrder._max.order || 0) + 1;
    }
  }

  try {
    const unit = await prisma.unit.create({
      data: { subjectId: subject.id, name, order },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.QUESTION_BANK_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { type: "unit_created", subjectId: subject.id, unitId: unit.id, name },
    });
    res.json(unit);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: `"${name}" already exists for ${subject.name}.` });
    console.error(err);
    res.status(500).json({ error: "Failed to create unit" });
  }
});

router.patch("/units/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const unit = await prisma.unit.findUnique({ where: { id: req.params.id }, include: { subject: true } });
  if (!unit) return res.status(404).json({ error: "Unit not found" });
  if (!(await canStaffUseSubject(req, unit.subjectId))) return res.status(403).json({ error: "You aren't authorized for this subject" });
  const data = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: "Unit name is required" });
    data.name = name;
  }
  if (req.body.order !== undefined) data.order = Number(req.body.order) || 0;
  try {
    const updated = await prisma.unit.update({ where: { id: unit.id }, data });
    res.json(updated);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A unit with this name already exists under this subject" });
    console.error(err);
    res.status(500).json({ error: "Failed to update unit" });
  }
});

router.delete("/units/:id", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const unit = await prisma.unit.findUnique({ where: { id: req.params.id } });
  if (!unit) return res.status(404).json({ error: "Unit not found" });
  if (!(await canStaffUseSubject(req, unit.subjectId))) return res.status(403).json({ error: "You aren't authorized for this subject" });
  const questionCount = await prisma.question.count({ where: { unitId: unit.id } });
  if (questionCount > 0) {
    return res.status(409).json({ error: `Cannot delete — ${questionCount} question(s) are still classified under this unit. Reassign or remove them first.` });
  }
  await prisma.unit.delete({ where: { id: unit.id } });
  res.json({ success: true });
});

// =========================== Topics ===========================
// Deliberately lightweight — no separate authorization layer beyond the parent Subject (see
// schema.prisma's Topic model comment). Create-if-not-exists (case-insensitive) so authoring a
// question with a new topic name never requires a separate "create topic first" step.

router.get("/units/:id/topics", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const unit = await prisma.unit.findUnique({ where: { id: req.params.id } });
  if (!unit) return res.status(404).json({ error: "Unit not found" });
  if (!(await canStaffUseSubject(req, unit.subjectId))) return res.status(403).json({ error: "You aren't authorized for this subject" });
  const topics = await prisma.topic.findMany({ where: { unitId: unit.id }, orderBy: { name: "asc" } });
  res.json(topics);
});

router.post("/units/:id/topics", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const unit = await prisma.unit.findUnique({ where: { id: req.params.id } });
  if (!unit) return res.status(404).json({ error: "Unit not found" });
  if (!(await canStaffUseSubject(req, unit.subjectId))) return res.status(403).json({ error: "You aren't authorized for this subject" });
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Topic name is required" });
  const existing = await prisma.topic.findFirst({ where: { unitId: unit.id, name: { equals: name, mode: "insensitive" } } });
  if (existing) return res.json(existing);
  const topic = await prisma.topic.create({ data: { unitId: unit.id, name } });
  res.json(topic);
});

// =========================== Staff authorization (ADMIN only) ===========================

router.get("/:id/assignments", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
    return res.status(404).json({ error: "Subject not found" });
  }
  const assignments = await prisma.staffSubjectAssignment.findMany({
    where: { subjectId: subject.id },
    include: { staff: { select: { id: true, name: true, email: true } } },
    orderBy: { assignedAt: "desc" },
  });
  res.json(assignments);
});

router.post("/:id/assignments", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
    return res.status(404).json({ error: "Subject not found" });
  }
  const staffId = req.body.staffId;
  if (!staffId) return res.status(400).json({ error: "A staff member is required" });
  const staff = await prisma.user.findUnique({ where: { id: staffId } });
  if (!staff || staff.role !== "STAFF") return res.status(400).json({ error: "That user isn't a Staff member" });
  try {
    const assignment = await prisma.staffSubjectAssignment.create({
      data: { staffId, subjectId: subject.id, assignedById: req.user.id },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.STAFF_SUBJECT_ASSIGNMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { type: "granted", subjectId: subject.id, subjectName: subject.name, staffId, staffName: staff.name },
    });
    res.json(assignment);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "That staff member already has access to this subject" });
    console.error(err);
    res.status(500).json({ error: "Failed to grant subject access" });
  }
});

router.delete("/:id/assignments/:staffId", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const subject = await prisma.subject.findUnique({ where: { id: req.params.id } });
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  if (req.requesterInstituteId && subject.instituteId && subject.instituteId !== req.requesterInstituteId) {
    return res.status(404).json({ error: "Subject not found" });
  }
  const staff = await prisma.user.findUnique({ where: { id: req.params.staffId } });
  await prisma.staffSubjectAssignment.deleteMany({ where: { subjectId: subject.id, staffId: req.params.staffId } });
  await logAudit({
    req, action: AUDIT_ACTIONS.STAFF_SUBJECT_ASSIGNMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
    instituteId: req.requesterInstituteId, details: { type: "revoked", subjectId: subject.id, subjectName: subject.name, staffId: req.params.staffId, staffName: staff?.name },
  });
  res.json({ success: true });
});

module.exports = router;
