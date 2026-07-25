const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { generateTempPassword, recordPasswordChange } = require("../utils/password");
const { cached } = require("../utils/cache");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

const router = express.Router();

// Academic groups (Institute -> Batch -> Department -> Section) are auto-derived from registered
// students (Bulk Upload/Registration, or the one-time migration) — there is no manual create/edit
// here, mirroring the Attendance module's already-validated "no standalone entity" principle.
// Typo'd Department/Section names get corrected via the per-student edit form (PATCH /users/:id),
// which re-resolves the group. Deletion IS manual (see DELETE /:id below), but only ever reaches a
// group that a human explicitly chose to remove along with its students — auto-cleanup of groups
// that simply went empty is handled separately by deleteAcademicGroupIfEmpty() (utils/academicGroups.js),
// called from users.js's PATCH /:id and DELETE /:id.

router.get("/", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  const where = {};
  if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
  else if (req.query.instituteId) where.instituteId = req.query.instituteId;
  const cacheKey = `academic-groups:list:${req.requesterInstituteId || req.query.instituteId || "all"}`;
  const groups = await cached(cacheKey, 2 * 60 * 1000, () =>
    prisma.academicGroup.findMany({
      where,
      orderBy: [{ batch: "desc" }, { department: { name: "asc" } }, { section: "asc" }],
      include: {
        institute: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        _count: { select: { users: true } },
      },
    })
  );
  res.json(groups);
});

// ADMIN/STAFF: full student roster for one academic group (roll number, name, email, mobile).
router.get("/:id/students", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const group = await prisma.academicGroup.findUnique({
      where: { id: req.params.id },
      include: { institute: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
    });
    if (!group) return res.status(404).json({ error: "Academic group not found" });
    if (req.requesterInstituteId && group.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view groups under your own institute" });
    }

    const students = await prisma.user.findMany({
      where: { academicGroupId: req.params.id, role: "STUDENT" },
      select: { id: true, name: true, email: true, rollNumber: true, mobile: true },
      orderBy: { name: "asc" },
    });
    res.json({ group, students });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load group roster" });
  }
});

// ADMIN: reset every student in a group to their own new, unique random temporary password — NOT
// the same password for the whole group (a shared reset password would be exactly the kind of
// reused-across-many-accounts secret that gets a group collectively compromised if any one
// student's password leaks). Each account is flagged to force a password change on next login.
// Individual per-row updates (not a single updateMany) since each student needs a distinct hash.
router.post("/:id/bulk-reset-password", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const group = await prisma.academicGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: "Academic group not found" });
    if (req.requesterInstituteId && group.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage groups under your own institute" });
    }

    const students = await prisma.user.findMany({
      where: { academicGroupId: req.params.id, role: "STUDENT" },
      select: { id: true, name: true, email: true, rollNumber: true },
    });

    const reset = [];
    for (const student of students) {
      const newPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({ where: { id: student.id }, data: { passwordHash, mustChangePassword: true } });
      await recordPasswordChange(prisma, student.id, passwordHash, null);
      reset.push({ id: student.id, name: student.name, email: student.email, rollNumber: student.rollNumber, newPassword });
    }

    res.json({ resetCount: reset.length, students: reset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to bulk-reset passwords" });
  }
});

// ADMIN-ONLY (never STAFF — requireRole enforces this, and the frontend route/action is gated the
// same way): permanently delete an academic group AND every student enrolled in it. Requires the
// requesting admin's own current password as a re-authentication step — this is the platform's
// most destructive single action (it deletes real student accounts, not just the group), so it
// gets the same "type your password to confirm" gate a password manager's own sudo mode would use,
// on top of the count-and-warn confirmation the frontend shows before this call is ever made.
router.delete("/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const group = await prisma.academicGroup.findUnique({
      where: { id: req.params.id },
      include: { institute: { select: { name: true } }, department: { select: { name: true } } },
    });
    if (!group) return res.status(404).json({ error: "Academic group not found" });

    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Your password is required to confirm this action" });

    const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res.status(401).json({ error: "Incorrect password" });

    const students = await prisma.user.findMany({
      where: { academicGroupId: req.params.id, role: "STUDENT" },
      select: { id: true, name: true, email: true, rollNumber: true },
    });
    const studentIds = students.map((s) => s.id);

    // Mirrors DELETE /users/:id's own cascade order exactly: submission/testAttempt have no
    // onDelete configured on their student relation (unlike Certificate/ModuleCodingAttempt/
    // InterviewSession/etc., which do cascade automatically), so they're the only two that need
    // deleting by hand before the User rows themselves — everything else the DB cleans up on its
    // own. The AcademicGroup row is deleted last, once nothing still references it.
    await prisma.$transaction([
      prisma.submission.deleteMany({ where: { studentId: { in: studentIds } } }),
      prisma.testAttempt.deleteMany({ where: { studentId: { in: studentIds } } }),
      prisma.user.deleteMany({ where: { id: { in: studentIds } } }),
      prisma.academicGroup.delete({ where: { id: req.params.id } }),
    ]);

    await logAudit({
      req,
      action: AUDIT_ACTIONS.USER_MANAGEMENT_CHANGED,
      actorId: req.user.id,
      actorName: admin.name,
      actorRole: "ADMIN",
      instituteId: group.instituteId,
      details: {
        subAction: "ACADEMIC_GROUP_DELETED",
        academicGroupId: group.id,
        batch: group.batch,
        institute: group.institute?.name,
        department: group.department?.name,
        section: group.section,
        deletedStudentCount: studentIds.length,
        deletedStudents: students.map((s) => ({ id: s.id, name: s.name, email: s.email, rollNumber: s.rollNumber })),
      },
    });

    res.json({ success: true, deletedStudents: studentIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete academic group" });
  }
});

module.exports = router;
