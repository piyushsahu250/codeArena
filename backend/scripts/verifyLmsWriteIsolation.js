// Live check (audit batch 10): a student can WRITE progress to, submit a practice test of, and start a module coding test of ONLY a course that is Published and assigned to their
// institute or group. REGRESSION: the read routes (GET /learning/lessons/:id, the practice-question routes, the chapter Levels) already required this, but
//   * POST /learning/lessons/:id/progress and POST /learning/lessons/:id/test-submit checked only the module lock, so a student who knew a lesson id of another institute's private
//     course (or of one never assigned to them, or not yet published) could mark it complete (earning XP) and read back every correct answer and explanation of its practice test;
//   * GET /module-coding/module/:id and POST /module-coding/module/:id/start (the module-direct coding test) relied on "lessons complete", which the first point let anyone satisfy.
// Throwaway institutes, users and a course; cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const PREFIX = "zz-verify-lmsw-";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let text = ""; try { text = await res.text(); } catch { /* empty */ }
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
}
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await res.json().catch(() => ({}))).token;
}

async function cleanup() {
  await prisma.course.deleteMany({ where: { slug: { startsWith: PREFIX } } }); // modules, lessons, practice questions, tests, progress and assignments cascade
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-lmsw-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ Verify LMSW " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  try {
    const A = await prisma.institute.create({ data: { name: `ZZ Verify LMSW A ${ts}` } });
    const B = await prisma.institute.create({ data: { name: `ZZ Verify LMSW B ${ts}` } });
    const mk = async (name, role, instituteId) => {
      const pw = crypto.randomBytes(18).toString("base64url");
      const u = await prisma.user.create({ data: { name, email: `verify-lmsw-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } });
      return { ...u, token: await login(u.email, pw) };
    };
    const adminB = await mk("Admin B", "INSTITUTE_ADMIN", B.id);
    const stuA = await mk("Student A", "STUDENT", A.id);
    const stuB = await mk("Student B", "STUDENT", B.id);
    check("test users could sign in", [adminB, stuA, stuB].every((u) => !!u.token));

    // B's private course, assigned to B only: a module with an ordinary lesson, a practice-test lesson whose answer explanation is the secret, and a module-direct coding test.
    const SECRET = `ZZ-SECRET-EXPLANATION-${ts}`;
    const course = await prisma.course.create({ data: { slug: `${PREFIX}${ts}`, name: `ZZ lmsw ${ts}`, instituteId: B.id, status: "PUBLISHED", isActive: true } });
    await prisma.courseInstituteAssignment.create({ data: { courseId: course.id, instituteId: B.id, assignedByUserId: adminB.id, assignedByName: "Verify" } });
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: "ZZ Module", order: 1, isActive: true, publishedAt: new Date() } });
    const lesson = await prisma.lesson.create({ data: { moduleId: mod.id, title: "ZZ Lesson", order: 1, content: "<p>ZZ</p>", isActive: true, publishedAt: new Date() } });
    const practice = await prisma.lesson.create({ data: { moduleId: mod.id, title: "ZZ Practice Test", order: 2, content: "<p>ZZ</p>", isActive: true, publishedAt: new Date(), isModuleTest: true } });
    await prisma.practiceQuestion.create({ data: { lessonId: practice.id, type: "MCQ", prompt: "ZZ question?", options: ["a", "b"], correctAnswer: 1, explanation: SECRET, order: 1 } });
    await prisma.moduleCodingTest.create({ data: { moduleId: mod.id, title: "ZZ Module Test", isActive: true, publishedAt: new Date(), questionCount: 1 } });
    const progressOf = (studentId) => prisma.lessonProgress.count({ where: { studentId } });

    // ---- the assigned student still works (sanity)
    const okProgress = await call("POST", `/learning/lessons/${lesson.id}/progress`, stuB.token, { status: "IN_PROGRESS" });
    check("a student of the assigned institute can record progress on its lesson", okProgress.status === 200, `status ${okProgress.status}`);
    const okSubmit = await call("POST", `/learning/lessons/${practice.id}/test-submit`, stuB.token, { answers: {} });
    check("and can submit its practice test and get the review", okSubmit.status === 200 && okSubmit.text.includes(SECRET), `status ${okSubmit.status}`);
    const okCoding = await call("GET", `/module-coding/module/${mod.id}`, stuB.token);
    check("and sees its module coding test", okCoding.status === 200 && okCoding.json && okCoding.json.exists === true, `status ${okCoding.status} ${okCoding.text.slice(0, 80)}`);

    // ---- a student of another institute (course not assigned to them) gets nothing and writes nothing
    const noProgress = await call("POST", `/learning/lessons/${lesson.id}/progress`, stuA.token, { status: "COMPLETED" });
    check("progress on an unassigned course's lesson is refused as 'not found'", noProgress.status === 404, `status ${noProgress.status}`);
    const noSubmit = await call("POST", `/learning/lessons/${practice.id}/test-submit`, stuA.token, { answers: {} });
    check("its practice test is refused too, and no answer or explanation comes back", noSubmit.status === 404 && !noSubmit.text.includes(SECRET), `status ${noSubmit.status}`);
    check("nothing was written for that student", (await progressOf(stuA.id)) === 0, `${await progressOf(stuA.id)} rows`);

    // The module coding test must hold even if "lessons complete" is somehow already true for that student (the old exploit, or a course unassigned after they finished it).
    await prisma.lessonProgress.createMany({ data: [lesson, practice].map((l) => ({ studentId: stuA.id, lessonId: l.id, status: "COMPLETED", completedAt: new Date() })) });
    const peek = await call("GET", `/module-coding/module/${mod.id}`, stuA.token);
    check("the module coding test of an unassigned course is 'not found', even with every lesson marked complete", peek.status === 200 && peek.json && peek.json.exists === false && !peek.text.includes("ZZ Module Test"), `status ${peek.status} ${peek.text.slice(0, 80)}`);
    const start = await call("POST", `/module-coding/module/${mod.id}/start`, stuA.token);
    check("starting it is refused as 'not found'", start.status === 404, `status ${start.status} ${start.text.slice(0, 80)}`);
    const attempts = await prisma.moduleCodingAttempt.count({ where: { studentId: stuA.id } });
    check("and no attempt was created", attempts === 0, `${attempts}`);

    // ---- access follows the ASSIGNMENT, not the institute that owns the course
    await prisma.courseInstituteAssignment.create({ data: { courseId: course.id, instituteId: A.id, assignedByUserId: adminB.id, assignedByName: "Verify" } });
    const afterAssign = await call("POST", `/learning/lessons/${lesson.id}/progress`, stuA.token, { status: "COMPLETED" });
    check("once the course is assigned to the student's institute, the same call works", afterAssign.status === 200, `status ${afterAssign.status}`);
    const seen = await call("GET", `/module-coding/module/${mod.id}`, stuA.token);
    check("and so does the module coding test", seen.status === 200 && seen.json && seen.json.exists === true, `status ${seen.status}`);
    await prisma.courseInstituteAssignment.deleteMany({ where: { courseId: course.id, instituteId: A.id } });

    // ---- a course that is not Published is closed to writes, even for the assigned institute
    await prisma.course.update({ where: { id: course.id }, data: { status: "DRAFT" } });
    const draftProgress = await call("POST", `/learning/lessons/${lesson.id}/progress`, stuB.token, { status: "COMPLETED" });
    const draftSubmit = await call("POST", `/learning/lessons/${practice.id}/test-submit`, stuB.token, { answers: {} });
    check("progress and practice-test submission are refused while the course is not Published", draftProgress.status === 404 && draftSubmit.status === 404 && !draftSubmit.text.includes(SECRET), `${draftProgress.status}/${draftSubmit.status}`);
    await prisma.course.update({ where: { id: course.id }, data: { status: "PUBLISHED" } });
  } finally {
    await cleanup();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(failures === 0 ? "\nLMS WRITE ISOLATION VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
