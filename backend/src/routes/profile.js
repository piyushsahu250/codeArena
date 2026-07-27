const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { computeMandatoryCompletion, MOBILE_RE } = require("../utils/studentProfileCompletion");
const { generateStudentProfilePdf } = require("../utils/studentProfilePdf");

const router = express.Router();

// Every User field a student may edit from their own profile — deliberately narrower than the
// admin-only PATCH /users/:id allowlist (no rollNumber/registrationNumber/instituteId/isActive).
const STUDENT_EDITABLE_USER_FIELDS = ["mobile", "gender", "profilePhotoUrl"];
const STUDENT_PROFILE_FIELDS = [
  "personalEmail", "dob", "address", "state", "district", "pincode",
  "fatherName", "fatherContact", "motherName", "motherContact", "shortDescription",
  "leetcodeHandle", "hackerrankHandle", "stopstalkHandle", "amcatId", "cocubesId",
  "placementParticipation", "placementDeclineReason", "placementDeclineOther",
];

async function loadCompletionInputs(studentId) {
  const [user, studentProfile, resume] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId } }),
    prisma.studentProfile.findUnique({ where: { studentId } }),
    prisma.resume.findUnique({ where: { studentId }, select: { education: true, fullName: true, email: true } }),
  ]);
  return { user, studentProfile, resume };
}

// STUDENT: merged view of everything the profile page renders — User's identity subset,
// StudentProfile's additional fields, Resume's existence/education (for the completion
// checklist), and the computed completion result (never trust a client-side percentage).
router.get("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { user, studentProfile, resume } = await loadCompletionInputs(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const completion = computeMandatoryCompletion(user, studentProfile, resume);

    res.json({
      user: {
        id: user.id, name: user.name, email: user.email, mobile: user.mobile,
        gender: user.gender, profilePhotoUrl: user.profilePhotoUrl,
        rollNumber: user.rollNumber, registrationNumber: user.registrationNumber,
      },
      profile: studentProfile,
      hasResume: !!(resume?.fullName && resume?.email),
      educationCount: Array.isArray(resume?.education) ? resume.education.length : 0,
      completion,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// STUDENT: upsert their own profile — a mix of the small editable User subset and the full
// StudentProfile record, saved as one call per section from the frontend's per-tab save-on-
// submit UX. Recomputes + persists mandatoryStatus/mandatoryCompletedAt every save so the
// gating check never has to trust a stale value.
router.patch("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { firstName, lastName, ...rest } = req.body || {};

    const userData = {};
    for (const key of STUDENT_EDITABLE_USER_FIELDS) {
      if (rest[key] !== undefined) userData[key] = rest[key] || null;
    }
    if (userData.mobile && !MOBILE_RE.test(userData.mobile)) {
      return res.status(400).json({ error: "Enter a valid mobile number" });
    }
    // First/Last Name is a UI-only split — joined back into the single User.name field this
    // platform already uses everywhere (audit logs, certificates, emails, dashboards).
    if (firstName !== undefined || lastName !== undefined) {
      const first = String(firstName || "").trim();
      const last = String(lastName || "").trim();
      if (!first || !last) return res.status(400).json({ error: "First name and last name are both required" });
      userData.name = `${first} ${last}`;
    }

    const profileData = {};
    for (const key of STUDENT_PROFILE_FIELDS) {
      if (rest[key] !== undefined) profileData[key] = rest[key] || null;
    }
    if (profileData.dob) profileData.dob = new Date(profileData.dob);
    if (profileData.fatherContact && !MOBILE_RE.test(profileData.fatherContact)) {
      return res.status(400).json({ error: "Enter a valid father's contact number" });
    }
    if (profileData.motherContact && !MOBILE_RE.test(profileData.motherContact)) {
      return res.status(400).json({ error: "Enter a valid mother's contact number" });
    }
    if (profileData.placementParticipation === "NOT_INTERESTED" || rest.placementParticipation === "INTERESTED") {
      profileData.placementUpdatedAt = new Date();
    }

    await prisma.$transaction([
      ...(Object.keys(userData).length ? [prisma.user.update({ where: { id: req.user.id }, data: userData })] : []),
      prisma.studentProfile.upsert({
        where: { studentId: req.user.id },
        create: { studentId: req.user.id, ...profileData },
        update: profileData,
      }),
    ]);

    const { user: freshUser, studentProfile, resume } = await loadCompletionInputs(req.user.id);
    const completion = computeMandatoryCompletion(freshUser, studentProfile, resume);
    const wasComplete = studentProfile?.mandatoryStatus === "COMPLETED";
    await prisma.studentProfile.update({
      where: { studentId: req.user.id },
      data: {
        mandatoryStatus: completion.status,
        mandatoryCompletedAt: completion.complete && !wasComplete ? new Date() : studentProfile?.mandatoryCompletedAt,
      },
    });

    await logAudit({
      req, action: AUDIT_ACTIONS.STUDENT_PROFILE_UPDATED,
      actorId: req.user.id, actorName: freshUser?.name || req.user.name, actorRole: "STUDENT",
      studentId: req.user.id, instituteId: freshUser?.instituteId,
      details: { self: true, fieldsChanged: [...Object.keys(userData), ...Object.keys(profileData)], mandatoryStatus: completion.status },
    });

    res.json({
      success: true,
      completion,
      user: { id: freshUser.id, name: freshUser.name, mobile: freshUser.mobile, gender: freshUser.gender, profilePhotoUrl: freshUser.profilePhotoUrl },
      profile: await prisma.studentProfile.findUnique({ where: { studentId: req.user.id } }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

// ADMIN/STAFF/CLERK: view a specific student's profile — own institute only for scoped roles
// (unscoped Platform Admin sees everyone), same convention as every other institute-scoped route.
router.get("/:studentId", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.studentId } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Student not found" });
    }

    const { user, studentProfile, resume } = await loadCompletionInputs(req.params.studentId);
    const completion = computeMandatoryCompletion(user, studentProfile, resume);
    res.json({
      user: {
        id: user.id, name: user.name, email: user.email, mobile: user.mobile,
        gender: user.gender, profilePhotoUrl: user.profilePhotoUrl,
        rollNumber: user.rollNumber, registrationNumber: user.registrationNumber,
      },
      profile: studentProfile,
      hasResume: !!(resume?.fullName && resume?.email),
      education: Array.isArray(resume?.education) ? resume.education : [],
      completion,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load student profile" });
  }
});

// ADMIN/STAFF: set a student's CGPA — admin-entered only (mirrors placementOffers.js's
// department-eligibility upsert-with-setBy/setAt pattern exactly). Deliberately not in
// STUDENT_PROFILE_FIELDS above, so a student can never self-report this — it's a Talent Pool
// auto-selection criterion and needs to stay a trustworthy, staff-verified number.
router.patch("/students/:studentId/cgpa", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const cgpa = Number(req.body.cgpa);
    if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) return res.status(400).json({ error: "cgpa must be a number between 0 and 10" });

    const student = await prisma.user.findUnique({ where: { id: req.params.studentId } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Student not found" });
    }

    const profile = await prisma.studentProfile.upsert({
      where: { studentId: req.params.studentId },
      create: { studentId: req.params.studentId, cgpa, cgpaSetBy: req.user.name, cgpaSetAt: new Date() },
      update: { cgpa, cgpaSetBy: req.user.name, cgpaSetAt: new Date() },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.STUDENT_PROFILE_UPDATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: req.params.studentId, instituteId: student.instituteId, details: { type: "cgpa", cgpa },
    });
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update CGPA" });
  }
});

// ADMIN/STAFF/CLERK: downloadable PDF of the same profile data above, for offline record-keeping
// (e.g. Placement Cell staff printing a student's academic-record sheet).
router.get("/:studentId/report.pdf", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.studentId } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Student not found" });
    }

    const { user, studentProfile, resume } = await loadCompletionInputs(req.params.studentId);
    const instituteRecord = student.instituteId ? await prisma.institute.findUnique({ where: { id: student.instituteId } }) : null;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${(user.rollNumber || user.id)}-profile.pdf"`);
    generateStudentProfilePdf({
      user, studentProfile, instituteName: instituteRecord?.name,
      education: Array.isArray(resume?.education) ? resume.education : [],
    }, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate profile PDF" });
  }
});

module.exports = router;
