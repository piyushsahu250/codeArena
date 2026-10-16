// Database-backed check of the results leaderboard status rules (GET /api/tests/:id/results and the CSV export) against the real API. Creates a disposable test with
// one attempt in each situation (finished by the student, auto-submitted, still inside its own time, past its own time but not yet closed, and a legacy status), then
// proves the server labels each one correctly, ranks only the finished ones, keeps the institute boundaries and agrees with the export. Disposable data only
// (@example.invalid users, "ZZ-VERIFY leaderboard status" test and institutes), removed afterwards.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_API || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const rand = () => crypto.randomBytes(18).toString("base64url");
const MIN = 60 * 1000;

async function call(method, path, token) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, text };
}
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await res.json();
  if (!body?.token) throw new Error(`login failed for ${email}: ${res.status}`);
  return body.token;
}
async function cleanup() {
  const tests = await prisma.test.findMany({ where: { title: { startsWith: "ZZ-VERIFY leaderboard status" } }, select: { id: true } });
  const ids = tests.map((t) => t.id);
  if (ids.length) {
    await prisma.testAttempt.deleteMany({ where: { testId: { in: ids } } });
    await prisma.test.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-lbstatus-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { code: { in: ["ZZLBA", "ZZLBB"] } } });
}

async function main() {
  await cleanup();
  const A = await prisma.institute.create({ data: { name: "ZZ-VERIFY leaderboard status A", code: "ZZLBA" } });
  const B = await prisma.institute.create({ data: { name: "ZZ-VERIFY leaderboard status B", code: "ZZLBB" } });
  const pw = { staffA: rand(), staffB: rand(), stu: rand() };
  const mk = (tag, role, instituteId, password) => bcrypt.hash(password, 10).then((passwordHash) => prisma.user.create({ data: { name: `LB ${tag}`, email: `verify-lbstatus-${tag}-${Date.now()}@example.invalid`, passwordHash, role, instituteId, mustChangePassword: false } }));
  const staffA = await mk("staffA", "INSTITUTE_ADMIN", A.id, pw.staffA);
  const staffB = await mk("staffB", "INSTITUTE_ADMIN", B.id, pw.staffB);
  const stu = await mk("student", "STUDENT", A.id, pw.stu);
  const people = {};
  for (const tag of ["finished", "auto", "active", "expired", "legacy"]) people[tag] = await mk(tag, "STUDENT", A.id, rand());
  const now = Date.now();
  const test = await prisma.test.create({ data: { title: "ZZ-VERIFY leaderboard status", durationMin: 60, startTime: new Date(now - 24 * 60 * MIN), endTime: new Date(now + 24 * 60 * MIN), isPublished: true, passingMarks: 5, createdById: staffA.id, instituteId: A.id } });
  const mkAttempt = (tag, status, startedMinAgo, score) => prisma.testAttempt.create({ data: { testId: test.id, studentId: people[tag].id, status, startedAt: new Date(now - startedMinAgo * MIN), submittedAt: /SUBMITTED/.test(status) ? new Date(now - MIN) : null, totalScore: score } });
  await mkAttempt("finished", "SUBMITTED", 80, 9);
  await mkAttempt("auto", "AUTO_SUBMITTED", 100, 5);
  await mkAttempt("active", "IN_PROGRESS", 10, 7);
  await mkAttempt("expired", "IN_PROGRESS", 90, 8); // 30 minutes past its own deadline and not yet closed; its running score is the highest
  await mkAttempt("legacy", "Completed ", 70, 6); // a status this code does not recognise
  const tA = await login(staffA.email, pw.staffA);
  const tB = await login(staffB.email, pw.staffB);
  const tS = await login(stu.email, pw.stu);
  const P = `/tests/${test.id}/results`;

  check("no token is refused", (await call("GET", P, null)).status === 401);
  check("a student cannot read the leaderboard", [403, 401].includes((await call("GET", P, tS)).status));
  check("another institute's admin cannot read it", (await call("GET", P, tB)).status === 403);
  check("another institute's admin cannot export it", (await call("GET", `${P}/export?format=csv`, tB)).status === 403);

  const res = await call("GET", P, tA);
  check("the owner institute's admin gets the leaderboard", res.status === 200 && Array.isArray(res.body), String(res.status));
  const rows = Object.fromEntries((res.body || []).map((r) => [r.student.name.replace("LB ", ""), r]));
  const st = (k) => rows[k]?.lifecycle?.state;
  check("finished by the student is COMPLETED (Submitted)", st("finished") === "COMPLETED" && rows.finished.lifecycle.detail === "Submitted");
  check("auto-submitted is COMPLETED (Auto-submitted)", st("auto") === "COMPLETED" && rows.auto.lifecycle.detail === "Auto-submitted");
  check("inside its own time is IN_PROGRESS", st("active") === "IN_PROGRESS");
  check("REGRESSION: past its own time but not yet closed is TIME_EXPIRED, not In progress", st("expired") === "TIME_EXPIRED", JSON.stringify(rows.expired?.lifecycle));
  check("an unrecognised stored status is UNKNOWN, not guessed", st("legacy") === "UNKNOWN", JSON.stringify(rows.legacy?.lifecycle));
  check("only finished attempts have a rank, ordered by score", rows.finished.rank === 1 && rows.auto.rank === 2 && rows.active.rank === null && rows.expired.rank === null && rows.legacy.rank === null, JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.rank]))));
  check("the stored rows are unchanged by reading the leaderboard", (await prisma.testAttempt.count({ where: { testId: test.id, status: "IN_PROGRESS" } })) === 2);
  const completed = (res.body || []).filter((r) => r.lifecycle.state === "COMPLETED").length;
  check("the completed count equals the persisted finished attempts", completed === (await prisma.testAttempt.count({ where: { testId: test.id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } } })));

  const exp = await call("GET", `${P}/export?format=csv`, tA);
  const line = (tag) => exp.text.split("\n").find((l) => l.includes(`verify-lbstatus-${tag}-`)) || "";
  check("the export agrees: finished rows are ranked, others are not", exp.status === 200 && line("finished").startsWith("1,") && line("auto").startsWith("2,") && /^,|^"",/.test(line("expired")) && /^,|^"",/.test(line("active")), line("expired").slice(0, 60));
  check("the export shows the same lifecycle labels", exp.text.includes("Time expired, not yet closed") && exp.text.includes("In progress") && exp.text.includes("Auto-submitted") && exp.text.includes("Unknown"));
  check("the export gives no pass/fail to unfinished attempts", !/Pass|Fail/.test(line("expired")) && !/Pass|Fail/.test(line("active")));

  await cleanup();
  if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
  console.log("leaderboard status verification: all passed");
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); }).finally(() => prisma.$disconnect());
