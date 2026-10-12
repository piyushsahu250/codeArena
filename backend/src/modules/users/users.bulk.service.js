// Bulk student import in two steps. Preview parses and fully validates the uploaded file WITHOUT creating anything, so the admin sees "185 valid / 10 invalid /
// 5 duplicate" before a single account exists. Confirm creates accounts only for the rows the admin kept, re-validating each against fresh database state
// (never trusting the preview's possibly stale snapshot), with a unique random password per account and a forced password change at first login.
// Behaviour, status codes and messages are those of the routes this replaced (see backend/test/snapshots/users-write-contract.json).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../../prisma");
const { ServiceError } = require("../../utils/serviceError");
const { sendMailLogged } = require("../../utils/mailer");
const { accountCredentialsTemplate } = require("../../utils/emailTemplates");
const { logAudit, AUDIT_ACTIONS } = require("../../utils/auditLog");
const { generateTempPassword } = require("../../utils/password");
const { mapWithConcurrency } = require("../../utils/queue");
const { resolveRollNumberAvoidingCollisions, fetchTakenRollNumbers, withRollNumberLock } = require("../../utils/studentIdentifiers");
const d = require("./users.accounts.domain");
const repo = require("./users.accounts.repository");

// A service result that also needs work done AFTER the response has been sent (the background e-mail batch).
const AFTER = Symbol("after");

// Bounded concurrency for background credential e-mails: small enough not to open dozens of simultaneous SMTP connections on this single low-resource instance.
const EMAIL_CONCURRENCY = Number(process.env.EMAIL_CONCURRENCY) || 5;

// Scoped to the e-mails and PRNs present in these rows rather than every user on the platform, and re-run fresh at BOTH steps (never reused between them) so
// confirm sees the latest state.
async function loadBulkContext(rows) {
  const emailsInFile = [...new Set(rows.map((r) => r.email).filter(Boolean))];
  const regNumbersInFile = [...new Set(rows.map((r) => r.registrationNumber).filter(Boolean))];
  const [existingUsers, institutes] = await Promise.all([repo.findExistingForBulk(emailsInFile, regNumbersInFile), repo.listInstitutes()]);
  return {
    existingEmails: new Set(existingUsers.map((u) => u.email.toLowerCase())),
    // The PRN is unique platform-wide, so there is no institute scoping in the dedup key. Roll Number is deliberately not deduped here (duplicates across groups
    // are expected by design).
    existingRegNumbers: new Set(existingUsers.filter((u) => u.registrationNumber).map((u) => u.registrationNumber.toLowerCase())),
    instituteByName: new Map(institutes.map((i) => [i.name.toLowerCase(), i])),
  };
}

async function preview(requesterInstituteId, file) {
  if (!file) throw new ServiceError(400, "No file uploaded");
  const parsed = d.parseBulkFile(file.buffer);
  if (parsed.error) throw new ServiceError(400, parsed.error);
  if (parsed.rows.length === 0) throw new ServiceError(400, "The uploaded file has no data rows.");

  const ctx = await loadBulkContext(parsed.rows);
  const seenEmails = new Set();
  const seenRegNumbers = new Set();
  const rows = parsed.rows.map((row) => {
    const result = d.validateBulkRow(row, { ...ctx, requesterInstituteId, seenEmails, seenRegNumbers });
    return { row: row.rowNum, ...row, rollNumberPreview: result.rollNumberPreview, status: result.status, reason: result.reason || null };
  });
  return d.previewSummary(rows);
}

const problem = (row, result, rollNumber) => ({ row: row.rowNum, name: row.name, email: row.email, registrationNumber: row.registrationNumber, rollNumber, reason: result });

async function confirm(actor, body) {
  const { req, user: admin, requesterInstituteId } = actor;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) throw new ServiceError(400, "No rows to import");
  if (rows.length > d.BULK_MAX_ROWS) throw new ServiceError(400, "Too many rows in one confirm request");
  const sendCredentials = !!body.sendCredentials;

  const ctx = await loadBulkContext(rows);
  const seenEmails = new Set();
  const seenRegNumbers = new Set();
  const groupCache = new Map();
  const groupRollNumberCache = new Map(); // academicGroupId -> Roll Numbers already used in that group (database + rows already created this run)
  const created = [];
  const duplicates = [];
  const errors = [];

  for (const row of rows) {
    const result = d.validateBulkRow(row, { ...ctx, requesterInstituteId, seenEmails, seenRegNumbers });
    if (result.status === "error") { errors.push(problem(row, result.reason, result.rollNumberPreview)); continue; }
    if (result.status === "duplicate") { duplicates.push(problem(row, result.reason, result.rollNumberPreview)); continue; }

    const { institute } = result;
    const generatedPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    try {
      const group = await repo.resolveAcademicGroup({ instituteId: institute.id, batchYear: row.batchYear, departmentName: row.department, section: row.section }, groupCache);
      // Resolve and create share one advisory-locked transaction. The in-memory cache saves a database read per row of a large upload to the same group (rows of
      // this run are processed one commit at a time, so it stays accurate); the lock protects against a DIFFERENT concurrent request targeting the group.
      const user = await withRollNumberLock(group.id, async (tx) => {
        if (!groupRollNumberCache.has(group.id)) groupRollNumberCache.set(group.id, await fetchTakenRollNumbers(group.id, null, tx));
        const takenInGroup = groupRollNumberCache.get(group.id);
        const finalRollNumber = resolveRollNumberAvoidingCollisions(row.registrationNumber, takenInGroup);
        if (finalRollNumber) takenInGroup.add(finalRollNumber);
        return repo.createBulkStudentTx(tx, {
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
        });
      });
      created.push({ ...user, generatedPassword });
    } catch (err) {
      // P2002 here is a genuine last-instant race (two concurrent confirms) that slipped past the fresh check: reported per row, never a raw 500.
      errors.push(problem(row, err.code === "P2002" ? "Duplicate detected during creation" : "Failed to create account", null));
    }
  }

  // Credential e-mails are never sent inside the request (a few hundred sends would hold the response open): the response goes out with a batchId, sending runs
  // afterwards in a bounded-concurrency pass, and the admin polls GET /admin/email-logs/batch/:batchId/summary for live counts.
  const batchId = sendCredentials && created.length > 0 ? crypto.randomUUID() : null;

  await logAudit({
    req, action: AUDIT_ACTIONS.ACCOUNT_CREATED, actorId: admin.id, actorName: admin.name, actorRole: admin.role,
    instituteId: requesterInstituteId || (created[0]?.instituteId ?? null),
    details: { method: "bulk", createdCount: created.length, duplicateCount: duplicates.length, errorCount: errors.length, totalRows: rows.length },
  });

  const out = {
    total: rows.length,
    createdCount: created.length,
    duplicateCount: duplicates.length,
    errorCount: errors.length,
    created: created.map((u) => ({ name: u.name, email: u.email, registrationNumber: u.registrationNumber, rollNumber: u.rollNumber, generatedPassword: u.generatedPassword })),
    duplicates,
    errors,
    sendCredentials,
    emailsQueued: batchId ? created.length : 0,
    batchId,
  };
  if (!batchId) return out;
  // Not awaited: an error here must never reach the controller's catch, which would try to send a second response.
  out[AFTER] = () => mapWithConcurrency(created, EMAIL_CONCURRENCY, (u) =>
    sendMailLogged(prisma, {
      to: u.email, name: u.name, studentId: u.id, emailType: "CREDENTIALS", batchId, subject: "Your CodeArena Account Has Been Created",
      html: accountCredentialsTemplate({ name: u.name, email: u.email, password: u.generatedPassword, registrationNumber: u.registrationNumber }),
    }).catch((e) => ({ ok: false, error: e.message }))
  ).catch((err) => console.error("[users.bulk-upload.confirm] background email batch failed:", err));
  return out;
}

module.exports = { preview, confirm, AFTER };
