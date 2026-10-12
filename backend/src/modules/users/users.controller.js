// HTTP in, HTTP out for the user-directory, own-account and audit routes. Reads the request, calls a service and maps results and ServiceErrors to responses.
// Two failure styles are preserved from the routes this replaced:
//   most routes:                 an unexpected fault is logged and answered with a fixed 500 message;
//   user list and single user:   an unexpected fault is passed to the application's error handler (these two had no try/catch).
const { ServiceError } = require("../../utils/serviceError");
const { generatePerformancePdf } = require("../../utils/reportPdf");
const account = require("./users.account.service");
const directory = require("./users.directory.service");
const audit = require("./users.audit.service");
const performance = require("./users.performance.service");
const accounts = require("./users.accounts.service");
const bulk = require("./users.bulk.service");
const passwords = require("./users.passwords.service");
const { uniqueViolation } = require("./users.accounts.domain");

const refuse = (res, err) => res.status(err.status).json({ error: err.message, ...(err.extra || {}) });

// `send(res, result, req)` lets a route answer with something other than res.json(result) (a file, a CSV).
function handler(fallback, fn, send) {
  return async (req, res) => {
    try {
      const out = await fn(req);
      if (send) return send(res, out, req);
      res.json(out);
    } catch (err) {
      if (err instanceof ServiceError) return refuse(res, err);
      console.error(err);
      res.status(500).json({ error: fallback });
    }
  };
}
function unguarded(fn) {
  return async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof ServiceError) return refuse(res, err);
      next(err);
    }
  };
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ---- own account ----
const updateOwnAccount = handler("Failed to update account", (req) => account.updateOwnAccount(req, req.body));
const resendVerification = handler("Failed to resend verification email", (req) => account.resendVerification(req.user.id));
const mySessions = handler("Failed to load sessions", (req) => account.mySessions(req.user));
const endMySession = handler("Failed to sign out session", (req) => account.endMySession(req, req.params.sessionId));

// ---- directory ----
const listUsers = unguarded((req) => directory.listUsers(req.requesterInstituteId, req.query));
const getUser = unguarded((req) => directory.getUser(req.requesterInstituteId, req.params.id));
const lookup = handler("Lookup failed", (req) => directory.lookupStudent(req.requesterInstituteId, req.params.query));
const search = handler("Search failed", (req) => directory.searchUsers(req.requesterInstituteId, req.query));
const browse = handler("Browse failed", (req) => directory.browseSection(req.requesterInstituteId, req.query));
const migrationStatus = handler("Failed to load migration status", () => directory.migrationStatus());
const template = (req, res) => {
  const buffer = directory.templateWorkbook();
  res.setHeader("Content-Type", XLSX_TYPE);
  res.setHeader("Content-Disposition", "attachment; filename=student-upload-template.xlsx");
  res.send(buffer);
};

// ---- audit ----
const resetHistory = handler("Failed to load password reset history", (req) => audit.passwordResetHistory(req.requesterInstituteId));
const conflicts = handler("Failed to load roll number conflicts", (req) => audit.rollNumberConflicts(req.requesterInstituteId, req.query));
const auditLog = handler("Failed to load audit log", (req) => audit.auditLog(req.user, req.requesterInstituteId, req.query), (res, out) => {
  if (out.csv === undefined) return res.json(out);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
  res.send(out.csv);
});
const auditActions = handler("Failed to load audit actions", (req) => audit.auditActions(req.requesterInstituteId));

// ---- performance ----
const dashboard = handler("Failed to load performance data", (req) => performance.dashboard(req.user, req.params.id));
const readiness = handler("Failed to load placement readiness", (req) => performance.placementReadiness(req.user, req.params.id));
const excelReport = handler("Failed to generate Excel report", async (req) => {
  const data = await performance.reportData(req.user, req.params.id);
  return { buffer: performance.excelReport(data), stem: performance.reportFileStem(data) };
}, (res, out) => {
  res.setHeader("Content-Type", XLSX_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${out.stem}-performance-report.xlsx"`);
  res.send(out.buffer);
});
const pdfReport = handler("Failed to generate PDF report", (req) => performance.reportData(req.user, req.params.id), (res, data) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${performance.reportFileStem(data)}-performance-report.pdf"`);
  generatePerformancePdf(data, res);
});

module.exports = {
  updateOwnAccount, resendVerification, mySessions, endMySession, listUsers, getUser, lookup, search, browse, migrationStatus, template,
  resetHistory, conflicts, auditLog, auditActions, dashboard, readiness, excelReport, pdfReport,
};

// ---- writes: create, edit, delete, bulk upload, password resets, bulk status ----
// Same failure style as the routes this replaced: an unexpected fault is logged and answered with a fixed message; where noted, a unique-constraint collision that
// the pre-checks missed (a race between two requests) is a clean 409. A result may carry work to run AFTER the response (the background e-mail batch).
const actor = (req) => ({ req, user: req.user, requesterInstituteId: req.requesterInstituteId });

function writer(fallback, fn, { p2002 = false, log = (err) => console.error(err) } = {}) {
  return async (req, res) => {
    try {
      const out = await fn(req);
      res.json(out);
      if (out && out[bulk.AFTER]) { try { out[bulk.AFTER](); } catch (afterErr) { console.error("[users] background work failed:", afterErr); } }
    } catch (err) {
      if (err instanceof ServiceError) return refuse(res, err);
      log(err);
      if (p2002 && err.code === "P2002") return res.status(409).json({ error: uniqueViolation(err) });
      res.status(500).json({ error: fallback });
    }
  };
}

const createAccount = writer("Failed to create user. Please try again, and contact support if the issue persists.", (req) => accounts.createAccount(actor(req), req.body),
  { p2002: true, log: (err) => console.error("[users.create] failed:", { message: err.message, code: err.code, meta: err.meta }) });
const editAccount = writer("Failed to update user", (req) => accounts.editAccount(actor(req), req.params.id, req.body), { p2002: true });
const deleteAccount = writer("Failed to delete account", (req) => accounts.deleteAccount(actor(req), req.params.id));
const bulkPreview = writer("Failed to validate file", (req) => bulk.preview(req.requesterInstituteId, req.file), { log: (err) => console.error("[users.bulk-upload.preview] failed:", err) });
const bulkConfirm = writer("Bulk import failed", (req) => bulk.confirm(actor(req), req.body), { log: (err) => console.error("[users.bulk-upload.confirm] failed:", err) });
const resetPassword = writer("Failed to reset password", (req) => passwords.resetPassword(actor(req), req.params.id, req.body));
const bulkRegenerate = writer("Failed to regenerate passwords", (req) => passwords.bulkRegenerate(actor(req), req.body));
const bulkStatus = writer("Failed to update student status", (req) => passwords.bulkStatus(actor(req), req.body));

Object.assign(module.exports, { createAccount, editAccount, deleteAccount, bulkPreview, bulkConfirm, resetPassword, bulkRegenerate, bulkStatus });
