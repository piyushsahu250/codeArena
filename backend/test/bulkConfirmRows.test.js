// The bulk-student confirm step takes its rows from the request body, so they must be normalised like parsed file rows. REGRESSION (2026-10 audit): confirm compared
// the row's e-mail case-sensitively against lower-case existing e-mails, kept arbitrary extra keys, and turned an omitted isActive into an INACTIVE account whose flag
// stayed true.
const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/users/users.accounts.domain");

const base = { rowNum: 7, name: "  Asha Rao ", registrationNumber: " 2026ABC123 ", email: "  Asha.Rao@Example.INVALID ", mobile: "9000000000", department: "CSE", program: "BTech", batchYear: "2026", section: "A", instituteName: "ZZ Inst", gender: "Female", isActive: true };

test("values are trimmed and the e-mail is lower-cased, as parseBulkFile does", () => {
  const r = d.normalizeConfirmRow(base);
  assert.equal(r.name, "Asha Rao");
  assert.equal(r.registrationNumber, "2026ABC123");
  assert.equal(r.email, "asha.rao@example.invalid");
  assert.equal(r.rowNum, 7);
});

test("a mixed-case e-mail now meets the duplicate check against the existing lower-case one", () => {
  const ctx = { instituteByName: new Map([["zz inst", { id: "i1", name: "ZZ Inst" }]]), requesterInstituteId: "i1", existingEmails: new Set(["asha.rao@example.invalid"]), existingRegNumbers: new Set(), seenEmails: new Set(), seenRegNumbers: new Set() };
  const result = d.validateBulkRow(d.normalizeConfirmRow(base), ctx);
  assert.equal(result.status, "duplicate");
  assert.equal(result.reason, "Email already exists");
});

test("only the known columns survive: role, institute id, status and other extra keys are dropped", () => {
  const r = d.normalizeConfirmRow({ ...base, role: "SUPER_ADMIN", instituteId: "other-institute", accountStatus: "ACTIVE", isAdmin: true, passwordHash: "x", mustChangePassword: false });
  assert.deepEqual(Object.keys(r).sort(), ["batchYear", "department", "email", "gender", "instituteName", "isActive", "mobile", "name", "program", "registrationNumber", "rowNum", "section"]);
});

test("isActive: omitted means active, true and 'true' mean active, everything else inactive", () => {
  assert.equal(d.normalizeConfirmRow({ ...base, isActive: undefined }).isActive, true);
  assert.equal(d.normalizeConfirmRow({ ...base, isActive: true }).isActive, true);
  assert.equal(d.normalizeConfirmRow({ ...base, isActive: "true" }).isActive, true);
  for (const v of [false, "false", 0, null, "no", "inactive"]) assert.equal(d.normalizeConfirmRow({ ...base, isActive: v }).isActive, false, String(v));
});

test("non-object rows and over-long values cannot break the importer", () => {
  for (const junk of [null, undefined, "x", 5, [], [1, 2]]) assert.doesNotThrow(() => d.normalizeConfirmRow(junk));
  assert.equal(d.normalizeConfirmRow(null).name, "");
  const long = d.normalizeConfirmRow({ ...base, name: "n".repeat(10000), email: "e".repeat(10000) + "@x.invalid" });
  assert.ok(long.name.length <= 120 && long.email.length <= 254);
  assert.equal(d.normalizeConfirmRow({ ...base, rowNum: "7" }).rowNum, null, "a non-integer row number is dropped");
});
