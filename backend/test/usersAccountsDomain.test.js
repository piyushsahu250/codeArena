const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const d = require("../src/modules/users/users.accounts.domain");

const sheet = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); };
const HEADER = ["Student Name", "Registration Number (PRN)", "Official Email ID", "Institute", "Batch/Year", "Mobile Number", "Department", "Program", "Section", "Gender", "Status"];

test("an institute-bound creator can grant only student, staff and clerk; SUPER_ADMIN is never grantable", () => {
  assert.deepEqual(d.creatableRoles("inst-1"), ["STUDENT", "STAFF", "CLERK"]);
  assert.deepEqual(d.creatableRoles(null), ["STUDENT", "STAFF", "ADMIN", "CLERK", "INSTITUTE_ADMIN"]);
  assert.ok(!d.creatableRoles(null).includes("SUPER_ADMIN"));
});

test("editable fields never include the role or the password", () => {
  for (const f of ["role", "passwordHash", "mustChangePassword", "id"]) assert.ok(!d.EDITABLE_FIELDS.includes(f), f);
  assert.ok(d.EDITABLE_FIELDS.includes("isActive"));
});

test("audit action for an edit: a real activate/deactivate toggle gets its own action", () => {
  assert.equal(d.auditActionForEdit("STUDENT", true, true), "ACCOUNT_ACTIVATED");
  assert.equal(d.auditActionForEdit("STUDENT", true, false), "ACCOUNT_DEACTIVATED");
  assert.equal(d.auditActionForEdit("STUDENT", false, undefined), "STUDENT_PROFILE_UPDATED");
  assert.equal(d.auditActionForEdit("STAFF", false, undefined), "USER_PROFILE_UPDATED");
});

test("changed fields compare as text, so null and an empty string are the same", () => {
  assert.deepEqual(d.changedFields({ a: null, b: "x", c: 1 }, { a: "", b: "y", c: 1 }), ["b"]);
  assert.deepEqual(d.changedFields({ a: undefined }, { a: null }), []);
});

test("mobile numbers: 10 to 15 digits with an optional plus", () => {
  assert.ok(d.MOBILE_RE.test("9876543210"));
  assert.ok(d.MOBILE_RE.test("+919876543210"));
  assert.ok(!d.MOBILE_RE.test("12345"));
  assert.ok(!d.MOBILE_RE.test("98765 43210"));
});

test("delete-blocked messages pluralise and name what must be dealt with first", () => {
  assert.equal(d.deleteBlocked.tests(1), "This account has created 1 test. Reassign or delete it first, then delete the account.");
  assert.match(d.deleteBlocked.tests(3), /3 tests\. Reassign or delete them first/);
  assert.match(d.deleteBlocked.certificates(2), /earned 2 certificates\. Revoke or reassign them first/);
  assert.match(d.deleteBlocked.attempts(1), /1 test attempt on record\..*deactivate the account instead\./);
  assert.match(d.deleteBlocked.attendanceSessions(2), /marked attendance for 2 sessions/);
  assert.match(d.deleteBlocked.results(1), /1 official result on record/);
});

test("clash and unique-violation messages", () => {
  assert.match(d.rollClash("007", "Asha"), /^Roll Number "007" is already used by Asha in this Batch\/Department\/Section/);
  assert.equal(d.uniqueViolation({ meta: { target: ["email", "x"] } }), "That email, x is already in use.");
  assert.equal(d.uniqueViolation({}), "That value is already in use.");
});

test("header aliases: the template headers the platform hands out are recognised", () => {
  const map = d.buildHeaderMap(HEADER);
  assert.equal(map.registrationNumber, "Registration Number (PRN)");
  assert.equal(map.email, "Official Email ID");
  assert.equal(map.instituteName, "Institute");
  assert.equal(map.batchYear, "Batch/Year");
});

test("bulk file parsing: required columns, blank rows skipped, status synonyms, row numbers", () => {
  assert.match(d.parseBulkFile(sheet([["Name", "Phone"], ["a", "1"]])).error, /Missing required columns\. The file must include Student Name/);
  assert.match(d.parseBulkFile(sheet([["Student Name", "PRN", "Email"], ["a", "ZZUW12345", "a@x.test"]])).error, /Institute and Batch\/Year/);
  assert.match(d.parseBulkFile(sheet([HEADER])).error, /no data rows/);
  const parsed = d.parseBulkFile(sheet([HEADER, ["Ann", "ZZUW12345", "ANN@X.TEST", "Inst", "2026", "9000000000", "CS", "BTech", "A", "F", "Inactive"], ["", "", "", "", "", "", "", "", "", "", ""], ["Bob", "ZZUW12346", "bob@x.test", "Inst", "2026", "9000000001", "", "", "", "", ""]]));
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].email, "ann@x.test");
  assert.equal(parsed.rows[0].isActive, false);
  assert.equal(parsed.rows[0].rowNum, 2);
  assert.equal(parsed.rows[1].rowNum, 4, "a skipped blank row still counts in the spreadsheet row number");
  assert.equal(parsed.rows[1].isActive, true);
});

test("bulk row validation: errors, duplicates inside the file, duplicates already registered, scope", () => {
  const inst = { id: "i1", name: "Inst" };
  const ctx = () => ({ instituteByName: new Map([["inst", inst], ["other", { id: "i2" }]]), requesterInstituteId: "i1", existingEmails: new Set(["taken@x.test"]), existingRegNumbers: new Set(["zzuw99999"]), seenEmails: new Set(), seenRegNumbers: new Set() });
  const row = (over = {}) => ({ name: "Ann", registrationNumber: "ZZUW12345", email: "ann@x.test", mobile: "9000000000", batchYear: "2026", instituteName: "Inst", ...over });
  const c = ctx();
  assert.equal(d.validateBulkRow(row(), c).status, "valid");
  assert.equal(d.validateBulkRow(row({ email: "other@x.test" }), c).reason, "Duplicate PRN in uploaded file or already registered", "the same PRN twice in one file");
  assert.equal(d.validateBulkRow(row({ registrationNumber: "ZZUW54321" }), c).reason, "Email already exists", "the same e-mail twice in one file");
  assert.equal(d.validateBulkRow(row({ email: "taken@x.test" }), ctx()).status, "duplicate");
  assert.equal(d.validateBulkRow(row({ registrationNumber: "ZZUW99999" }), ctx()).status, "duplicate");
  assert.match(d.validateBulkRow(row({ name: "" }), ctx()).reason, /^Missing required field/);
  assert.equal(d.validateBulkRow(row({ email: "nope" }), ctx()).reason, "Invalid email format");
  assert.match(d.validateBulkRow(row({ registrationNumber: "AB" }), ctx()).reason, /9-12 alphanumeric/);
  assert.equal(d.validateBulkRow(row({ mobile: "12" }), ctx()).reason, "Invalid mobile number");
  assert.match(d.validateBulkRow(row({ instituteName: "Nowhere" }), ctx()).reason, /was not found/);
  assert.equal(d.validateBulkRow(row({ instituteName: "Other" }), ctx()).reason, "You can only upload students to your own institute");
  assert.equal(d.validateBulkRow(row({ instituteName: "Other" }), { ...ctx(), requesterInstituteId: null }).status, "valid", "a platform account may import into any institute");
});

test("preview summary counts rows by status", () => {
  const s = d.previewSummary([{ status: "valid" }, { status: "valid" }, { status: "error" }, { status: "duplicate" }]);
  assert.deepEqual([s.totalRows, s.validCount, s.invalidCount, s.duplicateCount], [4, 2, 1, 1]);
});
