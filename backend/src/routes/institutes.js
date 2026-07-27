const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { cached, invalidate } = require("../utils/cache");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { computeMandatoryCompletion } = require("../utils/studentProfileCompletion");

const router = express.Router();

// ADMIN/STAFF: list all institutes. Cached — this list changes rarely (an admin adding/editing
// an institute is a rare event, not a per-request one) but gets read on nearly every admin page
// load for the institute-picker dropdown. Invalidated explicitly on create/update/delete below
// rather than relying on the 2-minute TTL to catch up.
router.get("/", authenticate, requireRole("ADMIN", "STAFF"), async (req, res) => {
  const institutes = await cached("institutes:list", 2 * 60 * 1000, () =>
    prisma.institute.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { classes: true, users: true } } },
    })
  );
  res.json(institutes);
});

// ADMIN: create an institute
router.post("/", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const { name, code, address, contact } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Institute name is required" });

    const existing = await prisma.institute.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(409).json({ error: "An institute with this name already exists" });

    const institute = await prisma.institute.create({
      data: { name: name.trim(), code: code?.trim() || null, address: address?.trim() || null, contact: contact?.trim() || null },
    });
    invalidate("institutes:");
    res.json(institute);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create institute" });
  }
});

// ADMIN: edit details, or toggle active/inactive
router.patch("/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const existing = await prisma.institute.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Institute not found" });

    const { name, code, address, contact, isActive, logoUrl, passwordExpiryDays, passwordHistoryDepth, singleSessionOnly, aiHintsEnabled, requireProfileCompletion } = req.body;
    if (name && name.trim() !== existing.name) {
      const dup = await prisma.institute.findUnique({ where: { name: name.trim() } });
      if (dup) return res.status(409).json({ error: "An institute with this name already exists" });
    }
    if (passwordExpiryDays !== undefined && passwordExpiryDays !== null && (!Number.isFinite(Number(passwordExpiryDays)) || Number(passwordExpiryDays) < 0)) {
      return res.status(400).json({ error: "Password expiry days must be a non-negative number, or blank for never" });
    }
    if (passwordHistoryDepth !== undefined && (!Number.isFinite(Number(passwordHistoryDepth)) || Number(passwordHistoryDepth) < 0)) {
      return res.status(400).json({ error: "Password history depth must be a non-negative number" });
    }

    const institute = await prisma.institute.update({
      where: { id: req.params.id },
      data: {
        name: name?.trim() ?? existing.name,
        code: code !== undefined ? (code?.trim() || null) : existing.code,
        address: address !== undefined ? (address?.trim() || null) : existing.address,
        contact: contact !== undefined ? (contact?.trim() || null) : existing.contact,
        isActive: isActive ?? existing.isActive,
        logoUrl: logoUrl !== undefined ? (logoUrl || null) : existing.logoUrl,
        passwordExpiryDays: passwordExpiryDays !== undefined ? (passwordExpiryDays === null || passwordExpiryDays === "" ? null : Number(passwordExpiryDays)) : existing.passwordExpiryDays,
        passwordHistoryDepth: passwordHistoryDepth !== undefined ? Number(passwordHistoryDepth) : existing.passwordHistoryDepth,
        singleSessionOnly: singleSessionOnly !== undefined ? !!singleSessionOnly : existing.singleSessionOnly,
        aiHintsEnabled: aiHintsEnabled !== undefined ? !!aiHintsEnabled : existing.aiHintsEnabled,
        requireProfileCompletion: requireProfileCompletion !== undefined ? !!requireProfileCompletion : existing.requireProfileCompletion,
      },
    });
    invalidate("institutes:");
    await logAudit({ req, action: AUDIT_ACTIONS.INSTITUTE_CONFIG_CHANGED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, instituteId: institute.id, details: { instituteName: institute.name, changedFields: Object.keys(req.body) } });
    res.json(institute);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update institute" });
  }
});

// ADMIN: delete an institute — only if no dependent classes or users exist
router.delete("/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    // A class with zero enrolled users carries no real data to lose (its only other links —
    // TestClass, StaffClassAssignment — cascade harmlessly, same reasoning as
    // deleteAcademicGroupIfEmpty() for AcademicGroup/Department). Clearing these first means an
    // institute whose only remaining "classes" are stale leftovers (created once, never
    // populated, or emptied out student-by-student over time) deletes cleanly instead of 409ing
    // forever — a class that still has real students always survives this and correctly blocks
    // the delete below.
    const emptyClasses = await prisma.class.findMany({
      where: { instituteId: req.params.id, users: { none: {} } },
      select: { id: true },
    });
    if (emptyClasses.length) {
      await prisma.class.deleteMany({ where: { id: { in: emptyClasses.map((c) => c.id) } } });
    }

    const [classCount, userCount] = await Promise.all([
      prisma.class.count({ where: { instituteId: req.params.id } }),
      prisma.user.count({ where: { instituteId: req.params.id } }),
    ]);
    if (classCount > 0 || userCount > 0) {
      return res.status(409).json({ error: "This institute has classes or users linked to it and can't be deleted. Remove or reassign them first." });
    }
    await prisma.institute.delete({ where: { id: req.params.id } });
    invalidate("institutes:");
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete institute" });
  }
});

// ADMIN: per-course engagement stats for one institute — how many courses are assigned to it,
// how many of its students are actively learning each one, certificates issued, and coding-
// assessment performance. Course counts per institute are small, so per-course stats are computed
// with a plain loop rather than a single aggregate query.
router.get("/:id/course-analytics", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const instituteId = req.params.id;
    const institute = await prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true, name: true } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });

    const [directAssignments, groupAssignments] = await Promise.all([
      prisma.courseInstituteAssignment.findMany({ where: { instituteId }, select: { courseId: true } }),
      prisma.courseAcademicGroupAssignment.findMany({ where: { academicGroup: { instituteId } }, select: { courseId: true } }),
    ]);
    const courseIds = [...new Set([...directAssignments.map((a) => a.courseId), ...groupAssignments.map((a) => a.courseId)])];

    if (courseIds.length === 0) {
      return res.json({ institute, assignedCourseCount: 0, courses: [] });
    }

    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: {
        id: true, name: true, status: true,
        modules: {
          select: {
            lessons: { select: { id: true } },
            codingTest: { select: { id: true } },
            chapters: { select: { levels: { select: { id: true } } } },
          },
        },
      },
    });

    const courseAnalytics = await Promise.all(courses.map(async (course) => {
      const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
      const testIds = [
        ...course.modules.filter((m) => m.codingTest).map((m) => m.codingTest.id),
        ...course.modules.flatMap((m) => m.chapters.flatMap((c) => c.levels.map((l) => l.id))),
      ];

      const [activeLearners, certificatesIssued, attempts] = await Promise.all([
        lessonIds.length > 0
          ? prisma.lessonProgress.findMany({
              where: { lessonId: { in: lessonIds }, status: { in: ["IN_PROGRESS", "COMPLETED"] }, student: { instituteId } },
              distinct: ["studentId"], select: { studentId: true },
            })
          : Promise.resolve([]),
        prisma.certificate.count({ where: { courseId: course.id, student: { instituteId } } }),
        testIds.length > 0
          ? prisma.moduleCodingAttempt.findMany({
              where: { moduleCodingTestId: { in: testIds }, status: { not: "IN_PROGRESS" }, student: { instituteId } },
              select: { score: true, passed: true },
            })
          : Promise.resolve([]),
      ]);

      return {
        courseId: course.id,
        courseName: course.name,
        status: course.status,
        activeLearners: activeLearners.length,
        certificatesIssued,
        codingAttempts: attempts.length,
        avgCodingScore: attempts.length > 0 ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / attempts.length) : null,
        codingSuccessRate: attempts.length > 0 ? Math.round((attempts.filter((a) => a.passed).length / attempts.length) * 100) : null,
      };
    }));

    res.json({ institute, assignedCourseCount: courseIds.length, courses: courseAnalytics });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load course analytics" });
  }
});

// ADMIN/STAFF/CLERK: Student Profile Completion stats for one institute — total/completed/
// incomplete/percent plus the list of students still pending, optionally filtered by department.
// Institute-scoped for Staff/Clerk (attachRequesterInstitute) the same way every other Placement
// Cell/analytics route on this platform is; an unscoped Platform Admin can query any institute.
router.get("/:id/profile-completion-stats", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const instituteId = req.params.id;
    if (req.requesterInstituteId && req.requesterInstituteId !== instituteId) {
      return res.status(403).json({ error: "You can only view your own institute's data" });
    }
    const institute = await prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true, name: true, requireProfileCompletion: true } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });

    const { departmentId } = req.query;
    const students = await prisma.user.findMany({
      where: {
        instituteId, role: "STUDENT",
        ...(departmentId ? { academicGroup: { departmentId } } : {}),
      },
      select: {
        id: true, name: true, email: true, rollNumber: true, mobile: true, gender: true, profilePhotoUrl: true,
        academicGroup: { select: { department: { select: { id: true, name: true } } } },
      },
    });

    if (students.length === 0) {
      return res.json({ institute, total: 0, completed: 0, incomplete: 0, percentComplete: 0, pending: [] });
    }

    const studentIds = students.map((s) => s.id);
    const [profiles, resumes] = await Promise.all([
      prisma.studentProfile.findMany({ where: { studentId: { in: studentIds } } }),
      prisma.resume.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, education: true, fullName: true, email: true } }),
    ]);
    const profileByStudent = new Map(profiles.map((p) => [p.studentId, p]));
    const resumeByStudent = new Map(resumes.map((r) => [r.studentId, r]));

    let completed = 0;
    const pending = [];
    for (const student of students) {
      const completion = computeMandatoryCompletion(student, profileByStudent.get(student.id), resumeByStudent.get(student.id));
      if (completion.complete) {
        completed++;
      } else {
        pending.push({
          id: student.id, name: student.name, email: student.email, rollNumber: student.rollNumber,
          department: student.academicGroup?.department?.name || null,
          percent: completion.percent, missingFields: completion.missingFields.map((f) => f.label),
        });
      }
    }

    res.json({
      institute, total: students.length, completed, incomplete: students.length - completed,
      percentComplete: Math.round((completed / students.length) * 100),
      pending: pending.sort((a, b) => a.percent - b.percent),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load profile completion stats" });
  }
});

module.exports = router;
