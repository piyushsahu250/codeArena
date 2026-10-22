// Live check of two staff-scope rules that were not enforced (2026-10 audit):
//  1. GET /export/results returned EVERY test attempt in the institute to any STAFF account. Every per-test results route limits staff to tests they created or that were
//     shared with them (utils/testOwnership.js); the export centre did not, so staff could export scores and student details for tests they had no access to.
//  2. GET /search (the staff/legacy-admin branch) matched course names across ALL institutes, including another institute's private and draft courses.
// Throwaway institutes, users, tests and courses; cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null; try { body = await res.json(); } catch { /* 204 or empty */ }
  return { status: res.status, body };
}
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await res.json().catch(() => ({}))).token;
}

async function cleanup() {
  await prisma.testAttempt.deleteMany({ where: { test: { title: { startsWith: "ZZ Scope " } } } });
  await prisma.test.deleteMany({ where: { title: { startsWith: "ZZ Scope " } } }); // shares cascade
  await prisma.course.deleteMany({ where: { slug: { startsWith: "zz-scope-" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-scope-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ Scope " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const token = `zzscope${ts}`; // appears in the course name so search results can be told apart from real data
  const A = await prisma.institute.create({ data: { name: `ZZ Scope A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Scope B ${ts}` } });
  const mk = async (name, role, instituteId) => {
    const pw = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name, email: `verify-scope-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } });
    return { ...u, token: await login(u.email, pw) };
  };
  try {
    const staffA1 = await mk("Staff A1", "STAFF", A.id);
    const staffA2 = await mk("Staff A2", "STAFF", A.id);
    const staffB = await mk("Staff B", "STAFF", B.id);
    const adminA = await mk("Admin A", "INSTITUTE_ADMIN", A.id);
    const plat = await mk("Platform Admin", "ADMIN", null);
    const student = await mk("Student A", "STUDENT", A.id);
    check("test users could sign in", [staffA1, staffA2, staffB, adminA, plat, student].every((u) => !!u.token));

    const now = Date.now();
    const mkTest = (title, creator) => prisma.test.create({ data: { title: `ZZ Scope ${title} ${ts}`, startTime: new Date(now - 3600000), endTime: new Date(now + 3600000), createdById: creator.id, instituteId: A.id, isPublished: true } });
    const t1 = await mkTest("Test One", staffA1), t2 = await mkTest("Test Two", staffA2);
    for (const t of [t1, t2]) await prisma.testAttempt.create({ data: { testId: t.id, studentId: student.id, status: "SUBMITTED", totalScore: 7 } });
    const titles = (r) => (Array.isArray(r.body) ? r.body.map((x) => x.Test).filter((n) => String(n).startsWith("ZZ Scope ")) : []);
    const has = (r, t) => titles(r).includes(t.title);

    // ---- results export is limited to the tests staff may open
    const e1 = await call("/export/results?format=json", staffA1.token);
    check("staff export contains the tests they created", e1.status === 200 && has(e1, t1), `status ${e1.status}`);
    check("staff export does NOT contain another staff member's test", !has(e1, t2), JSON.stringify(titles(e1)));
    const e2 = await call("/export/results?format=json", staffA2.token);
    check("the other staff member sees their own test only", e2.status === 200 && has(e2, t2) && !has(e2, t1), JSON.stringify(titles(e2)));
    await prisma.testShare.create({ data: { testId: t2.id, staffId: staffA1.id, sharedByUserId: staffA2.id, sharedByName: staffA2.name } });
    const e1s = await call("/export/results?format=json", staffA1.token);
    check("after the test is shared with them, staff see it in the export", e1s.status === 200 && has(e1s, t1) && has(e1s, t2), JSON.stringify(titles(e1s)));
    const ea = await call("/export/results?format=json", adminA.token);
    check("an institute admin still exports every test in the institute", ea.status === 200 && has(ea, t1) && has(ea, t2), JSON.stringify(titles(ea)));
    const ep = await call("/export/results?format=json", plat.token);
    check("a platform admin still exports every institute", ep.status === 200 && has(ep, t1) && has(ep, t2), `status ${ep.status}`);
    const eb = await call("/export/results?format=json", staffB.token);
    check("staff of another institute get nothing for these tests", (eb.status === 204 || eb.status === 200) && !has(eb, t1) && !has(eb, t2), `status ${eb.status}`);

    // ---- search: another institute's private course
    await prisma.course.create({ data: { slug: `zz-scope-private-${ts}`, name: `ZZ ${token} Private Course`, instituteId: B.id, status: "DRAFT" } });
    const courseNames = (r) => ((r.body && r.body.results) || []).filter((x) => x.type === "Course").map((x) => x.label);
    const sa = await call(`/search?q=${token}`, staffA1.token);
    check("staff of institute A do not find institute B's private course by name", sa.status === 200 && courseNames(sa).length === 0, JSON.stringify(courseNames(sa)));
    const sb = await call(`/search?q=${token}`, staffB.token);
    check("staff of institute B find their own institute's course (sanity)", sb.status === 200 && courseNames(sb).some((n) => n.includes(token)), JSON.stringify(courseNames(sb)));
    const sp = await call(`/search?q=${token}`, plat.token);
    check("a platform admin still finds it", sp.status === 200 && JSON.stringify(sp.body).includes(token), `status ${sp.status}`);
    const sad = await call(`/search?q=${token}`, adminA.token);
    check("the institute admin of A does not find it either", sad.status === 200 && !JSON.stringify(sad.body).includes(token), `status ${sad.status}`);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nSTAFF SCOPE ISOLATION VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
