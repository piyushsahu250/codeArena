// The audit-trail views: password-reset history, the general searchable audit log (JSON and CSV), its action list, and the roll-number-conflict dashboard.
// Institute-bound requesters only see their own institute's rows; an unscoped platform account sees all. Behaviour and messages are those of the routes this replaced.
const { auditRollNumberConflicts } = require("../../../scripts/auditRollNumberConflicts");
const d = require("./users.domain");
const repo = require("./users.repository");

// An operational log capped at 300 rows, most recent first, not a paginated archive.
async function passwordResetHistory(instituteId) {
  return (await repo.passwordResetLogs(instituteId)).map(d.resetHistoryRow);
}

// Reuses the read-only audit script as the single definition of a conflict. It resolves nothing: renaming is a human decision made through the existing edit flow.
async function rollNumberConflicts(instituteId, query) {
  const { page, pageSize } = d.intPaging(query, 20, 50);
  const { duplicates } = await auditRollNumberConflicts();
  // Every student row of a duplicate group shares one institute (they are in the same academic group), so the first row decides.
  const scoped = instituteId ? duplicates.filter((x) => x.students[0]?.instituteId === instituteId) : duplicates;

  const total = scoped.length;
  const pageRows = scoped.slice((page - 1) * pageSize, page * pageSize);
  const groups = await repo.groupsWithInstitute([...new Set(pageRows.map((x) => x.groupId))]);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  return { conflicts: pageRows.map((x) => d.conflictRow(x, groupById.get(x.groupId))), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Returns { csv } for ?format=csv (one capped pull of 5000) or the paged JSON list.
async function auditLog(user, instituteId, query) {
  const where = d.auditWhere(user, query, instituteId);
  if (query.format === "csv") return { csv: d.auditCsv(await repo.auditLogsForExport(where)) };

  const { page, pageSize } = d.numPaging(query, 50, 200);
  const [rows, total] = await repo.auditLogPage(where, page, pageSize);
  return { rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

// Read from the real data rather than hard-coded, since older rows predate the action catalogue.
async function auditActions(instituteId) {
  return (await repo.distinctAuditActions(instituteId)).map((r) => r.action).sort();
}

module.exports = { passwordResetHistory, rollNumberConflicts, auditLog, auditActions };
