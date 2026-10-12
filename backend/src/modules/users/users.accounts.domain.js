// Account-writing rules that need no database: which roles a creator may grant, the editable fields, the bulk-upload sheet (column aliases, parsing, per-row
// validation) and the messages that explain why a delete is blocked. Behaviour and messages are those of the routes this replaced
// (see backend/test/snapshots/users-write-contract.json).
const XLSX = require("xlsx");
const { isValidEmail } = require("../../utils/emailValidation");
const { initRollNumberFromRegistration, REGISTRATION_NUMBER_RE } = require("../../utils/studentIdentifiers");

const MOBILE_RE = /^\+?[0-9]{10,15}$/;
const BULK_MAX_ROWS = 5000;

const EDITABLE_FIELDS = [
  "name", "email", "mobile", "gender", "rollNumber", "registrationNumber", "department", "program",
  "batchYear", "section", "instituteId", "isActive", "profilePhotoUrl", "employeeId", "designation",
];

// SUPER_ADMIN can never be granted here: the only one is set by a script, and a partial unique index makes a second impossible. An institute-bound creator
// additionally cannot grant ADMIN or INSTITUTE_ADMIN: only a platform-level account creates another admin-tier account.
const creatableRoles = (requesterInstituteId) => (requesterInstituteId ? ["STUDENT", "STAFF", "CLERK"] : ["STUDENT", "STAFF", "ADMIN", "CLERK", "INSTITUTE_ADMIN"]);

// Whether `value` is a non-blank string once trimmed.
const filled = (value) => !!String(value || "").trim();

const auditActionForEdit = (existingRole, isActiveToggled, nextIsActive) => (isActiveToggled
  ? (nextIsActive ? "ACCOUNT_ACTIVATED" : "ACCOUNT_DEACTIVATED")
  : existingRole === "STUDENT" ? "STUDENT_PROFILE_UPDATED" : "USER_PROFILE_UPDATED");

// The fields whose stored value really changed, compared as text so null and "" are the same.
const changedFields = (existing, data) => Object.keys(data).filter((f) => String(existing[f] ?? "") !== String(data[f] ?? ""));

const rollClash = (rollNumber, name) => `Roll Number "${rollNumber}" is already used by ${name} in this Batch/Department/Section — choose a different Roll Number.`;
const uniqueViolation = (err) => `That ${Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "value"} is already in use.`;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const them = (n) => (n === 1 ? "it" : "them");
const PRESERVE = "This action cannot be undone, and academic records like this are best preserved — it is recommended to deactivate the account instead.";
const deleteBlocked = {
  tests: (n) => `This account has created ${plural(n, "test")}. Reassign or delete ${them(n)} first, then delete the account.`,
  lecturePlans: (n) => `This account has created ${plural(n, "lecture plan")}. Reassign or delete ${them(n)} first, then delete the account.`,
  attendanceSessions: (n) => `This account has marked attendance for ${plural(n, "session")}. Those attendance records must be reassigned first, then delete the account.`,
  certificates: (n) => `This student has earned ${plural(n, "certificate")}. Revoke or reassign ${them(n)} first, then delete the account.`,
  attempts: (n) => `This account has ${plural(n, "test attempt")} on record. ${PRESERVE}`,
  attendanceRecords: (n) => `This account has ${plural(n, "attendance record")} on record. ${PRESERVE}`,
  results: (n) => `This account has ${plural(n, "official result")} on record. ${PRESERVE}`,
};

// ---- bulk upload sheet ----
// Roll Number is deliberately not an input column: it is never entered during a bulk upload, only generated from the Registration Number after import. A
// "Roll Number" column in an uploaded file is ignored like any other unrecognised column.
const FIELD_ALIASES = {
  name: ["student name", "name", "full name"],
  // "registration number prn" is what the downloaded template's own header, "Registration Number (PRN)", normalises to; without it the platform's own template
  // would fail its own required-columns check.
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

const normalizeHeader = (str) => String(str || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

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

// Parses the uploaded workbook into plain row objects, or { error }. Shared by preview and confirm so a file validates identically at both steps.
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
  if (!headerMap.instituteName || !headerMap.batchYear) return { error: "Missing required columns. The file must include Institute and Batch/Year." };

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
      rowNum: i + 2, // +1 for the header row, +1 for 1-indexing
      name, registrationNumber, email,
      mobile: field(row, "mobile"),
      department: field(row, "department"),
      program: field(row, "program"),
      batchYear: field(row, "batchYear"),
      section: field(row, "section"),
      instituteName: field(row, "instituteName"),
      gender: field(row, "gender"),
      // Optional column, default Active: any value other than a recognisable "inactive" synonym is Active rather than rejecting the row over a typo.
      isActive: !["inactive", "disabled", "no"].includes(statusRaw),
    });
  }
  return { rows };
}

// The single source of truth for "is this bulk row acceptable", used identically by preview (dry run) and confirm (right before creating the row), so a row can
// never pass one step under different rules than the other. `seenEmails` / `seenRegNumbers` are mutated to catch a repeat inside the same file, in file order.
function validateBulkRow(row, { instituteByName, requesterInstituteId, existingEmails, existingRegNumbers, seenEmails, seenRegNumbers }) {
  const { name, registrationNumber, email, mobile, batchYear, instituteName } = row;
  // Provisional only: the real, same-group collision-resolved value is computed at confirm time.
  const rollNumberPreview = initRollNumberFromRegistration(registrationNumber) || "";

  if (!name || !registrationNumber || !email || !instituteName || !batchYear || !mobile) {
    return { status: "error", reason: "Missing required field (name, registration number, email, mobile, institute, or batch/year)", rollNumberPreview };
  }
  if (!isValidEmail(email)) return { status: "error", reason: "Invalid email format", rollNumberPreview };
  if (!REGISTRATION_NUMBER_RE.test(registrationNumber)) return { status: "error", reason: "Registration Number (PRN) must be 9-12 alphanumeric characters", rollNumberPreview };
  if (!MOBILE_RE.test(mobile)) return { status: "error", reason: "Invalid mobile number", rollNumberPreview };

  const institute = instituteByName.get(instituteName.toLowerCase());
  if (!institute) return { status: "error", reason: `Institute "${instituteName}" was not found. Create it first in Institute Management.`, rollNumberPreview };
  // An institute-bound admin can only import into their own institute, whatever the file's Institute column says.
  if (requesterInstituteId && institute.id !== requesterInstituteId) return { status: "error", reason: "You can only upload students to your own institute", rollNumberPreview };

  const regKey = registrationNumber.toLowerCase();
  if (existingEmails.has(email) || seenEmails.has(email)) return { status: "duplicate", reason: "Email already exists", rollNumberPreview };
  if (existingRegNumbers.has(regKey) || seenRegNumbers.has(regKey)) return { status: "duplicate", reason: "Duplicate PRN in uploaded file or already registered", rollNumberPreview };

  seenEmails.add(email);
  seenRegNumbers.add(regKey);
  return { status: "valid", rollNumberPreview, institute };
}

const previewSummary = (rows) => ({
  totalRows: rows.length,
  validCount: rows.filter((r) => r.status === "valid").length,
  invalidCount: rows.filter((r) => r.status === "error").length,
  duplicateCount: rows.filter((r) => r.status === "duplicate").length,
  rows,
});

module.exports = {
  MOBILE_RE, BULK_MAX_ROWS, EDITABLE_FIELDS, creatableRoles, filled, auditActionForEdit, changedFields, rollClash, uniqueViolation, deleteBlocked,
  normalizeHeader, buildHeaderMap, parseBulkFile, validateBulkRow, previewSummary,
};
