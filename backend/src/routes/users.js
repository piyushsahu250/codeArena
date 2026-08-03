const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { sendMailLogged, wrapBranded } = require("../utils/mailer");
const { computeStudentPerformance } = require("../utils/studentPerformance");
const { generatePerformancePdf } = require("../utils/reportPdf");
const { generateTempPassword, validatePasswordComplexity, isPasswordReused, recordPasswordChange } = require("../utils/password");
const { createSession } = require("../utils/sessions");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { deleteAcademicGroupIfEmpty } = require("../utils/academicGroups");
const cache = require("../utils/cache");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena-app.vercel.app";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[0-9]{10,15}$/;

const SELECT_FIELDS = {
  id: true, name: true, email: true, role: true, rollNumber: true, registrationNumber: true, department: true,
  mobile: true, gender: true, program: true, batchYear: true, section: true, isActive: true, profilePhotoUrl: true, createdAt: true,
  mustChangePassword: true, accountStatus: true, employeeId: true, designation: true, lastLoginAt: true,
  institute: { select: { id: true, name: true } },
  class: { select: { id: true, name: true, batchYear: true } },
  academicGroup: { select: { id: true, batch: true, section: true, department: { select: { id: true, name: true } } } },
};


// Maps flexible spreadsheet header text -> our field names
const FIELD_ALIASES = {
  name: ["student name", "name", "full name"],
  rollNumber: ["roll number", "roll no", "rollno", "roll no."],
  email: ["official email id", "email", "email id", "official email"],
  mobile: ["mobile number", "mobile", "phone", "phone number"],
  department: ["department", "dept"],
  program: ["program", "course"],
  batchYear: ["batch/year", "batch year", "batch", "year"],
  section: ["section"],
  instituteName: ["institute", "institute name", "college", "college name"],
};

// Institute -> Batch -> Department -> Section: find-or-create the academic group a student belongs
// to, replacing the old single-key Class match. Department/Section fall back to "Unassigned"/
// "Section A" when left blank (same fallback the one-time migration script used for pre-existing
// classes with no Division), matched case-insensitively/trimmed so trivial spelling differences
// don't fragment groups. `cache` is an optional per-request Map to avoid redundant lookups when a
// bulk upload has many rows sharing the same group.
async function resolveAcademicGroup({ instituteId, batchYear, departmentName, section }, cache) {
  const batch = String(batchYear || "").trim() || "Unassigned";
  const deptName = String(departmentName || "").trim() || "Unassigned";
  const sectionName = String(section || "").trim() || "Section A";
  const key = `${instituteId}::${batch.toLowerCase()}::${deptName.toLowerCase()}::${sectionName.toLowerCase()}`;
  if (cache && cache.has(key)) return cache.get(key);

  let department = await prisma.department.findFirst({
    where: { instituteId, name: { equals: deptName, mode: "insensitive" } },
  });
  if (!department) {
    department = await prisma.department.create({ data: { instituteId, name: deptName } });
  }

  let group = await prisma.academicGroup.findFirst({
    where: { instituteId, batch, departmentId: department.id, section: { equals: sectionName, mode: "insensitive" } },
    include: { department: true },
  });
  if (!group) {
    group = await prisma.academicGroup.create({
      data: { instituteId, batch, departmentId: department.id, section: sectionName },
      include: { department: true },
    });
  }
  if (cache) cache.set(key, group);
  return group;
}

function normalizeHeader(str) {
  return String(str || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildHeaderMap(headers) {
  const map = {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (!map[field] && aliases.includes(norm)) map[field] = header;
    }
  }
  return map;
}

const TEMPLATE_HEADERS = ["Student Name", "Roll Number", "Official Email ID", "Institute", "Batch/Year", "Mobile Number", "Department", "Program", "Section"];

// Any authenticated user: change their own email and/or password
router.patch("/me", authenticate, async (req, res) => {
  try {
    const { currentPassword, newEmail, newPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: "currentPassword is required" });
    }
    if (!newEmail && !newPassword) {
      return res.status(400).json({ error: "Provide newEmail and/or newPassword" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const data = {};
    if (newEmail && newEmail !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email: newEmail } });
      if (existing) return res.status(409).json({ error: "Email already in use" });
      data.email = newEmail;
    }
    const institute = user.instituteId ? await prisma.institute.findUnique({ where: { id: user.instituteId } }) : null;
    let newPasswordHash = null;
    if (newPassword) {
      const complexityError = validatePasswordComplexity(newPassword);
      if (complexityError) return res.status(400).json({ error: complexityError });
      if (newPassword === currentPassword) return res.status(400).json({ error: "New password cannot be the same as your current password" });
      if (await isPasswordReused(prisma, user.id, newPassword, institute?.passwordHistoryDepth)) {
        return res.status(400).json({ error: `You've used this password recently. Choose a password you haven't used in your last ${institute?.passwordHistoryDepth ?? 3} passwords.` });
      }
      newPasswordHash = await bcrypt.hash(newPassword, 10);
      data.passwordHash = newPasswordHash;
      data.mustChangePassword = false;
    }

    // When a password is changing, the hash write and the passwordChangedAt/PasswordHistory
    // write must be atomic (see auth.js's reset-password route for the same reasoning) — a
    // crash between them would leave a changed password untracked for expiry/reuse purposes.
    let updated;
    if (newPasswordHash) {
      await prisma.$transaction(async (tx) => {
        updated = await tx.user.update({ where: { id: user.id }, data, select: SELECT_FIELDS });
        await recordPasswordChange(tx, user.id, newPasswordHash, institute?.passwordHistoryDepth);
      });
    } else {
      updated = await prisma.user.update({ where: { id: user.id }, data, select: SELECT_FIELDS });
    }
    if (newPasswordHash) {
      sendMailLogged(prisma, {
        to: updated.email, name: updated.name, emailType: "LOGIN_ALERT",
        studentId: updated.role === "STUDENT" ? updated.id : null,
        subject: "Your CodeArena password was changed",
        html: wrapBranded(`<p>Hi ${updated.name},</p><p>Your password was just changed from your account settings. If this wasn't you, contact your administrator immediately.</p>`),
      }).catch((err) => console.error("[users] password-change alert email failed:", err.message));
    }

    const token = await createSession({ user: updated, req, singleSessionOnly: false });
    await logAudit({ req, action: AUDIT_ACTIONS.PASSWORD_CHANGED, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.role === "STUDENT" ? user.id : null, instituteId: user.instituteId, details: { self: true, emailChanged: !!data.email, passwordChanged: !!newPasswordHash } });

    res.json({ token, user: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update account" });
  }
});

// Any authenticated user: their own login-session history (most recent first), so they can spot
// a device they don't recognize — "Device Tracking" + "view active sessions" from the enterprise
// security spec. Capped at 50 rows; this is a personal history view, not an audit export.
router.get("/me/sessions", authenticate, async (req, res) => {
  try {
    const sessions = await prisma.loginSession.findMany({
      where: { userId: req.user.id },
      orderBy: { loginAt: "desc" },
      take: 50,
      select: { id: true, ip: true, device: true, browser: true, os: true, isActive: true, loginAt: true, logoutAt: true, token: true },
    });
    res.json(sessions.map((s) => ({ ...s, isCurrent: s.token === req.user.jti, token: undefined })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

// Any authenticated user: force-logout one of their OWN other active sessions ("log out from
// other devices"). Deliberately cannot target another user's session — that's an admin action
// this platform doesn't expose (no legitimate reason for staff to remotely kill a student's
// session outside of deactivating the whole account, which already exists).
router.delete("/me/sessions/:sessionId", authenticate, async (req, res) => {
  try {
    const session = await prisma.loginSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session || session.userId !== req.user.id) return res.status(404).json({ error: "Session not found" });
    if (session.token === req.user.jti) return res.status(400).json({ error: "Use Sign Out to end your current session" });

    await prisma.loginSession.update({ where: { id: session.id }, data: { isActive: false, logoutAt: new Date() } });
    cache.invalidate(`session-active:${session.token}`);
    await logAudit({ req, action: AUDIT_ACTIONS.SESSION_REVOKED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role, studentId: req.user.id, details: { revokedSessionId: session.id, device: `${session.browser} on ${session.os}` } });
    res.json({ message: "Session signed out" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sign out session" });
  }
});

// ADMIN: list all users. Paginated — this is the whole User table with no institute scoping
// (platform Super Admin view), which at scale is exactly the "load everything, render everything"
// pattern that doesn't hold up past a few hundred rows.
router.get("/", authenticate, requireRole("ADMIN"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200));
  const [users, total] = await Promise.all([
    prisma.user.findMany({ select: SELECT_FIELDS, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count(),
  ]);
  res.json({ rows: users, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

// ADMIN: create a Staff, Admin, or Student account directly (no self-registration needed).
// Password is a unique, randomly generated temporary one — the admin never types one — and the
// account is flagged to force a password change on first login.
router.post("/", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      name, email, role, rollNumber, registrationNumber, department, mobile, gender, program,
      batchYear, section, instituteId, employeeId, designation,
    } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ error: "name, email, and role are required" });
    }
    if (!EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: "Invalid email address" });
    if (!["STUDENT", "STAFF", "ADMIN", "CLERK"].includes(role)) {
      return res.status(400).json({ error: "role must be STUDENT, STAFF, ADMIN, or CLERK" });
    }
    if (!instituteId) return res.status(400).json({ error: "An institute is required" });
    // An institute-scoped ADMIN must not be able to plant accounts under a different institute by
    // passing an arbitrary instituteId — only a platform-level (unscoped) admin can target any.
    if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only create accounts under your own institute" });
    }
    if (role === "STUDENT" && !String(mobile || "").trim()) return res.status(400).json({ error: "A mobile number is required for students" });
    if (role === "STUDENT" && !String(batchYear || "").trim()) return res.status(400).json({ error: "A batch is required for students" });
    if (mobile && !MOBILE_RE.test(String(mobile).trim())) return res.status(400).json({ error: "Invalid mobile number" });

    const institute = await prisma.institute.findUnique({ where: { id: instituteId } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });

    let academicGroup = null;
    if (role === "STUDENT") {
      academicGroup = await resolveAcademicGroup({ instituteId, batchYear, departmentName: department, section });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    // Roll numbers are only unique within an institute (see the @@unique([instituteId,
    // rollNumber]) constraint on User) — bulk-import already enforced this, but single-account
    // creation never checked at all, so two students could silently end up with the same roll
    // number at the same institute if created one at a time. Checked before create rather than
    // left to surface as a raw DB constraint error.
    if (role === "STUDENT" && String(rollNumber || "").trim()) {
      const dupRoll = await prisma.user.findFirst({ where: { instituteId, rollNumber: String(rollNumber).trim() } });
      if (dupRoll) return res.status(409).json({ error: `Roll number "${rollNumber}" is already in use at ${institute.name}` });
    }
    if (String(employeeId || "").trim()) {
      const dupEmployee = await prisma.user.findFirst({ where: { instituteId, employeeId: String(employeeId).trim() } });
      if (dupEmployee) return res.status(409).json({ error: `Employee ID "${employeeId}" is already in use at ${institute.name}` });
    }

    const generatedPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash, role, rollNumber, registrationNumber, department, mobile, gender,
        program, batchYear, section, instituteId, academicGroupId: academicGroup?.id || null, mustChangePassword: true,
        employeeId: employeeId ? String(employeeId).trim() : null, designation: designation ? String(designation).trim() : null,
      },
      select: SELECT_FIELDS,
    });

    let emailSent = false;
    let emailError = null;
    if (role === "STUDENT") {
      const mailResult = await sendMailLogged(prisma, {
        to: user.email,
        name: user.name,
        studentId: user.id,
        emailType: "WELCOME",
        subject: "Welcome to CodeArena – Your Student Account Has Been Created",
        html: wrapBranded(`
          <p>Dear ${user.name},</p>
          <p>Welcome to CodeArena! Your student account has been created successfully.</p>
          <p><strong>Login Details</strong></p>
          <p>
            Name: ${user.name}<br/>
            Institute: ${institute.name}<br/>
            ${academicGroup ? `Department: ${academicGroup.department.name} · Section: ${academicGroup.section}<br/>` : ""}
            ${batchYear ? `Batch: ${batchYear}<br/>` : ""}
            Email: ${user.email}<br/>
            Temporary Password: <strong>${generatedPassword}</strong>
          </p>
          <p>Login URL: <a href="${FRONTEND_URL}/login">${FRONTEND_URL}/login</a></p>
          <p>For security reasons, you will be required to change your password during your first login.</p>
          <p>If you have any questions, please contact your institute administrator.</p>
          <p>Regards,<br/>CodeArena Team</p>
        `),
      }).catch((e) => ({ ok: false, error: e.message }));
      emailSent = !!mailResult.ok;
      emailError = mailResult.error || null;
    } else {
      const mailResult = await sendMailLogged(prisma, {
        to: user.email,
        name: user.name,
        studentId: user.id,
        emailType: "WELCOME",
        subject: "Your CodeArena account",
        html: wrapBranded(`<p>Hi ${user.name},</p><p>Your account has been created.</p><p><strong>Login email:</strong> ${user.email}<br/><strong>Temporary password:</strong> ${generatedPassword}</p><p>Sign in at <a href="${FRONTEND_URL}/login">${FRONTEND_URL}/login</a> — you'll be asked to set a new password on first login.</p>`),
      }).catch((e) => ({ ok: false, error: e.message }));
      emailSent = !!mailResult.ok;
      emailError = mailResult.error || null;
    }

    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    await prisma.auditLog.create({
      data: {
        action: "ACCOUNT_CREATED",
        adminId: req.user.id,
        adminName: admin?.name || req.user.email,
        details: { studentId: user.id, studentName: user.name, role, email: user.email, emailSent, emailError },
      },
    }).catch(() => {});

    res.json({ ...user, generatedPassword, emailSent, emailError });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// ADMIN: edit an existing student's (or any user's) profile fields. Unlike account creation,
// this never touches the password — email uniqueness and mobile format are the only validated
// fields, everything else is free-text/FK. Every change is written to AuditLog so there's a
// record of who edited what and when.
const EDITABLE_FIELDS = [
  "name", "email", "mobile", "gender", "rollNumber", "registrationNumber", "department", "program",
  "batchYear", "section", "instituteId", "isActive", "profilePhotoUrl", "employeeId", "designation",
];
router.patch("/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "User not found" });
    if (req.requesterInstituteId && existing.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only edit users under your own institute" });
    }
    if (req.requesterInstituteId && req.body.instituteId !== undefined && req.body.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You cannot move a user to a different institute" });
    }

    const data = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }

    if (data.email !== undefined) {
      const email = String(data.email).trim();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email address" });
      if (email !== existing.email) {
        const dup = await prisma.user.findUnique({ where: { email } });
        if (dup) return res.status(409).json({ error: "Email already registered to another account" });
      }
      data.email = email;
    }
    if (data.mobile !== undefined && data.mobile !== null && data.mobile !== "") {
      if (!MOBILE_RE.test(String(data.mobile).trim())) return res.status(400).json({ error: "Invalid mobile number" });
    }
    // Roll numbers are only unique within an institute (see the @@unique([instituteId,
    // rollNumber]) constraint on User) — check before saving so a raw DB constraint error never
    // surfaces to the admin. Blank input must be normalized to `null`, never left as `""` — the
    // unique constraint treats NULL as "never conflicts" but treats "" as a real, collidable
    // value, so saving one blank-rollNumber account as "" would then 500 the very next unrelated
    // account's save the moment it also happened to have a blank rollNumber at the same institute.
    if (data.rollNumber !== undefined) {
      const rollNumber = String(data.rollNumber || "").trim();
      if (!rollNumber) {
        data.rollNumber = null;
      } else {
        const targetInstituteId = data.instituteId !== undefined ? data.instituteId : existing.instituteId;
        if (rollNumber !== existing.rollNumber || targetInstituteId !== existing.instituteId) {
          const dupRoll = await prisma.user.findFirst({ where: { instituteId: targetInstituteId, rollNumber, id: { not: existing.id } } });
          if (dupRoll) return res.status(409).json({ error: "That roll number is already in use by another account at this institute" });
        }
        data.rollNumber = rollNumber;
      }
    }
    // Same NULL-tolerant per-institute uniqueness (and the same blank->null normalization) as
    // rollNumber above, for Staff/Clerk employee IDs.
    if (data.employeeId !== undefined) {
      const employeeId = String(data.employeeId || "").trim();
      if (!employeeId) {
        data.employeeId = null;
      } else {
        const targetInstituteId = data.instituteId !== undefined ? data.instituteId : existing.instituteId;
        if (employeeId !== existing.employeeId || targetInstituteId !== existing.instituteId) {
          const dupEmployee = await prisma.user.findFirst({ where: { instituteId: targetInstituteId, employeeId, id: { not: existing.id } } });
          if (dupEmployee) return res.status(409).json({ error: "That employee ID is already in use by another account at this institute" });
        }
        data.employeeId = employeeId;
      }
    }
    if (data.instituteId) {
      const institute = await prisma.institute.findUnique({ where: { id: data.instituteId } });
      if (!institute) return res.status(404).json({ error: "Institute not found" });
    }
    // Re-resolve the academic group whenever any of its 4 keys change, so an edited batch/
    // department/section (or a moved institute) keeps the student's group current.
    if (existing.role === "STUDENT" && (data.batchYear !== undefined || data.department !== undefined || data.section !== undefined || data.instituteId !== undefined)) {
      const group = await resolveAcademicGroup({
        instituteId: data.instituteId !== undefined ? data.instituteId : existing.instituteId,
        batchYear: data.batchYear !== undefined ? data.batchYear : existing.batchYear,
        departmentName: data.department !== undefined ? data.department : existing.department,
        section: data.section !== undefined ? data.section : existing.section,
      });
      data.academicGroupId = group.id;
    }

    const changedFields = Object.keys(data).filter((f) => String(existing[f] ?? "") !== String(data[f] ?? ""));
    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });

    const [updated] = await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data, select: SELECT_FIELDS }),
      prisma.auditLog.create({
        data: {
          action: existing.role === "STUDENT" ? "STUDENT_PROFILE_UPDATED" : "USER_PROFILE_UPDATED",
          adminId: req.user.id,
          adminName: admin?.name || req.user.email,
          details: {
            studentId: existing.id,
            studentName: existing.name,
            changedFields,
            before: Object.fromEntries(changedFields.map((f) => [f, existing[f]])),
            after: Object.fromEntries(changedFields.map((f) => [f, data[f]])),
          },
        },
      }),
    ]);

    // If this student just moved to a different academic group, the OLD group may now be empty —
    // an Academic Group is purely auto-derived (see resolveAcademicGroup() above), so once nothing
    // is enrolled in it anymore it should never be left behind as a dangling empty row.
    if (data.academicGroupId !== undefined && data.academicGroupId !== existing.academicGroupId) {
      await deleteAcademicGroupIfEmpty(existing.academicGroupId);
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    // Safety net for any unique-constraint collision the pre-checks above didn't already catch
    // (e.g. a race between two concurrent edits) — surfaces as a clean 409, not an opaque 500.
    if (err.code === "P2002") {
      return res.status(409).json({ error: `That ${Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "value"} is already in use.` });
    }
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ADMIN: download a sample .xlsx template for bulk student upload
router.get("/bulk-template", authenticate, requireRole("ADMIN"), (req, res) => {
  const sampleRow = ["John Doe", "MCA2024001", "john.doe@codearena.edu.in", "CodeArena University", "2024-26", "9876543210", "Computer Applications", "MCA", "A"];
  const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, sampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Students");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=student-upload-template.xlsx");
  res.send(buffer);
});

// ADMIN: bulk-create student accounts from an uploaded .xlsx/.csv file.
// Each row must name an existing Institute and a Batch/Year — Department and Section are optional
// (falling back to "Unassigned"/"Section A"). Every (Institute, Batch, Department, Section)
// combination is found-or-created automatically as an AcademicGroup; there's no separate "Class"
// to create ahead of time anymore. Each row gets its own unique, randomly generated password (not
// shared with any other row), and the account is flagged to force a password change on first login.
router.post("/bulk-upload", authenticate, requireRole("ADMIN"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
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

    const headerMap = buildHeaderMap(Object.keys(rows[0]));
    if (!headerMap.name || !headerMap.rollNumber || !headerMap.email) {
      return res.status(400).json({
        error: "Missing required columns. The file must include Student Name, Roll Number, and Official Email ID.",
      });
    }
    if (!headerMap.instituteName || !headerMap.batchYear) {
      return res.status(400).json({
        error: "Missing required columns. The file must include Institute and Batch/Year.",
      });
    }

    const sendCredentials = req.body.sendCredentials === "true";

    const [existingUsers, institutes] = await Promise.all([
      prisma.user.findMany({ select: { email: true, rollNumber: true, instituteId: true } }),
      prisma.institute.findMany(),
    ]);
    const existingEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
    // Roll numbers are only unique WITHIN an institute (mirrors the new
    // @@unique([instituteId, rollNumber]) DB constraint) — the same roll number legitimately
    // exists at two different institutes, so the dedup key must include instituteId, not just
    // the roll number on its own.
    const existingRolls = new Set(existingUsers.filter((u) => u.rollNumber).map((u) => `${u.instituteId || ""}::${u.rollNumber.toLowerCase()}`));
    const seenEmails = new Set();
    const seenRolls = new Set();
    const instituteByName = new Map(institutes.map((i) => [i.name.toLowerCase(), i]));
    const groupCache = new Map(); // reused across rows sharing the same (institute, batch, department, section)

    const created = [];
    const duplicates = [];
    const errors = [];

    const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
      const row = rows[i];
      const name = field(row, "name");
      const rollNumber = field(row, "rollNumber");
      const email = field(row, "email").toLowerCase();
      const mobile = field(row, "mobile");
      const department = field(row, "department");
      const program = field(row, "program");
      const batchYear = field(row, "batchYear");
      const section = field(row, "section");
      const instituteName = field(row, "instituteName");

      if (!name && !rollNumber && !email) continue; // blank row

      if (!name || !rollNumber || !email || !instituteName || !batchYear) {
        errors.push({ row: rowNum, name, email, rollNumber, reason: "Missing required field (name, roll number, email, institute, or batch/year)" });
        continue;
      }
      if (!EMAIL_RE.test(email)) {
        errors.push({ row: rowNum, name, email, rollNumber, reason: "Invalid email format" });
        continue;
      }

      const institute = instituteByName.get(instituteName.toLowerCase());
      if (!institute) {
        errors.push({ row: rowNum, name, email, rollNumber, reason: `Institute "${instituteName}" was not found. Create it first in Institute Management.` });
        continue;
      }
      // Mirrors the same guard on POST / — an institute-scoped ADMIN can only import students
      // into their own institute, regardless of what the uploaded file's Institute column says.
      if (req.requesterInstituteId && institute.id !== req.requesterInstituteId) {
        errors.push({ row: rowNum, name, email, rollNumber, reason: `You can only upload students to your own institute` });
        continue;
      }

      const rollKey = `${institute.id}::${rollNumber.toLowerCase()}`;
      if (existingEmails.has(email) || seenEmails.has(email)) {
        duplicates.push({ row: rowNum, name, email, rollNumber, reason: "Email already exists" });
        continue;
      }
      if (existingRolls.has(rollKey) || seenRolls.has(rollKey)) {
        duplicates.push({ row: rowNum, name, email, rollNumber, reason: `Roll number already exists at ${institute.name}` });
        continue;
      }

      seenEmails.add(email);
      seenRolls.add(rollKey);

      const generatedPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 10);

      try {
        const group = await resolveAcademicGroup({ instituteId: institute.id, batchYear, departmentName: department, section }, groupCache);
        const user = await prisma.user.create({
          data: {
            name, email, rollNumber, passwordHash, role: "STUDENT",
            mobile: mobile || null,
            department: department || null,
            program: program || null,
            batchYear: batchYear || null,
            section: section || null,
            instituteId: institute.id,
            academicGroupId: group.id,
            mustChangePassword: true,
          },
        });
        created.push({ ...user, generatedPassword });
      } catch (err) {
        errors.push({ row: rowNum, name, email, rollNumber, reason: "Failed to create account" });
      }
    }

    let emailsSentCount = 0;
    let emailsFailedCount = 0;
    if (sendCredentials && created.length > 0) {
      for (const u of created) {
        const mailResult = await sendMailLogged(prisma, {
          to: u.email,
          name: u.name,
          studentId: u.id,
          emailType: "WELCOME",
          subject: "Your CodeArena account",
          html: wrapBranded(`<p>Hi ${u.name},</p><p>Your student account has been created.</p><p><strong>Login email:</strong> ${u.email}<br/><strong>Temporary password:</strong> ${u.generatedPassword}</p><p>Sign in at <a href="${FRONTEND_URL}/login">${FRONTEND_URL}/login</a> — you'll be asked to set a new password on first login.</p>`),
        }).catch((e) => ({ ok: false, error: e.message }));
        u.emailSent = !!mailResult.ok;
        if (mailResult.ok) emailsSentCount++;
        else emailsFailedCount++;
      }
    }

    res.json({
      total: rows.length,
      createdCount: created.length,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      created: created.map((u) => ({ name: u.name, email: u.email, rollNumber: u.rollNumber, generatedPassword: u.generatedPassword, emailSent: u.emailSent ?? null })),
      duplicates,
      errors,
      sendCredentials,
      emailsSentCount,
      emailsFailedCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk upload failed" });
  }
});

// ADMIN: look up a student by roll number and see which tests they've completed
router.get("/lookup/:query", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const q = req.params.query;
    const user = await prisma.user.findFirst({
      where: {
        role: "STUDENT",
        OR: [{ rollNumber: q }, { email: q }, { id: q }],
        ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        rollNumber: true,
        attempts: {
          select: {
            status: true,
            totalScore: true,
            startedAt: true,
            submittedAt: true,
            tabSwitchCount: true,
            test: { select: { id: true, title: true, isPublished: true } },
          },
          orderBy: { startedAt: "desc" },
        },
      },
    });
    if (!user) return res.status(404).json({ error: "No student found with that roll number, email, or ID" });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

// ADMIN/STAFF: search students by ID, roll number, name, or official email — institute-scoped
// accounts only ever match students under their own institute. Powers the Student Performance
// Dashboard's search box; results are capped and meant for picking one student, not browsing.
router.get("/search", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);
    const students = await prisma.user.findMany({
      where: {
        role: "STUDENT",
        ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
        OR: [
          { id: q },
          { rollNumber: { contains: q, mode: "insensitive" } },
          { registrationNumber: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { mobile: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true, name: true, email: true, rollNumber: true,
        institute: { select: { name: true } },
        class: { select: { name: true, batchYear: true } },
        academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
      take: 20,
    });
    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

// ADMIN/STAFF: hierarchical browse — same result shape as /search, but selected via
// Institute -> Department -> Section instead of typed free-text, for working through an entire
// section's students consecutively instead of searching one at a time. departmentId + section
// are both required: a bare institute/department selection with no section would return an
// entire institute's roster unbounded. Page/pageSize paginated (previously a hard 500-row cap
// with no way to see further students in a large section).
router.get("/browse", authenticate, requireRole("ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { departmentId, section, batch, placementParticipation, offerVerificationStatus } = req.query;
    if (!departmentId || !section) return res.status(400).json({ error: "Department and Section are required" });
    const instituteId = req.requesterInstituteId || req.query.instituteId;
    if (!instituteId) return res.status(400).json({ error: "Institute is required" });

    const groups = await prisma.academicGroup.findMany({
      where: { instituteId, departmentId, section, ...(batch ? { batch } : {}) },
      select: { id: true },
    });
    if (groups.length === 0) return res.json({ rows: [], page: 1, pageSize: 50, total: 0, totalPages: 0 });

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50));

    // Placement Registration Status lives on StudentProfile, not User — a student with no
    // StudentProfile row yet (never opened Profile) is correctly excluded from either
    // "INTERESTED"/"NOT_INTERESTED" filter, same as a Prisma relation-filter on a null relation.
    // Verification Status means "has at least one placement offer with this verification status"
    // — offer-level verification is this pass's scope (see studentProfileCompletion.js /
    // placementOffers.js), not a whole-profile status.
    const where = {
      role: "STUDENT",
      academicGroupId: { in: groups.map((g) => g.id) },
      ...(placementParticipation ? { studentProfile: { placementParticipation } } : {}),
      ...(offerVerificationStatus ? { placementOffers: { some: { verificationStatus: offerVerificationStatus } } } : {}),
    };

    const [students, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, rollNumber: true,
          institute: { select: { name: true } },
          class: { select: { name: true, batchYear: true } },
          academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ rows: students, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Browse failed" });
  }
});

// ADMIN/STAFF: password reset history. Staff sees only resets for students under their own
// institute (matching the same scoping as the reset action itself); an unscoped platform Admin
// sees every institute's history. Capped at 300 rows, most recent first — an operational log,
// not a paginated archive (same convention as /admin/email-logs). Placed before the "/:id"
// catch-all below so this literal segment can never be shadowed by it.
router.get("/password-reset-history", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        action: "PASSWORD_RESET",
        ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    res.json(logs.map((l) => ({
      id: l.id,
      studentName: l.details?.studentName || null,
      studentId: l.studentId,
      resetBy: l.adminName,
      emailSent: l.details?.emailSent ?? null,
      createdAt: l.createdAt,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load password reset history" });
  }
});

// ADMIN/STAFF: general-purpose, searchable/filterable/exportable audit trail — the enterprise
// spec's requirement over and above the narrow password-reset-only view above. Staff are scoped
// to their own institute the same way as everywhere else on this platform; an unscoped platform
// Admin sees every institute. Same "capped operational log, not a paginated archive" convention
// as the routes around it, at a slightly higher cap since this view covers every action type.
router.get("/audit-log", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const { action, studentId, from, to, format } = req.query;
    const where = {
      ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      ...(action ? { action } : {}),
      ...(studentId ? { studentId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    };

    if (format === "csv") {
      // Export stays a single capped pull (same "cap, not paginate" convention as every other
      // export on this platform) — a CSV download is inherently a one-shot "give me everything
      // visible" action, unlike the JSON list view below.
      const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000 });
      const header = "Timestamp,Action,Actor,Role,IP Address,Device,Student ID,Institute ID,Details\n";
      const rows = logs.map((l) => [
        l.createdAt.toISOString(), l.action, l.adminName, l.adminRole || "", l.ipAddress || "", l.deviceInfo || "",
        l.studentId || "", l.instituteId || "", JSON.stringify(l.details || {}).replace(/"/g, '""'),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
      return res.send(header + rows.join("\n"));
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ rows: logs, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

// ADMIN/STAFF: distinct action names currently in the log, for the filter dropdown on the audit
// log page — read from real data rather than hardcoding AUDIT_ACTIONS, since legacy rows (e.g.
// REATTEMPT_GRANTED, STUDENT_PROFILE_UPDATED) predate that catalogue.
router.get("/audit-log/actions", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const rows = await prisma.auditLog.findMany({
      where: req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {},
      select: { action: true },
      distinct: ["action"],
    });
    res.json(rows.map((r) => r.action).sort());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load audit actions" });
  }
});

// ADMIN: read-only counters for the Institute->Batch->Department->Section migration (see
// backend/scripts/migrateAcademicGroups.js) — lets the migration's zero-data-loss gate be checked
// over HTTP instead of requiring direct database access. Kept permanently (cheap aggregate counts),
// not a throwaway diagnostic.
router.get("/migration-status", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const [classesTotal, academicGroupsTotal, studentsWithClassId, studentsWithGroupId, studentsUnlinked] = await Promise.all([
      prisma.class.count(),
      prisma.academicGroup.count(),
      prisma.user.count({ where: { role: "STUDENT", classId: { not: null } } }),
      prisma.user.count({ where: { role: "STUDENT", academicGroupId: { not: null } } }),
      prisma.user.count({ where: { role: "STUDENT", classId: { not: null }, academicGroupId: null } }),
    ]);
    res.json({ classesTotal, academicGroupsTotal, studentsWithClassId, studentsWithGroupId, studentsUnlinked, zeroDataLossGatePassed: studentsUnlinked === 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load migration status" });
  }
});

// Shared access check for the performance dashboard + both report exports: ADMIN/STAFF can view
// any student under their own institute (platform-level accounts see everyone); a STUDENT may
// only view their own. Returns the student's own institute-scope-relevant fields on success, or
// sends the appropriate error response and returns null.
async function authorizeStudentPerformanceAccess(req, res) {
  const targetId = req.params.id;
  if (req.user.role === "STUDENT" && req.user.id !== targetId) {
    res.status(403).json({ error: "You can only view your own performance dashboard" });
    return null;
  }
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, instituteId: true } });
  if (!target || target.role !== "STUDENT") {
    res.status(404).json({ error: "Student not found" });
    return null;
  }
  if (req.user.role !== "STUDENT") {
    const requester = await prisma.user.findUnique({ where: { id: req.user.id }, select: { instituteId: true } });
    if (requester?.instituteId && target.instituteId !== requester.instituteId) {
      res.status(403).json({ error: "You can only view students under your own institute" });
      return null;
    }
  }
  return target;
}

// ADMIN: fetch a single user's full editable profile (institute/class as {id,name} for
// populating dropdowns, plus fields not exposed by the search/performance endpoints). Placed
// after every literal-segment GET route (bulk-template, lookup/:query, search) so this catch-all
// "/:id" can never shadow them — Express matches routes in registration order.
router.get("/:id", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: SELECT_FIELDS });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (req.requesterInstituteId && user.instituteId !== req.requesterInstituteId) {
    return res.status(403).json({ error: "You can only view users under your own institute" });
  }
  res.json(user);
});

// ADMIN/STAFF/STUDENT(self): full performance dashboard — summary stats, test history, and
// chart-ready analytics. A student's own view masks scores for any test whose results aren't
// published yet, same principle as the single-test result page.
router.get("/:id/performance", authenticate, requireRole("ADMIN", "STAFF", "CLERK", "STUDENT"), async (req, res) => {
  try {
    const target = await authorizeStudentPerformanceAccess(req, res);
    if (!target) return;
    const data = await computeStudentPerformance(target.id, { maskUnpublished: req.user.role === "STUDENT" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load performance data" });
  }
});

// Same access rule as above: downloadable Excel report.
router.get("/:id/performance/report.xlsx", authenticate, requireRole("ADMIN", "STAFF", "CLERK", "STUDENT"), async (req, res) => {
  try {
    const target = await authorizeStudentPerformanceAccess(req, res);
    if (!target) return;
    const data = await computeStudentPerformance(target.id, { maskUnpublished: req.user.role === "STUDENT" });

    const wb = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ["Student Performance Report"],
      [],
      ["Name", data.student.name],
      ["Roll Number", data.student.rollNumber || "—"],
      ["Official Email", data.student.email],
      ["Mobile", data.student.mobile || "—"],
      ["Institute", data.student.institute?.name || "—"],
      ["Department", data.student.academicGroup?.department?.name || "—"],
      ["Section", data.student.academicGroup?.section || "—"],
      ["Batch Year", data.student.academicGroup?.batch || data.student.batchYear || "—"],
      [],
      ["Total Tests Assigned", data.summary.totalTestsAssigned],
      ["Total Tests Attempted", data.summary.totalTestsAttempted],
      ["Total Tests Completed", data.summary.totalTestsCompleted],
      ["Total Tests Pending", data.summary.totalTestsPending],
      ["Average Score (%)", data.summary.averageScorePercent],
      ["Overall Percentage", data.summary.overallPercentage],
      ["Highest Score (%)", data.summary.highest?.percentage ?? "—"],
      ["Lowest Score (%)", data.summary.lowest?.percentage ?? "—"],
      ["Total Coding Questions Solved", data.summary.totalCodingSolved],
      ["Total MCQs Attempted", data.summary.totalMcqAttempted],
      ["Total MCQs Answered Correctly", data.summary.totalMcqCorrect],
      ["Total Time Spent (minutes)", data.summary.totalTimeSpentMin],
      ["Last Test Attempt Date", data.summary.lastAttemptDate ? new Date(data.summary.lastAttemptDate).toLocaleString() : "—"],
    ]);
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    const historySheet = XLSX.utils.json_to_sheet(
      data.testHistory.map((h) => ({
        "Test Name": h.testName,
        "Date": new Date(h.date).toLocaleDateString(),
        "Score": h.resultsPending ? "Pending" : h.score,
        "Max Score": h.maxScore,
        "Percentage": h.resultsPending ? "Pending" : `${h.percentage}%`,
        "Time Taken (min)": h.timeTakenMin ?? "—",
        "Status": h.status,
      }))
    );
    XLSX.utils.book_append_sheet(wb, historySheet, "Test History");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${(data.student.rollNumber || data.student.id)}-performance-report.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate Excel report" });
  }
});

// Same access rule as above: downloadable PDF report.
router.get("/:id/performance/report.pdf", authenticate, requireRole("ADMIN", "STAFF", "CLERK", "STUDENT"), async (req, res) => {
  try {
    const target = await authorizeStudentPerformanceAccess(req, res);
    if (!target) return;
    const data = await computeStudentPerformance(target.id, { maskUnpublished: req.user.role === "STUDENT" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${(data.student.rollNumber || data.student.id)}-performance-report.pdf"`);
    generatePerformancePdf(data, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate PDF report" });
  }
});

// ADMIN/STAFF: reset a student's (or any account's) password to a new, unique random temporary
// one — never a shared/fixed value, so an account can't be logged into by anyone who knows a
// documented default before the real owner's first login. Staff is institute-scoped: they can
// only reset students under their own institute, matching the same access rule as /search and
// the performance dashboard. The account is flagged to force a password change on next login.
router.post("/:id/reset-password", authenticate, requireRole("ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (req.requesterInstituteId && user.instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only reset passwords for students under your own institute" });
    }

    let newPassword;
    if (req.body.customPassword) {
      newPassword = String(req.body.customPassword).trim();
      const complexityError = validatePasswordComplexity(newPassword);
      if (complexityError) return res.status(400).json({ error: complexityError });
    } else {
      newPassword = generateTempPassword();
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    // Hash write + passwordChangedAt/PasswordHistory write must be atomic — see auth.js's
    // reset-password route for why.
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: req.params.id },
        data: { passwordHash, mustChangePassword: true },
      });
      await recordPasswordChange(tx, req.params.id, passwordHash, null); // system-generated — skip reuse-block, still tracked for future dedup
    });
    let emailSent = null; // null = not requested, true/false = requested + outcome
    let emailError = null;
    if (req.body.sendEmail) {
      const mailResult = await sendMailLogged(prisma, {
        to: user.email,
        name: user.name,
        studentId: user.id,
        emailType: "PASSWORD_RESET",
        subject: "Your CodeArena password has been reset",
        html: wrapBranded(`<p>Hi ${user.name},</p><p>Your password has been reset by an administrator.</p><p><strong>Login email:</strong> ${user.email}<br/><strong>New temporary password:</strong> ${newPassword}</p><p>Sign in at <a href="${FRONTEND_URL}/login">${FRONTEND_URL}/login</a> — you'll be asked to set a new password on first login.</p>`),
      }).catch((e) => ({ ok: false, error: e.message }));
      emailSent = !!mailResult.ok;
      emailError = mailResult.error || null;
    }

    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    await prisma.auditLog.create({
      data: {
        action: "PASSWORD_RESET",
        adminId: req.user.id,
        adminName: admin?.name || req.user.email,
        studentId: user.id,
        instituteId: user.instituteId,
        details: { studentId: user.id, studentName: user.name, emailSent, emailError },
      },
    }).catch(() => {});

    res.json({ success: true, defaultPassword: newPassword, emailSent, emailError });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// ADMIN: reset multiple students' passwords at once — same generateTempPassword() as every other
// reset (a unique random password per account, never a shared fixed value), returned per-student
// so the frontend can offer a CSV download. Used from Student Management's "Regenerate Passwords"
// bulk action. Optional `sendEmail: true` also emails each student their own new password
// directly (best-effort — a failed send for one student doesn't affect the others, and the CSV
// download stays available regardless as the reliable fallback).
router.post("/bulk-regenerate-password", authenticate, requireRole("ADMIN"), async (req, res) => {
  try {
    const ids = Array.isArray(req.body.studentIds) ? [...new Set(req.body.studentIds)] : [];
    if (ids.length === 0) return res.status(400).json({ error: "No students selected" });

    const users = await prisma.user.findMany({ where: { id: { in: ids } } });
    const results = [];
    for (const user of users) {
      const generatedPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 10);
      // Hash write + passwordChangedAt/PasswordHistory write must be atomic — see auth.js's
      // reset-password route for why.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true } });
        await recordPasswordChange(tx, user.id, passwordHash, null);
      });
      results.push({ id: user.id, name: user.name, email: user.email, rollNumber: user.rollNumber, generatedPassword, emailSent: null, emailError: null });
    }
    if (req.body.sendEmail) {
      for (const u of results) {
        const mailResult = await sendMailLogged(prisma, {
          to: u.email,
          name: u.name,
          studentId: u.id,
          emailType: "PASSWORD_RESET",
          subject: "Your CodeArena password has been reset",
          html: wrapBranded(`<p>Hi ${u.name},</p><p>Your password has been reset by an administrator.</p><p><strong>Login email:</strong> ${u.email}<br/><strong>New temporary password:</strong> ${u.generatedPassword}</p><p>Sign in at <a href="${FRONTEND_URL}/login">${FRONTEND_URL}/login</a> — you'll be asked to set a new password on first login.</p>`),
        }).catch((e) => ({ ok: false, error: e.message }));
        u.emailSent = !!mailResult.ok;
        u.emailError = mailResult.error || null;
      }
    }
    const failedIds = ids.filter((id) => !users.some((u) => u.id === id));

    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
    await prisma.auditLog.create({
      data: {
        action: "PASSWORD_RESET",
        adminId: req.user.id,
        adminName: admin?.name || req.user.email,
        details: { bulk: true, count: results.length, studentIds: results.map((u) => u.id), sendEmail: !!req.body.sendEmail },
      },
    }).catch(() => {});

    res.json({ results, failedIds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to regenerate passwords" });
  }
});

// ADMIN: delete a user. Deleting a student also removes their own test attempts/submissions
// (scoped only to that student — nothing anyone else can see is affected). Deleting a staff/
// admin account that has created tests is blocked instead of cascading, since that would
// delete a shared Test (and every student's attempts on it), not just this one account's data.
router.delete("/:id", authenticate, requireRole("ADMIN"), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.role !== "STUDENT") {
      const createdTestCount = await prisma.test.count({ where: { createdById: req.params.id } });
      if (createdTestCount > 0) {
        return res.status(409).json({
          error: `This account has created ${createdTestCount} test${createdTestCount === 1 ? "" : "s"}. Reassign or delete ${createdTestCount === 1 ? "it" : "them"} first, then delete the account.`,
        });
      }
      // LecturePlan.createdBy and AttendanceSession.markedBy are also Restrict (no onDelete
      // specified) — same reason as Test.createdBy above, just previously unchecked, which meant
      // deleting a staff account that ever created a lecture plan or marked attendance surfaced
      // as a raw, unhandled 500 instead of this same friendly 409.
      const [lecturePlanCount, attendanceMarkedCount] = await Promise.all([
        prisma.lecturePlan.count({ where: { createdById: req.params.id } }),
        prisma.attendanceSession.count({ where: { markedById: req.params.id } }),
      ]);
      if (lecturePlanCount > 0) {
        return res.status(409).json({
          error: `This account has created ${lecturePlanCount} lecture plan${lecturePlanCount === 1 ? "" : "s"}. Reassign or delete ${lecturePlanCount === 1 ? "it" : "them"} first, then delete the account.`,
        });
      }
      if (attendanceMarkedCount > 0) {
        return res.status(409).json({
          error: `This account has marked attendance for ${attendanceMarkedCount} session${attendanceMarkedCount === 1 ? "" : "s"}. Those attendance records must be reassigned first, then delete the account.`,
        });
      }
      await prisma.user.delete({ where: { id: req.params.id } });
    } else {
      // Certificate/InterviewCertificate are also Restrict (not Cascade) — a certificate is
      // proof of something the student actually earned, so it must not be silently destroyed by
      // deleting the account. Checked before the transaction rather than caught from it, since
      // failing partway through would otherwise leave Submission/TestAttempt already deleted.
      const [certCount, interviewCertCount] = await Promise.all([
        prisma.certificate.count({ where: { studentId: req.params.id } }),
        prisma.interviewCertificate.count({ where: { studentId: req.params.id } }),
      ]);
      if (certCount > 0 || interviewCertCount > 0) {
        const total = certCount + interviewCertCount;
        return res.status(409).json({
          error: `This student has earned ${total} certificate${total === 1 ? "" : "s"}. Revoke or reassign ${total === 1 ? "it" : "them"} first, then delete the account.`,
        });
      }
      await prisma.$transaction([
        prisma.submission.deleteMany({ where: { studentId: req.params.id } }),
        prisma.testAttempt.deleteMany({ where: { studentId: req.params.id } }),
        prisma.user.delete({ where: { id: req.params.id } }),
      ]);
      // The student's academic group may now be empty — see the matching comment in PATCH /:id.
      await deleteAcademicGroupIfEmpty(user.academicGroupId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

module.exports = router;
