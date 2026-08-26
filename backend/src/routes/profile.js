const express = require("express");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { computeMandatoryCompletion, MOBILE_RE, PINCODE_RE } = require("../utils/studentProfileCompletion");
const { isValidEmail } = require("../utils/emailValidation");
const { ROLL_NUMBER_MAX_LENGTH, isValidRollNumber } = require("../utils/studentIdentifiers");
const { generateStudentProfilePdf } = require("../utils/studentProfilePdf");
const { encryptProfileData, decryptProfile } = require("../utils/piiEncryption");

const router = express.Router();

// Every User field a student may edit from their own profile — deliberately narrower than the
// admin-only PATCH /users/:id allowlist (no registrationNumber/instituteId/isActive). Roll Number
// IS student-editable — it's the classroom number, not the permanent unique Registration Number
// (PRN), which stays admin-only.
const STUDENT_EDITABLE_USER_FIELDS = ["mobile", "gender", "profilePhotoUrl", "rollNumber"];
const STUDENT_PROFILE_FIELDS = [
  "personalEmail", "dob", "address", "state", "district", "pincode",
  "fatherName", "fatherContact", "motherName", "motherContact", "shortDescription",
  "leetcodeHandle", "hackerrankHandle", "stopstalkHandle", "amcatId", "cocubesId",
  "placementParticipation", "placementDeclineReason", "placementDeclineOther",
];

// Sequential, not Promise.all — GET /profile/me is checked on nearly every protected page load
// (App.jsx's profile-completion gate), so every student's session can fire this repeatedly in a
// short window. Same pool-contention reasoning as auth.js/dashboard.js.
async function loadCompletionInputs(studentId) {
  const user = await prisma.user.findUnique({ where: { id: studentId }, include: { institute: { select: { name: true } } } });
  const studentProfile = await prisma.studentProfile.findUnique({ where: { studentId } });
  const resume = await prisma.resume.findUnique({ where: { studentId }, select: { education: true, fullName: true, email: true, linkedin: true } });
  const documents = await prisma.studentDocument.findMany({ where: { studentId }, select: { id: true } });
  return { user, studentProfile: decryptProfile(studentProfile), resume, documents };
}

// STUDENT: merged view of everything the profile page renders — User's identity subset,
// StudentProfile's additional fields, Resume's existence/education (for the completion
// checklist), and the computed completion result (never trust a client-side percentage).
router.get("/me", authenticate, requireRole("STUDENT"), async (req, res) => {
  try {
    const { user, studentProfile, resume, documents } = await loadCompletionInputs(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const completion = computeMandatoryCompletion(user, studentProfile, resume, documents);

    res.json({
      user: {
        id: user.id, name: user.name, email: user.email, mobile: user.mobile,
        gender: user.gender, profilePhotoUrl: user.profilePhotoUrl,
        rollNumber: user.rollNumber, registrationNumber: user.registrationNumber,
        institute: user.institute,
      },
      profile: studentProfile,
      hasResume: !!(resume?.fullName && resume?.email),
      educationCount: Array.isArray(resume?.education) ? resume.education.length : 0,
      linkedin: resume?.linkedin || null,
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
    // Client-side (FileUpload.jsx) already validates type/size before encoding, but the server
    // must be the actual source of truth: reject anything that isn't a genuine image data URL
    // (never an arbitrary string/script/executable disguised with an image extension) and cap the
    // encoded size — a compressed photo should never approach this, so hitting it means either a
    // bug in the client-side compression or a deliberately oversized payload.
    if (userData.profilePhotoUrl) {
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(userData.profilePhotoUrl)) {
        return res.status(400).json({ error: "Profile photo must be a valid image (PNG, JPEG, or WEBP)." });
      }
      if (userData.profilePhotoUrl.length > 700_000) {
        return res.status(400).json({ error: "Profile photo is too large after processing. Please choose a smaller image." });
      }
    }
    // Roll Number is the classroom number, intentionally not unique platform-wide (duplicates
    // across different Academic Groups are expected by design) — but a collision within the
    // SAME group (Institute+Batch+Department+Section) IS a real conflict, so it's checked here
    // the same way users.js's admin-facing routes already do. Previously this route only
    // trimmed/length-checked the value with no format or uniqueness check at all, which let a
    // student self-edit into a non-numeric value or a same-group clash that admin-side routes
    // would have rejected.
    if ("rollNumber" in userData) {
      userData.rollNumber = String(userData.rollNumber || "").trim() || null;
      if (userData.rollNumber && userData.rollNumber.length > ROLL_NUMBER_MAX_LENGTH) {
        return res.status(400).json({ error: "Roll Number cannot exceed 3 characters" });
      }
      if (userData.rollNumber && !isValidRollNumber(userData.rollNumber)) {
        return res.status(400).json({ error: "Roll Number must be exactly 3 digits" });
      }
      if (userData.rollNumber) {
        const self = await prisma.user.findUnique({ where: { id: req.user.id }, select: { academicGroupId: true } });
        if (self?.academicGroupId) {
          const clash = await prisma.user.findFirst({
            where: { academicGroupId: self.academicGroupId, role: "STUDENT", rollNumber: userData.rollNumber, id: { not: req.user.id } },
            select: { name: true },
          });
          if (clash) return res.status(409).json({ error: `Roll Number "${userData.rollNumber}" is already used by ${clash.name} in your Batch/Department/Section — choose a different Roll Number.` });
        }
      }
    }
    // First/Last Name is a UI-only split — joined back into the single User.name field this
    // platform already uses everywhere (audit logs, certificates, emails, dashboards).
    if (firstName !== undefined || lastName !== undefined) {
      const first = String(firstName || "").trim();
      const last = String(lastName || "").trim();
      if (!first || !last) return res.status(400).json({ error: "First name and last name are both required" });
      userData.name = `${first} ${last}`;
    }

    // Format-validate personalEmail/pincode/dob only when the student is actually changing that
    // field — these three fields went unvalidated for a long time, so plenty of already-saved
    // profiles have a value that wouldn't pass today's stricter check. Since every save on this
    // tab resubmits the whole form (not just the field the student touched), validating an
    // untouched legacy value would permanently block that student from saving anything at all on
    // this tab. Comparing against the currently-stored (decrypted) value keeps validation strict
    // for genuinely new input while never punishing someone for data saved before this existed.
    const existingProfileForCompare = decryptProfile(await prisma.studentProfile.findUnique({ where: { studentId: req.user.id } }));

    const profileData = {};
    for (const key of STUDENT_PROFILE_FIELDS) {
      if (rest[key] !== undefined) profileData[key] = rest[key] || null;
    }
    if (profileData.personalEmail) profileData.personalEmail = profileData.personalEmail.trim();
    if (profileData.personalEmail && profileData.personalEmail !== existingProfileForCompare?.personalEmail && !isValidEmail(profileData.personalEmail)) {
      return res.status(400).json({ error: "Enter a valid personal email address" });
    }
    if (profileData.pincode && profileData.pincode !== existingProfileForCompare?.pincode && !PINCODE_RE.test(profileData.pincode)) {
      return res.status(400).json({ error: "Enter a valid pincode" });
    }
    if (profileData.dob) {
      const dob = new Date(profileData.dob);
      const dobChanged = !existingProfileForCompare?.dob || dob.getTime() !== new Date(existingProfileForCompare.dob).getTime();
      if (dobChanged && (Number.isNaN(dob.getTime()) || dob.getTime() >= Date.now())) {
        return res.status(400).json({ error: "Enter a valid date of birth" });
      }
      profileData.dob = dob;
    }
    if (profileData.fatherContact && !MOBILE_RE.test(profileData.fatherContact)) {
      return res.status(400).json({ error: "Enter a valid father's contact number" });
    }
    if (profileData.motherContact && !MOBILE_RE.test(profileData.motherContact)) {
      return res.status(400).json({ error: "Enter a valid mother's contact number" });
    }
    if (profileData.placementParticipation === "NOT_INTERESTED" || rest.placementParticipation === "INTERESTED") {
      profileData.placementUpdatedAt = new Date();
    }

    // Isolated from the outer catch's generic "Failed to save profile" so a misconfigured
    // PII_ENCRYPTION_KEY (loadKey() throws synchronously here, before any DB write) surfaces as
    // its own clearly-tagged log line instead of being indistinguishable from a real DB failure —
    // this exact failure mode is what caused students to see "Failed to save profile" whenever
    // their edit touched an encrypted field (personalEmail/address/state/district/pincode/
    // father*/mother*) while the key was unset, and silently succeed otherwise, which is why the
    // symptom looked intermittent/"partially saved" rather than a hard outage.
    let encryptedProfileData;
    try {
      encryptedProfileData = encryptProfileData(profileData);
    } catch (encErr) {
      console.error("[profile.patchMe] PII encryption failed:", { userId: req.user.id, message: encErr.message });
      return res.status(503).json({ error: "Profile save is temporarily unavailable due to a server configuration issue. Please try again later or contact support." });
    }
    await prisma.$transaction([
      ...(Object.keys(userData).length ? [prisma.user.update({ where: { id: req.user.id }, data: userData })] : []),
      prisma.studentProfile.upsert({
        where: { studentId: req.user.id },
        create: { studentId: req.user.id, ...encryptedProfileData },
        update: encryptedProfileData,
      }),
    ]);

    const { user: freshUser, studentProfile, resume, documents } = await loadCompletionInputs(req.user.id);
    const completion = computeMandatoryCompletion(freshUser, studentProfile, resume, documents);
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
      user: { id: freshUser.id, name: freshUser.name, mobile: freshUser.mobile, gender: freshUser.gender, profilePhotoUrl: freshUser.profilePhotoUrl, rollNumber: freshUser.rollNumber, registrationNumber: freshUser.registrationNumber },
      profile: decryptProfile(await prisma.studentProfile.findUnique({ where: { studentId: req.user.id } })),
    });
  } catch (err) {
    console.error("[profile.patchMe] failed:", { userId: req.user.id, message: err.message, code: err.code, meta: err.meta });
    // Safety net for a unique-constraint collision (none of the student-editable fields are
    // unique today, but this keeps the response meaningful rather than a raw 500 if that ever
    // changes) — same convention as users.js's create/update routes.
    if (err.code === "P2002") {
      return res.status(409).json({ error: `That ${Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "value"} is already in use.` });
    }
    res.status(500).json({ error: "Failed to save profile. Please try again, and contact support if the issue persists." });
  }
});

// STAFF/CLERK/ADMIN/INSTITUTE_ADMIN/SUPER_ADMIN: self-service profile edit (name/mobile/photo/
// LinkedIn) — the non-student equivalent of PATCH /me above. Deliberately separate from that route
// (different editable-field set, no StudentProfile/completion-tracking involved) and from
// users.js's PATCH /me (which is security-sensitive email/password change requiring
// currentPassword + rate-limiting — mixing a photo upload into that flow would force every
// profile-photo change to also re-enter a password for no security benefit).
router.patch("/me/account", authenticate, requireRole("STAFF", "CLERK", "ADMIN", "INSTITUTE_ADMIN", "SUPER_ADMIN"), async (req, res) => {
  try {
    const { name, mobile, profilePhotoUrl, linkedinUrl } = req.body || {};
    const data = {};

    if (name !== undefined) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return res.status(400).json({ error: "Name cannot be empty" });
      data.name = trimmed;
    }
    if (mobile !== undefined) {
      const trimmed = String(mobile || "").trim();
      if (trimmed && !MOBILE_RE.test(trimmed)) return res.status(400).json({ error: "Enter a valid mobile number" });
      data.mobile = trimmed || null;
    }
    if (profilePhotoUrl !== undefined) {
      if (profilePhotoUrl) {
        if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(profilePhotoUrl)) {
          return res.status(400).json({ error: "Profile photo must be a valid image (PNG, JPEG, or WEBP)." });
        }
        if (profilePhotoUrl.length > 700_000) {
          return res.status(400).json({ error: "Profile photo is too large after processing. Please choose a smaller image." });
        }
      }
      data.profilePhotoUrl = profilePhotoUrl || null;
    }
    if (linkedinUrl !== undefined) {
      const trimmed = String(linkedinUrl || "").trim();
      if (trimmed && !/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i.test(trimmed)) {
        return res.status(400).json({ error: "Enter a valid LinkedIn profile URL (must start with https://linkedin.com/)." });
      }
      data.linkedinUrl = trimmed || null;
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, name: true, mobile: true, profilePhotoUrl: true, linkedinUrl: true, role: true },
    });
    await logAudit({
      req, action: AUDIT_ACTIONS.USER_PROFILE_UPDATED,
      actorId: req.user.id, actorName: updated.name, actorRole: req.user.role,
      instituteId: req.user.instituteId,
      details: { self: true, fieldsChanged: Object.keys(data) },
    });
    res.json({ success: true, user: updated });
  } catch (err) {
    console.error("[profile.patchMeAccount] failed:", { userId: req.user.id, message: err.message });
    res.status(500).json({ error: "Failed to save profile. Please try again." });
  }
});

// ADMIN/STAFF/CLERK: view a specific student's profile — own institute only for scoped roles
// (unscoped Platform Admin sees everyone), same convention as every other institute-scoped route.
router.get("/:studentId", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.studentId } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Student not found" });
    }

    const { user, studentProfile, resume, documents } = await loadCompletionInputs(req.params.studentId);
    const completion = computeMandatoryCompletion(user, studentProfile, resume, documents);
    res.json({
      user: {
        id: user.id, name: user.name, email: user.email, mobile: user.mobile,
        gender: user.gender, profilePhotoUrl: user.profilePhotoUrl,
        rollNumber: user.rollNumber, registrationNumber: user.registrationNumber,
        institute: user.institute,
      },
      profile: studentProfile,
      hasResume: !!(resume?.fullName && resume?.email),
      education: Array.isArray(resume?.education) ? resume.education : [],
      linkedin: resume?.linkedin || null,
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
router.patch("/students/:studentId/cgpa", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
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
    res.json(decryptProfile(profile));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update CGPA" });
  }
});

// ADMIN/STAFF/CLERK: downloadable PDF of the same profile data above, for offline record-keeping
// (e.g. Placement Cell staff printing a student's academic-record sheet).
router.get("/:studentId/report.pdf", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.studentId } });
    if (!student || student.role !== "STUDENT") return res.status(404).json({ error: "Student not found" });
    if (req.requesterInstituteId && student.instituteId !== req.requesterInstituteId) {
      return res.status(404).json({ error: "Student not found" });
    }

    const { user, studentProfile, resume } = await loadCompletionInputs(req.params.studentId);
    const instituteRecord = student.instituteId ? await prisma.institute.findUnique({ where: { id: student.instituteId } }) : null;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${(user.registrationNumber || user.id)}-profile.pdf"`);
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
