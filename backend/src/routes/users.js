const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const XLSX = require("xlsx");
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { sendMailLogged, wrapBranded } = require("../utils/mailer");
const { accountCredentialsTemplate, credentialsResendTemplate } = require("../utils/emailTemplates");
const { computeStudentPerformance } = require("../utils/studentPerformance");
const { generatePerformancePdf } = require("../utils/reportPdf");
const { generateTempPassword, validatePasswordComplexity, isPasswordReused, recordPasswordChange } = require("../utils/password");
const { createSession, revokeAllSessions } = require("../utils/sessions");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");
const { deleteAcademicGroupIfEmpty } = require("../utils/academicGroups");
const cache = require("../utils/cache");
const { spreadsheetFileFilter } = require("../utils/uploadFilters");
const { initRollNumberFromRegistration, resolveRollNumberAvoidingCollisions, compareRollNumbers, isValidRollNumber, REGISTRATION_NUMBER_RE, ROLL_NUMBER_MAX_LENGTH } = require("../utils/studentIdentifiers");
const { mapWithConcurrency } = require("../utils/queue");
const { isValidEmail, normalizeEmail } = require("../utils/emailValidation");
const { dbRateLimit } = require("../utils/dbRateLimit");
const crypto = require("crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h -- longer than the 1h password-reset
// token since a new/changed personal email may not be checked as promptly as an active recovery flow.

// Bounded-concurrency cap for background bulk credential-email sends (bulk-upload,
// bulk-regenerate-password) — small enough not to open dozens of simultaneous SMTP connections
// on this project's single low-resource instance, matching the same concurrency-limiting posture
// queue.js already applies to the judge.
const EMAIL_CONCURRENCY = Number(process.env.EMAIL_CONCURRENCY) || 5;

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: spreadsheetFileFilter });

const FRONTEND_URL = process.env.FRONTEND_URL || "https://codearena.site";
const MOBILE_RE = /^\+?[0-9]{10,15}$/;

const SELECT_FIELDS = {
  id: true, name: true, email: true, role: true, rollNumber: true, registrationNumber: true, department: true,
  mobile: true, gender: true, program: true, batchYear: true, section: true, isActive: true, profilePhotoUrl: true, createdAt: true,
  mustChangePassword: true, accountStatus: true, employeeId: true, designation: true, lastLoginAt: true,
  emailVerified: true, pendingEmail: true,
  institute: { select: { id: true, name: true } },
  class: { select: { id: true, name: true, batchYear: true } },
  academicGroup: { select: { id: true, batch: true, section: true, department: { select: { id: true, name: true } } } },
};


// Maps flexible spreadsheet header text -> our field names. Roll Number is deliberately NOT a
// mapped input column — it's never entered manually during bulk upload, only auto-generated from
// the Registration Number (PRN) after import (see the row loop below); a "Roll Number" column in
// an uploaded file is simply ignored, same as any other unrecognized column.
const FIELD_ALIASES = {
  name: ["student name", "name", "full name"],
  // "registration number prn" is what the downloaded sample template's own header,
  // "Registration Number (PRN)", normalizes to (normalizeHeader collapses "(" / ")" to spaces) —
  // without it here, the platform's own template fails its own "missing required columns" check.
  registrationNumber: ["registration number", "registration number prn", "registration no", "reg no", "reg. no", "prn", "prn no", "prn number"],
  email: ["official email id", "email", "email id", "official email"],
  mobile: ["mobile number", "mobile", "phone", "phone number"],
  department: ["department", "dept"],
  program: ["program", "course"],
  batchYear: ["batch/year", "batch year", "batch", "year"],
  section: ["section"],
  instituteName: ["institute", "institute name", "college", "college name"],
  gender: ["gender", "sex"],
  status: ["status", "account status"],
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

  // findFirst stays case-insensitive so an existing "Computer Applications" is reused instead of
  // spawning a case-variant duplicate. But find-then-create alone leaves a race window: two
  // concurrent requests for the same brand-new department/group (e.g. a double-clicked "Create"
  // button, or two bulk-upload rows processed in parallel) can both find nothing and both attempt
  // create(), and the second hits the @@unique constraint as an unhandled P2002 — which is exactly
  // what previously surfaced to the admin as a generic "Failed to create user" even though nothing
  // about the student's own data was invalid. upsert() closes that window: the second racer's
  // create() attempt atomically becomes a no-op update against the row the first racer just
  // inserted, instead of throwing.
  let department = await prisma.department.findFirst({
    where: { instituteId, name: { equals: deptName, mode: "insensitive" } },
  });
  if (!department) {
    department = await prisma.department.upsert({
      where: { instituteId_name: { instituteId, name: deptName } },
      update: {},
      create: { instituteId, name: deptName },
    });
  }

  let group = await prisma.academicGroup.findFirst({
    where: { instituteId, batch, departmentId: department.id, section: { equals: sectionName, mode: "insensitive" } },
    include: { department: true },
  });
  if (!group) {
    group = await prisma.academicGroup.upsert({
      where: { instituteId_batch_departmentId_section: { instituteId, batch, departmentId: department.id, section: sectionName } },
      update: {},
      create: { instituteId, batch, departmentId: department.id, section: sectionName },
      include: { department: true },
    });
  }
  if (cache) cache.set(key, group);
  return group;
}

// Roll Number must be unique within one Academic Group (Institute+Batch+Department+Section) but
// duplicates ARE expected across different groups — so every lookup here is scoped by
// academicGroupId, never platform-wide (that's Registration Number's job, enforced via the DB's
// own @@unique([registrationNumber])).
async function fetchTakenRollNumbers(academicGroupId, excludeUserId) {
  if (!academicGroupId) return new Set();
  const rows = await prisma.user.findMany({
    where: { academicGroupId, role: "STUDENT", rollNumber: { not: null }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { rollNumber: true },
  });
  return new Set(rows.map((r) => r.rollNumber));
}

// Used only when an admin manually types/edits a Roll Number (not the auto-derive path) — a
// same-group collision is a real human mistake, so it's rejected outright with a specific error
// rather than silently resolved, per the platform's error-message-quality standard.
async function findRollNumberClash(academicGroupId, rollNumber, excludeUserId) {
  if (!academicGroupId || !rollNumber) return null;
  const clash = await prisma.user.findFirst({
    where: { academicGroupId, role: "STUDENT", rollNumber, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { name: true },
  });
  return clash?.name || null;
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

// Roll Number is intentionally absent — it's never a bulk-upload input, only auto-generated from
// the Registration Number (PRN)'s last 3 characters after import.
const TEMPLATE_HEADERS = ["Student Name", "Registration Number (PRN)", "Official Email ID", "Institute", "Batch/Year", "Mobile Number", "Department", "Program", "Section", "Gender", "Status"];

// Rate-limits how often a signed-in user can (re)request a new sign-in email — the token is sent
// to the NEW address, so the abuse shape here is spamming an arbitrary inbox with verification
// mail, not credential guessing. Same 3/15min shape as auth.js's forgotPasswordLimiter/resend
// conventions. Keyed by the account, not the IP, since this route requires a valid session already.
const emailChangeLimiter = dbRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `email-change:${req.user.id}`,
  message: { error: "Too many email change requests. Please try again later." },
});

// Any authenticated user: change their own email and/or password. A new email is never written
// to the live `email` column directly — see the pendingEmail fields' schema comment. The account
// keeps signing in with its current, already-verified address until the new one is confirmed via
// the link sent to it, so a typo here can never lock the owner out or silently misdirect future
// account mail.
router.patch("/me", authenticate, emailChangeLimiter, async (req, res) => {
  try {
    const { currentPassword, newEmail: rawNewEmail, newPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: "currentPassword is required" });
    }
    if (!rawNewEmail && !newPassword) {
      return res.status(400).json({ error: "Provide newEmail and/or newPassword" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const data = {};
    let verificationEmailSent = null; // null = no email change requested; true/false once one is
    let newEmailNormalized = null;
    let pendingVerifyToken = null;
    if (rawNewEmail) {
      newEmailNormalized = normalizeEmail(rawNewEmail);
      if (!isValidEmail(newEmailNormalized)) return res.status(400).json({ error: "Please enter a valid email address" });
      if (newEmailNormalized !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email: newEmailNormalized } });
        if (existing) return res.status(409).json({ error: "This email address is already associated with an account" });
        pendingVerifyToken = crypto.randomBytes(32).toString("hex");
        data.pendingEmail = newEmailNormalized;
        data.pendingEmailTokenHash = hashToken(pendingVerifyToken);
        data.pendingEmailTokenExpiry = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
        // Actually sent below, after the DB write succeeds.
      }
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
    } else if (Object.keys(data).length > 0) {
      updated = await prisma.user.update({ where: { id: user.id }, data, select: SELECT_FIELDS });
    } else {
      // Nothing actually changed (e.g. newEmail matched the current email already) -- re-select
      // in the same shape the update branches return, rather than hand-assembling a shorter object.
      updated = await prisma.user.findUnique({ where: { id: user.id }, select: SELECT_FIELDS });
    }
    if (newPasswordHash) {
      sendMailLogged(prisma, {
        to: updated.email, name: updated.name, emailType: "LOGIN_ALERT",
        studentId: updated.role === "STUDENT" ? updated.id : null,
        subject: "Your CodeArena password was changed",
        html: wrapBranded(`<p>Hi ${updated.name},</p><p>Your password was just changed from your account settings. If this wasn't you, contact your administrator immediately.</p>`),
      }).catch((err) => console.error("[users] password-change alert email failed:", err.message));
    }
    if (pendingVerifyToken) {
      const verifyLink = `${FRONTEND_URL}/verify-email?token=${pendingVerifyToken}`;
      const mailResult = await sendMailLogged(prisma, {
        to: newEmailNormalized, name: updated.name, emailType: "EMAIL_VERIFICATION",
        studentId: updated.role === "STUDENT" ? updated.id : null,
        subject: "Confirm your new CodeArena email address",
        html: wrapBranded(`<p>Hi ${updated.name},</p><p>Click the link below to confirm this is your new sign-in email address. This link expires in 24 hours.</p><p><a href="${verifyLink}">${verifyLink}</a></p><p>Your current sign-in email stays active until you confirm this one. If you didn't request this change, you can ignore this email.</p>`),
      }).catch((e) => ({ ok: false, error: e.message }));
      verificationEmailSent = !!mailResult.ok;
    }

    const token = await createSession({ user: updated, req, singleSessionOnly: false });
    await logAudit({ req, action: AUDIT_ACTIONS.PASSWORD_CHANGED, actorId: user.id, actorName: user.name, actorRole: user.role, studentId: user.role === "STUDENT" ? user.id : null, instituteId: user.instituteId, details: { self: true, emailChangeRequested: !!pendingVerifyToken, verificationEmailSent, passwordChanged: !!newPasswordHash } });

    let message = null;
    if (pendingVerifyToken) {
      message = verificationEmailSent
        ? `Verification email sent to ${newEmailNormalized}. Your sign-in email stays as ${user.email} until you confirm the new one.`
        : `Account updated, but the verification email to ${newEmailNormalized} failed to send. Please try again.`;
    }
    res.json({ token, user: updated, message, verificationEmailSent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update account" });
  }
});

// Any authenticated user with a pending (unverified) email change: re-send the verification link
// to that same pendingEmail, with a fresh token/expiry. Shares emailChangeLimiter with PATCH /me
// itself (3/15min combined) rather than a separate budget -- both routes send mail to the same
// address for the same reason, so splitting the limits would just double the achievable send rate.
router.post("/me/resend-verification", authenticate, emailChangeLimiter, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.pendingEmail) return res.status(400).json({ error: "No email change is pending" });

    const verifyToken = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: { pendingEmailTokenHash: hashToken(verifyToken), pendingEmailTokenExpiry: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS) },
    });
    const verifyLink = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
    const mailResult = await sendMailLogged(prisma, {
      to: user.pendingEmail, name: user.name, emailType: "EMAIL_VERIFICATION",
      studentId: user.role === "STUDENT" ? user.id : null,
      subject: "Confirm your new CodeArena email address",
      html: wrapBranded(`<p>Hi ${user.name},</p><p>Click the link below to confirm this is your new sign-in email address. This link expires in 24 hours.</p><p><a href="${verifyLink}">${verifyLink}</a></p><p>Your current sign-in email stays active until you confirm this one.</p>`),
    }).catch((e) => ({ ok: false, error: e.message }));

    res.json({
      message: mailResult.ok ? `Verification email re-sent to ${user.pendingEmail}.` : `Failed to send verification email to ${user.pendingEmail}. Please try again.`,
      verificationEmailSent: !!mailResult.ok,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to resend verification email" });
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

// ADMIN: list users. Paginated. Platform-level (unscoped) Admin sees everyone, matching every
// other admin route's convention — but an institute-scoped Admin previously saw the exact same
// unfiltered platform-wide list (confirmed live: this route had no institute check of any kind,
// unlike literally every other admin-facing route in this file), meaning that admin's own institute
// scope was pure UI convention (AdminDashboard.jsx's client-side `.filter()`), not a real backend
// boundary -- any institute-scoped admin's browser DevTools/Network tab exposed every other
// institute's full user list (name, email, mobile, PRN, department, batch) with zero extra effort.
router.get("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200));
  const where = req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {};
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, select: SELECT_FIELDS, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where }),
  ]);
  res.json({ rows: users, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

// ADMIN/SUPER_ADMIN/INSTITUTE_ADMIN: create a Staff, Admin, Institute Admin, or Student account
// directly (no self-registration needed). Password is a unique, randomly generated temporary
// one — the admin never types one — and the account is flagged to force a password change on
// first login.
router.post("/", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const {
      name, email: rawEmail, role, rollNumber, registrationNumber, department, mobile, gender, program,
      batchYear, section, instituteId, employeeId, designation,
    } = req.body;
    if (!name || !rawEmail || !role) {
      return res.status(400).json({ error: "name, email, and role are required" });
    }
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email address" });
    // SUPER_ADMIN can never be granted here (or anywhere else user-facing) — the only SUPER_ADMIN
    // account is set once by scripts/migrateSuperAdmin.js, and a database-level partial unique
    // index (scripts/enforceSingleSuperAdmin.js) makes a second one impossible even if this check
    // were ever bypassed. An institute-scoped creator (req.requesterInstituteId set — an
    // institute-scoped ADMIN or an INSTITUTE_ADMIN) additionally can't grant ADMIN/INSTITUTE_ADMIN
    // — only a platform-level SUPER_ADMIN (or legacy platform-level ADMIN) can create another
    // admin-tier account, and per spec that's an Institute Admin, never a second Super Admin.
    const allowedRoles = req.requesterInstituteId
      ? ["STUDENT", "STAFF", "CLERK"]
      : ["STUDENT", "STAFF", "ADMIN", "CLERK", "INSTITUTE_ADMIN"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${allowedRoles.join(", ")}` });
    }
    if (role === "INSTITUTE_ADMIN" && !instituteId) {
      return res.status(400).json({ error: "An institute is required to create an Institute Admin" });
    }
    if (!instituteId) return res.status(400).json({ error: "An institute is required" });
    // An institute-scoped ADMIN must not be able to plant accounts under a different institute by
    // passing an arbitrary instituteId — only a platform-level (unscoped) admin can target any.
    if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only create accounts under your own institute" });
    }
    if (role === "STUDENT" && !String(mobile || "").trim()) return res.status(400).json({ error: "A mobile number is required for students" });
    if (role === "STUDENT" && !String(batchYear || "").trim()) return res.status(400).json({ error: "A batch is required for students" });
    // Registration Number (PRN) is the platform's sole permanent unique student identifier —
    // required at creation (matching bulk-upload's requirement) so a student can never be created
    // with only a Roll Number filled in, which would otherwise leave PRN permanently unset and the
    // classroom Roll Number field stuck holding whatever the admin actually meant as the PRN.
    if (role === "STUDENT" && !String(registrationNumber || "").trim()) return res.status(400).json({ error: "A Registration Number (PRN) is required for students" });
    if (mobile && !MOBILE_RE.test(String(mobile).trim())) return res.status(400).json({ error: "Invalid mobile number" });

    const institute = await prisma.institute.findUnique({ where: { id: instituteId } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });

    let academicGroup = null;
    if (role === "STUDENT") {
      academicGroup = await resolveAcademicGroup({ instituteId, batchYear, departmentName: department, section });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "Email already registered" });

    // Registration Number (PRN) is the platform's sole permanent, system-wide unique student
    // identifier (see @@unique([registrationNumber]) on User) — checked before create rather than
    // left to surface as a raw DB constraint error. Roll Number is unique only within one Academic
    // Group (Institute+Batch+Department+Section) — duplicates across different groups are expected
    // by design, but a collision inside the SAME group is not allowed.
    let normalizedRollNumber = String(rollNumber || "").trim() || null;
    let normalizedRegNumber = String(registrationNumber || "").trim() || null;
    if (normalizedRegNumber && !REGISTRATION_NUMBER_RE.test(normalizedRegNumber)) {
      return res.status(400).json({ error: "Registration Number (PRN) must be 9-12 alphanumeric characters" });
    }
    if (normalizedRollNumber && normalizedRollNumber.length > ROLL_NUMBER_MAX_LENGTH) {
      return res.status(400).json({ error: "Roll Number cannot exceed 3 characters" });
    }
    // A manually-typed Roll Number must be exactly 3 numeric digits — auto-generated values
    // (below, via resolveRollNumberAvoidingCollisions) already satisfy this by construction, so
    // this only ever rejects a human-entered value, with a clear error rather than silently
    // accepting a garbled one.
    if (normalizedRollNumber && !isValidRollNumber(normalizedRollNumber)) {
      return res.status(400).json({ error: "Roll Number must be exactly 3 digits" });
    }
    if (role === "STUDENT" && normalizedRegNumber) {
      const dupReg = await prisma.user.findFirst({ where: { registrationNumber: normalizedRegNumber } });
      if (dupReg) return res.status(409).json({ error: `Registration Number "${normalizedRegNumber}" is already registered to another account` });
    }
    if (role === "STUDENT" && normalizedRollNumber) {
      // Manually supplied Roll Number: reject a same-group collision outright rather than silently
      // resolving it — this is an explicit human entry, so a clear error is the correct UX.
      const clashName = await findRollNumberClash(academicGroup?.id, normalizedRollNumber, null);
      if (clashName) return res.status(409).json({ error: `Roll Number "${normalizedRollNumber}" is already used by ${clashName} in this Batch/Department/Section — choose a different Roll Number.` });
    } else if (role === "STUDENT" && normalizedRegNumber) {
      const taken = await fetchTakenRollNumbers(academicGroup?.id, null);
      normalizedRollNumber = resolveRollNumberAvoidingCollisions(normalizedRegNumber, taken);
    }
    if (String(employeeId || "").trim()) {
      const dupEmployee = await prisma.user.findFirst({ where: { instituteId, employeeId: String(employeeId).trim() } });
      if (dupEmployee) return res.status(409).json({ error: `Employee ID "${employeeId}" is already in use at ${institute.name}` });
    }

    const generatedPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash, role, rollNumber: normalizedRollNumber, registrationNumber: normalizedRegNumber, department, mobile, gender,
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
        emailType: "CREDENTIALS",
        subject: "Your CodeArena Account Has Been Created",
        html: accountCredentialsTemplate({
          name: user.name,
          email: user.email,
          password: generatedPassword,
          registrationNumber: normalizedRegNumber,
          institute: institute.name,
          departmentSection: academicGroup ? `Department: ${academicGroup.department.name} · Section: ${academicGroup.section}` : null,
          batchYear,
        }),
      }).catch((e) => ({ ok: false, error: e.message }));
      emailSent = !!mailResult.ok;
      emailError = mailResult.error || null;
    } else {
      const mailResult = await sendMailLogged(prisma, {
        to: user.email,
        name: user.name,
        studentId: user.id,
        emailType: "CREDENTIALS",
        subject: "Your CodeArena Account Has Been Created",
        html: accountCredentialsTemplate({ name: user.name, email: user.email, password: generatedPassword }),
      }).catch((e) => ({ ok: false, error: e.message }));
      emailSent = !!mailResult.ok;
      emailError = mailResult.error || null;
    }

    await logAudit({
      req, action: AUDIT_ACTIONS.ACCOUNT_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: role === "STUDENT" ? user.id : null, instituteId,
      details: { method: "single", userId: user.id, studentName: user.name, role, email: user.email, emailSent, emailError },
    });

    res.json({ ...user, generatedPassword, emailSent, emailError });
  } catch (err) {
    console.error("[users.create] failed:", { message: err.message, code: err.code, meta: err.meta });
    // Safety net for any unique-constraint collision the pre-checks above didn't already catch
    // (e.g. a race between two concurrent creates) — surfaces as a clean 409, not an opaque 500.
    if (err.code === "P2002") {
      return res.status(409).json({ error: `That ${Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "value"} is already in use.` });
    }
    res.status(500).json({ error: "Failed to create user. Please try again, and contact support if the issue persists." });
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
router.patch("/:id", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"), attachRequesterInstitute, async (req, res) => {
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
      const email = normalizeEmail(data.email);
      if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email address" });
      if (email !== existing.email) {
        const dup = await prisma.user.findUnique({ where: { email } });
        if (dup) return res.status(409).json({ error: "This email address is already associated with an account" });
        // A changed address hasn't been proven to belong to this person just because an admin
        // typed it in -- don't let a stale `true` from the old address carry over silently.
        data.emailVerified = false;
        data.emailVerifiedAt = null;
      }
      data.email = email;
    }
    if (data.mobile !== undefined && data.mobile !== null && data.mobile !== "") {
      if (!MOBILE_RE.test(String(data.mobile).trim())) return res.status(400).json({ error: "Invalid mobile number" });
    }
    // Roll Number is unique only within one Academic Group (Institute+Batch+Department+Section) —
    // duplicates across different groups are expected by design. Normalized here (blank -> null,
    // never left as ""); the actual same-group collision check happens further down, once the
    // student's final target Academic Group is known (it may itself be changing in this request).
    if (data.rollNumber !== undefined) {
      data.rollNumber = String(data.rollNumber || "").trim() || null;
      if (data.rollNumber && data.rollNumber.length > ROLL_NUMBER_MAX_LENGTH) {
        return res.status(400).json({ error: "Roll Number cannot exceed 3 characters" });
      }
      // Same rule as POST /users: a manually-typed Roll Number must be exactly 3 numeric
      // digits. Values re-derived below via resolveRollNumberAvoidingCollisions already
      // satisfy this by construction, so this only rejects a human-entered value.
      if (data.rollNumber && !isValidRollNumber(data.rollNumber)) {
        return res.status(400).json({ error: "Roll Number must be exactly 3 digits" });
      }
    }
    // Registration Number (PRN) IS the platform's sole permanent, system-wide unique identifier
    // (see @@unique([registrationNumber]) on User) — checked before saving so a raw DB constraint
    // error never surfaces to the admin. Same blank->null normalization discipline as elsewhere in
    // this route (NULL never conflicts; "" would).
    if (data.registrationNumber !== undefined) {
      const registrationNumber = String(data.registrationNumber || "").trim();
      if (!registrationNumber) {
        data.registrationNumber = null;
      } else {
        if (!REGISTRATION_NUMBER_RE.test(registrationNumber)) {
          return res.status(400).json({ error: "Registration Number (PRN) must be 9-12 alphanumeric characters" });
        }
        if (registrationNumber !== existing.registrationNumber) {
          const dupReg = await prisma.user.findFirst({ where: { registrationNumber, id: { not: existing.id } } });
          if (dupReg) return res.status(409).json({ error: "That Registration Number (PRN) is already registered to another account" });
        }
        data.registrationNumber = registrationNumber;
        // Whenever the PRN actually changes, Roll Number auto-resets from it (collision-checked
        // against the target Academic Group further down) — unless this same request also
        // explicitly supplied a rollNumber, in which case that explicit value wins.
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

    // Roll Number same-group collision check/resolution — runs last, once the student's final
    // target Academic Group (possibly just re-resolved above) and final Registration Number are
    // both known.
    if (existing.role === "STUDENT") {
      const targetAcademicGroupId = data.academicGroupId !== undefined ? data.academicGroupId : existing.academicGroupId;
      const rollNumberExplicitlyEdited = req.body.rollNumber !== undefined;
      const prnChanged = data.registrationNumber !== undefined && data.registrationNumber !== existing.registrationNumber;
      const groupChanged = data.academicGroupId !== undefined && data.academicGroupId !== existing.academicGroupId;

      if (rollNumberExplicitlyEdited) {
        if (data.rollNumber) {
          const clashName = await findRollNumberClash(targetAcademicGroupId, data.rollNumber, existing.id);
          if (clashName) return res.status(409).json({ error: `Roll Number "${data.rollNumber}" is already used by ${clashName} in this Batch/Department/Section — choose a different Roll Number.` });
        }
      } else if (prnChanged) {
        const taken = await fetchTakenRollNumbers(targetAcademicGroupId, existing.id);
        data.rollNumber = resolveRollNumberAvoidingCollisions(data.registrationNumber, taken);
      } else if (groupChanged && existing.rollNumber) {
        // Student moved to a different group without touching Roll Number or PRN — only re-derive
        // if the existing value actually collides with someone already in the NEW group; otherwise
        // leave it untouched (don't overwrite valid data that doesn't need fixing).
        const taken = await fetchTakenRollNumbers(targetAcademicGroupId, existing.id);
        if (taken.has(existing.rollNumber) && existing.registrationNumber) {
          data.rollNumber = resolveRollNumberAvoidingCollisions(existing.registrationNumber, taken);
        }
      }
    }

    const changedFields = Object.keys(data).filter((f) => String(existing[f] ?? "") !== String(data[f] ?? ""));
    const admin = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } });

    // A pure activate/deactivate toggle (via this same generic edit route — no dedicated route
    // needed since isActive is already in EDITABLE_FIELDS) gets the same specific audit action
    // staffClerk.js's dedicated STAFF/CLERK status-toggle route already uses, instead of the
    // generic *_PROFILE_UPDATED, so "who deactivated this account and when" is answerable for
    // every role, not just Staff/Clerk.
    const isActiveToggled = data.isActive !== undefined && data.isActive !== existing.isActive;
    const auditAction = isActiveToggled
      ? (data.isActive ? "ACCOUNT_ACTIVATED" : "ACCOUNT_DEACTIVATED")
      : existing.role === "STUDENT" ? "STUDENT_PROFILE_UPDATED" : "USER_PROFILE_UPDATED";

    const [updated] = await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data, select: SELECT_FIELDS }),
      prisma.auditLog.create({
        data: {
          action: auditAction,
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
  const sampleRow = ["John Doe", "MCA2024001", "john.doe@codearena.edu.in", "CodeArena University", "2024-26", "9876543210", "Computer Applications", "MCA", "A", "Male", "Active"];
  const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, sampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Students");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=student-upload-template.xlsx");
  res.send(buffer);
});

// Shared by both /bulk-upload/preview and /bulk-upload/confirm — parses the uploaded workbook into
// plain row objects using the same header-alias mapping, so a file validates identically at both
// steps regardless of which endpoint reads it.
function parseBulkFile(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { error: "Could not read this file. Please upload a valid .xlsx or .csv file." };
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
  if (rawRows.length === 0) return { error: "The uploaded file has no data rows." };

  const headerMap = buildHeaderMap(Object.keys(rawRows[0]));
  if (!headerMap.name || !headerMap.registrationNumber || !headerMap.email) {
    return { error: "Missing required columns. The file must include Student Name, Registration Number (PRN), and Official Email ID. Roll Number is not a file column — it's auto-generated from the last 3 characters of the Registration Number." };
  }
  if (!headerMap.instituteName || !headerMap.batchYear) {
    return { error: "Missing required columns. The file must include Institute and Batch/Year." };
  }

  const field = (row, key) => (headerMap[key] ? String(row[headerMap[key]] ?? "").trim() : "");
  const rows = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const name = field(row, "name");
    const registrationNumber = field(row, "registrationNumber");
    const email = field(row, "email").toLowerCase();
    if (!name && !registrationNumber && !email) continue; // blank row, silently skipped (not counted at all)
    const statusRaw = field(row, "status").toLowerCase();
    rows.push({
      rowNum: i + 2, // +1 for header row, +1 for 1-indexing
      name, registrationNumber, email,
      mobile: field(row, "mobile"),
      department: field(row, "department"),
      program: field(row, "program"),
      batchYear: field(row, "batchYear"),
      section: field(row, "section"),
      instituteName: field(row, "instituteName"),
      gender: field(row, "gender"),
      // Optional column — defaults to Active (matches every other creation path's implicit
      // default); any value other than a recognizable "inactive" synonym is treated as Active
      // rather than silently rejecting the row over a typo in an optional field.
      isActive: !["inactive", "disabled", "no"].includes(statusRaw),
    });
  }
  return { rows };
}

// Scoped to only the emails/registration numbers actually present in these rows, instead of
// loading every user on the entire platform for a dedup check — that unscoped query grows
// unbounded as institutes accumulate users over years, for a check that only ever needs to know
// about the handful-to-few-thousand rows in front of it right now. Re-run fresh at BOTH preview
// and confirm time (never cached/reused between the two requests) so confirm always sees the
// latest DB state — closing the staleness gap of "someone else created that PRN in the minute
// between preview and confirm" rather than trusting a snapshot from the earlier preview call.
async function loadBulkContext(rows) {
  const emailsInFile = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  const regNumbersInFile = [...new Set(rows.map((r) => r.registrationNumber).filter(Boolean))];
  const [existingUsers, institutes] = await Promise.all([
    (emailsInFile.length || regNumbersInFile.length)
      ? prisma.user.findMany({
          where: { OR: [...(emailsInFile.length ? [{ email: { in: emailsInFile, mode: "insensitive" } }] : []), ...(regNumbersInFile.length ? [{ registrationNumber: { in: regNumbersInFile, mode: "insensitive" } }] : [])] },
          select: { email: true, registrationNumber: true },
        })
      : [],
    prisma.institute.findMany(),
  ]);
  return {
    existingEmails: new Set(existingUsers.map((u) => u.email.toLowerCase())),
    // Registration Number (PRN) is unique PLATFORM-WIDE (mirrors @@unique([registrationNumber])) —
    // no institute scoping in the dedup key. Roll Number is deliberately not deduped at all here
    // (duplicates across groups are expected by design).
    existingRegNumbers: new Set(existingUsers.filter((u) => u.registrationNumber).map((u) => u.registrationNumber.toLowerCase())),
    instituteByName: new Map(institutes.map((i) => [i.name.toLowerCase(), i])),
  };
}

// The single source of truth for "is this bulk row acceptable" — used IDENTICALLY by preview
// (dry-run only) and confirm (right before actually creating the row), so a row can never pass
// one step under different rules than the other. `seenEmails`/`seenRegNumbers` are mutated in
// place to catch a duplicate PRN/email appearing twice WITHIN the same file, in file order.
function validateBulkRow(row, { instituteByName, requesterInstituteId, existingEmails, existingRegNumbers, seenEmails, seenRegNumbers }) {
  const { name, registrationNumber, email, mobile, batchYear, instituteName } = row;
  // Never read Roll Number from the file — always derived from the Registration Number's last 3
  // characters, matching the single-create path. This is provisional only: the real, same-group
  // collision-resolved value is computed at confirm time once every row actually being imported
  // (and the order they're processed in) is known.
  const rollNumberPreview = initRollNumberFromRegistration(registrationNumber) || "";

  if (!name || !registrationNumber || !email || !instituteName || !batchYear || !mobile) {
    return { status: "error", reason: "Missing required field (name, registration number, email, mobile, institute, or batch/year)", rollNumberPreview };
  }
  if (!isValidEmail(email)) return { status: "error", reason: "Invalid email format", rollNumberPreview };
  if (!REGISTRATION_NUMBER_RE.test(registrationNumber)) return { status: "error", reason: "Registration Number (PRN) must be 9-12 alphanumeric characters", rollNumberPreview };
  if (!MOBILE_RE.test(mobile)) return { status: "error", reason: "Invalid mobile number", rollNumberPreview };

  const institute = instituteByName.get(instituteName.toLowerCase());
  if (!institute) return { status: "error", reason: `Institute "${instituteName}" was not found. Create it first in Institute Management.`, rollNumberPreview };
  // Mirrors the same guard on POST / — an institute-scoped ADMIN can only import students into
  // their own institute, regardless of what the uploaded file's Institute column says.
  if (requesterInstituteId && institute.id !== requesterInstituteId) {
    return { status: "error", reason: "You can only upload students to your own institute", rollNumberPreview };
  }

  const regKey = registrationNumber.toLowerCase();
  if (existingEmails.has(email) || seenEmails.has(email)) return { status: "duplicate", reason: "Email already exists", rollNumberPreview };
  if (existingRegNumbers.has(regKey) || seenRegNumbers.has(regKey)) return { status: "duplicate", reason: "Duplicate PRN in uploaded file or already registered", rollNumberPreview };

  seenEmails.add(email);
  seenRegNumbers.add(regKey);
  return { status: "valid", rollNumberPreview, institute };
}

// ADMIN: Step 1 of bulk import — parse + fully validate the uploaded file (duplicate checks,
// format checks, institute/scope checks) WITHOUT creating anything. Section 11 of the account-
// creation spec: never insert thousands of rows straight off an upload — this exists precisely so
// the admin sees "185 valid / 10 invalid / 5 duplicate" and can review row-level errors before a
// single account is created.
router.post("/bulk-upload/preview", authenticate, requireRole("ADMIN"), attachRequesterInstitute, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const parsed = parseBulkFile(req.file.buffer);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.rows.length === 0) return res.status(400).json({ error: "The uploaded file has no data rows." });

    const ctx = await loadBulkContext(parsed.rows);
    const seenEmails = new Set();
    const seenRegNumbers = new Set();
    const previewRows = parsed.rows.map((row) => {
      const result = validateBulkRow(row, { ...ctx, requesterInstituteId: req.requesterInstituteId, seenEmails, seenRegNumbers });
      return { row: row.rowNum, ...row, rollNumberPreview: result.rollNumberPreview, status: result.status, reason: result.reason || null };
    });

    res.json({
      totalRows: previewRows.length,
      validCount: previewRows.filter((r) => r.status === "valid").length,
      invalidCount: previewRows.filter((r) => r.status === "error").length,
      duplicateCount: previewRows.filter((r) => r.status === "duplicate").length,
      rows: previewRows,
    });
  } catch (err) {
    console.error("[users.bulk-upload.preview] failed:", err);
    res.status(500).json({ error: "Failed to validate file" });
  }
});

// ADMIN: Step 2 — creates accounts ONLY for the rows the admin confirmed from the preview
// (`rows`, same shape /preview returned; a row the admin unchecked simply isn't included). Every
// row is re-validated here against fresh DB state (never trusts the preview's now-possibly-stale
// snapshot) — closing the race where another admin creates a colliding PRN/email in the gap
// between preview and confirm. Each row gets its own unique, randomly generated password, and the
// account is flagged to force a password change on first login.
router.post("/bulk-upload/confirm", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: "No rows to import" });
    if (rows.length > 5000) return res.status(400).json({ error: "Too many rows in one confirm request" });
    const sendCredentials = !!req.body.sendCredentials;

    const ctx = await loadBulkContext(rows);
    const seenEmails = new Set();
    const seenRegNumbers = new Set();
    const groupCache = new Map();
    const groupRollNumberCache = new Map(); // academicGroupId -> Set of Roll Numbers already used in that group (DB + rows already created this run)

    const created = [];
    const duplicates = [];
    const errors = [];

    for (const row of rows) {
      const result = validateBulkRow(row, { ...ctx, requesterInstituteId: req.requesterInstituteId, seenEmails, seenRegNumbers });
      if (result.status === "error") { errors.push({ row: row.rowNum, name: row.name, email: row.email, registrationNumber: row.registrationNumber, rollNumber: result.rollNumberPreview, reason: result.reason }); continue; }
      if (result.status === "duplicate") { duplicates.push({ row: row.rowNum, name: row.name, email: row.email, registrationNumber: row.registrationNumber, rollNumber: result.rollNumberPreview, reason: result.reason }); continue; }

      const { institute } = result;
      const generatedPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 10);

      try {
        const group = await resolveAcademicGroup({ instituteId: institute.id, batchYear: row.batchYear, departmentName: row.department, section: row.section }, groupCache);
        if (!groupRollNumberCache.has(group.id)) {
          groupRollNumberCache.set(group.id, await fetchTakenRollNumbers(group.id, null));
        }
        const takenInGroup = groupRollNumberCache.get(group.id);
        const finalRollNumber = resolveRollNumberAvoidingCollisions(row.registrationNumber, takenInGroup);
        if (finalRollNumber) takenInGroup.add(finalRollNumber);
        const user = await prisma.user.create({
          data: {
            name: row.name, email: row.email, registrationNumber: row.registrationNumber, rollNumber: finalRollNumber || null, passwordHash, role: "STUDENT",
            mobile: row.mobile || null,
            department: row.department || null,
            program: row.program || null,
            batchYear: row.batchYear || null,
            section: row.section || null,
            gender: row.gender || null,
            isActive: row.isActive,
            accountStatus: row.isActive ? "ACTIVE" : "INACTIVE",
            instituteId: institute.id,
            academicGroupId: group.id,
            mustChangePassword: true,
          },
        });
        created.push({ ...user, generatedPassword });
      } catch (err) {
        // P2002 here means a genuine last-instant race (e.g. two concurrent confirms) slipped
        // past the fresh-context check above — reported as a duplicate, never a raw 500.
        errors.push({ row: row.rowNum, name: row.name, email: row.email, registrationNumber: row.registrationNumber, rollNumber: null, reason: err.code === "P2002" ? "Duplicate detected during creation" : "Failed to create account" });
      }
    }

    // Credential emails are never sent synchronously inside this request — for a few hundred
    // students that would hold the HTTP response open for the full duration of every send. The
    // response goes out immediately with a batchId; sending happens as a bounded-concurrency
    // background pass afterward (see below), and the admin polls
    // GET /admin/email-logs/batch/:batchId/summary for live sent/failed counts.
    const batchId = sendCredentials && created.length > 0 ? crypto.randomUUID() : null;
    const emailsQueued = batchId ? created.length : 0;

    await logAudit({
      req, action: AUDIT_ACTIONS.ACCOUNT_CREATED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      instituteId: req.requesterInstituteId || (created[0]?.instituteId ?? null),
      details: { method: "bulk", createdCount: created.length, duplicateCount: duplicates.length, errorCount: errors.length, totalRows: rows.length },
    });

    res.json({
      total: rows.length,
      createdCount: created.length,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      created: created.map((u) => ({ name: u.name, email: u.email, registrationNumber: u.registrationNumber, rollNumber: u.rollNumber, generatedPassword: u.generatedPassword })),
      duplicates,
      errors,
      sendCredentials,
      emailsQueued,
      batchId,
    });

    if (batchId) {
      // Fire-and-forget after the response is already sent — same pattern as auth.js's
      // maybeSendLoginAlert. Not awaited, so an error here can never reach the outer catch below
      // (which would otherwise try to send a second response and crash with
      // ERR_HTTP_HEADERS_SENT); mapWithConcurrency's own promise rejection is caught locally.
      mapWithConcurrency(created, EMAIL_CONCURRENCY, (u) =>
        sendMailLogged(prisma, {
          to: u.email,
          name: u.name,
          studentId: u.id,
          emailType: "CREDENTIALS",
          batchId,
          subject: "Your CodeArena Account Has Been Created",
          html: accountCredentialsTemplate({ name: u.name, email: u.email, password: u.generatedPassword, registrationNumber: u.registrationNumber }),
        }).catch((e) => ({ ok: false, error: e.message }))
      ).catch((err) => console.error("[users.bulk-upload.confirm] background email batch failed:", err));
    }
  } catch (err) {
    console.error("[users.bulk-upload.confirm] failed:", err);
    res.status(500).json({ error: "Bulk import failed" });
  }
});

// ADMIN: look up a student by roll number and see which tests they've completed
router.get("/lookup/:query", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const q = req.params.query;
    const user = await prisma.user.findFirst({
      where: {
        role: "STUDENT",
        OR: [{ registrationNumber: q }, { rollNumber: q }, { email: q }, { id: q }],
        ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        rollNumber: true,
        registrationNumber: true,
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
    if (!user) return res.status(404).json({ error: "No student found with that registration number, roll number, email, or ID" });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lookup failed" });
  }
});

// ADMIN/STAFF/CLERK: search users of any role by PRN/Employee ID/Name/Email/Mobile — institute-
// scoped accounts only ever match users under their own institute (Super Admin sees all).
// Optional ?role= narrows to one role (STUDENT/STAFF/CLERK/ADMIN); omitted searches all four.
// Real DB-level pagination via ?page/?pageSize (default 20), not an in-memory fetch-then-slice —
// this is the one cross-role search surface for Admin User Search & Delete, reusing the same
// { rows, page, pageSize, total, totalPages } shape questions.js's GET / and staffClerk.js's
// GET / already return.
router.get("/search", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ rows: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const role = ["STUDENT", "STAFF", "CLERK", "ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"].includes(req.query.role) ? req.query.role : undefined;
    const { documentType, documentVerificationStatus } = req.query;

    const where = {
      ...(role ? { role } : {}),
      ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      ...(documentType || documentVerificationStatus
        ? { studentDocuments: { some: { ...(documentType ? { documentType } : {}), ...(documentVerificationStatus ? { verificationStatus: documentVerificationStatus } : {}) } } }
        : {}),
      OR: [
        { id: q },
        { rollNumber: { contains: q, mode: "insensitive" } },
        { registrationNumber: { contains: q, mode: "insensitive" } },
        { employeeId: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q, mode: "insensitive" } },
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, role: true, rollNumber: true, registrationNumber: true,
          employeeId: true, mobile: true, isActive: true, accountStatus: true,
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
    res.json({ rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
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
    const { departmentId, section, batch, placementParticipation, offerVerificationStatus, documentType, documentVerificationStatus } = req.query;
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
      ...(documentType || documentVerificationStatus
        ? { studentDocuments: { some: { ...(documentType ? { documentType } : {}), ...(documentVerificationStatus ? { verificationStatus: documentVerificationStatus } : {}) } } }
        : {}),
    };

    // Ascending Roll Number is numeric-aware ("1, 2, 3 ... 60", not lexicographic), which Prisma's
    // `orderBy` can't express over a String column — so the full matching id/name/rollNumber set
    // (already bounded to specific academicGroups, not the whole institute) is fetched once, sorted
    // in JS, then just the current page's ids are hydrated with the full select below. This keeps
    // pagination correct across the whole result set rather than only re-ordering a single page.
    const allMatches = await prisma.user.findMany({ where, select: { id: true, name: true, rollNumber: true } });
    allMatches.sort(compareRollNumbers);
    const total = allMatches.length;
    const pageIds = allMatches.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((s) => s.id);

    const hydrated = await prisma.user.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true, name: true, email: true, rollNumber: true, registrationNumber: true,
        institute: { select: { name: true } },
        class: { select: { name: true, batchYear: true } },
        academicGroup: { select: { batch: true, section: true, department: { select: { name: true } } } },
      },
    });
    const byId = new Map(hydrated.map((s) => [s.id, s]));
    const students = pageIds.map((id) => byId.get(id)).filter(Boolean);

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

// Clerk's own audit-log access is scoped to what a Placement Cell / Document Verification role
// actually needs to review — not the institute's full action stream (login/logout, question-bank
// edits, test creation, etc.), which was previously reachable simply because this route granted
// CLERK the same unfiltered `where` as ADMIN/STAFF once institute-scoped. Kept in sync with
// ClerkDashboard.jsx's actual surface (Documents + Placement).
const CLERK_AUDIT_ACTIONS = [
  AUDIT_ACTIONS.DOCUMENT_UPLOADED, AUDIT_ACTIONS.DOCUMENT_UPDATED, AUDIT_ACTIONS.DOCUMENT_VERIFIED, AUDIT_ACTIONS.DOCUMENT_DELETED,
  AUDIT_ACTIONS.PLACEMENT_OFFER_VERIFIED, AUDIT_ACTIONS.PLACEMENT_ELIGIBILITY_CHANGED,
];

// ADMIN/STAFF/CLERK: general-purpose, searchable/filterable/exportable audit trail — the
// enterprise spec's requirement over and above the narrow password-reset-only view above.
// Staff/Clerk are scoped to their own institute the same way as everywhere else on this
// platform; an unscoped platform Admin sees every institute. CLERK included so Clerk can view
// document-verification history (Document Verification permission review) — see
// CLERK_AUDIT_ACTIONS above for exactly which action types that covers. Same "capped
// operational log, not a paginated archive" convention as the routes around it, at a slightly
// higher cap since this view covers every action type.
router.get("/audit-log", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
  try {
    const { action, studentId, from, to, format } = req.query;
    const where = {
      ...(req.requesterInstituteId ? { instituteId: req.requesterInstituteId } : {}),
      // A CLERK-supplied ?action= is intersected against the allowlist rather than trusted
      // outright, so the query param itself can never be used to see outside Clerk's real scope.
      ...(req.user.role === "CLERK"
        ? { action: action && CLERK_AUDIT_ACTIONS.includes(action) ? action : { in: CLERK_AUDIT_ACTIONS } }
        : (action ? { action } : {})),
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

// ADMIN/STAFF/CLERK: distinct action names currently in the log, for the filter dropdown on the
// audit log page — read from real data rather than hardcoding AUDIT_ACTIONS, since legacy rows
// (e.g. REATTEMPT_GRANTED, STUDENT_PROFILE_UPDATED) predate that catalogue.
router.get("/audit-log/actions", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF", "CLERK"), attachRequesterInstitute, async (req, res) => {
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
      ["Registration Number (PRN)", data.student.registrationNumber || "—"],
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
router.post("/:id/reset-password", authenticate, requireRole("ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"), attachRequesterInstitute, async (req, res) => {
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
    // Close any session the account is currently logged in on — an admin-triggered reset (often
    // done precisely because the account may be compromised, or the student is locked out and an
    // old session shouldn't quietly outlive the credential change) shouldn't leave a pre-existing
    // login valid until its 12h token naturally expires.
    await revokeAllSessions(req.params.id).catch(() => {});
    let emailSent = null; // null = not requested, true/false = requested + outcome
    let emailError = null;
    if (req.body.sendEmail) {
      const mailResult = await sendMailLogged(prisma, {
        to: user.email,
        name: user.name,
        studentId: user.id,
        emailType: "CREDENTIALS_RESEND",
        subject: "Your CodeArena Password Has Been Reset",
        html: credentialsResendTemplate({ name: user.name, email: user.email, password: newPassword }),
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
      await revokeAllSessions(user.id).catch(() => {}); // same reasoning as the single-reset route above
      results.push({ id: user.id, name: user.name, email: user.email, rollNumber: user.rollNumber, generatedPassword });
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

    // The CSV of new passwords (built client-side from `results`, which is already complete) is
    // the reliable fallback regardless of email outcome, so it's fine for the response to go out
    // before any email has actually sent — same background-after-response pattern as bulk-upload.
    const batchId = req.body.sendEmail && results.length > 0 ? crypto.randomUUID() : null;
    const emailsQueued = batchId ? results.length : 0;

    res.json({ results, failedIds, emailsQueued, batchId });

    if (batchId) {
      mapWithConcurrency(results, EMAIL_CONCURRENCY, (u) =>
        sendMailLogged(prisma, {
          to: u.email,
          name: u.name,
          studentId: u.id,
          emailType: "CREDENTIALS_RESEND",
          batchId,
          subject: "Your CodeArena Password Has Been Reset",
          html: credentialsResendTemplate({ name: u.name, email: u.email, password: u.generatedPassword }),
        }).catch((e) => ({ ok: false, error: e.message }))
      ).catch((err) => console.error("[users.bulk-regenerate-password] background email batch failed:", err));
    }
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
      // deleting the account. TestAttempt (assessment history) and AttendanceRecord are checked
      // the same way — previously only certificates were checked here, so a student with test
      // attempts but no certificate was silently, permanently deleted along with their entire
      // assessment history, and AttendanceRecord.student is onDelete: Cascade at the schema level
      // (so it would have vanished with zero warning, not even an error). Any of these existing
      // blocks permanent deletion; the admin is expected to deactivate the account instead.
      // ResultEntry.student is also onDelete: Cascade at the schema level, same gap as
      // AttendanceRecord above — ResultEntry is a verified, official exam marksheet row (see the
      // model's own schema comment), so it must not silently vanish either.
      const [certCount, interviewCertCount, testAttemptCount, attendanceRecordCount, resultEntryCount] = await Promise.all([
        prisma.certificate.count({ where: { studentId: req.params.id } }),
        prisma.interviewCertificate.count({ where: { studentId: req.params.id } }),
        prisma.testAttempt.count({ where: { studentId: req.params.id } }),
        prisma.attendanceRecord.count({ where: { studentId: req.params.id } }),
        prisma.resultEntry.count({ where: { studentId: req.params.id } }),
      ]);
      if (certCount > 0 || interviewCertCount > 0) {
        const total = certCount + interviewCertCount;
        return res.status(409).json({
          error: `This student has earned ${total} certificate${total === 1 ? "" : "s"}. Revoke or reassign ${total === 1 ? "it" : "them"} first, then delete the account.`,
        });
      }
      if (testAttemptCount > 0) {
        return res.status(409).json({
          error: `This account has ${testAttemptCount} test attempt${testAttemptCount === 1 ? "" : "s"} on record. This action cannot be undone, and academic records like this are best preserved — it is recommended to deactivate the account instead.`,
        });
      }
      if (attendanceRecordCount > 0) {
        return res.status(409).json({
          error: `This account has ${attendanceRecordCount} attendance record${attendanceRecordCount === 1 ? "" : "s"} on record. This action cannot be undone, and academic records like this are best preserved — it is recommended to deactivate the account instead.`,
        });
      }
      if (resultEntryCount > 0) {
        return res.status(409).json({
          error: `This account has ${resultEntryCount} official result${resultEntryCount === 1 ? "" : "s"} on record. This action cannot be undone, and academic records like this are best preserved — it is recommended to deactivate the account instead.`,
        });
      }
      await prisma.user.delete({ where: { id: req.params.id } });
      // The student's academic group may now be empty — see the matching comment in PATCH /:id.
      await deleteAcademicGroupIfEmpty(user.academicGroupId);
    }

    await logAudit({
      req, action: AUDIT_ACTIONS.USER_DELETED, actorId: req.user.id, actorName: req.user.name, actorRole: req.user.role,
      studentId: user.id, instituteId: user.instituteId,
      details: { deletedUserRole: user.role, deletedUserName: user.name },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

module.exports = router;
