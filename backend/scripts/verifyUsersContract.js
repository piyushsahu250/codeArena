// Characterization (contract) test for the read and self-service half of /api/users: the signed-in user's own account and sessions (/me*), the user list, lookup,
// search, browse, the audit-log views, the roll-number-conflict view, and a student's performance dashboard and reports. It drives each route through success and
// failure paths with disposable data and compares a normalized record of every response with test/snapshots/users-contract.json. Used to prove a restructuring of
// routes/users.js changes nothing except what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a database.
//   node scripts/verifyUsersContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifyUsersContract.js --record   (re)write the snapshot
// Deliberately NOT exercised here: account creation, edit, delete, bulk upload, password reset and bulk status (the write half, migrated and checked separately).
// Routes that read platform-wide data are recorded as a SHAPE (keys and types) because production holds real rows the snapshot must not depend on.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ UC";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "users-contract.json");
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const MASKED = new Set(["ipAddress", "deviceInfo", "ip", "message", "lastLoginAt"]);
function norm(v, keepMasked) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>").replace(/\d{13}/g, "<ts>");
  if (Array.isArray(v)) return v.map((x) => norm(x, keepMasked));
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = k === "token" ? (v[k] ? "<token>" : null) : !keepMasked && MASKED.has(k) && v[k] ? "<masked>" : norm(v[k], keepMasked); return o; }
  return v;
}
// Structure only (keys, nesting), never values or types: platform-wide reads return real production rows whose nulls and strings the snapshot must not depend on.
const shapeOf = (v) => (Array.isArray(v) ? (v.length ? [shapeOf(v[0])] : []) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shapeOf(v[k])])) : ".");
let ipSeq = 0;
const nextIp = () => `203.0.113.${100 + ++ipSeq}`;
// opts: shape = record keys and types only; headers = response headers to keep; bool = replace these body keys by their type (mail results differ by environment)
async function call(name, method, p, token, body, opts = {}) {
  const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  const entry = { name, status: res.status };
  if (opts.headers) entry.headers = Object.fromEntries(opts.headers.map((h) => [h, res.headers.get(h)]));
  if (json !== null) {
    if (opts.bool) for (const k of opts.bool) if (k in json) json[k] = typeof json[k];
    entry.body = opts.shape ? shapeOf(json) : norm(json);
  } else {
    entry.body = (res.headers.get("content-type") || "").includes("text/csv") ? norm(text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<time>")) : `<non-json ${buf.length > 0 ? "bytes" : "empty"}>`;
  }
  log.push(entry);
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(900);

let allIds = [];
async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { email: { startsWith: "zz-uc-" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-uc-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-uc-" } }, ...uids.map((u) => ({ key: `email-change:${u}` }))] } });
  await prisma.test.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }] } });
  await prisma.testAttempt.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZUA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZUB" } });
  const deptA = await prisma.department.create({ data: { name: "ZZ UC Dept A", instituteId: A.id } });
  const deptB = await prisma.department.create({ data: { name: "ZZ UC Dept B", instituteId: B.id } });
  const groupA = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: deptA.id, section: "Section A" } });
  const groupB = await prisma.academicGroup.create({ data: { instituteId: B.id, batch: "2026", departmentId: deptB.id, section: "Section B" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
    return prisma.user.create({ data: { name: `ZZ UC ${key}`, email: `zz-uc-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const platform = await mk("platform", "ADMIN", null);
  const instA = await mk("instA", "INSTITUTE_ADMIN", A.id);
  const instB = await mk("instB", "INSTITUTE_ADMIN", B.id);
  const staffA = await mk("staffA", "STAFF", A.id);
  const staffB = await mk("staffB", "STAFF", B.id);
  const clerkA = await mk("clerkA", "CLERK", A.id);
  const stu1 = await mk("stu1", "STUDENT", A.id, { academicGroupId: groupA.id, rollNumber: "001", registrationNumber: `ZZUC-${ts}-1`, mobile: "9000000001", gender: "Male" });
  const stu2 = await mk("stu2", "STUDENT", A.id, { academicGroupId: groupA.id, rollNumber: "002", registrationNumber: `ZZUC-${ts}-2`, mobile: "9000000002" });
  const stu3 = await mk("stu3", "STUDENT", A.id, { academicGroupId: groupA.id, rollNumber: "010", registrationNumber: `ZZUC-${ts}-3` });
  const groupA2 = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: deptA.id, section: "Section B" } });
  await mk("cf1", "STUDENT", A.id, { academicGroupId: groupA2.id, rollNumber: "005", registrationNumber: `ZZUC-${ts}-C1` });
  await mk("cf2", "STUDENT", A.id, { academicGroupId: groupA2.id, rollNumber: "005", registrationNumber: `ZZUC-${ts}-C2` });
  const stuB = await mk("stuB", "STUDENT", B.id, { academicGroupId: groupB.id, rollNumber: "001", registrationNumber: `ZZUC-${ts}-B` });
  const me = {};
  for (const k of ["m1", "m2", "m3", "m4", "m5", "m6"]) me[k] = await mk(k, "STAFF", A.id);
  const login = async (u, k) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
  const T = { platform: await login(platform, "platform"), instA: await login(instA, "instA"), instB: await login(instB, "instB"), staffA: await login(staffA, "staffA"), staffB: await login(staffB, "staffB"), clerkA: await login(clerkA, "clerkA"), stu1: await login(stu1, "stu1"), stuB: await login(stuB, "stuB") };
  for (const k of Object.keys(me)) T[k] = await login(me[k], k);
  const clearLimit = (u) => prisma.rateLimitHit.deleteMany({ where: { key: `email-change:${u.id}` } });
  const bogus = crypto.randomUUID();

  // a published test with one submitted attempt, for lookup and the performance views
  const test = await prisma.test.create({ data: { title: `${TAG} test ${ts}`, durationMin: 30, startTime: new Date(Date.now() - 3 * 86400000), endTime: new Date(Date.now() - 2 * 86400000), isPublished: true, instituteId: A.id, createdById: staffA.id } });
  await prisma.testAttempt.create({ data: { testId: test.id, studentId: stu1.id, status: "SUBMITTED", totalScore: 0, startedAt: new Date(Date.now() - 2.9 * 86400000), submittedAt: new Date(Date.now() - 2.89 * 86400000) } });

  // audit rows with fixed past timestamps, so the views are deterministic whatever else the API writes meanwhile
  const at = (s) => new Date(Date.UTC(2020, 0, 1, 0, 0, s));
  const seed = (n, action, who, inst, student, details) => prisma.auditLog.create({ data: { action, adminId: who.id, adminName: who.name, adminRole: who.role, studentId: student ? student.id : null, instituteId: inst ? inst.id : null, details, createdAt: at(n), ipAddress: "10.0.0.1", deviceInfo: "Seed" } });
  await seed(1, "DOCUMENT_UPLOADED", stu1, A, stu1, { documentType: "AADHAAR" });
  await seed(2, "DOCUMENT_UPLOADED", stu2, A, stu2, { documentType: "PAN" });
  await seed(3, "DOCUMENT_VERIFIED", clerkA, A, stu1, { documentType: "AADHAAR" });
  await seed(4, "PASSWORD_RESET", instA, A, stu1, { studentName: stu1.name, emailSent: true });
  await seed(5, "PASSWORD_RESET", staffA, A, stu2, { studentName: stu2.name, emailSent: false });
  await seed(6, "PASSWORD_RESET", instB, B, stuB, { studentName: stuB.name, emailSent: true });
  await seed(7, "TEST_CREATED", staffA, A, null, { title: "x" });

  // ---------- own account: PATCH /me ----------
  const mailKeys = ["message", "verificationEmailSent"];
  await call("me patch: anonymous", "PATCH", "/users/me", null, { currentPassword: "x", newPassword: "Aa1!aaaa" });
  await call("me patch: no current password", "PATCH", "/users/me", T.m1, { newPassword: "Aa1!aaaa" });
  await call("me patch: nothing to change", "PATCH", "/users/me", T.m1, { currentPassword: pw.m1 });
  await call("me patch: wrong current password", "PATCH", "/users/me", T.m1, { currentPassword: "Wrong1!pass", newPassword: "Aa1!aaaa" });
  await clearLimit(me.m1);
  await call("me patch: invalid new email", "PATCH", "/users/me", T.m1, { currentPassword: pw.m1, newEmail: "not-an-email" });
  await call("me patch: email already in use", "PATCH", "/users/me", T.m1, { currentPassword: pw.m1, newEmail: staffB.email.toUpperCase() });
  await clearLimit(me.m1);
  await call("me patch: weak new password", "PATCH", "/users/me", T.m1, { currentPassword: pw.m1, newPassword: "weak" });
  await call("me patch: new password equals current", "PATCH", "/users/me", T.m1, { currentPassword: pw.m1, newPassword: pw.m1 });
  await clearLimit(me.m1);
  await prisma.passwordHistory.create({ data: { userId: me.m1.id, passwordHash: await bcrypt.hash("Old1!passwordX", 10) } });
  await call("me patch: password used recently", "PATCH", "/users/me", T.m1, { currentPassword: pw.m1, newPassword: "Old1!passwordX" });
  await clearLimit(me.m1);
  await call("me patch: same email as the current one changes nothing", "PATCH", "/users/me", T.m1, { currentPassword: pw.m1, newEmail: me.m1.email.toUpperCase() }, { bool: mailKeys });
  await clearLimit(me.m1);
  const newPw = `Nn7#${crypto.randomBytes(8).toString("base64url")}`;
  const changed = await call("me patch: password changed", "PATCH", "/users/me", T.m2, { currentPassword: pw.m2, newPassword: newPw }, { bool: mailKeys });
  note("me patch: password stored", { historyRows: await prisma.passwordHistory.count({ where: { userId: me.m2.id } }), flag: (await prisma.user.findUnique({ where: { id: me.m2.id }, select: { mustChangePassword: true } })).mustChangePassword, loginWithNew: (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: me.m2.email, password: newPw }) })).status });
  await call("me patch: the session that changed the password still works", "GET", "/users/me/sessions", T.m2, undefined, { shape: true });
  await call("me patch: a new sign-in address is held as pending", "PATCH", "/users/me", T.m3, { currentPassword: pw.m3, newEmail: ` NEW-${me.m3.email.toUpperCase()} ` }, { bool: mailKeys });
  note("me patch: pending state", await prisma.user.findUnique({ where: { id: me.m3.id }, select: { email: true, pendingEmail: true, emailVerified: true } }).then((u) => ({ email: u.email, pendingEmail: u.pendingEmail, verified: u.emailVerified, tokenStored: true })));
  const pendingHash = (await prisma.user.findUnique({ where: { id: me.m3.id }, select: { pendingEmailTokenHash: true, pendingEmailTokenExpiry: true } }));
  note("me patch: pending token", { hashed: !!pendingHash.pendingEmailTokenHash && pendingHash.pendingEmailTokenHash.length === 64, hoursValid: Math.round((pendingHash.pendingEmailTokenExpiry.getTime() - Date.now()) / 3600000) });
  await call("me patch: password and e-mail together", "PATCH", "/users/me", T.m4, { currentPassword: pw.m4, newPassword: `Nn8#${crypto.randomBytes(8).toString("base64url")}`, newEmail: `zz-uc-both-${ts}@example.invalid` }, { bool: mailKeys });
  await settle();
  note("me patch: audit rows", (await prisma.auditLog.findMany({ where: { adminId: { in: [me.m1.id, me.m2.id, me.m3.id, me.m4.id] }, action: "PASSWORD_CHANGED" }, select: { adminRole: true, instituteId: true, studentId: true, details: true } })).map((a) => `${a.adminRole}:${a.instituteId ? "inst" : "-"}:${a.studentId ? "student" : "-"}:${JSON.stringify({ ...a.details, verificationEmailSent: typeof a.details.verificationEmailSent })}`).sort());
  note("me patch: e-mails queued", (await prisma.emailLog.findMany({ where: { recipientEmail: { in: [me.m2.email, me.m3.email, me.m4.email, `new-${me.m3.email}`, `zz-uc-both-${ts}@example.invalid`] }, emailType: { in: ["LOGIN_ALERT", "EMAIL_VERIFICATION"] } }, select: { emailType: true, recipientEmail: true } })).map((m) => `${m.emailType}:${m.recipientEmail.startsWith("new-") || m.recipientEmail.includes("both") ? "to-new-address" : "to-current"}`).sort());
  const lim = me.m5;
  await clearLimit(lim);
  for (let i = 1; i <= 3; i++) await call(`me patch limit: request ${i}`, "PATCH", "/users/me", T.m5, { currentPassword: "Wrong1!pass", newPassword: "Aa1!aaaa" });
  await call("me patch limit: fourth request", "PATCH", "/users/me", T.m5, { currentPassword: pw.m5, newPassword: "Aa1!aaaa" });
  await call("me patch limit: resend shares the same budget", "POST", "/users/me/resend-verification", T.m5);

  // ---------- own account: resend verification ----------
  await call("resend: anonymous", "POST", "/users/me/resend-verification", null);
  await clearLimit(me.m1);
  await call("resend: no change pending", "POST", "/users/me/resend-verification", T.m1);
  await clearLimit(me.m3);
  const before = (await prisma.user.findUnique({ where: { id: me.m3.id }, select: { pendingEmailTokenHash: true } })).pendingEmailTokenHash;
  await call("resend: pending change", "POST", "/users/me/resend-verification", T.m3, undefined, { bool: mailKeys });
  note("resend: token replaced", { replaced: (await prisma.user.findUnique({ where: { id: me.m3.id }, select: { pendingEmailTokenHash: true } })).pendingEmailTokenHash !== before });

  // ---------- own sessions ----------
  await call("sessions: anonymous", "GET", "/users/me/sessions", null);
  const second = await login(me.m6, "m6");
  await call("sessions: list", "GET", "/users/me/sessions", T.m6, undefined);
  const rows = (await prisma.loginSession.findMany({ where: { userId: me.m6.id }, orderBy: { loginAt: "asc" } }));
  const jtiOf = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).jti;
  const currentRow = rows.find((r) => r.token === jtiOf(second));
  const otherRow = rows.find((r) => r.token !== jtiOf(second));
  await call("sessions: end with no token", "DELETE", `/users/me/sessions/${otherRow.id}`, null);
  await call("sessions: unknown session", "DELETE", `/users/me/sessions/${bogus}`, second);
  const foreign = await prisma.loginSession.findFirst({ where: { userId: stu1.id } });
  await call("sessions: another user's session", "DELETE", `/users/me/sessions/${foreign.id}`, second);
  await call("sessions: the current session", "DELETE", `/users/me/sessions/${currentRow.id}`, second);
  await call("sessions: another of one's own sessions", "DELETE", `/users/me/sessions/${otherRow.id}`, second);
  note("sessions: stored state", { active: await prisma.loginSession.count({ where: { userId: me.m6.id, isActive: true } }), stamped: !!(await prisma.loginSession.findUnique({ where: { id: otherRow.id } })).logoutAt });
  await call("sessions: the revoked session's token is dead", "GET", "/users/me/sessions", T.m6);
  await call("sessions: list afterwards", "GET", "/users/me/sessions", second);
  await settle();
  note("sessions: audit rows", (await prisma.auditLog.findMany({ where: { adminId: me.m6.id, action: "SESSION_REVOKED" }, select: { adminRole: true, instituteId: true, studentId: true, details: true } })).map((a) => `${a.adminRole}:${a.instituteId ? "inst" : "-"}:${a.studentId ? "student" : "-"}:${Object.keys(a.details).sort()}`));

  // ---------- user list, one user, template ----------
  await call("list: anonymous", "GET", "/users", null);
  await call("list: student refused", "GET", "/users", T.stu1);
  await call("list: staff refused", "GET", "/users", T.staffA);
  await call("list: institute admin sees only the own institute", "GET", "/users", T.instA);
  await call("list: second page of two", "GET", "/users?page=2&pageSize=2", T.instA);
  await call("list: page size is capped and floored", "GET", "/users?page=0&pageSize=9999", T.instB);
  await call("list: platform admin sees everyone (shape)", "GET", "/users?pageSize=1", T.platform, undefined, { shape: true });
  await call("template: anonymous", "GET", "/users/bulk-template", null);
  await call("template: staff refused", "GET", "/users/bulk-template", T.staffA);
  await call("template: institute admin", "GET", "/users/bulk-template", T.instA, undefined, { headers: ["content-type", "content-disposition"] });
  await call("one: anonymous", "GET", `/users/${stu1.id}`, null);
  await call("one: staff refused", "GET", `/users/${stu1.id}`, T.staffA);
  await call("one: own institute", "GET", `/users/${stu1.id}`, T.instA);
  await call("one: another institute refused", "GET", `/users/${stu1.id}`, T.instB);
  await call("one: platform admin", "GET", `/users/${stu1.id}`, T.platform);
  await call("one: unknown id", "GET", `/users/${bogus}`, T.instA);
  await call("one: id that is not a uuid", "GET", "/users/not-a-uuid", T.instA);

  // ---------- lookup ----------
  await call("lookup: anonymous", "GET", `/users/lookup/ZZUC-${ts}-1`, null);
  await call("lookup: staff refused", "GET", `/users/lookup/ZZUC-${ts}-1`, T.staffA);
  await call("lookup: by registration number", "GET", `/users/lookup/ZZUC-${ts}-1`, T.instA);
  await call("lookup: by e-mail", "GET", `/users/lookup/${encodeURIComponent(stu1.email)}`, T.instA);
  await call("lookup: by id", "GET", `/users/lookup/${stu1.id}`, T.instA);
  await call("lookup: by roll number (first match)", "GET", "/users/lookup/010", T.instA);
  await call("lookup: a student of another institute", "GET", `/users/lookup/ZZUC-${ts}-1`, T.instB);
  await call("lookup: platform admin", "GET", `/users/lookup/ZZUC-${ts}-1`, T.platform);
  await call("lookup: a staff member is not a student", "GET", `/users/lookup/${encodeURIComponent(staffA.email)}`, T.instA);
  await call("lookup: unknown", "GET", "/users/lookup/nobody-here", T.instA);

  // ---------- search ----------
  await call("search: anonymous", "GET", "/users/search?q=ZZ", null);
  await call("search: student refused", "GET", "/users/search?q=ZZ", T.stu1);
  await call("search: empty query", "GET", "/users/search", T.staffA);
  await call("search: by name, staff", "GET", "/users/search?q=zz%20uc%20stu", T.staffA);
  await call("search: by name, clerk", "GET", "/users/search?q=zz%20uc%20stu", T.clerkA);
  await call("search: by e-mail fragment, institute admin", "GET", `/users/search?q=zz-uc-stu1-${ts}`, T.instA);
  await call("search: by mobile", "GET", "/users/search?q=9000000002", T.instA);
  await call("search: by exact id", "GET", `/users/search?q=${stu2.id}`, T.instA);
  await call("search: role filter", "GET", "/users/search?q=zz%20uc&role=CLERK", T.instA);
  await call("search: unknown role filter is ignored", "GET", "/users/search?q=zz%20uc%20stu&role=NOPE", T.instA);
  await call("search: institute isolation", "GET", "/users/search?q=zz%20uc%20stu", T.staffB);
  await call("search: platform admin sees both institutes", "GET", "/users/search?q=zz%20uc%20stu&pageSize=100", T.platform);
  await call("search: paging", "GET", "/users/search?q=zz%20uc%20stu&page=2&pageSize=2", T.instA);
  await call("search: document filter with no documents", "GET", "/users/search?q=zz%20uc%20stu&documentType=AADHAAR", T.instA);

  // ---------- browse ----------
  await call("browse: anonymous", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A`, null);
  await call("browse: student refused", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A`, T.stu1);
  await call("browse: no department", "GET", "/users/browse?section=Section%20A", T.staffA);
  await call("browse: platform admin without an institute", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A`, T.platform);
  await call("browse: platform admin with an institute", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A&instituteId=${A.id}`, T.platform);
  await call("browse: staff, ordered by roll number", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A`, T.staffA);
  await call("browse: with the batch", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A&batch=2026`, T.clerkA);
  await call("browse: paging", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A&page=2&pageSize=2`, T.instA);
  await call("browse: no such group", "GET", `/users/browse?departmentId=${deptA.id}&section=Nope`, T.staffA);
  await call("browse: another institute's department", "GET", `/users/browse?departmentId=${deptB.id}&section=Section%20B`, T.staffA);
  await call("browse: placement filter", "GET", `/users/browse?departmentId=${deptA.id}&section=Section%20A&placementParticipation=INTERESTED`, T.staffA);

  // ---------- reset history, conflicts, audit trail ----------
  await call("history: anonymous", "GET", "/users/password-reset-history", null);
  await call("history: clerk refused", "GET", "/users/password-reset-history", T.clerkA);
  await call("history: staff sees the own institute", "GET", "/users/password-reset-history", T.staffA);
  await call("history: other institute", "GET", "/users/password-reset-history", T.instB);
  await call("history: platform admin (shape)", "GET", "/users/password-reset-history", T.platform, undefined, { shape: true });
  await call("conflicts: anonymous", "GET", "/users/roll-number-conflicts", null);
  await call("conflicts: staff refused", "GET", "/users/roll-number-conflicts", T.staffA);
  await call("conflicts: institute admin", "GET", "/users/roll-number-conflicts", T.instA);
  await call("conflicts: other institute has none", "GET", "/users/roll-number-conflicts", T.instB);
  await call("conflicts: paging", "GET", "/users/roll-number-conflicts?page=2&pageSize=1", T.instA);
  await call("conflicts: platform admin (shape)", "GET", "/users/roll-number-conflicts?pageSize=1", T.platform, undefined, { shape: true });
  await settle();
  const window = `from=${encodeURIComponent("2019-12-31T00:00:00Z")}&to=${encodeURIComponent("2020-01-02T00:00:00Z")}`;
  await call("audit: anonymous", "GET", `/users/audit-log?${window}`, null);
  await call("audit: student refused", "GET", `/users/audit-log?${window}`, T.stu1);
  await call("audit: institute admin, time window", "GET", `/users/audit-log?${window}`, T.instA);
  await call("audit: one action", "GET", `/users/audit-log?${window}&action=PASSWORD_RESET`, T.staffA);
  await call("audit: one student", "GET", `/users/audit-log?${window}&studentId=${stu1.id}`, T.instA);
  await call("audit: clerk sees only the document actions", "GET", `/users/audit-log?${window}`, T.clerkA);
  await call("audit: clerk asking for an action outside the allowlist", "GET", `/users/audit-log?${window}&action=PASSWORD_RESET`, T.clerkA);
  await call("audit: clerk asking for an allowed action", "GET", `/users/audit-log?${window}&action=DOCUMENT_VERIFIED`, T.clerkA);
  await call("audit: paging", "GET", `/users/audit-log?${window}&page=2&pageSize=2`, T.instA);
  await call("audit: other institute", "GET", `/users/audit-log?${window}`, T.instB);
  await call("audit: csv export", "GET", `/users/audit-log?${window}&format=csv`, T.instA, undefined, { headers: ["content-type", "content-disposition"] });
  await call("audit actions: anonymous", "GET", "/users/audit-log/actions", null);
  await call("audit actions: student refused", "GET", "/users/audit-log/actions", T.stu1);
  await call("audit actions: institute B", "GET", "/users/audit-log/actions", T.instB, undefined, { shape: true });
  await call("audit actions: platform admin (shape)", "GET", "/users/audit-log/actions", T.platform, undefined, { shape: true });
  await call("migration status: anonymous", "GET", "/users/migration-status", null);
  await call("migration status: institute admin refused", "GET", "/users/migration-status", T.instA);
  await call("migration status: platform admin (shape)", "GET", "/users/migration-status", T.platform, undefined, { shape: true });

  // ---------- performance dashboard and reports ----------
  const perf = (suffix, name, who, id, opts) => call(`${name}`, "GET", `/users/${id}/${suffix}`, who, undefined, opts);
  for (const [suffix, label, opts] of [["performance", "performance", undefined], ["placement-readiness", "readiness", undefined], ["performance/report.xlsx", "excel", { headers: ["content-type", "content-disposition"] }], ["performance/report.pdf", "pdf", { headers: ["content-type", "content-disposition"] }]]) {
    await perf(suffix, `${label}: anonymous`, null, stu1.id, opts);
    await perf(suffix, `${label}: the student itself`, T.stu1, stu1.id, opts);
    await perf(suffix, `${label}: a student asking for another`, T.stu1, stu2.id, opts);
    await perf(suffix, `${label}: staff of the institute`, T.staffA, stu1.id, opts);
    await perf(suffix, `${label}: clerk of the institute`, T.clerkA, stu1.id, opts);
    await perf(suffix, `${label}: staff of another institute`, T.staffB, stu1.id, opts);
    await perf(suffix, `${label}: institute admin of another institute`, T.instB, stu1.id, opts);
    await perf(suffix, `${label}: platform admin`, T.platform, stu1.id, opts);
    await perf(suffix, `${label}: unknown student`, T.platform, bogus, opts);
    await perf(suffix, `${label}: target is not a student`, T.platform, staffA.id, opts);
  }

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
