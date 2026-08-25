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

// CLERK included: StudentSearch.jsx's "browse by Institute · Department · Section" panel (shared
// by Admin/Staff/Clerk) calls this to populate the Department/Section dropdowns — without CLERK
// here, that call 403'd and was silently swallowed by the frontend's .catch(() => setGroups([])),
// leaving the Department dropdown permanently empty and the Fetch button permanently unusable for
// Clerk (it stays disabled until both a department and section are picked).
router.get("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  const where = {};
  if (req.requesterInstituteId) where.instituteId = req.requesterInstituteId;
  else if (req.query.instituteId) where.instituteId = req.query.instituteId;

  // Accepts a single batch or a comma-separated list (e.g. "2023-2027,2024-2028") for a future
  // multi-select without another backend change — filtering happens in this query (indexed via
  // AcademicGroup's existing @@index([instituteId, batch])), not by loading everything and
  // filtering in JS/frontend.
  const batches = req.query.batch ? String(req.query.batch).split(",").map((b) => b.trim()).filter(Boolean) : [];
  if (batches.length === 1) where.batch = batches[0];
  else if (batches.length > 1) where.batch = { in: batches };

  // The batch selection is folded into the cache key so a batch-filtered request never serves a
  // stale unfiltered (or differently-filtered) result cached under the same institute.
  const cacheKey = `academic-groups:list:${req.requesterInstituteId || req.query.instituteId || "all"}:${batches.slice().sort().join(",") || "all"}`;
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
router.get("/:id/students", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
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
      select: { id: true, name: true, email: true, rollNumber: true, registrationNumber: true, mobile: true },
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
router.post("/:id/bulk-reset-password", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const group = await prisma.academicGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: "Academic group not found" });
    if (req.requesterInstituteId && group.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage groups under your own institute" });
    }

    const students = await prisma.user.findMany({
      where: { academicGroupId: req.params.id, role: "STUDENT" },
      select: { id: true, name: true, email: true, rollNumber: true, registrationNumber: true },
    });

    const reset = [];
    for (const student of students) {
      const newPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(newPassword, 10);
      // Hash write + passwordChangedAt/PasswordHistory write must be atomic — see auth.js's
      // reset-password route for why.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: student.id }, data: { passwordHash, mustChangePassword: true } });
        await recordPasswordChange(tx, student.id, passwordHash, null);
      });
      reset.push({ id: student.id, name: student.name, email: student.email, rollNumber: student.rollNumber, registrationNumber: student.registrationNumber, newPassword });
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
router.delete("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const group = await prisma.academicGroup.findUnique({
      where: { id: req.params.id },
      include: { institute: { select: { name: true } }, department: { select: { name: true } } },
    });
    if (!group) return res.status(404).json({ error: "Academic group not found" });
    // Cascade-deletes every student in the group — an institute-scoped ADMIN must not be able to
    // reach a group belonging to a different institute by ID.
    if (req.requesterInstituteId && group.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only manage academic groups under your own institute" });
    }

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

    // Certificate/InterviewCertificate are Restrict, not Cascade — a certificate is proof of
    // something a student actually earned and must not be silently destroyed by a group-wide
    // student purge. Checked up front (same reasoning as DELETE /users/:id) rather than letting
    // the transaction below fail partway through.
    const [certCount, interviewCertCount] = studentIds.length > 0
      ? await Promise.all([
          prisma.certificate.count({ where: { studentId: { in: studentIds } } }),
          prisma.interviewCertificate.count({ where: { studentId: { in: studentIds } } }),
        ])
      : [0, 0];
    if (certCount > 0 || interviewCertCount > 0) {
      const total = certCount + interviewCertCount;
      return res.status(409).json({
        error: `${total} certificate${total === 1 ? "" : "s"} have been earned by students in this group. Revoke or reassign ${total === 1 ? "it" : "them"} first, then delete the group.`,
      });
    }

    // Mirrors DELETE /users/:id's own cascade order exactly: submission/testAttempt have no
    // onDelete configured on their student relation (unlike ModuleCodingAttempt/InterviewSession/
    // etc., which do cascade automatically), so they're the only two that need deleting by hand
    // before the User rows themselves — everything else the DB cleans up on its own. The
    // AcademicGroup row is deleted last, once nothing still references it.
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
