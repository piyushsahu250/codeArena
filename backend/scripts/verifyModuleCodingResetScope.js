// Live check: resetting a student's module-coding attempts ("manual approval of additional attempts") by STAFF is limited to students in the classes (academic groups: batch,
// department, section) assigned to that staff member, on the server, not only in the page. REGRESSION: DELETE /module-coding/admin/tests/:id/students/:studentId/attempts
// checked only that the student belonged to the staff member's INSTITUTE, so any staff member could grant extra attempts to any student of the institute.
// An institute admin is not scoped by class; attempts of other tests and of other students are untouched; the grant is audited; a refusal is audited too.
// Throwaway institutes, users, a course and attempts (prefix verify-mcrs-); cleans up after itself. Needs the API on localhost:4000 (or VERIFY_BASE).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const PREFIX = "verify-mcrs-";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text().catch(() => "");
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
async function signIn(email, password) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await res.json().catch(() => ({}))).token;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX, endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { studentId: { in: ids } }] } });
  await prisma.course.deleteMany({ where: { slug: { startsWith: PREFIX } } }); // modules, tests and attempts cascade
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.academicGroup.deleteMany({ where: { institute: { name: { startsWith: "ZZ Verify MCRS " } } } });
  await prisma.department.deleteMany({ where: { institute: { name: { startsWith: "ZZ Verify MCRS " } } } });
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ Verify MCRS " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  try {
    const A = await prisma.institute.create({ data: { name: `ZZ Verify MCRS A ${ts}` } });
    const B = await prisma.institute.create({ data: { name: `ZZ Verify MCRS B ${ts}` } });
    const dept = await prisma.department.create({ data: { name: "ZZ Dept", instituteId: A.id } });
    const g1 = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section A" } });
    const g2 = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section B" } });
    const mk = async (name, role, instituteId, extra = {}) => {
      const pw = crypto.randomBytes(18).toString("base64url");
      const u = await prisma.user.create({ data: { name, email: `${PREFIX}${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false, ...extra } });
      return { ...u, token: await signIn(u.email, pw) };
    };
    const staff = await mk("Staff One", "STAFF", A.id);
    const otherStaff = await mk("Staff Two", "STAFF", A.id);
    const instAdmin = await mk("Inst Admin", "INSTITUTE_ADMIN", A.id);
    const inClass = await mk("Student InClass", "STUDENT", A.id, { academicGroupId: g1.id });
    const otherClass = await mk("Student OtherClass", "STUDENT", A.id, { academicGroupId: g2.id });
    const noClass = await mk("Student NoClass", "STUDENT", A.id);
    const foreign = await mk("Student Foreign", "STUDENT", B.id);
    check("test users could sign in", [staff, otherStaff, instAdmin, inClass, otherClass, noClass, foreign].every((u) => !!u.token));
    await prisma.staffClassAssignment.create({ data: { staffId: staff.id, academicGroupId: g1.id } });

    const course = await prisma.course.create({ data: { slug: `${PREFIX}${ts}`, name: `ZZ mcrs ${ts}`, instituteId: A.id, status: "PUBLISHED", isActive: true } });
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: "ZZ Module", order: 1, isActive: true, publishedAt: new Date() } });
    const mod2 = await prisma.courseModule.create({ data: { courseId: course.id, title: "ZZ Module 2", order: 2, isActive: true, publishedAt: new Date() } });
    const test = await prisma.moduleCodingTest.create({ data: { moduleId: mod.id, title: "ZZ Test", isActive: true, publishedAt: new Date(), questionCount: 1, maxAttempts: 3 } });
    const otherTest = await prisma.moduleCodingTest.create({ data: { moduleId: mod2.id, title: "ZZ Other Test", isActive: true, publishedAt: new Date(), questionCount: 1, maxAttempts: 3 } });
    const attemptsOf = (studentId, testId = test.id) => prisma.moduleCodingAttempt.count({ where: { moduleCodingTestId: testId, studentId } });
    for (const s of [inClass, otherClass, noClass, foreign]) {
      for (const t of [test, otherTest]) await prisma.moduleCodingAttempt.create({ data: { moduleCodingTestId: t.id, studentId: s.id, attemptNumber: 1, status: "SUBMITTED", submittedAt: new Date() } });
    }
    const reset = (token, studentId, body = { mode: "full", reason: "verify" }) => call("DELETE", `/module-coding/admin/tests/${test.id}/students/${studentId}/attempts`, token, body);

    // ---- a student in a class assigned to the staff member
    const ok = await reset(staff.token, inClass.id, { mode: "full", reason: "Network failure during the test" });
    check("staff can reset a student of an assigned class", ok.status === 200, `status ${ok.status} ${ok.text.slice(0, 100)}`);
    check("that student's attempts on this test are gone", (await attemptsOf(inClass.id)) === 0);
    check("their attempts on ANOTHER test are untouched", (await attemptsOf(inClass.id, otherTest.id)) === 1);

    // ---- everyone else
    const r2 = await reset(staff.token, otherClass.id);
    check("a student of another class of the same institute is refused (403)", r2.status === 403, `status ${r2.status}`);
    check("and nothing was deleted", (await attemptsOf(otherClass.id)) === 1);
    const r3 = await reset(staff.token, noClass.id);
    check("a student with no class is refused (403)", r3.status === 403 && (await attemptsOf(noClass.id)) === 1, `status ${r3.status}`);
    const r4 = await reset(staff.token, foreign.id);
    check("a student of another institute is refused (403)", r4.status === 403 && (await attemptsOf(foreign.id)) === 1, `status ${r4.status}`);
    const r5 = await reset(otherStaff.token, inClass.id);
    check("staff with no assignment cannot reset even the student the first staff member can", r5.status === 403, `status ${r5.status}`);
    const r6 = await reset(null, otherClass.id);
    check("anonymous: 401", r6.status === 401);
    const r7 = await reset(otherClass.token, otherClass.id);
    check("a student cannot reset their own attempts: 403", r7.status === 403 && (await attemptsOf(otherClass.id)) === 1, `status ${r7.status}`);
    const custom = await reset(staff.token, otherClass.id, { mode: "custom", attemptsRemaining: 3, reason: "x" });
    check("the 'custom' mode is scoped the same way", custom.status === 403 && (await attemptsOf(otherClass.id)) === 1, `status ${custom.status}`);

    // ---- an institute admin is not scoped by class, but is by institute
    const adminOk = await reset(instAdmin.token, otherClass.id, { mode: "full", reason: "Approved by the institute" });
    check("an institute admin can reset a student of any class of the institute", adminOk.status === 200 && (await attemptsOf(otherClass.id)) === 0, `status ${adminOk.status}`);
    const adminForeign = await reset(instAdmin.token, foreign.id);
    check("but not a student of another institute", adminForeign.status === 403 && (await attemptsOf(foreign.id)) === 1, `status ${adminForeign.status}`);

    // ---- audit
    await sleep(900);
    const granted = await prisma.auditLog.findMany({ where: { action: "REATTEMPT_GRANTED", studentId: { in: [inClass.id, otherClass.id] } }, select: { adminId: true, studentId: true, details: true, createdAt: true } });
    const forInClass = granted.find((a) => a.studentId === inClass.id);
    check("the grant is audited: who, for which student, when and why", !!forInClass && forInClass.adminId === staff.id && forInClass.details.reason === "Network failure during the test" && !!forInClass.createdAt && forInClass.details.studentName === "Student InClass", JSON.stringify(forInClass && forInClass.details).slice(0, 160));
    check("only the two successful resets were audited as grants", granted.length === 2, `${granted.length}`);
    const refused = await prisma.auditLog.count({ where: { action: "UNAUTHORIZED_ACCESS_ATTEMPT", adminId: staff.id } });
    check("the refused attempts by the staff member are audited as unauthorized access", refused >= 3, `${refused} rows`);
  } finally {
    await cleanup().catch((err) => console.error("cleanup failed:", err.message));
  }
  console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
