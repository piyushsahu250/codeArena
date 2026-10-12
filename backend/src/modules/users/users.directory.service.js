// The user directory: list, one user, look a student up, search, browse a section, the bulk-upload template, and the academic-group migration counters.
// Institute-bound requesters only ever see their own institute (`requesterInstituteId`, set by attachRequesterInstitute); platform accounts see everyone.
// Behaviour and messages are those of the routes this replaced (see backend/test/snapshots/users-contract.json).
const { ServiceError } = require("../../utils/serviceError");
const { compareRollNumbers } = require("../../utils/studentIdentifiers");
const d = require("./users.domain");
const repo = require("./users.repository");

async function listUsers(instituteId, query) {
  const { page, pageSize } = d.numPaging(query, 200, 500);
  const [rows, total] = await repo.listUsers(d.instituteFilter(instituteId), page, pageSize);
  return { rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

async function getUser(instituteId, id) {
  const user = await repo.selectUser(id);
  if (!user) throw new ServiceError(404, "User not found");
  // The row selected for display carries the institute as { id, name } and no flat instituteId, so the comparison has to use institute.id. Comparing the missing
  // field made every institute-bound admin get 403 for every user, including their own (a fix declared in the contract snapshot).
  const userInstituteId = user.institute ? user.institute.id : null;
  if (instituteId && userInstituteId !== instituteId) throw new ServiceError(403, "You can only view users under your own institute");
  return user;
}

async function lookupStudent(instituteId, query) {
  const user = await repo.lookupStudent(d.lookupWhere(query, instituteId));
  if (!user) throw new ServiceError(404, "No student found with that registration number, roll number, email, or ID");
  return user;
}

// Real database paging, the one cross-role search surface; an optional ?role= narrows to one role.
async function searchUsers(instituteId, query) {
  const q = String(query.q || "").trim();
  if (!q) return { rows: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };
  const { page, pageSize } = d.intPaging(query, 20, 100);
  const [rows, total] = await repo.searchUsers(d.searchWhere(q, query, instituteId), page, pageSize);
  return { rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// Institute -> Department -> Section, for working through a whole section consecutively. Department and section are both required: a bare institute or department
// would return an entire roster unbounded.
async function browseSection(instituteIdFromRequester, query) {
  const { departmentId, section, batch } = query;
  if (!departmentId || !section) throw new ServiceError(400, "Department and Section are required");
  const instituteId = instituteIdFromRequester || query.instituteId;
  if (!instituteId) throw new ServiceError(400, "Institute is required");

  const groups = await repo.groupIdsFor(instituteId, departmentId, section, batch);
  if (groups.length === 0) return { rows: [], page: 1, pageSize: 50, total: 0, totalPages: 0 };

  const { page, pageSize } = d.numPaging(query, 50, 500);
  // Roll number order is numeric-aware ("1, 2, 3 ... 60"), which a database ORDER BY on a string cannot express: fetch the matching set once (bounded to specific
  // groups), sort it here, then hydrate only the page, so paging stays correct across the whole result.
  const all = await repo.matchingStudents(d.browseWhere(query, groups.map((g) => g.id)));
  all.sort(compareRollNumbers);
  const pageIds = d.pageSlice(all, page, pageSize).map((s) => s.id);
  const byId = new Map((await repo.hydrateStudents(pageIds)).map((s) => [s.id, s]));
  return { rows: pageIds.map((id) => byId.get(id)).filter(Boolean), page, pageSize, total: all.length, totalPages: Math.ceil(all.length / pageSize) };
}

async function migrationStatus() {
  const c = await repo.migrationCounts();
  return { ...c, zeroDataLossGatePassed: c.studentsUnlinked === 0 };
}

module.exports = { listUsers, getUser, lookupStudent, searchUsers, browseSection, migrationStatus, templateWorkbook: d.templateWorkbook };
