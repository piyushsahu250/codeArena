// Real HTTP integration test for Attendance (backend/src/routes/attendance.js). Added in the 2026-11 audit: the module had no automated test (one manual verify script that does not run in CI) and the
// October audit list of known issues still said the absence alert did not exist. It talks to the running API on localhost:4000, creates its own rows (two institutes, a department and group, an
// administrator per institute, two staff members, three students) and removes them afterwards. With REQUIRE_INTEGRATION=1 (the CI integration job) a missing prerequisite FAILS the file instead of skipping it.
//   - an administrator can assign staff only inside their own institute; another institute's administrator cannot
//   - staff reach only their own assignment; another staff member of the same institute cannot see or change it
//   - a lecture plan needs valid input and a unique lecture number
//   - saving attendance keeps only students of the group (a student of another institute is dropped), replaces the earlier save, and is visible to the student only for their own record
//   - three absences in a row in one subject notify the student exactly once
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");

const HOST = "localhost";
const PORT = 4000;
const tag = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let lastCall = "";
const strictEqual = assert.equal;
assert.equal = (actual, expected, message) => strictEqual(actual, expected, message || `last call: ${lastCall}`);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: HOST, port: PORT, path, method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let chunks = "";
      res.on("data", (d) => (chunks += d));
      res.on("end", () => { lastCall = `${method} ${path.replace(/[0-9a-f-]{36}/g, "<id>")} -> ${res.statusCode} ${chunks.slice(0, 300)}`; let b = {}; try { b = JSON.parse(chunks || "{}"); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: b, raw: chunks }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const tokenFor = (u) => jwt.sign({ id: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "30m" });

let ready = false;
const F = { users: [], institutes: [] };
function notReady(reason) { ready = false; if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(`attendance integration prerequisites missing: ${reason}`); }
async function mkUser(role, instituteId, label, extra = {}) {
  const u = await prisma.user.create({ data: { name: `${label} ${tag}`, email: `${tag}-${label}@example.test`, passwordHash: "not-a-real-hash", role, instituteId, registrationNumber: role === "STUDENT" ? `PRN-${tag}-${label}`.slice(0, 40) : null, ...extra } });
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
    const dept = await prisma.department.create({ data: { name: `Dept ${tag}`, instituteId: A.id } });
    const group = await prisma.academicGroup.create({ data: { instituteId: A.id, departmentId: dept.id, batch: "2025-2028", section: "Section A" } });
    F.A = A; F.B = B; F.group = group;
    F.adminA = await mkUser("ADMIN", A.id, "adminA");
    F.adminB = await mkUser("ADMIN", B.id, "adminB");
    F.staff1 = await mkUser("STAFF", A.id, "staff1");
    F.staff2 = await mkUser("STAFF", A.id, "staff2");
    F.s1 = await mkUser("STUDENT", A.id, "s1", { academicGroupId: group.id });
    F.s2 = await mkUser("STUDENT", A.id, "s2", { academicGroupId: group.id });
    F.sB = await mkUser("STUDENT", B.id, "sB");
    F.t = Object.fromEntries(["adminA", "adminB", "staff1", "staff2", "s1", "s2", "sB"].map((k) => [k, tokenFor(F[k])]));
    ready = true;
  } catch (e) { notReady(`fixture creation failed: ${e.message}`); }
});

test.after(async () => {
  try {
    await prisma.notification.deleteMany({ where: { userId: { in: F.users } } }).catch(() => {});
    await prisma.attendanceRecord.deleteMany({ where: { studentId: { in: F.users } } }).catch(() => {});
    await prisma.staffClassAssignment.deleteMany({ where: { staffId: { in: F.users } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: F.users } } }).catch(() => {});
    await prisma.academicGroup.deleteMany({ where: { instituteId: { in: F.institutes } } }).catch(() => {});
    await prisma.department.deleteMany({ where: { instituteId: { in: F.institutes } } }).catch(() => {});
    await prisma.institute.deleteMany({ where: { id: { in: F.institutes } } }).catch(() => {});
  } finally { await prisma.$disconnect(); }
});

const plan = (n, over = {}) => ({ subject: "Maths", topic: `Topic ${n}`, scheduleDate: `2026-11-${String(10 + n).padStart(2, "0")}`, lectureNumber: n, lectureType: "REGULAR", slotLabel: "Slot 1", ...over });

test("attendance: assignment, access, plan rules, saving, student privacy and the three-in-a-row alert", async (t) => {
  if (!ready) return t.skip("not ready");

  // 1. assignment: only inside the administrator's own institute
  const asg = await request("POST", "/api/attendance/admin/staff-assignments", F.t.adminA, { staffId: F.staff1.id, academicGroupId: F.group.id, semester: "1", subject: "Maths" });
  assert.equal(asg.status, 200, asg.raw);
  const aid = asg.body.id;
  assert.ok(aid, "the assignment has an id");
  const foreign = await request("POST", "/api/attendance/admin/staff-assignments", F.t.adminB, { staffId: F.staff1.id, academicGroupId: F.group.id, semester: "1", subject: "Physics" });
  assert.equal(foreign.status, 403, "another institute's administrator cannot assign this institute's staff and group");
  assert.equal((await request("POST", "/api/attendance/admin/staff-assignments", F.t.adminA, { staffId: F.staff1.id, academicGroupId: F.group.id, semester: "", subject: "Maths" })).status, 400, "a semester is required");
  assert.equal((await request("POST", "/api/attendance/admin/staff-assignments", F.t.staff1, { staffId: F.staff1.id, academicGroupId: F.group.id, semester: "1", subject: "Maths" })).status, 403, "staff cannot assign themselves");

  // 2. access: only the assigned staff member, and administrators of the same institute
  assert.equal((await request("GET", `/api/attendance/assignments/${aid}`, F.t.staff1)).status, 200);
  assert.equal((await request("GET", `/api/attendance/assignments/${aid}`, F.t.staff2)).status, 403, "another staff member of the same institute is not assigned");
  assert.equal((await request("GET", `/api/attendance/assignments/${aid}`, F.t.adminA)).status, 200);
  assert.notEqual((await request("GET", `/api/attendance/assignments/${aid}`, F.t.adminB)).status, 200, "another institute's administrator cannot read it");
  assert.equal((await request("GET", `/api/attendance/assignments/${aid}`, F.t.s1)).status, 403, "a student cannot");
  assert.equal((await request("GET", `/api/attendance/assignments/${aid}`, null)).status, 401);

  // 3. plans: valid input, unique lecture number, only the assigned staff member
  const p1 = await request("POST", `/api/attendance/assignments/${aid}/plans`, F.t.staff1, plan(1));
  assert.equal(p1.status, 200, p1.raw);
  assert.equal((await request("POST", `/api/attendance/assignments/${aid}/plans`, F.t.staff1, plan(1))).status, 409, "a lecture number is used once per assignment");
  assert.equal((await request("POST", `/api/attendance/assignments/${aid}/plans`, F.t.staff1, plan(2, { topic: "" }))).status, 400, "a topic is required");
  assert.equal((await request("POST", `/api/attendance/assignments/${aid}/plans`, F.t.staff1, plan(2, { lectureType: "NOPE" }))).status, 400, "an unknown lecture type is refused");
  assert.equal((await request("POST", `/api/attendance/assignments/${aid}/plans`, F.t.staff2, plan(2))).status, 403, "unassigned staff cannot plan lectures");
  const p2 = await request("POST", `/api/attendance/assignments/${aid}/plans`, F.t.staff1, plan(2));
  const p3 = await request("POST", `/api/attendance/assignments/${aid}/plans`, F.t.staff1, plan(3));
  assert.equal(p2.status, 200, p2.raw);
  assert.equal(p3.status, 200, p3.raw);

  // 4. saving: only the group's students are kept; a student of another institute is dropped; the second save replaces the first
  const mark = (planId, token, records) => request("POST", `/api/attendance/assignments/${aid}/plans/${planId}/attendance`, token, { records });
  const first = await mark(p1.body.id, F.t.staff1, [{ studentId: F.s1.id, status: "PRESENT" }, { studentId: F.s2.id, status: "ABSENT" }, { studentId: F.sB.id, status: "PRESENT" }]);
  assert.equal(first.status, 200, first.raw);
  assert.equal(first.body.records.length, 2, "the other institute's student was dropped");
  assert.ok(!first.body.records.some((r) => r.studentId === F.sB.id));
  assert.equal((await mark(p1.body.id, F.t.staff2, [{ studentId: F.s1.id, status: "PRESENT" }])).status, 403, "unassigned staff cannot save attendance");
  assert.equal((await mark(p1.body.id, F.t.s1, [{ studentId: F.s1.id, status: "PRESENT" }])).status, 403, "a student cannot mark their own attendance");
  const again = await mark(p1.body.id, F.t.staff1, [{ studentId: F.s1.id, status: "LATE" }, { studentId: F.s2.id, status: "ABSENT" }, { studentId: F.s1.id, status: "NOT-A-STATUS" }]);
  assert.equal(again.status, 200, again.raw);
  assert.equal(await prisma.attendanceRecord.count({ where: { session: { planId: p1.body.id } } }), 3, "the second save replaced the first rows (a repeated student id is kept as sent, an unknown status becomes PRESENT)");

  // 5. the student sees only their own record
  const mine = await request("GET", "/api/attendance/my-records", F.t.s1);
  assert.equal(mine.status, 200, mine.raw);
  assert.ok(mine.body.records.length >= 1 && mine.body.records.every((r) => r.subject === "Maths"));
  assert.ok(!JSON.stringify(mine.body).includes(F.s2.email), "no other student's identity in a student's records");
  const other = await request("GET", "/api/attendance/my-records", F.t.sB);
  assert.equal(other.status, 200);
  assert.equal(other.body.records.length, 0, "a student of another institute sees nothing of this group");
  assert.equal((await request("GET", "/api/attendance/my-records", F.t.staff1)).status, 403, "the student records route is for students");

  // 6. three absences in a row in one subject notify the student once
  await mark(p1.body.id, F.t.staff1, [{ studentId: F.s2.id, status: "ABSENT" }]);
  await mark(p2.body.id, F.t.staff1, [{ studentId: F.s2.id, status: "ABSENT" }]);
  await mark(p3.body.id, F.t.staff1, [{ studentId: F.s2.id, status: "ABSENT" }]);
  let alerts = [];
  for (let i = 0; i < 20 && alerts.length === 0; i++) { // the alert is sent after the save has returned
    await new Promise((r) => setTimeout(r, 250));
    alerts = (await request("GET", "/api/notifications", F.t.s2)).body.notifications?.filter((n) => n.type === "ATTENDANCE_ABSENCE_ALERT") || [];
  }
  assert.equal(alerts.length, 1, "exactly one absence alert after the third absence in a row");
  assert.match(alerts[0].message, /3 classes in a row in Maths/);
  await mark(p3.body.id, F.t.staff1, [{ studentId: F.s2.id, status: "ABSENT" }]); // saving the same state again must not alert again
  await new Promise((r) => setTimeout(r, 800));
  const after = (await request("GET", "/api/notifications", F.t.s2)).body.notifications.filter((n) => n.type === "ATTENDANCE_ABSENCE_ALERT");
  assert.equal(after.length, 1, "no duplicate alert for the same streak");
  const noAlert = (await request("GET", "/api/notifications", F.t.s1)).body.notifications.filter((n) => n.type === "ATTENDANCE_ABSENCE_ALERT");
  assert.equal(noAlert.length, 0, "a student who was not absent three times is not alerted");
});
