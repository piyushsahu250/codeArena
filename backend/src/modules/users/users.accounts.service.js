// Creating, editing and deleting accounts. No req/res: the controller passes `req` only for the audit entry's address and device, plus the acting user and the
// requester's institute (`requesterInstituteId`, set by attachRequesterInstitute; null for platform accounts, which may act on any institute).
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/users-write-contract.json).
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { sendMailLogged } = require("../../utils/mailer");
const { accountCredentialsTemplate } = require("../../utils/emailTemplates");
const { revokeAllSessions } = require("../../utils/sessions");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { generateTempPassword } = require("../../utils/password");
const { deleteAcademicGroupIfEmpty } = require("../../utils/academicGroups");
const { isValidEmail, normalizeEmail } = require("../../utils/emailValidation");
const {
  resolveRollNumberAvoidingCollisions, isValidRollNumber, REGISTRATION_NUMBER_RE, ROLL_NUMBER_MAX_LENGTH, fetchTakenRollNumbers, findRollNumberClash, withRollNumberLock,
} = require("../../utils/studentIdentifiers");
const d = require("./users.accounts.domain");
const repo = require("./users.accounts.repository");

// ---------------------------------------------------------------- create
async function createAccount(actor, body) {
  const { name, email: rawEmail, role, rollNumber, registrationNumber, department, mobile, gender, program, batchYear, section, instituteId, employeeId, designation } = body;
  const { req, user: admin, requesterInstituteId } = actor;
  if (!name || !rawEmail || !role) throw new ServiceError(400, "name, email, and role are required");
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new ServiceError(400, "Please enter a valid email address");

  const allowedRoles = d.creatableRoles(requesterInstituteId);
  if (!allowedRoles.includes(role)) throw new ServiceError(400, `role must be one of: ${allowedRoles.join(", ")}`);
  if (role === "INSTITUTE_ADMIN" && !instituteId) throw new ServiceError(400, "An institute is required to create an Institute Admin");
  if (!instituteId) throw new ServiceError(400, "An institute is required");
  // An institute-bound admin must not plant accounts under another institute by passing an arbitrary instituteId.
  if (requesterInstituteId && instituteId !== requesterInstituteId) throw new ServiceError(403, "You can only create accounts under your own institute");
  if (role === "STUDENT" && !d.filled(mobile)) throw new ServiceError(400, "A mobile number is required for students");
  if (role === "STUDENT" && !d.filled(batchYear)) throw new ServiceError(400, "A batch is required for students");
  // The Registration Number (PRN) is the platform's sole permanent unique student identifier, so a student cannot be created without it.
  if (role === "STUDENT" && !d.filled(registrationNumber)) throw new ServiceError(400, "A Registration Number (PRN) is required for students");
  if (mobile && !d.MOBILE_RE.test(String(mobile).trim())) throw new ServiceError(400, "Invalid mobile number");

  const institute = await repo.findInstitute(instituteId);
  if (!institute) throw new ServiceError(404, "Institute not found");

  let academicGroup = null;
  if (role === "STUDENT") academicGroup = await repo.resolveAcademicGroup({ instituteId, batchYear, departmentName: department, section });

  if (await repo.findUserByEmail(email)) throw new ServiceError(409, "Email already registered");

  // The PRN is unique platform-wide, checked before the create rather than left to surface as a raw constraint error. A Roll Number is unique only inside one
  // Academic Group (Institute + Batch + Department + Section).
  let normalizedRollNumber = String(rollNumber || "").trim() || null;
  const normalizedRegNumber = String(registrationNumber || "").trim() || null;
  if (normalizedRegNumber && !REGISTRATION_NUMBER_RE.test(normalizedRegNumber)) throw new ServiceError(400, "Registration Number (PRN) must be 9-12 alphanumeric characters");
  if (normalizedRollNumber && normalizedRollNumber.length > ROLL_NUMBER_MAX_LENGTH) throw new ServiceError(400, "Roll Number cannot exceed 3 characters");
  // A typed Roll Number must be exactly 3 digits; generated values satisfy this by construction.
  if (normalizedRollNumber && !isValidRollNumber(normalizedRollNumber)) throw new ServiceError(400, "Roll Number must be exactly 3 digits");
  if (role === "STUDENT" && normalizedRegNumber && (await repo.findByRegistrationNumber(normalizedRegNumber))) {
    throw new ServiceError(409, `Registration Number "${normalizedRegNumber}" is already registered to another account`);
  }
  if (d.filled(employeeId) && (await repo.findByEmployeeId(instituteId, String(employeeId).trim()))) {
    throw new ServiceError(409, `Employee ID "${employeeId}" is already in use at ${institute.name}`);
  }

  const generatedPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  // Roll-number resolution and the create happen in one advisory-locked transaction, which closes the concurrent-create race a pre-check cannot.
  let clashError = null;
  const user = await withRollNumberLock(academicGroup?.id, async (tx) => {
    if (role === "STUDENT" && normalizedRollNumber) {
      // A manually supplied Roll Number that collides inside the group is rejected outright, not silently resolved.
      const clashName = await findRollNumberClash(academicGroup?.id, normalizedRollNumber, null, tx);
      if (clashName) { clashError = d.rollClash(normalizedRollNumber, clashName); return null; }
    } else if (role === "STUDENT" && normalizedRegNumber) {
      normalizedRollNumber = resolveRollNumberAvoidingCollisions(normalizedRegNumber, await fetchTakenRollNumbers(academicGroup?.id, null, tx));
    }
    return repo.createUserTx(tx, {
      name, email, passwordHash, role, rollNumber: normalizedRollNumber, registrationNumber: normalizedRegNumber, department, mobile, gender,
      program, batchYear, section, instituteId, academicGroupId: academicGroup?.id || null, mustChangePassword: true,
      employeeId: employeeId ? String(employeeId).trim() : null, designation: designation ? String(designation).trim() : null,
    });
  });
  if (clashError) throw new ServiceError(409, clashError);

  const template = role === "STUDENT"
    ? accountCredentialsTemplate({
      name: user.name, email: user.email, password: generatedPassword, registrationNumber: normalizedRegNumber, institute: institute.name,
      departmentSection: academicGroup ? `Department: ${academicGroup.department.name} · Section: ${academicGroup.section}` : null, batchYear,
    })
    : accountCredentialsTemplate({ name: user.name, email: user.email, password: generatedPassword });
  const mailSend = sendMailLogged(prisma, {
    to: user.email, name: user.name, studentId: user.id, emailType: "CREDENTIALS", subject: "Your CodeArena Account Has Been Created", html: template,
  }).catch((e) => ({ ok: false, error: e.message }));
  // Bounded wait: the response must not depend on how busy the mail server is (see MAIL_WAIT_MS in the domain). The send itself is never cancelled.
  const mailResult = await d.withDeadline(mailSend, d.MAIL_WAIT_MS, { ok: false, error: d.MAIL_STILL_SENDING });
  const emailSent = !!mailResult.ok;
  const emailError = mailResult.error || null;

  await logAudit({
    req, action: AUDIT_ACTIONS.ACCOUNT_CREATED, actorId: admin.id, actorName: admin.name, actorRole: admin.role,
    studentId: role === "STUDENT" ? user.id : null, instituteId,
    details: { method: "single", userId: user.id, studentName: user.name, role, email: user.email, emailSent, emailError },
  });
  return { ...user, generatedPassword, emailSent, emailError };
}

// ---------------------------------------------------------------- edit
// Never touches the password. Every change is written to the audit log with before and after values.
async function editAccount(actor, id, body) {
  const { user: admin, requesterInstituteId } = actor;
  const existing = await repo.findUser(id);
  if (!existing) throw new ServiceError(404, "User not found");
  if (requesterInstituteId && existing.instituteId !== requesterInstituteId) throw new ServiceError(403, "You can only edit users under your own institute");
  if (requesterInstituteId && body.instituteId !== undefined && body.instituteId !== requesterInstituteId) throw new ServiceError(403, "You cannot move a user to a different institute");

  const data = {};
  for (const field of d.EDITABLE_FIELDS) if (body[field] !== undefined) data[field] = body[field];

  if (data.email !== undefined) {
    const email = normalizeEmail(data.email);
    if (!isValidEmail(email)) throw new ServiceError(400, "Please enter a valid email address");
    if (email !== existing.email) {
      if (await repo.findUserByEmail(email)) throw new ServiceError(409, "This email address is already associated with an account");
      // An address typed in by an admin has not been proven to belong to this person: a stale `true` from the old address must not carry over.
      data.emailVerified = false;
      data.emailVerifiedAt = null;
    }
    data.email = email;
  }
  if (data.mobile !== undefined && data.mobile !== null && data.mobile !== "" && !d.MOBILE_RE.test(String(data.mobile).trim())) throw new ServiceError(400, "Invalid mobile number");
  // Roll Number: blank becomes null, never ""; the same-group collision check runs further down, once the final academic group is known.
  if (data.rollNumber !== undefined) {
    data.rollNumber = String(data.rollNumber || "").trim() || null;
    if (data.rollNumber && data.rollNumber.length > ROLL_NUMBER_MAX_LENGTH) throw new ServiceError(400, "Roll Number cannot exceed 3 characters");
    if (data.rollNumber && !isValidRollNumber(data.rollNumber)) throw new ServiceError(400, "Roll Number must be exactly 3 digits");
  }
  // The PRN is unique platform-wide; checked before saving so a raw constraint error never reaches the admin. Blank becomes null (NULL never conflicts, "" would).
  if (data.registrationNumber !== undefined) {
    const registrationNumber = String(data.registrationNumber || "").trim();
    if (!registrationNumber) {
      data.registrationNumber = null;
    } else {
      if (!REGISTRATION_NUMBER_RE.test(registrationNumber)) throw new ServiceError(400, "Registration Number (PRN) must be 9-12 alphanumeric characters");
      if (registrationNumber !== existing.registrationNumber && (await repo.findByRegistrationNumber(registrationNumber, existing.id))) {
        throw new ServiceError(409, "That Registration Number (PRN) is already registered to another account");
      }
      data.registrationNumber = registrationNumber;
    }
  }
  // The same NULL-tolerant per-institute uniqueness for staff and clerk employee ids.
  if (data.employeeId !== undefined) {
    const employeeId = String(data.employeeId || "").trim();
    if (!employeeId) {
      data.employeeId = null;
    } else {
      const targetInstituteId = data.instituteId !== undefined ? data.instituteId : existing.instituteId;
      if ((employeeId !== existing.employeeId || targetInstituteId !== existing.instituteId) && (await repo.findByEmployeeId(targetInstituteId, employeeId, existing.id))) {
        throw new ServiceError(409, "That employee ID is already in use by another account at this institute");
      }
      data.employeeId = employeeId;
    }
  }
  if (data.instituteId && !(await repo.findInstitute(data.instituteId))) throw new ServiceError(404, "Institute not found");
  // Re-resolve the academic group whenever any of its four keys change, so an edited batch, department or section (or a moved institute) keeps it current.
  if (existing.role === "STUDENT" && (data.batchYear !== undefined || data.department !== undefined || data.section !== undefined || data.instituteId !== undefined)) {
    const group = await repo.resolveAcademicGroup({
      instituteId: data.instituteId !== undefined ? data.instituteId : existing.instituteId,
      batchYear: data.batchYear !== undefined ? data.batchYear : existing.batchYear,
      departmentName: data.department !== undefined ? data.department : existing.department,
      section: data.section !== undefined ? data.section : existing.section,
    });
    data.academicGroupId = group.id;
  }

  // The final target group and PRN are both known now; the collision check and the write share one advisory-locked transaction so a concurrent edit or create in
  // the same group cannot slip a colliding Roll Number in between.
  const targetAcademicGroupId = existing.role === "STUDENT" ? (data.academicGroupId !== undefined ? data.academicGroupId : existing.academicGroupId) : null;
  const adminRow = await repo.findUserNameById(admin.id);
  const isActiveToggled = data.isActive !== undefined && data.isActive !== existing.isActive;
  const auditAction = d.auditActionForEdit(existing.role, isActiveToggled, data.isActive);

  let clashError = null;
  const updated = await withRollNumberLock(targetAcademicGroupId, async (tx) => {
    if (existing.role === "STUDENT") {
      const rollNumberExplicitlyEdited = body.rollNumber !== undefined;
      const prnChanged = data.registrationNumber !== undefined && data.registrationNumber !== existing.registrationNumber;
      const groupChanged = data.academicGroupId !== undefined && data.academicGroupId !== existing.academicGroupId;

      if (rollNumberExplicitlyEdited) {
        if (data.rollNumber) {
          const clashName = await findRollNumberClash(targetAcademicGroupId, data.rollNumber, existing.id, tx);
          if (clashName) { clashError = d.rollClash(data.rollNumber, clashName); return null; }
        }
      } else if (prnChanged) {
        data.rollNumber = resolveRollNumberAvoidingCollisions(data.registrationNumber, await fetchTakenRollNumbers(targetAcademicGroupId, existing.id, tx));
      } else if (groupChanged && existing.rollNumber) {
        // Moved to another group without touching Roll Number or PRN: re-derive only if the existing value collides with someone already in the new group.
        const taken = await fetchTakenRollNumbers(targetAcademicGroupId, existing.id, tx);
        if (taken.has(existing.rollNumber) && existing.registrationNumber) data.rollNumber = resolveRollNumberAvoidingCollisions(existing.registrationNumber, taken);
      }
    }
    // The before/after record reflects the FINAL data (including a roll number just resolved above), so it is computed inside the lock.
    const fields = d.changedFields(existing, data);
    const [result] = await Promise.all([
      repo.updateUserTx(tx, existing.id, data),
      repo.createAuditTx(tx, {
        action: auditAction,
        adminId: admin.id,
        adminRole: admin.role,
        studentId: existing.id,
        instituteId: existing.instituteId,
        adminName: adminRow?.name || admin.email,
        details: {
          studentId: existing.id,
          studentName: existing.name,
          changedFields: fields,
          before: Object.fromEntries(fields.map((f) => [f, existing[f]])),
          after: Object.fromEntries(fields.map((f) => [f, data[f]])),
        },
      }),
    ]);
    return result;
  });
  if (clashError) throw new ServiceError(409, clashError);

  // An academic group is purely derived: once nothing is enrolled in the old one it should not be left behind as an empty row.
  if (data.academicGroupId !== undefined && data.academicGroupId !== existing.academicGroupId) await deleteAcademicGroupIfEmpty(existing.academicGroupId);
  // A deactivated account must lose access at once, not only at its next login: authenticate() never reads User.isActive, so an open session would stay usable
  // (even mid-exam) for up to the 12h token life.
  if (isActiveToggled && !data.isActive) await revokeAllSessions(existing.id).catch(() => {});
  return updated;
}

// ---------------------------------------------------------------- delete
// Deleting a student also removes their own attempts and submissions only if there are none (academic records block deletion; deactivate instead). Deleting a
// staff or admin account that created tests, lecture plans or attendance is blocked rather than cascading into data other people see.
async function deleteAccount(actor, id) {
  const { req, user: admin, requesterInstituteId } = actor;
  if (id === admin.id) throw new ServiceError(400, "You cannot delete your own account");
  const user = await repo.findUser(id);
  if (!user) throw new ServiceError(404, "User not found");
  if (requesterInstituteId && user.instituteId !== requesterInstituteId) throw new ServiceError(403, "You can only manage accounts under your own institute");

  if (user.role !== "STUDENT") {
    const tests = await repo.countTestsCreated(id);
    if (tests > 0) throw new ServiceError(409, d.deleteBlocked.tests(tests));
    // Lecture plans and attendance sessions are also restrict-on-delete; unchecked, deleting such a staff account was an unhandled 500.
    const [plans, sessions] = await Promise.all([repo.countLecturePlans(id), repo.countAttendanceSessionsMarked(id)]);
    if (plans > 0) throw new ServiceError(409, d.deleteBlocked.lecturePlans(plans));
    if (sessions > 0) throw new ServiceError(409, d.deleteBlocked.attendanceSessions(sessions));
    await repo.deleteUser(id);
  } else {
    // A certificate is proof of something earned and must not be silently destroyed. Attempts, attendance and official results would vanish with the account
    // (the last two cascade at schema level), so any of them blocks permanent deletion.
    const c = await repo.studentRecordCounts(id);
    const certificates = c.certificates + c.interviewCertificates;
    if (certificates > 0) throw new ServiceError(409, d.deleteBlocked.certificates(certificates));
    if (c.attempts > 0) throw new ServiceError(409, d.deleteBlocked.attempts(c.attempts));
    if (c.attendanceRecords > 0) throw new ServiceError(409, d.deleteBlocked.attendanceRecords(c.attendanceRecords));
    if (c.results > 0) throw new ServiceError(409, d.deleteBlocked.results(c.results));
    await repo.deleteUser(id);
    await deleteAcademicGroupIfEmpty(user.academicGroupId); // the student's group may now be empty
  }

  await logAudit({
    req, action: AUDIT_ACTIONS.USER_DELETED, actorId: admin.id, actorName: admin.name, actorRole: admin.role,
    studentId: user.id, instituteId: user.instituteId, details: { deletedUserRole: user.role, deletedUserName: user.name },
  });
  return { success: true };
}

module.exports = { createAccount, editAccount, deleteAccount };
