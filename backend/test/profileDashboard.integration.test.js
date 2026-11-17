// Real HTTP integration test for student profiles and the dashboards (backend/src/routes/profile.js, routes/dashboard.js, modules/studentDashboard). Added in the 2026-11 audit: the profile
// had no automated test (only a manual script that does not run in CI) and the dashboards were covered only by a browser test. It talks to the running API on localhost:4000, creates its own
// rows (two institutes, an administrator per institute, one staff member, one clerk, three students) and removes them afterwards. With REQUIRE_INTEGRATION=1 a missing prerequisite FAILS the
// file instead of skipping it. It checks:
//   - a student reads only their own profile, and the response never carries a credential field
//   - a student cannot rewrite their role, institute, password or active flag through the profile update (mass assignment), and bad mobile / LinkedIn / photo values are refused
//   - staff, clerk and administrators read a student's profile only inside their own institute (another institute's student is a 404, not a 403, so existence is not revealed)
//   - a student cannot read another student's profile, set a CGPA, or download a report; staff set a CGPA only for their own institute's students and only between 0 and 10
//   - the two student dashboards answer a student, refuse staff and anonymous callers, and carry nothing of another student or another institute
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");

const tag = `pd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let lastCall = "";
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: "localhost", port: 4000, path, method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let chunks = "";
      res.on("data", (d) => (chunks += d));
      res.on("end", () => { lastCall = `${method} ${path.replace(/[0-9a-f-]{36}/g, "<id>")} -> ${res.statusCode} ${chunks.slice(0, 200)}`; let b = {}; try { b = JSON.parse(chunks || "{}"); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: b, raw: chunks }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
// real tokens carry the name too (utils/sessions.js); the CGPA route records req.user.name
const tokenFor = (u) => jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name }, process.env.JWT_SECRET, { expiresIn: "30m" });
const eq = (actual, expected, message) => assert.equal(actual, expected, `${message || ""} | last call: ${lastCall}`);

let ready = false;
const F = { users: [], institutes: [] };
function notReady(reason) { ready = false; if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(`profile/dashboard integration prerequisites missing: ${reason}`); }
async function mkUser(role, instituteId, label, extra = {}) {
  const u = await prisma.user.create({ data: { name: `${label} ${tag}`, email: `${tag}-${label}@example.test`, passwordHash: "not-a-real-hash", role, instituteId, ...extra } });
  F.users.push(u.id);
  return u;
}

test.before(async () => {
  let reachable = false;
  try { reachable = (await request("GET", "/api/health", null)).status === 200; } catch { reachable = false; }
  if (!reachable) return notReady("the API is not answering on localhost:4000");
  if (!process.env.JWT_SECRET) return notReady("JWT_SECRET is not set");
  try {
    const A = await prisma.institute.create({ data: { name: `${tag}-A` } });
    const B = await prisma.institute.create({ data: { name: `${tag}-B` } });
    F.institutes.push(A.id, B.id);
    F.A = A; F.B = B;
    F.adminA = await mkUser("ADMIN", A.id, "adminA");
    F.adminB = await mkUser("ADMIN", B.id, "adminB");
    F.staffA = await mkUser("STAFF", A.id, "staffA");
    F.clerkA = await mkUser("CLERK", A.id, "clerkA");
    F.s1 = await mkUser("STUDENT", A.id, "s1");
    F.s2 = await mkUser("STUDENT", A.id, "s2");
    F.sB = await mkUser("STUDENT", B.id, "sB");
    F.t = Object.fromEntries(["adminA", "adminB", "staffA", "clerkA", "s1", "s2", "sB"].map((k) => [k, tokenFor(F[k])]));
    ready = true;
  } catch (e) { notReady(`fixture creation failed: ${e.message}`); }
});

test.after(async () => {
  try {
    await prisma.studentProfile.deleteMany({ where: { studentId: { in: F.users } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: F.users } }, { studentId: { in: F.users } }] } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { recipientId: { in: F.users } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: F.users } } }).catch(() => {});
    await prisma.institute.deleteMany({ where: { id: { in: F.institutes } } }).catch(() => {});
  } finally { await prisma.$disconnect(); }
});

test("a student reads only their own profile, and no credential field is ever returned", async (t) => {
  if (!ready) return t.skip("not ready");
  const r = await request("GET", "/api/profile/me", F.t.s1);
  eq(r.status, 200);
  eq(r.body.user.id, F.s1.id);
  eq(r.body.user.email, F.s1.email);
  assert.ok(!/passwordHash|not-a-real-hash/.test(r.raw), "no password hash in the profile");
  assert.ok(!r.raw.includes(F.s2.email) && !r.raw.includes(F.sB.email), "no other student's email in the profile");
  // roles other than STUDENT have no student profile
  for (const k of ["staffA", "clerkA", "adminA"]) eq((await request("GET", "/api/profile/me", F.t[k])).status, 403, `${k} has no student profile`);
  eq((await request("GET", "/api/profile/me", null)).status, 401);
});

test("a student's profile update refuses bad values and cannot rewrite role, institute, password or active flag", async (t) => {
  if (!ready) return t.skip("not ready");
  eq((await request("PATCH", "/api/profile/me", F.t.s1, { mobile: "12ab" })).status, 400, "a malformed mobile number");
  eq((await request("PATCH", "/api/profile/me", F.t.s1, { linkedinUrl: "http://evil.example/x" })).status, 400, "a LinkedIn URL that is not https://linkedin.com");
  eq((await request("PATCH", "/api/profile/me", F.t.s1, { profilePhotoUrl: "data:text/html;base64,PHNjcmlwdD4=" })).status, 400, "a photo that is not an image");
  eq((await request("PATCH", "/api/profile/me", F.t.s1, { profilePhotoUrl: `data:image/png;base64,${"A".repeat(700001)}` })).status, 400, "an oversized photo");

  const before = await prisma.user.findUnique({ where: { id: F.s1.id } });
  const ok = await request("PATCH", "/api/profile/me", F.t.s1, {
    mobile: "9876501234", linkedinUrl: "https://www.linkedin.com/in/someone",
    // none of these may take effect
    role: "SUPER_ADMIN", instituteId: F.B.id, passwordHash: "x", isActive: false, email: `${tag}-changed@example.test`, registrationNumber: "REG-HIJACK",
  });
  eq(ok.status, 200);
  const after = await prisma.user.findUnique({ where: { id: F.s1.id } });
  eq(after.mobile, "9876501234", "the allowed field is saved");
  eq(after.role, "STUDENT"); eq(after.instituteId, F.A.id); eq(after.passwordHash, before.passwordHash); eq(after.isActive, before.isActive); eq(after.email, before.email);
  eq(after.registrationNumber, before.registrationNumber, "the registration number is not editable by the student");
  const read = await request("GET", "/api/profile/me", F.t.s1);
  eq(read.body.user.mobile, "9876501234", "and it is what the profile now returns");
});

test("staff, clerk and administrators read a student's profile only inside their own institute", async (t) => {
  if (!ready) return t.skip("not ready");
  for (const k of ["staffA", "clerkA", "adminA"]) {
    const own = await request("GET", `/api/profile/${F.s1.id}`, F.t[k]);
    eq(own.status, 200, `${k} reads a student of their own institute`);
    eq(own.body.user.id, F.s1.id);
    assert.ok(!/passwordHash|not-a-real-hash/.test(own.raw), `${k}: no credential field`);
    const other = await request("GET", `/api/profile/${F.sB.id}`, F.t[k]);
    eq(other.status, 404, `${k} gets 404 (not 403) for another institute's student`);
    assert.ok(!other.raw.includes(F.sB.email), `${k}: nothing of the other institute's student in the answer`);
  }
  eq((await request("GET", `/api/profile/${F.s1.id}`, F.t.adminB)).status, 404, "an administrator of institute B cannot read an institute A student");
  eq((await request("GET", `/api/profile/${F.adminA.id}`, F.t.staffA)).status, 404, "the endpoint serves students only");
  eq((await request("GET", `/api/profile/${F.s2.id}`, F.t.s1)).status, 403, "a student cannot read another student's profile");
  eq((await request("GET", `/api/profile/${F.s1.id}`, null)).status, 401);
});

test("only staff of the same institute set a CGPA, and only a number between 0 and 10", async (t) => {
  if (!ready) return t.skip("not ready");
  eq((await request("PATCH", `/api/profile/students/${F.s1.id}/cgpa`, F.t.s1, { cgpa: 10 })).status, 403, "a student cannot set their own CGPA");
  eq((await request("PATCH", `/api/profile/students/${F.s1.id}/cgpa`, F.t.clerkA, { cgpa: 8 })).status, 403, "a clerk cannot set a CGPA");
  eq((await request("PATCH", `/api/profile/students/${F.sB.id}/cgpa`, F.t.staffA, { cgpa: 8 })).status, 404, "staff cannot set a CGPA for another institute's student");
  for (const bad of [-1, 10.5, "abc"]) eq((await request("PATCH", `/api/profile/students/${F.s1.id}/cgpa`, F.t.staffA, { cgpa: bad })).status, 400, `cgpa ${JSON.stringify(bad)} is refused`);
  eq((await request("PATCH", `/api/profile/students/${F.s1.id}/cgpa`, F.t.staffA, { cgpa: 8.25 })).status, 200);
  const saved = await prisma.studentProfile.findUnique({ where: { studentId: F.s1.id } });
  eq(Number(saved.cgpa), 8.25);
  eq(saved.cgpaSetBy, F.staffA.name, "the CGPA records who set it");
  const sB = await prisma.studentProfile.findUnique({ where: { studentId: F.sB.id } });
  assert.ok(!sB || sB.cgpa == null, "the other institute's student was not touched");
});

test("the profile report is not available to students or across institutes", async (t) => {
  if (!ready) return t.skip("not ready");
  eq((await request("GET", `/api/profile/${F.s1.id}/report.pdf`, F.t.s1)).status, 403, "a student cannot download a report");
  eq((await request("GET", `/api/profile/${F.sB.id}/report.pdf`, F.t.staffA)).status, 404, "staff cannot download another institute's report");
  eq((await request("GET", `/api/profile/${F.s1.id}/report.pdf`, null)).status, 401);
});

test("the student dashboards answer a student, refuse staff and anonymous callers, and carry nothing of another student", async (t) => {
  if (!ready) return t.skip("not ready");
  for (const path of ["/api/student/dashboard", "/api/dashboard/student"]) {
    const r = await request("GET", path, F.t.s1);
    eq(r.status, 200, `${path} for a student`);
    assert.ok(!r.raw.includes(F.s2.email) && !r.raw.includes(F.sB.email), `${path}: no other student's email`);
    assert.ok(!/passwordHash|not-a-real-hash/.test(r.raw), `${path}: no credential field`);
    const anon = await request("GET", path, null);
    eq(anon.status, 401, `${path} without a token`);
  }
  eq((await request("GET", "/api/dashboard/student", F.t.staffA)).status, 403, "staff do not get the student dashboard");
  eq((await request("GET", "/api/dashboard/student", F.t.adminA)).status, 403, "administrators do not get the student dashboard");
});
