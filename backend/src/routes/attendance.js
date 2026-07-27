const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { sendExport } = require("../utils/exportFile");
const { generateAttendancePdf } = require("../utils/attendancePdf");
const { testEligibilityWhere } = require("../utils/testEligibility");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const LECTURE_TYPES = ["REGULAR", "PRACTICE_TEST", "EXAM"];
const LECTURE_TYPE_LABELS = { REGULAR: "Regular Class", PRACTICE_TEST: "Practice Test", EXAM: "Exam" };

// AttendanceRecord.status stays a plain validated string (not a Prisma enum) — converting an
// already-populated column's type is exactly the kind of schema change that broke two deploys
// earlier this session; app-layer validation carries zero migration risk.
const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "LEAVE"];

// LEAVE is excluded from the denominator (an approved leave neither helps nor hurts the
// percentage); LATE counts toward presence (the student was there, just tardy).
function computeAttendancePercent(counts) {
  const present = counts.PRESENT || 0;
  const absent = counts.ABSENT || 0;
  const late = counts.LATE || 0;
  const denominator = present + absent + late;
  if (denominator === 0) return null;
  return Math.round(((present + late) / denominator) * 100);
}

const SLOTS = [
  { label: "Slot 1", startTime: "09:50", endTime: "10:45" },
  { label: "Slot 2", startTime: "10:45", endTime: "11:40" },
  { label: "Slot 3", startTime: "11:40", endTime: "12:35" },
  { label: "Slot 4", startTime: "13:15", endTime: "14:10" },
  { label: "Slot 5", startTime: "14:10", endTime: "15:05" },
  { label: "Slot 6", startTime: "15:25", endTime: "16:20" },
  { label: "Slot 7", startTime: "16:20", endTime: "17:15" },
];
const SLOT_LABEL_SET = new Set([...SLOTS.map((s) => s.label), "Other"]);

// "YYYY-MM-DD" -> Date at UTC midnight, so the same calendar date always compares equal
// regardless of the caller's local timezone offset. Returns null for anything unparseable.
function normalizeDate(input) {
  if (!input) return null;
  const match = String(input).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const d = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeHeader(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const LECTURE_TYPE_ALIASES = {
  "regular class": "REGULAR", regular: "REGULAR",
  "practice test": "PRACTICE_TEST", practicetest: "PRACTICE_TEST",
  exam: "EXAM",
};

// One of the 7 fixed slots (always resolves to its fixed start/end), or "Other" with a
// caller-supplied custom start/end. Returns null on anything invalid.
function resolveSlot(slotLabel, customStart, customEnd) {
  if (slotLabel === "Other") {
    const startTime = String(customStart || "").trim();
    const endTime = String(customEnd || "").trim();
    if (!startTime || !endTime) return null;
    return { slotLabel: "Other", startTime, endTime };
  }
  const preset = SLOTS.find((s) => s.label === slotLabel);
  return preset ? { slotLabel: preset.label, startTime: preset.startTime, endTime: preset.endTime } : null;
}

function validatePlanInput(body) {
  const subject = String(body.subject || "").trim();
  const topic = String(body.topic || "").trim();
  const scheduleDate = typeof body.scheduleDate === "string" ? normalizeDate(body.scheduleDate) : body.scheduleDate;
  const lectureNumber = Number(body.lectureNumber);
  const lectureType = LECTURE_TYPES.includes(body.lectureType) ? body.lectureType : null;
  const slot = resolveSlot(body.slotLabel, body.startTime, body.endTime);

  if (!subject) return { error: "A subject is required" };
  if (!topic) return { error: "A topic is required" };
  if (!scheduleDate) return { error: "A valid schedule date is required" };
  if (!lectureNumber || lectureNumber < 1) return { error: "A valid lecture number is required" };
  if (!lectureType) return { error: "A valid lecture type is required" };
  if (!slot) return { error: body.slotLabel === "Other" ? "Start and end time are required for a custom slot" : "A valid slot is required" };

  return { data: { subject, topic, scheduleDate, lectureNumber, lectureType, ...slot } };
}

// Central access gate for every assignment-scoped attendance route. ADMIN: institute-scoped (same
// convention as attachRequesterInstitute everywhere else on this platform). STAFF: must own this
// exact StaffClassAssignment — this is the enforcement point for "staff must not access another
// staff member's (or another subject's) attendance." Returns the assignment (with both the legacy
// class/division and the new academicGroup joined — academicGroup is authoritative wherever both
// are populated; class/division is kept only as a fallback for any pre-migration row that somehow
// never got backfilled) on success, or null after already sending the appropriate 403/404 itself.
async function resolveAssignmentAccess(req, res, assignmentId) {
  const assignment = await prisma.staffClassAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      staff: { select: { id: true, name: true, email: true } },
      class: { include: { institute: { select: { id: true, name: true } }, division: { include: { department: true } } } },
      academicGroup: { include: { institute: { select: { id: true, name: true } }, department: true } },
      // Third roster type — "students of ONE institute within a Talent Pool" — see schema.prisma's
      // StaffClassAssignment comment. Only populated when talentPoolId is set.
      talentPool: { select: { id: true, name: true } },
      attendanceInstitute: { select: { id: true, name: true } },
    },
  });
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return null;
  }
  const instituteId = assignment.academicGroup?.instituteId || assignment.class?.instituteId || assignment.attendanceInstituteId;
  if (req.user.role === "STAFF") {
    if (assignment.staffId !== req.user.id) {
      res.status(403).json({ error: "You are not assigned to this group" });
      return null;
    }
    return assignment;
  }
  // ADMIN
  if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
    res.status(403).json({ error: "You can only manage attendance under your own institute" });
    return null;
  }
  return assignment;
}

// Roster where-clause for an assignment: talentPoolId first (this assignment owns attendance for
// one institute's slice of a Talent Pool's members — see schema.prisma), then academicGroupId
// (every current division-based assignment, post-migration), classId as a defensive fallback for
// any row that somehow wasn't backfilled.
function rosterWhereForAssignment(assignment) {
  if (assignment.talentPoolId) {
    return {
      role: "STUDENT",
      instituteId: assignment.attendanceInstituteId,
      talentPoolMemberships: { some: { poolId: assignment.talentPoolId } },
    };
  }
  return assignment.academicGroupId
    ? { academicGroupId: assignment.academicGroupId, role: "STUDENT" }
    : { classId: assignment.classId, role: "STUDENT" };
}

// Which tests may be picked for a PRACTICE_TEST/EXAM lecture under this assignment. For a
// talent-pool assignment, this is simply "attendance-mandatory tests exclusively assigned to that
// pool" (the pool is already known, so testEligibilityWhere's per-student membership resolution
// isn't needed here). For an ordinary division assignment, behavior is unchanged.
function eligibleTestsWhere(assignment, now) {
  const base = { isPublished: true, attendanceMandatory: true, startTime: { lte: now }, endTime: { gte: now } };
  if (assignment.talentPoolId) {
    return { ...base, talentPools: { some: { poolId: assignment.talentPoolId } } };
  }
  return { ...base, ...testEligibilityWhere(assignment.academicGroupId, assignment.classId) };
}

// ===================== Admin: Department CRUD =====================

router.get("/admin/departments", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const where = {};
  if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
  else if (req.query.instituteId) where.instituteId = req.query.instituteId;
  const departments = await prisma.department.findMany({
    where,
    orderBy: { name: "asc" },
    include: { _count: { select: { divisions: true } } },
  });
  res.json(departments);
});

router.post("/admin/departments", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Department name is required" });
    if (req.requesterInstituteId && req.body.instituteId && req.body.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only add departments under your own institute" });
    }
    const instituteId = req.requesterInstituteId || req.body.instituteId;
    if (!instituteId) return res.status(400).json({ error: "An institute is required" });

    const existing = await prisma.department.findFirst({ where: { instituteId, name: name.trim() } });
    if (existing) return res.status(409).json({ error: "A department with this name already exists for this institute" });

    const dept = await prisma.department.create({ data: { name: name.trim(), instituteId } });
    res.json(dept);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create department" });
  }
});

router.patch("/admin/departments/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Department not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage departments under your own institute" });
    }
    const { name, isActive } = req.body;
    const nextName = name?.trim() || existing.name;
    if (name && nextName !== existing.name) {
      const dup = await prisma.department.findFirst({ where: { instituteId: existing.instituteId, name: nextName, NOT: { id: existing.id } } });
      if (dup) return res.status(409).json({ error: "A department with this name already exists for this institute" });
    }
    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data: { name: nextName, isActive: isActive ?? existing.isActive },
    });
    res.json(dept);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update department" });
  }
});

router.delete("/admin/departments/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Department not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage departments under your own institute" });
    }
    // Groups with zero enrolled students carry no real data to lose — same "safe to remove
    // automatically" bar deleteAcademicGroupIfEmpty() already applies elsewhere with no
    // confirmation prompt (see utils/academicGroups.js). Clearing these first means a department
    // whose only remaining "divisions" are stale empty ones (e.g. left behind after every student
    // in them was edited/moved away one at a time) deletes cleanly instead of 409ing forever. A
    // group that still has real students always survives this and correctly blocks the delete below.
    const emptyGroups = await prisma.academicGroup.findMany({
      where: { departmentId: req.params.id, users: { none: {} } },
      select: { id: true },
    });
    if (emptyGroups.length) {
      await prisma.academicGroup.deleteMany({ where: { id: { in: emptyGroups.map((g) => g.id) } } });
    }
    await prisma.department.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(409).json({ error: "This department has divisions under it and can't be deleted. Delete or move its divisions first." });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete department" });
  }
});

// ===================== Admin: Attendance Rules (display-only minimum-percentage threshold) =====================

router.get("/admin/rules", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.query.instituteId;
    if (!instituteId) return res.status(400).json({ error: "An institute is required" });
    const institute = await prisma.institute.findUnique({ where: { id: instituteId }, select: { attendanceMinPercent: true } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });
    res.json({ attendanceMinPercent: institute.attendanceMinPercent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load attendance rules" });
  }
});

router.patch("/admin/rules", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.body.instituteId;
    if (!instituteId) return res.status(400).json({ error: "An institute is required" });
    if (req.requesterInstituteId && req.body.instituteId && req.body.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage rules under your own institute" });
    }
    let attendanceMinPercent = null;
    if (req.body.attendanceMinPercent !== undefined && req.body.attendanceMinPercent !== null && req.body.attendanceMinPercent !== "") {
      const n = Number(req.body.attendanceMinPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: "Minimum percentage must be a number between 0 and 100" });
      attendanceMinPercent = Math.round(n);
    }
    const institute = await prisma.institute.update({ where: { id: instituteId }, data: { attendanceMinPercent }, select: { attendanceMinPercent: true } });
    res.json(institute);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update attendance rules" });
  }
});

// ===================== Admin: Staff ↔ Division assignments (one staff per division) =====================

router.get("/admin/staff", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const where = { role: "STAFF", isActive: true };
  if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
  else if (req.query.instituteId) where.instituteId = req.query.instituteId;
  const staff = await prisma.user.findMany({ where, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  res.json(staff);
});

// Distinct batches available for a Batch dropdown — the first step of every cascading
// Institute -> Batch -> Department/Section picker across the platform. Academic groups are
// auto-derived from registered students (Bulk Upload/Registration, or the one-time migration) —
// there is no manual "create a batch" admin step.
router.get("/admin/batches", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const where = {};
  if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
  else if (req.query.instituteId) where.instituteId = req.query.instituteId;
  const rows = await prisma.academicGroup.findMany({ where, select: { batch: true }, distinct: ["batch"], orderBy: { batch: "desc" } });
  res.json(rows.map((r) => r.batch));
});

// The Admin Attendance Assignment Page's data source: every academic group (Institute+Batch+
// Department+Section, auto-derived from registered students) for the given institute+batch, each
// with its department, section, and current staff assignment (at most one, per the "one staff per
// group" model) joined in a single call.
router.get("/admin/group-table", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.requesterInstituteId || req.query.instituteId;
    if (!instituteId) return res.status(400).json({ error: "An institute is required" });
    if (req.requesterInstituteId && req.query.instituteId && req.query.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view groups under your own institute" });
    }
    if (!req.query.batchYear) return res.status(400).json({ error: "A batch is required" });

    const groups = await prisma.academicGroup.findMany({
      where: { instituteId, batch: req.query.batchYear },
      include: {
        department: true,
        staffAssignments: { include: { staff: { select: { id: true, name: true, email: true } } }, orderBy: { assignedAt: "desc" }, take: 1 },
      },
      orderBy: [{ department: { name: "asc" } }, { section: "asc" }],
    });

    res.json(groups.map((g) => ({
      academicGroupId: g.id,
      batchYear: g.batch,
      department: g.department,
      section: g.section,
      assignment: g.staffAssignments[0] || null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load the group table" });
  }
});

// One row per academic group: assigning a staff member who's already assigned elsewhere on this
// group UPDATES that same row rather than creating a second one — this find-then-update-or-create
// logic is the sole enforcement point for "one staff per group," deliberately not a DB unique
// constraint (safer to deploy against any pre-existing rows, and this is the only write path).
router.post("/admin/staff-assignments", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { staffId, academicGroupId } = req.body;
    const semester = String(req.body.semester || "").trim();
    if (!staffId || !academicGroupId) return res.status(400).json({ error: "Both a staff member and an academic group are required" });
    if (!semester) return res.status(400).json({ error: "A semester is required" });

    const [staff, group] = await Promise.all([
      prisma.user.findUnique({ where: { id: staffId } }),
      prisma.academicGroup.findUnique({ where: { id: academicGroupId }, include: { department: true } }),
    ]);
    if (!staff || staff.role !== "STAFF") return res.status(404).json({ error: "Staff member not found" });
    if (!group) return res.status(404).json({ error: "Academic group not found" });
    if (req.requesterInstituteId && (staff.instituteId !== req.requesterInstituteId || group.instituteId !== req.requesterInstituteId)) {
      return res.status(403).json({ error: "You can only assign staff and groups under your own institute" });
    }

    const existing = await prisma.staffClassAssignment.findFirst({ where: { academicGroupId } });
    const assignment = existing
      ? await prisma.staffClassAssignment.update({
          where: { id: existing.id },
          data: { staffId, semester },
          include: { staff: { select: { id: true, name: true, email: true } }, academicGroup: { include: { department: true } } },
        })
      : await prisma.staffClassAssignment.create({
          data: { staffId, academicGroupId, semester },
          include: { staff: { select: { id: true, name: true, email: true } }, academicGroup: { include: { department: true } } },
        });

    const groupLabel = `${group.department.name} · ${group.section} (${group.batch})`;
    logAudit({
      req, action: AUDIT_ACTIONS.STAFF_CLASS_ASSIGNMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { change: existing ? "reassigned" : "assigned", staffId, staffName: staff.name, academicGroupId, groupLabel, semester },
    });

    res.json(assignment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign staff to group" });
  }
});

router.patch("/admin/staff-assignments/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.staffClassAssignment.findUnique({ where: { id: req.params.id }, include: { class: true, academicGroup: true } });
    if (!existing) return res.status(404).json({ error: "Assignment not found" });
    const instituteId = existing.academicGroup?.instituteId || existing.class?.instituteId;
    if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage assignments under your own institute" });
    }
    const nextSemester = req.body.semester?.trim() || existing.semester;
    const updated = await prisma.staffClassAssignment.update({
      where: { id: req.params.id },
      data: { semester: nextSemester },
      include: { staff: { select: { id: true, name: true, email: true } }, academicGroup: { include: { department: true } } },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update assignment" });
  }
});

router.delete("/admin/staff-assignments/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const assignment = await prisma.staffClassAssignment.findUnique({
      where: { id: req.params.id },
      include: { staff: true, class: true, academicGroup: { include: { department: true } } },
    });
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });
    const instituteId = assignment.academicGroup?.instituteId || assignment.class?.instituteId;
    if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage assignments under your own institute" });
    }
    await prisma.staffClassAssignment.delete({ where: { id: req.params.id } });

    const groupLabel = assignment.academicGroup
      ? `${assignment.academicGroup.department.name} · ${assignment.academicGroup.section} (${assignment.academicGroup.batch})`
      : assignment.class?.name;
    logAudit({
      req, action: AUDIT_ACTIONS.STAFF_CLASS_ASSIGNMENT_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId, details: { change: "unassigned", staffId: assignment.staffId, staffName: assignment.staff.name, academicGroupId: assignment.academicGroupId, groupLabel },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove assignment" });
  }
});

// ===================== Shared: which division assignments does this requester see =====================

// STAFF: only their own assignments (powers the "Attendance" landing page cards). ADMIN: every
// assignment in their institute scope (so the same card-grid page works for both roles).
router.get("/my-assignments", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const include = {
      staff: { select: { id: true, name: true } },
      class: { include: { institute: { select: { id: true, name: true } }, division: { include: { department: true } } } },
      academicGroup: { include: { institute: { select: { id: true, name: true } }, department: true } },
      talentPool: { select: { id: true, name: true } },
      attendanceInstitute: { select: { id: true, name: true } },
    };
    let assignments;
    if (req.user.role === "STAFF") {
      assignments = await prisma.staffClassAssignment.findMany({
        where: { staffId: req.user.id },
        include,
      });
    } else {
      const where = {};
      if (req.requesterInstituteId) {
        where.OR = [{ academicGroup: { instituteId: req.requesterInstituteId } }, { attendanceInstituteId: req.requesterInstituteId }];
      }
      assignments = await prisma.staffClassAssignment.findMany({ where, include });
    }
    // Sorted in JS (not the DB query) since the sort key differs by which relation is populated —
    // academicGroup.section for post-migration rows, class.name for any pre-migration fallback,
    // the Talent Pool's own name for a pool-based row.
    assignments.sort((a, b) => (a.academicGroup?.section || a.class?.name || a.talentPool?.name || "").localeCompare(b.academicGroup?.section || b.class?.name || b.talentPool?.name || ""));
    res.json(assignments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load your assignments" });
  }
});

router.get("/assignments/:assignmentId", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
  if (!assignment) return;
  res.json(assignment);
});

// ===================== Lecture Plans =====================

router.get("/assignments/:assignmentId/plans", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
    if (!assignment) return;
    const plans = await prisma.lecturePlan.findMany({
      where: { assignmentId: assignment.id },
      orderBy: [{ scheduleDate: "desc" }, { lectureNumber: "desc" }],
      include: { session: { select: { id: true } } },
    });
    res.json(plans);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load lecture plans" });
  }
});

router.post("/assignments/:assignmentId/plans", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
    if (!assignment) return;
    const { data, error } = validatePlanInput(req.body);
    if (error) return res.status(400).json({ error });

    const dup = await prisma.lecturePlan.findUnique({
      where: { assignmentId_lectureNumber: { assignmentId: assignment.id, lectureNumber: data.lectureNumber } },
    });
    if (dup) return res.status(409).json({ error: `Lecture number ${data.lectureNumber} already exists for this division` });

    const plan = await prisma.lecturePlan.create({ data: { ...data, assignmentId: assignment.id, createdById: req.user.id } });
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create lecture plan" });
  }
});

router.get("/assignments/:assignmentId/plans/template", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
  if (!assignment) return;
  const rows = [
    {
      Subject: "Data Structures", "Lecture Number": 1, Topic: "Introduction to Arrays", "Schedule Date": "2026-07-25", Slot: "Slot 1",
      "Lecture Type": "Regular Class", "Start Time (if Slot is Other)": "", "End Time (if Slot is Other)": "",
    },
  ];
  sendExport(res, { rows, filenameBase: "lecture-plan-template", format: "xlsx" });
});

router.post("/assignments/:assignmentId/plans/bulk-upload", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
    const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
    if (!assignment) return;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Could not read this file. Please upload a valid .xlsx or .csv file." });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
    if (rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    const existingPlans = await prisma.lecturePlan.findMany({ where: { assignmentId: assignment.id }, select: { lectureNumber: true } });
    const usedNumbers = new Set(existingPlans.map((p) => p.lectureNumber));

    const errors = [];
    const toCreate = [];
    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];
      const lectureNumber = Number(row["Lecture Number"]);
      const subject = String(row["Subject"] || "").trim();
      const topic = String(row["Topic"] || "").trim();
      const scheduleDate = normalizeDate(row["Schedule Date"]);
      const slotRaw = String(row["Slot"] || "").trim();
      const lectureTypeRaw = String(row["Lecture Type"] || "").trim();

      if (!lectureNumber && !subject && !topic && !slotRaw && !lectureTypeRaw) continue; // blank row

      if (!lectureNumber || lectureNumber < 1) { errors.push({ row: rowNum, reason: "Missing or invalid Lecture Number" }); continue; }
      if (usedNumbers.has(lectureNumber)) { errors.push({ row: rowNum, reason: `Lecture number ${lectureNumber} already exists` }); continue; }
      if (!subject) { errors.push({ row: rowNum, reason: "Missing Subject" }); continue; }
      if (!topic) { errors.push({ row: rowNum, reason: "Missing Topic" }); continue; }
      if (!scheduleDate) { errors.push({ row: rowNum, reason: "Missing or invalid Schedule Date (use YYYY-MM-DD)" }); continue; }
      if (!SLOT_LABEL_SET.has(slotRaw)) { errors.push({ row: rowNum, reason: `Unrecognized Slot "${slotRaw}"` }); continue; }
      const lectureType = LECTURE_TYPE_ALIASES[normalizeHeader(lectureTypeRaw)];
      if (!lectureType) { errors.push({ row: rowNum, reason: `Unrecognized Lecture Type "${lectureTypeRaw}"` }); continue; }

      let slot;
      if (slotRaw === "Other") {
        const startTime = String(row["Start Time (if Slot is Other)"] || "").trim();
        const endTime = String(row["End Time (if Slot is Other)"] || "").trim();
        if (!startTime || !endTime) { errors.push({ row: rowNum, reason: 'Start Time and End Time are required when Slot is "Other"' }); continue; }
        slot = { slotLabel: "Other", startTime, endTime };
      } else {
        const preset = SLOTS.find((s) => s.label === slotRaw);
        slot = { slotLabel: preset.label, startTime: preset.startTime, endTime: preset.endTime };
      }

      usedNumbers.add(lectureNumber);
      toCreate.push({ assignmentId: assignment.id, createdById: req.user.id, lectureNumber, subject, topic, scheduleDate, lectureType, ...slot });
    }

    let createdCount = 0;
    for (const data of toCreate) {
      try {
        await prisma.lecturePlan.create({ data });
        createdCount++;
      } catch (err) {
        errors.push({ row: "-", reason: `Failed to save lecture ${data.lectureNumber}: ${err.message || "unknown error"}` });
      }
    }

    res.json({ total: rows.length, createdCount, errorCount: errors.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk upload failed" });
  }
});

router.patch("/assignments/:assignmentId/plans/:planId", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
    if (!assignment) return;
    const existing = await prisma.lecturePlan.findUnique({ where: { id: req.params.planId } });
    if (!existing || existing.assignmentId !== assignment.id) return res.status(404).json({ error: "Lecture plan not found" });

    const merged = {
      subject: req.body.subject ?? existing.subject,
      topic: req.body.topic ?? existing.topic,
      scheduleDate: req.body.scheduleDate ?? existing.scheduleDate.toISOString().slice(0, 10),
      lectureNumber: req.body.lectureNumber ?? existing.lectureNumber,
      lectureType: req.body.lectureType ?? existing.lectureType,
      slotLabel: req.body.slotLabel ?? existing.slotLabel,
      startTime: req.body.startTime ?? existing.startTime,
      endTime: req.body.endTime ?? existing.endTime,
    };
    const { data, error } = validatePlanInput(merged);
    if (error) return res.status(400).json({ error });

    if (data.lectureNumber !== existing.lectureNumber) {
      const dup = await prisma.lecturePlan.findUnique({
        where: { assignmentId_lectureNumber: { assignmentId: assignment.id, lectureNumber: data.lectureNumber } },
      });
      if (dup) return res.status(409).json({ error: `Lecture number ${data.lectureNumber} already exists for this division` });
    }

    const updated = await prisma.lecturePlan.update({ where: { id: existing.id }, data });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update lecture plan" });
  }
});

router.delete("/assignments/:assignmentId/plans/:planId", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
    if (!assignment) return;
    const existing = await prisma.lecturePlan.findUnique({ where: { id: req.params.planId } });
    if (!existing || existing.assignmentId !== assignment.id) return res.status(404).json({ error: "Lecture plan not found" });
    await prisma.lecturePlan.delete({ where: { id: existing.id } }); // cascades its AttendanceSession/records, if any
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete lecture plan" });
  }
});

// ===================== Execute / edit attendance for a plan =====================

router.get("/assignments/:assignmentId/plans/:planId/execute", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
    if (!assignment) return;
    const plan = await prisma.lecturePlan.findUnique({
      where: { id: req.params.planId },
      include: {
        session: {
          include: {
            records: { select: { studentId: true, status: true } },
            test: { select: { id: true, title: true } },
            markedBy: { select: { name: true } },
            updatedBy: { select: { name: true } },
          },
        },
      },
    });
    if (!plan || plan.assignmentId !== assignment.id) return res.status(404).json({ error: "Lecture plan not found" });

    const now = new Date();
    const [roster, eligibleTests] = await Promise.all([
      prisma.user.findMany({
        where: rosterWhereForAssignment(assignment),
        select: { id: true, name: true, rollNumber: true },
        orderBy: { name: "asc" },
      }),
      plan.lectureType === "REGULAR"
        ? Promise.resolve([])
        : prisma.test.findMany({
            where: eligibleTestsWhere(assignment, now),
            select: { id: true, title: true },
            orderBy: { title: "asc" },
          }),
    ]);

    res.json({ plan, roster, eligibleTests });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load attendance execution context" });
  }
});

router.post("/assignments/:assignmentId/plans/:planId/attendance", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const assignment = await resolveAssignmentAccess(req, res, req.params.assignmentId);
    if (!assignment) return;
    const plan = await prisma.lecturePlan.findUnique({ where: { id: req.params.planId } });
    if (!plan || plan.assignmentId !== assignment.id) return res.status(404).json({ error: "Lecture plan not found" });

    const records = Array.isArray(req.body.records) ? req.body.records : [];

    // Practice Test / Exam lectures must be linked to a real, currently-eligible test — re-derived
    // server-side (never trusts the client's already-filtered dropdown) so a stale/expired/
    // non-mandatory test id can't be slipped through.
    let testId = null;
    if (plan.lectureType !== "REGULAR") {
      const now = new Date();
      const eligible = await prisma.test.findMany({
        where: eligibleTestsWhere(assignment, now),
        select: { id: true },
      });
      if (!req.body.testId || !eligible.some((t) => t.id === req.body.testId)) {
        return res.status(400).json({ error: "A currently-active, attendance-mandatory test must be selected for this lecture" });
      }
      testId = req.body.testId;
    }

    // Only accept records for students who actually belong to this group — defensive against a
    // stale roster on the client (a student transferred out between load and save) rather than
    // failing the whole save over it.
    const roster = await prisma.user.findMany({ where: rosterWhereForAssignment(assignment), select: { id: true } });
    const rosterIds = new Set(roster.map((s) => s.id));
    const cleanRecords = records
      .filter((r) => r && rosterIds.has(r.studentId))
      .map((r) => ({ studentId: r.studentId, status: ATTENDANCE_STATUSES.includes(r.status) ? r.status : "PRESENT" }));

    const session = await prisma.$transaction(async (tx) => {
      const existing = await tx.attendanceSession.findUnique({ where: { planId: plan.id } });
      const saved = existing
        ? await tx.attendanceSession.update({ where: { id: existing.id }, data: { testId, updatedById: req.user.id } })
        : await tx.attendanceSession.create({ data: { planId: plan.id, testId, markedById: req.user.id } });
      // Full replace on every save — simplest correct way to handle edits (added/removed
      // students, changed statuses) without reconciling a partial diff.
      await tx.attendanceRecord.deleteMany({ where: { sessionId: saved.id } });
      if (cleanRecords.length > 0) {
        await tx.attendanceRecord.createMany({
          data: cleanRecords.map((r) => ({ sessionId: saved.id, studentId: r.studentId, status: r.status })),
        });
      }
      return saved;
    });

    logAudit({
      req, action: AUDIT_ACTIONS.ATTENDANCE_MARKED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId,
      details: {
        academicGroupId: assignment.academicGroupId, subject: plan.subject, lectureNumber: plan.lectureNumber,
        presentCount: cleanRecords.filter((r) => r.status === "PRESENT").length,
        absentCount: cleanRecords.filter((r) => r.status === "ABSENT").length,
        lateCount: cleanRecords.filter((r) => r.status === "LATE").length,
        leaveCount: cleanRecords.filter((r) => r.status === "LEAVE").length,
      },
    });

    const full = await prisma.attendanceSession.findUnique({
      where: { id: session.id },
      include: {
        records: { select: { studentId: true, status: true } },
        test: { select: { id: true, title: true } },
        markedBy: { select: { name: true } },
        updatedBy: { select: { name: true } },
      },
    });
    res.json(full);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save attendance" });
  }
});

// ===================== Reports (+ CSV/XLSX export) =====================

router.get("/reports", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      date, dateFrom, dateTo, academicYear, departmentId, section, academicGroupId,
      subject, semester, facultyId, lectureType, status, studentId, talentPoolId,
    } = req.query;

    // Resolve the STAFF scope (their own assignment IDs) separately from any narrowing filter the
    // caller asked for, then reconcile the two explicitly below — building both into the same
    // `assignmentWhere.id` key one after another would let a later assignment silently clobber the
    // earlier one, exactly the shape of bug that already bit this module once.
    const assignmentWhere = {};
    let staffAssignedIds = null;
    if (req.user.role === "STAFF") {
      const own = await prisma.staffClassAssignment.findMany({ where: { staffId: req.user.id }, select: { id: true } });
      staffAssignedIds = own.map((a) => a.id);
    } else if (req.requesterInstituteId) {
      // Scoped admins see both their institute's division-based rows AND their institute's
      // Talent-Pool-based rows (attendanceInstituteId) — a plain `academicGroup: {instituteId}`
      // filter alone would silently hide the latter.
      assignmentWhere.OR = [
        { academicGroup: { instituteId: req.requesterInstituteId } },
        { attendanceInstituteId: req.requesterInstituteId },
      ];
    }
    if (talentPoolId) assignmentWhere.talentPoolId = talentPoolId;

    if (facultyId) {
      if (staffAssignedIds) {
        // A STAFF user has no legitimate reason to filter by a different faculty's id — their own
        // scope already is exactly one faculty.
        if (facultyId !== req.user.id) return res.status(403).json({ error: "You can only view your own attendance records" });
      } else {
        assignmentWhere.staffId = facultyId;
      }
    }
    if (semester) assignmentWhere.semester = semester;
    if (academicGroupId || section || departmentId || academicYear) {
      assignmentWhere.academicGroup = { ...(assignmentWhere.academicGroup || {}) };
      if (academicGroupId) assignmentWhere.academicGroup.id = academicGroupId;
      if (section) assignmentWhere.academicGroup.section = section;
      if (departmentId) assignmentWhere.academicGroup.departmentId = departmentId;
      if (academicYear) assignmentWhere.academicGroup.batch = academicYear; // "Batch" in the UI
    }

    if (staffAssignedIds) {
      assignmentWhere.id = { in: staffAssignedIds };
    }

    const planWhere = { assignment: assignmentWhere };
    // subject now lives on the plan, not the assignment; a substring/case-insensitive match since
    // the frontend filter is free text rather than picked from a fixed list of known subjects.
    if (subject) planWhere.subject = { contains: subject, mode: "insensitive" };
    if (date) {
      const d = normalizeDate(date);
      if (d) planWhere.scheduleDate = d;
    } else if (dateFrom || dateTo) {
      planWhere.scheduleDate = {};
      if (dateFrom) planWhere.scheduleDate.gte = normalizeDate(dateFrom);
      if (dateTo) planWhere.scheduleDate.lte = normalizeDate(dateTo);
    }
    if (lectureType && LECTURE_TYPES.includes(lectureType)) planWhere.lectureType = lectureType;

    const recordWhere = { session: { plan: planWhere } };
    if (studentId) recordWhere.studentId = studentId;
    if (status && ATTENDANCE_STATUSES.includes(status)) recordWhere.status = status;

    const records = await prisma.attendanceRecord.findMany({
      where: recordWhere,
      include: {
        student: { select: { id: true, name: true, rollNumber: true } },
        session: {
          include: {
            test: { select: { title: true } },
            plan: {
              include: {
                assignment: {
                  include: {
                    staff: { select: { name: true } },
                    class: { include: { division: { include: { department: true } } } },
                    academicGroup: { include: { department: true } },
                    talentPool: { select: { name: true } },
                    attendanceInstitute: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ session: { plan: { scheduleDate: "desc" } } }, { session: { plan: { lectureNumber: "asc" } } }],
      take: 10000, // hard ceiling — export/report views, not a paginated feed
    });

    const rows = records.map((r) => {
      const plan = r.session.plan;
      const assignment = plan.assignment;
      const group = assignment.academicGroup;
      return {
        Date: plan.scheduleDate.toISOString().slice(0, 10),
        Batch: group?.batch || assignment.class?.batchYear || "",
        Department: group?.department?.name || assignment.class?.division?.department?.name || (assignment.talentPoolId ? "Talent Pool" : ""),
        Section: group?.section || assignment.class?.division?.name || (assignment.talentPoolId ? `${assignment.talentPool?.name || ""} — ${assignment.attendanceInstitute?.name || ""}` : ""),
        Subject: plan.subject,
        Semester: assignment.semester,
        Faculty: assignment.staff.name,
        "Lecture #": plan.lectureNumber,
        "Lecture Type": LECTURE_TYPE_LABELS[plan.lectureType] || plan.lectureType,
        Test: r.session.test?.title || "",
        "Roll Number": r.student.rollNumber || "",
        "Student Name": r.student.name,
        Status: r.status,
      };
    });

    if (req.query.format) {
      logAudit({
        req, action: AUDIT_ACTIONS.DATA_EXPORTED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
        instituteId: req.requesterInstituteId, details: { entity: "attendance", format: req.query.format, rowCount: rows.length },
      });
      // PDF needs pdfkit's streaming model, not sendExport's XLSX/CSV/JSON buffer-based one — a
      // parallel branch rather than an extension of sendExport. Reuses the exact same `rows` this
      // route already built, so it's bound by the same institute/staff-scope filtering above.
      if (req.query.format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="attendance-report-${new Date().toISOString().slice(0, 10)}.pdf"`);
        return generateAttendancePdf(rows, res);
      }
      return sendExport(res, { rows, filenameBase: `attendance-report-${new Date().toISOString().slice(0, 10)}`, format: req.query.format });
    }

    res.json({ rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load attendance report" });
  }
});

// ===================== Student: own attendance history + per-subject summary =====================

// Always self-scoped by construction (studentId: req.user.id, no caller-supplied id accepted) —
// there is no query parameter that could widen this to another student's records.
router.get("/my-records", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const [records, student] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { studentId: req.user.id },
        include: {
          session: {
            include: {
              test: { select: { title: true } },
              plan: {
                include: {
                  assignment: {
                    include: {
                      class: { include: { division: { include: { department: true } } } },
                      academicGroup: { include: { department: true } },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ session: { plan: { scheduleDate: "desc" } } }],
        take: 5000,
      }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { institute: { select: { attendanceMinPercent: true } } } }),
    ]);

    const bySubjectCounts = {};
    const rows = records.map((r) => {
      const plan = r.session.plan;
      const assignment = plan.assignment;
      const group = assignment.academicGroup;
      const subject = plan.subject;
      if (!bySubjectCounts[subject]) bySubjectCounts[subject] = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
      bySubjectCounts[subject][r.status] = (bySubjectCounts[subject][r.status] || 0) + 1;

      return {
        date: plan.scheduleDate.toISOString().slice(0, 10),
        subject,
        department: group?.department?.name || assignment.class?.division?.department?.name || "",
        section: group?.section || assignment.class?.division?.name || "",
        batch: group?.batch || assignment.class?.batchYear || "",
        lectureNumber: plan.lectureNumber,
        lectureType: plan.lectureType,
        test: r.session.test?.title || null,
        status: r.status,
      };
    });

    const bySubject = Object.entries(bySubjectCounts)
      .map(([subject, counts]) => ({ subject, counts, percentage: computeAttendancePercent(counts) }))
      .sort((a, b) => a.subject.localeCompare(b.subject));

    res.json({ records: rows, bySubject, attendanceMinPercent: student?.institute?.attendanceMinPercent ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load your attendance records" });
  }
});

module.exports = router;
