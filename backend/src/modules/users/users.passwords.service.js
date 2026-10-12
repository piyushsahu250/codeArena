// Administrator-driven password resets (one account or many) and bulk activate/deactivate. Every reset produces a NEW, unique random temporary password (or a
// complexity-checked one the admin typed), never a shared or fixed value, flags the account to change it at next login, and closes the account's open sessions.
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/users-write-contract.json).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { sendMailLogged } = require("../../utils/mailer");
const { credentialsResendTemplate } = require("../../utils/emailTemplates");
const { revokeAllSessions } = require("../../utils/sessions");
const { generateTempPassword, validatePasswordComplexity, recordPasswordChange } = require("../../utils/password");
const { mapWithConcurrency } = require("../../utils/queue");
const { AFTER } = require("./users.bulk.service");
const repo = require("./users.accounts.repository");

const EMAIL_CONCURRENCY = Number(process.env.EMAIL_CONCURRENCY) || 5;

// Declared change: STAFF members could reset the password of ANY account of their institute, including their institute admin, and the new password came back in
// the response, a one-step takeover of a higher role. Staff may now reset students only; administrators keep the rights they had.
const STAFF_RESET_REFUSED = "Staff can reset passwords for students only";

async function replace(userId, passwordHash) {
  // The reuse block is skipped (history depth null) because the password is system-generated, but the change is still tracked for future dedup.
  await repo.replacePassword(userId, passwordHash, (tx) => recordPasswordChange(tx, userId, passwordHash, null));
}

async function resetPassword(actor, id, body) {
  const { user: admin, requesterInstituteId } = actor;
  const user = await repo.findUser(id);
  if (!user) throw new ServiceError(404, "User not found");
  if (requesterInstituteId && user.instituteId !== requesterInstituteId) throw new ServiceError(403, "You can only reset passwords for students under your own institute");
  if (admin.role === "STAFF" && user.role !== "STUDENT") throw new ServiceError(403, STAFF_RESET_REFUSED);

  let newPassword;
  if (body.customPassword) {
    newPassword = String(body.customPassword).trim();
    const complexityError = validatePasswordComplexity(newPassword);
    if (complexityError) throw new ServiceError(400, complexityError);
  } else {
    newPassword = generateTempPassword();
  }
  await replace(id, await bcrypt.hash(newPassword, 10));
  // An admin reset is often done because the account may be compromised or the student is locked out: an old session must not outlive the credential change.
  await revokeAllSessions(id).catch(() => {});

  let emailSent = null; // null = not requested, true or false = requested and its outcome
  let emailError = null;
  if (body.sendEmail) {
    const mailResult = await sendMailLogged(prisma, {
      to: user.email, name: user.name, studentId: user.id, emailType: "CREDENTIALS_RESEND", subject: "Your CodeArena Password Has Been Reset",
      html: credentialsResendTemplate({ name: user.name, email: user.email, password: newPassword }),
    }).catch((e) => ({ ok: false, error: e.message }));
    emailSent = !!mailResult.ok;
    emailError = mailResult.error || null;
  }

  const adminRow = await repo.findUserNameById(admin.id);
  await repo.createAudit({
    action: "PASSWORD_RESET", adminId: admin.id, adminName: adminRow?.name || admin.email, studentId: user.id, instituteId: user.instituteId,
    details: { studentId: user.id, studentName: user.name, emailSent, emailError },
  }).catch(() => {});
  return { success: true, defaultPassword: newPassword, emailSent, emailError };
}

// Out-of-institute ids are excluded from the query itself (not merely hidden from the response), so they land in failedIds rather than silently succeeding.
async function bulkRegenerate(actor, body) {
  const { user: admin, requesterInstituteId } = actor;
  const ids = Array.isArray(body.studentIds) ? [...new Set(body.studentIds)] : [];
  if (ids.length === 0) throw new ServiceError(400, "No students selected");

  const users = await repo.findUsersByIds(ids, requesterInstituteId);
  const results = [];
  for (const user of users) {
    const generatedPassword = generateTempPassword();
    await replace(user.id, await bcrypt.hash(generatedPassword, 10));
    await revokeAllSessions(user.id).catch(() => {});
    results.push({ id: user.id, name: user.name, email: user.email, rollNumber: user.rollNumber, generatedPassword });
  }
  const failedIds = ids.filter((id) => !users.some((u) => u.id === id));

  const adminRow = await repo.findUserNameById(admin.id);
  await repo.createAudit({
    action: "PASSWORD_RESET", adminId: admin.id, adminName: adminRow?.name || admin.email,
    details: { bulk: true, count: results.length, studentIds: results.map((u) => u.id), sendEmail: !!body.sendEmail },
  }).catch(() => {});

  // The CSV of new passwords (built client-side from `results`) is the reliable fallback whatever the e-mail outcome, so the response can go out before any send.
  const batchId = body.sendEmail && results.length > 0 ? crypto.randomUUID() : null;
  const out = { results, failedIds, emailsQueued: batchId ? results.length : 0, batchId };
  if (!batchId) return out;
  out[AFTER] = () => mapWithConcurrency(results, EMAIL_CONCURRENCY, (u) =>
    sendMailLogged(prisma, {
      to: u.email, name: u.name, studentId: u.id, emailType: "CREDENTIALS_RESEND", batchId, subject: "Your CodeArena Password Has Been Reset",
      html: credentialsResendTemplate({ name: u.name, email: u.email, password: u.generatedPassword }),
    }).catch((e) => ({ ok: false, error: e.message }))
  ).catch((err) => console.error("[users.bulk-regenerate-password] background email batch failed:", err));
  return out;
}

// STUDENT only, deliberately: staff and clerks go through staffClerk's own status route, which carries a richer LOCKED / ACTIVE / SUSPENDED state machine that a
// plain isActive toggle here would silently bypass. Deactivating cuts off open sessions immediately, as the single edit does.
async function bulkStatus(actor, body) {
  const { user: admin, requesterInstituteId } = actor;
  const ids = Array.isArray(body.studentIds) ? [...new Set(body.studentIds)] : [];
  const isActive = !!body.isActive;
  if (ids.length === 0) throw new ServiceError(400, "No students selected");

  const targets = await repo.findStudentsForStatus(ids, requesterInstituteId);
  const toUpdate = targets.filter((u) => u.isActive !== isActive); // skip no-ops: already at the target state
  const adminRow = await repo.findUserNameById(admin.id);
  const action = isActive ? "ACCOUNT_ACTIVATED" : "ACCOUNT_DEACTIVATED";

  for (const u of toUpdate) {
    // Declared change: these audit rows carried no role, student or institute, so the institute-scoped and per-student audit views could never find them.
    await repo.setActiveWithAudit(u.id, isActive, {
      action, adminId: admin.id, adminName: adminRow?.name || admin.email, adminRole: admin.role, studentId: u.id, instituteId: u.instituteId,
      details: { studentId: u.id, studentName: u.name, bulk: true, before: u.isActive, after: isActive },
    });
    if (!isActive) await revokeAllSessions(u.id).catch(() => {});
  }
  return { updated: toUpdate.length, skipped: targets.length - toUpdate.length, failedIds: ids.filter((id) => !targets.some((u) => u.id === id)) };
}

module.exports = { resetPassword, bulkRegenerate, bulkStatus };
