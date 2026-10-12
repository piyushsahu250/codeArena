// User-directory rules that need no database: the shape returned for a user, paging, the search/browse/audit filters, the audit CSV, the bulk-upload template and
// who may see a student's performance. Behaviour and messages are those of the routes this replaced (see backend/test/snapshots/users-contract.json).
const crypto = require("crypto");
const XLSX = require("xlsx");
const { AUDIT_ACTIONS } = require("../../utils/auditLog");

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // longer than the 1h password reset: a new personal address may not be checked as promptly
const ROLES = ["STUDENT", "STAFF", "CLERK", "ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN"];

const SELECT_FIELDS = {
  id: true, name: true, email: true, role: true, rollNumber: true, registrationNumber: true, department: true,
  mobile: true, gender: true, program: true, batchYear: true, section: true, isActive: true, profilePhotoUrl: true, createdAt: true,
  mustChangePassword: true, accountStatus: true, employeeId: true, designation: true, lastLoginAt: true,
  emailVerified: true, pendingEmail: true,
  institute: { select: { id: true, name: true } },
  class: { select: { id: true, name: true, batchYear: true } },
  academicGroup: { select: { id: true, batch: true, section: true, department: { select: { id: true, name: true } } } },
};

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const newVerificationToken = () => crypto.randomBytes(32).toString("hex");

// A clerk's audit access is limited to what the placement-cell and document-verification role actually reviews, not the institute's full action stream.
const CLERK_AUDIT_ACTIONS = [
  AUDIT_ACTIONS.DOCUMENT_UPLOADED, AUDIT_ACTIONS.DOCUMENT_UPDATED, AUDIT_ACTIONS.DOCUMENT_VERIFIED, AUDIT_ACTIONS.DOCUMENT_DELETED,
  AUDIT_ACTIONS.PLACEMENT_OFFER_VERIFIED, AUDIT_ACTIONS.PLACEMENT_ELIGIBILITY_CHANGED,
];

// ---- paging ----
// Each list had its own default and cap; they are kept as parameters so the numbers stay where they were.
function paging(query, { defaultSize, maxSize, parse = Number }) {
  const page = Math.max(1, parse(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, parse(query.pageSize, 10) || defaultSize));
  return { page, pageSize };
}
const intPaging = (query, defaultSize, maxSize) => paging(query, { defaultSize, maxSize, parse: (v) => parseInt(v, 10) });
// Number("abc") is NaN and `NaN || default` falls back, exactly as the routes did; the radix argument is ignored by Number.
const numPaging = (query, defaultSize, maxSize) => paging(query, { defaultSize, maxSize, parse: (v) => Number(v) });

// ---- user list / search / browse ----
const instituteFilter = (instituteId) => (instituteId ? { instituteId } : {});

const documentFilter = ({ documentType, documentVerificationStatus }) => (documentType || documentVerificationStatus
  ? { studentDocuments: { some: { ...(documentType ? { documentType } : {}), ...(documentVerificationStatus ? { verificationStatus: documentVerificationStatus } : {}) } } }
  : {});

function lookupWhere(query, instituteId) {
  return { role: "STUDENT", OR: [{ registrationNumber: query }, { rollNumber: query }, { email: query }, { id: query }], ...instituteFilter(instituteId) };
}

function searchWhere(q, query, instituteId) {
  const role = ROLES.includes(query.role) ? query.role : undefined;
  return {
    ...(role ? { role } : {}),
    ...instituteFilter(instituteId),
    ...documentFilter(query),
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
}

function browseWhere(query, groupIds) {
  const { placementParticipation, offerVerificationStatus } = query;
  return {
    role: "STUDENT",
    academicGroupId: { in: groupIds },
    ...(placementParticipation ? { studentProfile: { placementParticipation } } : {}),
    ...(offerVerificationStatus ? { placementOffers: { some: { verificationStatus: offerVerificationStatus } } } : {}),
    ...documentFilter(query),
  };
}

// ---- audit trail ----
// A clerk-supplied ?action= is intersected with the allowlist rather than trusted, so the query string can never reach beyond the clerk's real scope.
function auditWhere(user, query, instituteId) {
  const { action, studentId, from, to } = query;
  return {
    ...instituteFilter(instituteId),
    ...(user.role === "CLERK"
      ? { action: action && CLERK_AUDIT_ACTIONS.includes(action) ? action : { in: CLERK_AUDIT_ACTIONS } }
      : (action ? { action } : {})),
    ...(studentId ? { studentId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
  };
}

function auditCsv(logs) {
  const header = "Timestamp,Action,Actor,Role,IP Address,Device,Student ID,Institute ID,Details\n";
  const rows = logs.map((l) => [
    l.createdAt.toISOString(), l.action, l.adminName, l.adminRole || "", l.ipAddress || "", l.deviceInfo || "",
    l.studentId || "", l.instituteId || "", JSON.stringify(l.details || {}).replace(/"/g, '""'),
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return header + rows.join("\n");
}

const resetHistoryRow = (l) => ({ id: l.id, studentName: l.details?.studentName || null, studentId: l.studentId, resetBy: l.adminName, emailSent: l.details?.emailSent ?? null, createdAt: l.createdAt });

// Page `page` of the conflicts, each joined to its academic group.
function conflictRow(d, group) {
  return {
    academicGroupId: d.groupId,
    rollNumber: d.rollNumber,
    institute: group?.institute || null,
    batch: group?.batch || null,
    branch: group?.department?.name || null,
    section: group?.section || null,
    students: d.students,
  };
}

// ---- roll-number ordering for browse ----
const pageSlice = (items, page, pageSize) => items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

// ---- the sheet administrators download to prepare a bulk upload ----
// Roll Number is intentionally absent: it is never a bulk-upload input, only generated from the Registration Number after import.
const TEMPLATE_HEADERS = ["Student Name", "Registration Number (PRN)", "Official Email ID", "Institute", "Batch/Year", "Mobile Number", "Department", "Program", "Section", "Gender", "Status"];
const TEMPLATE_SAMPLE_ROW = ["John Doe", "MCA2024001", "john.doe@codearena.edu.in", "CodeArena University", "2024-26", "9876543210", "Computer Applications", "MCA", "A", "Male", "Active"];
function templateWorkbook() {
  const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROW]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Students");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

// ---- who may see a student's performance ----
// A student sees only their own; everyone else sees students of their own institute (platform accounts, with no institute, see everyone).
// Returns { status, message } to refuse, or null.
function performanceRefusal({ viewer, targetId, target, viewerInstituteId }) {
  if (viewer.role === "STUDENT" && viewer.id !== targetId) return { status: 403, message: "You can only view your own performance dashboard" };
  if (!target || target.role !== "STUDENT") return { status: 404, message: "Student not found" };
  if (viewer.role !== "STUDENT" && viewerInstituteId && target.instituteId !== viewerInstituteId) return { status: 403, message: "You can only view students under your own institute" };
  return null;
}

module.exports = {
  VERIFICATION_TOKEN_TTL_MS, ROLES, SELECT_FIELDS, CLERK_AUDIT_ACTIONS, TEMPLATE_HEADERS,
  hashToken, newVerificationToken, intPaging, numPaging, instituteFilter, lookupWhere, searchWhere, browseWhere, auditWhere, auditCsv, resetHistoryRow, conflictRow, pageSlice,
  templateWorkbook, performanceRefusal,
};
