// Characterization (contract) test for the write half of /api/users: create an account, edit it, delete it, bulk upload (preview and confirm), reset a password
// (single and bulk) and bulk activate/deactivate. It drives each route through success and failure paths with disposable data and compares a normalized record
// of every response, and of what the routes stored, with test/snapshots/users-write-contract.json. Used to prove a restructuring of routes/users.js changes
// nothing except what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a database.
//   node scripts/verifyUsersWriteContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifyUsersWriteContract.js --record   (re)write the snapshot
// Generated passwords and mail results are masked (random, and different between environments). Credential e-mails go only to example.invalid addresses.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ UW";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "users-write-contract.json");
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
// Random or environment-dependent values, masked whatever they hold.
const ALWAYS_MASK = new Set(["generatedPassword", "defaultPassword", "emailSent", "emailError", "ipAddress", "deviceInfo", "lastLoginAt"]);
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>").replace(/\d{13}/g, "<ts>");
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = ALWAYS_MASK.has(k) ? "<masked>" : k === "token" ? (v[k] ? "<token>" : null) : norm(v[k]); return o; }
  return v;
}
let ipSeq = 0;
const nextIp = () => `203.0.113.${150 + ++ipSeq}`;
async function call(name, method, p, token, body, form) {
  const headers = { "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (form) payload = form; else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${p}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  log.push({ name, status: res.status, body: json !== null ? norm(json) : `<non-json ${text.slice(0, 40)}>` });
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(1200);

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-uw-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-uw-" } }, { instituteId: { in: ids } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-uw-" } }] } });
  await prisma.testAttempt.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.test.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

const auditRows = async (where) => (await prisma.auditLog.findMany({ where, select: { action: true, adminRole: true, studentId: true, instituteId: true, details: true }, orderBy: { createdAt: "asc" } }))
  .map((a) => `${a.action}|role:${a.adminRole || "-"}|student:${a.studentId ? "set" : "-"}|inst:${a.instituteId ? "set" : "-"}|keys:${Object.keys(a.details || {}).sort().join(",")}`);

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZWA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZWB" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
    return prisma.user.create({ data: { name: `ZZ UW ${key}`, email: `zz-uw-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const platform = await mk("platform", "ADMIN", null);
  const instA = await mk("instA", "INSTITUTE_ADMIN", A.id);
  const instB = await mk("instB", "INSTITUTE_ADMIN", B.id);
  const staffA = await mk("staffA", "STAFF", A.id);
  const staffB = await mk("staffB", "STAFF", B.id);
  const clerkA = await mk("clerkA", "CLERK", A.id);
  const stuBase = await mk("stuBase", "STUDENT", A.id);
  const stuB = await mk("stuB", "STUDENT", B.id, { registrationNumber: "ZZUWB0001" });
  const login = async (u, k) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
  const T = { platform: await login(platform, "platform"), instA: await login(instA, "instA"), instB: await login(instB, "instB"), staffA: await login(staffA, "staffA"), staffB: await login(staffB, "staffB"), clerkA: await login(clerkA, "clerkA"), stuBase: await login(stuBase, "stuBase") };
  const bogus = crypto.randomUUID();
  const prn = (n) => `ZZUW0000${n}`; // 9-12 alphanumeric characters, fixed so the derived roll numbers are the same in every run
  const em = (n) => `zz-uw-new-${n}-${ts}@example.invalid`;
  const stuBody = (n, extra = {}) => ({ name: `ZZ UW student ${n}`, email: em(`s${n}`), role: "STUDENT", instituteId: A.id, mobile: "9000000010", batchYear: "2026", department: "ZZ UW Dept", section: "Section A", registrationNumber: prn(n), ...extra });

  // ---------- create ----------
  await call("create: anonymous", "POST", "/users", null, stuBody(1));
  await call("create: student refused", "POST", "/users", T.stuBase, stuBody(1));
  await call("create: staff refused", "POST", "/users", T.staffA, stuBody(1));
  await call("create: missing fields", "POST", "/users", T.instA, { name: "x" });
  await call("create: invalid e-mail", "POST", "/users", T.instA, stuBody(1, { email: "nope" }));
  await call("create: institute admin cannot create an admin", "POST", "/users", T.instA, stuBody(1, { role: "ADMIN" }));
  await call("create: super admin role is never allowed", "POST", "/users", T.platform, stuBody(1, { role: "SUPER_ADMIN" }));
  await call("create: institute admin role needs an institute", "POST", "/users", T.platform, { name: "x", email: em("ia0"), role: "INSTITUTE_ADMIN" });
  await call("create: an institute is required", "POST", "/users", T.platform, { name: "x", email: em("noinst"), role: "STAFF" });
  await call("create: another institute refused for a bound admin", "POST", "/users", T.instA, stuBody(1, { instituteId: B.id }));
  await call("create: student without mobile", "POST", "/users", T.instA, stuBody(1, { mobile: "" }));
  await call("create: student without batch", "POST", "/users", T.instA, stuBody(1, { batchYear: "" }));
  await call("create: student without PRN", "POST", "/users", T.instA, stuBody(1, { registrationNumber: "" }));
  await call("create: invalid mobile", "POST", "/users", T.instA, stuBody(1, { mobile: "12" }));
  await call("create: unknown institute", "POST", "/users", T.platform, stuBody(1, { instituteId: bogus }));
  await call("create: PRN of the wrong shape", "POST", "/users", T.instA, stuBody(1, { registrationNumber: "AB-1" }));
  await call("create: roll number too long", "POST", "/users", T.instA, stuBody(1, { rollNumber: "1234" }));
  await call("create: roll number not digits", "POST", "/users", T.instA, stuBody(1, { rollNumber: "ab1" }));
  const s1 = await call("create: student, roll number derived from the PRN", "POST", "/users", T.instA, stuBody(1));
  await call("create: the same e-mail again", "POST", "/users", T.instA, stuBody(2, { email: em("s1") }));
  await call("create: the same PRN again", "POST", "/users", T.instA, stuBody(2, { registrationNumber: prn(1) }));
  await call("create: student with a manual roll number", "POST", "/users", T.instA, stuBody(3, { rollNumber: "777" }));
  await call("create: manual roll number already used in the group", "POST", "/users", T.instA, stuBody(4, { rollNumber: "777" }));
  await call("create: PRN with an upper-case e-mail", "POST", "/users", T.instA, stuBody(5, { email: em("s5").toUpperCase() }));
  const staff1 = await call("create: staff with an employee id", "POST", "/users", T.instA, { name: "ZZ UW staff new", email: em("st1"), role: "STAFF", instituteId: A.id, employeeId: " E-100 ", designation: " Lecturer " });
  await call("create: employee id already used at the institute", "POST", "/users", T.instA, { name: "ZZ UW staff dup", email: em("st2"), role: "STAFF", instituteId: A.id, employeeId: "E-100" });
  await call("create: clerk", "POST", "/users", T.instA, { name: "ZZ UW clerk new", email: em("cl1"), role: "CLERK", instituteId: A.id });
  await call("create: platform admin creates an institute admin", "POST", "/users", T.platform, { name: "ZZ UW ia new", email: em("ia1"), role: "INSTITUTE_ADMIN", instituteId: B.id });
  await call("create: platform admin creates a student in another institute", "POST", "/users", T.platform, stuBody(6, { instituteId: B.id }));
  await settle();
  const created = await prisma.user.findMany({ where: { email: { startsWith: "zz-uw-new-" } }, select: { email: true, role: true, rollNumber: true, registrationNumber: true, employeeId: true, designation: true, mustChangePassword: true, isActive: true, accountStatus: true, academicGroupId: true, instituteId: true }, orderBy: { email: "asc" } });
  note("create: stored accounts", created.map((u) => ({ ...u, academicGroupId: u.academicGroupId ? "set" : null, instituteId: u.instituteId === A.id ? "A" : u.instituteId === B.id ? "B" : null })));
  note("create: academic groups made", (await prisma.academicGroup.findMany({ where: { instituteId: { in: [A.id, B.id] } }, select: { batch: true, section: true, department: { select: { name: true } }, instituteId: true } })).map((g) => `${g.instituteId === A.id ? "A" : "B"}:${g.batch}:${g.department.name}:${g.section}`).sort());
  note("create: audit rows", await auditRows({ action: "ACCOUNT_CREATED", adminId: { in: [instA.id, platform.id] } }));
  note("create: credential e-mails queued", (await prisma.emailLog.findMany({ where: { recipientEmail: { contains: "zz-uw-new-" } }, select: { emailType: true } })).map((m) => m.emailType).sort());
  const studentId = s1.json && s1.json.id;
  const staffNewId = staff1.json && staff1.json.id;

  // ---------- edit ----------
  const s3 = await prisma.user.findFirst({ where: { email: em("s3") } });
  const s5 = await prisma.user.findFirst({ where: { email: em("s5") } });
  await call("edit: anonymous", "PATCH", `/users/${studentId}`, null, { name: "x" });
  await call("edit: staff refused", "PATCH", `/users/${studentId}`, T.staffA, { name: "x" });
  await call("edit: unknown user", "PATCH", `/users/${bogus}`, T.instA, { name: "x" });
  await call("edit: user of another institute", "PATCH", `/users/${stuB.id}`, T.instA, { name: "x" });
  await call("edit: moving to another institute", "PATCH", `/users/${studentId}`, T.instA, { instituteId: B.id });
  await call("edit: invalid e-mail", "PATCH", `/users/${studentId}`, T.instA, { email: "nope" });
  await call("edit: e-mail already used", "PATCH", `/users/${studentId}`, T.instA, { email: em("s3") });
  await call("edit: invalid mobile", "PATCH", `/users/${studentId}`, T.instA, { mobile: "1" });
  await call("edit: roll number too long", "PATCH", `/users/${studentId}`, T.instA, { rollNumber: "1234" });
  await call("edit: roll number not digits", "PATCH", `/users/${studentId}`, T.instA, { rollNumber: "x12" });
  await call("edit: PRN of the wrong shape", "PATCH", `/users/${studentId}`, T.instA, { registrationNumber: "A" });
  await call("edit: PRN already used", "PATCH", `/users/${studentId}`, T.instA, { registrationNumber: prn(3) });
  await call("edit: employee id already used", "PATCH", `/users/${staffNewId}`, T.instA, { employeeId: "E-100", name: "ZZ UW staff renamed" });
  await call("edit: unknown institute for a platform admin", "PATCH", `/users/${studentId}`, T.platform, { instituteId: bogus });
  await call("edit: roll number already used in the group", "PATCH", `/users/${studentId}`, T.instA, { rollNumber: "777" });
  await call("edit: name, mobile and e-mail change", "PATCH", `/users/${studentId}`, T.instA, { name: "ZZ UW student renamed", mobile: " 9111111111 ", email: em("s1b").toUpperCase() });
  note("edit: e-mail change resets verification", await prisma.user.findUnique({ where: { id: studentId }, select: { email: true, emailVerified: true, emailVerifiedAt: true } }));
  await call("edit: the PRN changes, so the roll number is re-derived", "PATCH", `/users/${studentId}`, T.instA, { registrationNumber: prn(9) });
  await call("edit: moving to another batch re-resolves the group", "PATCH", `/users/${studentId}`, T.instA, { batchYear: "2027" });
  note("edit: groups after the move", (await prisma.academicGroup.findMany({ where: { instituteId: A.id }, select: { batch: true, section: true, department: { select: { name: true } } } })).map((g) => `${g.batch}:${g.department.name}:${g.section}`).sort());
  await call("edit: a blank employee id is cleared", "PATCH", `/users/${staffNewId}`, T.instA, { employeeId: "  " });
  await call("edit: nothing sent changes nothing", "PATCH", `/users/${studentId}`, T.instA, {});
  // deactivate / activate through the same route; a signed-in student loses access at once
  const target = stuBase;
  await call("edit: before deactivation the student's session works", "GET", "/auth/permissions", T.stuBase);
  await call("edit: deactivate", "PATCH", `/users/${target.id}`, T.instA, { isActive: false });
  await call("edit: the deactivated student's session is dead", "GET", "/auth/permissions", T.stuBase);
  await call("edit: deactivating again is not a toggle", "PATCH", `/users/${target.id}`, T.instA, { isActive: false });
  await call("edit: activate", "PATCH", `/users/${target.id}`, T.instA, { isActive: true });
  await call("edit: platform admin edits a student of any institute", "PATCH", `/users/${stuB.id}`, T.platform, { designation: "x" });
  await settle();
  note("edit: audit rows", await auditRows({ action: { in: ["STUDENT_PROFILE_UPDATED", "USER_PROFILE_UPDATED", "ACCOUNT_ACTIVATED", "ACCOUNT_DEACTIVATED"] }, adminId: { in: [instA.id, platform.id] } }));
  const editAudit = await prisma.auditLog.findFirst({ where: { action: "STUDENT_PROFILE_UPDATED", adminId: instA.id }, orderBy: { createdAt: "asc" } });
  note("edit: first audit row content", { changedFields: editAudit.details.changedFields, before: Object.keys(editAudit.details.before).sort(), after: Object.keys(editAudit.details.after).sort() });

  // ---------- bulk upload ----------
  const header = ["Student Name", "Registration Number (PRN)", "Official Email ID", "Institute", "Batch/Year", "Mobile Number", "Department", "Program", "Section", "Gender", "Status"];
  const sheet = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), "Students"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); };
  const upload = (buffer, filename = "students.xlsx") => { const f = new FormData(); f.append("file", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename); return f; };
  const row = (n, extra = {}) => { const base = [`ZZ UW bulk ${n}`, prn(`B${n}`), em(`b${n}`), A.name, "2026", "9000000020", "ZZ UW Dept", "MCA", "Section A", "Male", "Active"]; Object.entries(extra).forEach(([i, v]) => { base[i] = v; }); return base; };
  await call("bulk preview: anonymous", "POST", "/users/bulk-upload/preview", null, undefined, upload(sheet([row(1)])));
  await call("bulk preview: staff refused", "POST", "/users/bulk-upload/preview", T.staffA, undefined, upload(sheet([row(1)])));
  await call("bulk preview: no file", "POST", "/users/bulk-upload/preview", T.instA, {});
  await call("bulk preview: wrong file type", "POST", "/users/bulk-upload/preview", T.instA, undefined, upload(Buffer.from("hello"), "students.txt"));
  await call("bulk preview: no data rows", "POST", "/users/bulk-upload/preview", T.instA, undefined, upload(sheet([])));
  { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Phone"], ["a", "1"]]), "S"); await call("bulk preview: required columns missing", "POST", "/users/bulk-upload/preview", T.instA, undefined, upload(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))); }
  { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Student Name", "Registration Number (PRN)", "Official Email ID"], ["a", "ZZUW12345", "a@example.invalid"]]), "S"); await call("bulk preview: institute and batch columns missing", "POST", "/users/bulk-upload/preview", T.instA, undefined, upload(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))); }
  const mixed = sheet([
    row(1), row(2),
    row(3, { 1: prn("B1") }), // same PRN as row 1, inside the file
    row(4, { 2: em("b2") }), // same e-mail as row 2
    row(5, { 2: "not-an-email" }), row(6, { 1: "AB" }), row(7, { 5: "12" }), row(8, { 3: "No Such Institute" }), row(9, { 3: B.name }),
    row(10, { 5: "" }), row(11, { 1: prn(9) }), // PRN already registered (the edited student)
    row(12, { 10: "Inactive" }), ["", "", "", "", "", "", "", "", "", "", ""],
  ]);
  const preview = await call("bulk preview: a mixed file for an institute admin", "POST", "/users/bulk-upload/preview", T.instA, undefined, upload(mixed));
  await call("bulk preview: the same file for a platform admin", "POST", "/users/bulk-upload/preview", T.platform, undefined, upload(mixed));
  await call("bulk confirm: anonymous", "POST", "/users/bulk-upload/confirm", null, { rows: [] });
  await call("bulk confirm: staff refused", "POST", "/users/bulk-upload/confirm", T.staffA, { rows: [{}] });
  await call("bulk confirm: nothing to import", "POST", "/users/bulk-upload/confirm", T.instA, { rows: [] });
  await call("bulk confirm: too many rows", "POST", "/users/bulk-upload/confirm", T.instA, { rows: new Array(5001).fill({}) });
  const rowsFromPreview = (preview.json && preview.json.rows) || [];
  const confirmed = await call("bulk confirm: the previewed rows, no e-mail", "POST", "/users/bulk-upload/confirm", T.instA, { rows: rowsFromPreview, sendCredentials: false });
  await call("bulk confirm: the same rows again are duplicates", "POST", "/users/bulk-upload/confirm", T.instA, { rows: rowsFromPreview, sendCredentials: false });
  const q = (n) => ({ rowNum: 2, name: `ZZ UW bulk ${n}`, registrationNumber: prn(`B${n}`), email: em(`b${n}`), mobile: "9000000020", department: "ZZ UW Dept", program: "MCA", batchYear: "2026", section: "Section A", instituteName: A.name, gender: "Male", isActive: true });
  const mailed = await call("bulk confirm: one row with credentials e-mail queued", "POST", "/users/bulk-upload/confirm", T.instA, { rows: [q(20)], sendCredentials: true });
  await settle();
  note("bulk: stored accounts", (await prisma.user.findMany({ where: { email: { startsWith: "zz-uw-new-b" } }, select: { email: true, rollNumber: true, registrationNumber: true, isActive: true, accountStatus: true, mustChangePassword: true, role: true, academicGroupId: true } , orderBy: { email: "asc" } })).map((u) => ({ ...u, academicGroupId: u.academicGroupId ? "set" : null })));
  note("bulk: audit rows", await auditRows({ action: "ACCOUNT_CREATED", adminId: instA.id, details: { path: ["method"], equals: "bulk" } }));
  note("bulk: queued credential e-mails", (await prisma.emailLog.findMany({ where: { recipientEmail: { startsWith: "zz-uw-new-b20" } }, select: { emailType: true, batchId: true } })).map((m) => `${m.emailType}:${m.batchId ? "batch" : "-"}`));

  // ---------- reset password ----------
  const victim = await prisma.user.findFirst({ where: { email: em("b1") } });
  await call("reset: anonymous", "POST", `/users/${victim.id}/reset-password`, null, {});
  await call("reset: student refused", "POST", `/users/${victim.id}/reset-password`, T.stuBase, {});
  await call("reset: clerk refused", "POST", `/users/${victim.id}/reset-password`, T.clerkA, {});
  await call("reset: unknown user", "POST", `/users/${bogus}/reset-password`, T.instA, {});
  await call("reset: user of another institute", "POST", `/users/${stuB.id}/reset-password`, T.staffA, {});
  await call("reset: weak custom password", "POST", `/users/${victim.id}/reset-password`, T.instA, { customPassword: "weak" });
  await call("reset: custom password", "POST", `/users/${victim.id}/reset-password`, T.instA, { customPassword: "Custom#Pass1" });
  note("reset: stored", { loginWithCustom: (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: victim.email, password: "Custom#Pass1" }) })).status, mustChange: (await prisma.user.findUnique({ where: { id: victim.id }, select: { mustChangePassword: true } })).mustChangePassword, history: await prisma.passwordHistory.count({ where: { userId: victim.id } }) });
  const vTok = await (async () => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: victim.email, password: "Custom#Pass1" }) })).json()).token)();
  await call("reset: generated password by staff of the institute", "POST", `/users/${victim.id}/reset-password`, T.staffA, {});
  await call("reset: the account's open session is closed", "GET", "/auth/permissions", vTok);
  await call("reset: generated password with e-mail", "POST", `/users/${victim.id}/reset-password`, T.instA, { sendEmail: true });
  await call("reset: staff resets an institute admin of the same institute", "POST", `/users/${instA.id}/reset-password`, T.staffA, {});
  await call("reset: staff resets a clerk of the same institute", "POST", `/users/${clerkA.id}/reset-password`, T.staffA, {});
  await call("reset: institute admin resets a staff member", "POST", `/users/${staffA.id}/reset-password`, T.instA, {});
  await call("reset: platform admin resets a student of any institute", "POST", `/users/${stuB.id}/reset-password`, T.platform, {});
  await settle();
  note("reset: audit rows", await auditRows({ action: "PASSWORD_RESET", adminId: { in: [instA.id, staffA.id, platform.id] } }));

  // ---------- bulk reset ----------
  const b2 = await prisma.user.findFirst({ where: { email: em("b2") } });
  const b3 = await prisma.user.findFirst({ where: { email: em("b12") } }); // the inactive row of the upload, used as the student with a test attempt
  await call("bulk reset: anonymous", "POST", "/users/bulk-regenerate-password", null, { studentIds: [victim.id] });
  await call("bulk reset: staff refused", "POST", "/users/bulk-regenerate-password", T.staffA, { studentIds: [victim.id] });
  await call("bulk reset: nobody selected", "POST", "/users/bulk-regenerate-password", T.instA, { studentIds: [] });
  await call("bulk reset: own, foreign and unknown ids", "POST", "/users/bulk-regenerate-password", T.instA, { studentIds: [victim.id, b2 && b2.id, stuB.id, bogus, victim.id].filter(Boolean) });
  await call("bulk reset: a non-student account in the list", "POST", "/users/bulk-regenerate-password", T.instA, { studentIds: [staffA.id] });
  await call("bulk reset: platform admin, one student, with e-mail", "POST", "/users/bulk-regenerate-password", T.platform, { studentIds: [stuB.id], sendEmail: true });
  await settle();
  note("bulk reset: audit rows", await auditRows({ action: "PASSWORD_RESET", adminId: { in: [instA.id, platform.id] }, details: { path: ["bulk"], equals: true } }));

  // ---------- bulk status ----------
  await call("bulk status: anonymous", "POST", "/users/bulk-status", null, { studentIds: [victim.id], isActive: false });
  await call("bulk status: staff refused", "POST", "/users/bulk-status", T.staffA, { studentIds: [victim.id], isActive: false });
  await call("bulk status: nobody selected", "POST", "/users/bulk-status", T.instA, { studentIds: [], isActive: false });
  await call("bulk status: deactivate own, foreign, unknown and staff ids", "POST", "/users/bulk-status", T.instA, { studentIds: [victim.id, b2 && b2.id, stuB.id, bogus, staffA.id].filter(Boolean), isActive: false });
  note("bulk status: stored", (await prisma.user.findMany({ where: { id: { in: [victim.id, b2.id, stuB.id, staffA.id] } }, select: { email: true, isActive: true } , orderBy: { email: "asc" } })));
  await call("bulk status: deactivating again skips them", "POST", "/users/bulk-status", T.instA, { studentIds: [victim.id, b2.id], isActive: false });
  await call("bulk status: activate", "POST", "/users/bulk-status", T.instA, { studentIds: [victim.id, b2.id], isActive: true });
  await call("bulk status: platform admin, any institute", "POST", "/users/bulk-status", T.platform, { studentIds: [stuB.id], isActive: false });
  await settle();
  note("bulk status: audit rows", await auditRows({ action: { in: ["ACCOUNT_ACTIVATED", "ACCOUNT_DEACTIVATED"] }, adminId: { in: [instA.id, platform.id] }, details: { path: ["bulk"], equals: true } }));

  // ---------- delete ----------
  const test = await prisma.test.create({ data: { title: `${TAG} test ${ts}`, durationMin: 30, startTime: new Date(Date.now() - 3 * 86400000), endTime: new Date(Date.now() - 2 * 86400000), isPublished: true, instituteId: A.id, createdById: clerkA.id } });
  await prisma.testAttempt.create({ data: { testId: test.id, studentId: b3.id, status: "SUBMITTED", totalScore: 0 } });
  const free = await prisma.user.findFirst({ where: { email: em("b20") } });
  await call("delete: anonymous", "DELETE", `/users/${free.id}`, null);
  await call("delete: staff refused", "DELETE", `/users/${free.id}`, T.staffA);
  await call("delete: one's own account", "DELETE", `/users/${instA.id}`, T.instA);
  await call("delete: unknown user", "DELETE", `/users/${bogus}`, T.instA);
  await call("delete: user of another institute", "DELETE", `/users/${stuB.id}`, T.instA);
  await call("delete: a student with a test attempt", "DELETE", `/users/${b3.id}`, T.instA);
  await call("delete: an account that created a test", "DELETE", `/users/${clerkA.id}`, T.instA);
  await call("delete: a student with nothing on record", "DELETE", `/users/${free.id}`, T.instA);
  await call("delete: the same student again", "DELETE", `/users/${free.id}`, T.instA);
  await call("delete: a staff member with nothing on record", "DELETE", `/users/${staffNewId}`, T.instA);
  await call("delete: platform admin deletes a student of another institute", "DELETE", `/users/${stuB.id}`, T.platform);
  await settle();
  note("delete: audit rows", await auditRows({ action: "USER_DELETED", adminId: { in: [instA.id, platform.id] } }));
  note("delete: gone", { free: !(await prisma.user.findUnique({ where: { id: free.id } })), staff: !(await prisma.user.findUnique({ where: { id: staffNewId } })), kept: !!(await prisma.user.findUnique({ where: { id: b3.id } })) });

  await cleanup();
  const out = JSON.stringify(log, null, 2) + "\n";
  if (record) { fs.mkdirSync(path.dirname(SNAP), { recursive: true }); fs.writeFileSync(SNAP, out); console.log(`Recorded ${log.length} entries to ${path.relative(process.cwd(), SNAP)}`); await prisma.$disconnect(); return; }
  const expected = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const diffs = [];
  const n = Math.max(expected.length, log.length);
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(expected[i]), b = JSON.stringify(log[i]);
    if (a !== b) {
      let k = 0;
      while (a && b && a[k] === b[k]) k++;
      const win = (s) => (s ? s.slice(Math.max(0, k - 120), k + 160) : "(none)");
      diffs.push(`#${i} ${log[i] ? log[i].name : expected[i].name}\n  expected ...${win(a)}\n  actual   ...${win(b)}`);
    }
  }
  await prisma.$disconnect();
  if (diffs.length) { console.log(`${diffs.length} of ${n} recorded responses differ from the contract:\n${diffs.join("\n")}`); process.exit(1); }
  console.log(`All ${n} recorded responses match the contract`);
})().catch(async (e) => { console.error(e); try { await cleanup(); } catch { /* ignore */ } await prisma.$disconnect(); process.exit(1); });
