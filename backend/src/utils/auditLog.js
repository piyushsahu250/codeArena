const prisma = require("../prisma");

// Coarse User-Agent parsing — this platform only needs enough precision for an admin skimming a
// login-history list to recognize "that's not my usual browser," not full device fingerprinting.
function parseDevice(userAgent) {
  const ua = String(userAgent || "");

  let browser = "Unknown browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";

  let os = "Unknown OS";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ios/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";

  const device = /ipad|tablet/i.test(ua) ? "Tablet" : /mobile/i.test(ua) ? "Mobile" : "Desktop";

  return { browser, os, device, summary: `${browser} on ${os}` };
}

// Catalogue of action strings this platform writes, kept here as documentation only — `action`
// stays a free-text column (see AuditLog.action comment in schema.prisma) so a new call site
// doesn't need a schema migration, but every writer should pick a name from (or matching the
// style of) this list rather than inventing an inconsistent one.
const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LOGIN_FAILED: "LOGIN_FAILED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_RESET: "PASSWORD_RESET",
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  STUDENT_PROFILE_UPDATED: "STUDENT_PROFILE_UPDATED",
  TEST_CREATED: "TEST_CREATED",
  TEST_ASSIGNED: "TEST_ASSIGNED",
  RESULT_MODIFIED: "RESULT_MODIFIED",
  REATTEMPT_GRANTED: "REATTEMPT_GRANTED",
  CERTIFICATE_ISSUED: "CERTIFICATE_ISSUED",
  CERTIFICATE_REVOKED: "CERTIFICATE_REVOKED",
  QUESTION_BANK_CHANGED: "QUESTION_BANK_CHANGED",
  USER_MANAGEMENT_CHANGED: "USER_MANAGEMENT_CHANGED",
  INSTITUTE_CONFIG_CHANGED: "INSTITUTE_CONFIG_CHANGED",
  SESSION_REVOKED: "SESSION_REVOKED",
  DATABASE_BACKUP_DOWNLOADED: "DATABASE_BACKUP_DOWNLOADED",
  DATA_EXPORTED: "DATA_EXPORTED",
  AI_AUTO_REFRESH_RUN: "AI_AUTO_REFRESH_RUN",
  STAFF_CLASS_ASSIGNMENT_CHANGED: "STAFF_CLASS_ASSIGNMENT_CHANGED",
  ATTENDANCE_MARKED: "ATTENDANCE_MARKED",
  COURSE_MANAGEMENT_CHANGED: "COURSE_MANAGEMENT_CHANGED",
  COMPANY_MASTER_CHANGED: "COMPANY_MASTER_CHANGED",
};

// Never throws — audit logging is a best-effort side channel (same posture as this codebase's
// email-send tracking) and must not be able to fail the request it's describing.
async function logAudit({ req, action, actorId, actorName, actorRole, studentId, instituteId, details }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        adminId: actorId || "system",
        adminName: actorName || "System",
        adminRole: actorRole || null,
        ipAddress: req?.ip || null,
        deviceInfo: req ? parseDevice(req.headers["user-agent"]).summary : null,
        studentId: studentId || null,
        instituteId: instituteId || null,
        details: details || {},
      },
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

module.exports = { logAudit, parseDevice, AUDIT_ACTIONS };
