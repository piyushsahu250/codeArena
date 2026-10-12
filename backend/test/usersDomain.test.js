const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../src/modules/users/users.domain");

test("paging: numeric and integer parsing, defaults and caps", () => {
  assert.deepEqual(d.numPaging({}, 200, 500), { page: 1, pageSize: 200 });
  assert.deepEqual(d.numPaging({ page: "0", pageSize: "9999" }, 200, 500), { page: 1, pageSize: 500 });
  assert.deepEqual(d.numPaging({ page: "3", pageSize: "-5" }, 50, 200), { page: 3, pageSize: 1 });
  assert.deepEqual(d.numPaging({ page: "abc", pageSize: "abc" }, 50, 200), { page: 1, pageSize: 50 });
  assert.deepEqual(d.intPaging({ page: "2.9", pageSize: "30x" }, 20, 100), { page: 2, pageSize: 30 });
  assert.deepEqual(d.intPaging({}, 20, 50), { page: 1, pageSize: 20 });
});

test("lookup and search filters are scoped to the requester's institute", () => {
  assert.deepEqual(d.lookupWhere("q", null).OR.length, 4);
  assert.equal(d.lookupWhere("q", "i1").instituteId, "i1");
  assert.ok(!("instituteId" in d.lookupWhere("q", null)));
  const w = d.searchWhere("ann", { role: "CLERK" }, "i1");
  assert.equal(w.role, "CLERK");
  assert.equal(w.instituteId, "i1");
  assert.equal(w.OR.length, 7);
  assert.ok(!("role" in d.searchWhere("ann", { role: "NOPE" }, null)), "an unknown role is ignored");
  assert.deepEqual(d.searchWhere("a", { documentType: "PAN", documentVerificationStatus: "VERIFIED" }, null).studentDocuments, { some: { documentType: "PAN", verificationStatus: "VERIFIED" } });
});

test("browse filter keeps students of the given groups and the optional placement and document filters", () => {
  const w = d.browseWhere({ placementParticipation: "INTERESTED", offerVerificationStatus: "VERIFIED" }, ["g1", "g2"]);
  assert.deepEqual(w.academicGroupId, { in: ["g1", "g2"] });
  assert.equal(w.role, "STUDENT");
  assert.deepEqual(w.studentProfile, { placementParticipation: "INTERESTED" });
  assert.deepEqual(w.placementOffers, { some: { verificationStatus: "VERIFIED" } });
  assert.ok(!("studentDocuments" in d.browseWhere({}, ["g"])));
});

test("audit filter: a clerk can never reach outside the document and placement actions", () => {
  const clerk = { role: "CLERK" };
  assert.deepEqual(d.auditWhere(clerk, {}, "i1").action, { in: d.CLERK_AUDIT_ACTIONS });
  assert.deepEqual(d.auditWhere(clerk, { action: "PASSWORD_RESET" }, "i1").action, { in: d.CLERK_AUDIT_ACTIONS });
  assert.equal(d.auditWhere(clerk, { action: "DOCUMENT_VERIFIED" }, "i1").action, "DOCUMENT_VERIFIED");
  assert.equal(d.auditWhere({ role: "STAFF" }, { action: "PASSWORD_RESET" }, null).action, "PASSWORD_RESET");
  assert.ok(!("action" in d.auditWhere({ role: "STAFF" }, {}, null)));
  const w = d.auditWhere({ role: "ADMIN" }, { from: "2020-01-01", to: "2020-01-02", studentId: "s" }, "i1");
  assert.equal(w.studentId, "s");
  assert.equal(w.instituteId, "i1");
  assert.ok(w.createdAt.gte instanceof Date && w.createdAt.lte instanceof Date);
});

test("audit CSV quotes every field and doubles embedded quotes", () => {
  const csv = d.auditCsv([{ createdAt: new Date("2020-01-01T00:00:00Z"), action: "A", adminName: 'Say "hi"', adminRole: null, ipAddress: null, deviceInfo: null, studentId: null, instituteId: "i", details: { k: 'v"' } }]);
  const [header, row] = csv.split("\n");
  assert.equal(header, "Timestamp,Action,Actor,Role,IP Address,Device,Student ID,Institute ID,Details");
  assert.ok(row.startsWith('"2020-01-01T00:00:00.000Z","A","Say ""hi""","","","","","i",'));
});

test("performance access: students see only themselves, others only their own institute", () => {
  const student = { id: "s1", role: "STUDENT" };
  const target = { id: "s2", role: "STUDENT", instituteId: "i1" };
  assert.equal(d.performanceRefusal({ viewer: student, targetId: "s2", target, viewerInstituteId: null }).status, 403);
  assert.equal(d.performanceRefusal({ viewer: student, targetId: "s1", target: { ...target, id: "s1" }, viewerInstituteId: null }), null);
  assert.equal(d.performanceRefusal({ viewer: { id: "a", role: "STAFF" }, targetId: "s2", target: null, viewerInstituteId: "i1" }).status, 404);
  assert.equal(d.performanceRefusal({ viewer: { id: "a", role: "STAFF" }, targetId: "x", target: { id: "x", role: "STAFF", instituteId: "i1" }, viewerInstituteId: "i1" }).status, 404);
  assert.equal(d.performanceRefusal({ viewer: { id: "a", role: "STAFF" }, targetId: "s2", target, viewerInstituteId: "i2" }).status, 403);
  assert.equal(d.performanceRefusal({ viewer: { id: "a", role: "STAFF" }, targetId: "s2", target, viewerInstituteId: "i1" }), null);
  assert.equal(d.performanceRefusal({ viewer: { id: "a", role: "ADMIN" }, targetId: "s2", target, viewerInstituteId: null }), null, "platform accounts see everyone");
});

test("the displayed user carries the institute as an object and no flat instituteId", () => {
  assert.ok(!("instituteId" in d.SELECT_FIELDS));
  assert.deepEqual(d.SELECT_FIELDS.institute, { select: { id: true, name: true } });
});

test("verification tokens: sha256 hashed, 24 hours", () => {
  assert.equal(d.hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(d.newVerificationToken(), /^[0-9a-f]{64}$/);
  assert.equal(d.VERIFICATION_TOKEN_TTL_MS, 86400000);
});

test("the upload template is an xlsx with the documented headers", () => {
  const buf = d.templateWorkbook();
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 2).toString(), "PK");
  assert.equal(d.TEMPLATE_HEADERS.length, 11);
  assert.ok(!d.TEMPLATE_HEADERS.includes("Roll Number"));
});

test("reset history rows carry the student name and mail result, or null", () => {
  const row = d.resetHistoryRow({ id: "1", details: { studentName: "N", emailSent: false }, studentId: "s", adminName: "A", createdAt: "t" });
  assert.deepEqual(row, { id: "1", studentName: "N", studentId: "s", resetBy: "A", emailSent: false, createdAt: "t" });
  assert.deepEqual(d.resetHistoryRow({ id: "2", details: {}, studentId: null, adminName: "A", createdAt: "t" }).emailSent, null);
});
