// End-to-end verification of independent publishing across Course > Module > Chapter > Reference Material /
// Coding Level > Coding Question, run against the live API on this instance. Creates a disposable institute-admin,
// student, academic group and course (random passwords, @example.invalid emails, a course assigned ONLY to the
// disposable group so no real student can see it), exercises every rule, then deletes everything it created.
// Also proves nothing real was lost: global counts of progress/attempt rows are compared before and after.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
async function login(email, password) {
  const r = await call("POST", "/auth/login", null, { email, password });
  if (!r.body?.token) throw new Error(`login failed ${r.status}`);
  return r.body.token;
}

async function main() {
  const groups = await prisma.academicGroup.findMany({ where: { isActive: true } });
  const off = await prisma.featureSetting.findMany({ where: { featureKey: { in: ["lms", "compiler"] }, enabled: false } });
  const offIds = new Set(off.map((f) => f.instituteId));
  const real = groups.find((g) => !offIds.has(g.instituteId));
  if (!real) throw new Error("no usable institute");
  const { instituteId, departmentId } = real;

  const before = { progress: await prisma.lessonProgress.count(), attempts: await prisma.moduleCodingAttempt.count(), subs: await prisma.moduleCodingSubmission.count() };

  const ts = Date.now();
  const group = await prisma.academicGroup.create({ data: { instituteId, departmentId, batch: "ZZ-VERIFY", section: `ZZ-${ts}` } });
  const adminPw = rand(), stuPw = rand();
  const admin = await prisma.user.create({ data: { name: "Verify Publish Admin", email: `verify-pub-admin-${ts}@example.invalid`, passwordHash: await bcrypt.hash(adminPw, 10), role: "INSTITUTE_ADMIN", instituteId, mustChangePassword: false } });
  const student = await prisma.user.create({ data: { name: "Verify Publish Student", email: `verify-pub-student-${ts}@example.invalid`, passwordHash: await bcrypt.hash(stuPw, 10), role: "STUDENT", instituteId, academicGroupId: group.id, mustChangePassword: false } });
  const course = await prisma.course.create({ data: { name: `ZZ Verify Publish ${ts}`, slug: `zz-verify-publish-${ts}`, status: "PUBLISHED", isActive: true, instituteId } });
  await prisma.courseAcademicGroupAssignment.create({ data: { courseId: course.id, academicGroupId: group.id } });

  try {
    const A = await login(admin.email, adminPw);
    const S = await login(student.email, stuPw);
    const studentCourse = async () => (await call("GET", `/learning/courses/${course.slug}`, S)).body;

    // 1. new module under a published course starts Draft and is invisible
    const mod = (await call("POST", `/learning/courses/${course.id}/modules`, A, { title: "M1" })).body;
    check("new module under published course is Draft", mod.isActive === false);
    check("student does not see Draft module", (await studentCourse()).modules.length === 0);

    // 2. publishing the module shows it; course publish state is untouched
    const pm = await call("POST", `/learning/publish/module/${mod.id}/publish`, A);
    check("publish module", pm.body?.publishStatus === "PUBLISHED", JSON.stringify(pm.body));
    check("student now sees module", (await studentCourse()).modules.length === 1);

    // 3. chapter + lesson start Draft; publishing a parent never publishes a child
    const ch = (await call("POST", `/learning/modules/${mod.id}/chapters`, A, { title: "C1" })).body;
    check("new chapter under published module is Draft", ch.isActive === false);
    const les = (await call("POST", `/learning/chapters/${ch.id}/lessons`, A, { title: "L1", content: "x" })).body;
    check("new reference item under chapter is Draft", les.isActive === false);
    check("Draft lesson hidden from student lesson list", (await call("GET", `/learning/courses/${course.slug}/modules/${mod.id}/lessons`, S)).body.length === 0);
    check("Draft lesson 404 for student", (await call("GET", `/learning/lessons/${les.id}`, S)).status === 404);
    await call("POST", `/learning/publish/lesson/${les.id}/publish`, A);
    check("published lesson under DRAFT chapter still hidden (chain rule)", (await call("GET", `/learning/lessons/${les.id}`, S)).status === 404);
    await call("POST", `/learning/publish/chapter/${ch.id}/publish`, A);
    check("lesson visible once whole chain published", (await call("GET", `/learning/lessons/${les.id}`, S)).status === 200);
    const lessonRow = await prisma.lesson.findUnique({ where: { id: les.id } });
    const chapterRow = await prisma.chapter.findUnique({ where: { id: ch.id } });
    check("publishing chapter did not touch sibling states", lessonRow.isActive === true && chapterRow.isActive === true);
    const les2 = (await call("POST", `/learning/chapters/${ch.id}/lessons`, A, { title: "L2", content: "y" })).body;
    check("second lesson under published chapter stays Draft", les2.isActive === false && (await call("GET", `/learning/lessons/${les2.id}`, S)).status === 404);

    // 4. progress exists, then unpublish/archive must keep it
    await call("POST", `/learning/lessons/${les.id}/progress`, S, { status: "COMPLETED" });
    const progressRows = await prisma.lessonProgress.count({ where: { studentId: student.id } });
    check("student progress recorded", progressRows === 1);

    // 5. coding level + question
    const lvl = (await call("POST", `/module-coding/admin/chapter/${ch.id}/levels`, A, { title: "Level 1", questionCount: 1, maxAttempts: 5 })).body;
    check("new level under published chapter is Draft", lvl.isActive === false);
    const tcs = [...Array(2).fill(0).map((_, i) => ({ input: String(i), expected: String(i), isHidden: false })), ...Array(5).fill(0).map((_, i) => ({ input: String(i + 9), expected: String(i + 9), isHidden: true }))];
    const q = (await call("POST", `/module-coding/admin/tests/${lvl.id}/questions`, A, { title: "Echo", description: "Print the number.", testCases: tcs })).body;
    check("new coding question is Draft", q.questionStatus === "DRAFT", q.questionStatus);
    const levels = async () => (await call("GET", `/module-coding/module/${mod.id}/levels`, S)).body;
    check("student sees no Draft level", (await levels()).length === 0);
    await call("POST", `/learning/publish/question/${q.id}/publish`, A);
    check("published question inside DRAFT level is still hidden", (await levels()).length === 0);
    const start0 = await call("POST", `/module-coding/level/${lvl.id}/start`, S);
    check("cannot start a Draft level", start0.status === 404, String(start0.status));
    await call("POST", `/learning/publish/level/${lvl.id}/publish`, A);
    const lv = await levels();
    check("level visible after explicit publish", lv.length === 1 && lv[0].questionCount === 1);

    // 6. start an attempt, THEN unpublish the level mid-attempt
    const start = await call("POST", `/module-coding/level/${lvl.id}/start`, S);
    check("student can start a Published level", start.status === 200 && !!start.body?.attemptId, String(start.status));
    const attemptId = start.body?.attemptId;
    const un = await call("POST", `/learning/publish/level/${lvl.id}/unpublish`, A);
    check("unpublish level warns about in-progress attempt", (un.body?.warnings || []).length === 1, JSON.stringify(un.body?.warnings));
    check("unpublished level disappears for students", (await levels()).length === 0);
    const resume = await call("POST", `/module-coding/level/${lvl.id}/start`, S);
    check("in-progress attempt can still be resumed", resume.status === 200 && resume.body?.attemptId === attemptId, String(resume.status));
    const fin = await call("POST", `/module-coding/attempts/${attemptId}/finalize`, S, { reason: "manual" });
    check("in-progress attempt can still be finalized", fin.status === 200, String(fin.status));
    const fresh = await call("POST", `/module-coding/level/${lvl.id}/start`, S);
    check("no NEW attempt on an unpublished level", fresh.status === 404, String(fresh.status));
    check("attempt row kept", (await prisma.moduleCodingAttempt.count({ where: { id: attemptId } })) === 1);

    // 7. archive chapter: hidden from students, nothing deleted; restore comes back as Draft
    await call("POST", `/learning/publish/chapter/${ch.id}/archive`, A);
    check("archived chapter hides its lesson", (await call("GET", `/learning/lessons/${les.id}`, S)).status === 404);
    check("progress preserved after archive", (await prisma.lessonProgress.count({ where: { studentId: student.id } })) === progressRows);
    const rs = await call("POST", `/learning/publish/chapter/${ch.id}/restore`, A);
    check("restore returns Draft (never auto-republishes)", rs.body?.publishStatus === "DRAFT", JSON.stringify(rs.body));

    // 8. unpublishing the course hides everything but keeps data
    await call("POST", `/learning/publish/chapter/${ch.id}/publish`, A);
    check("course unpublish hides content", (await call("POST", `/learning/publish/course/${course.id}/unpublish`, A)).body?.publishStatus === "DRAFT" && (await call("GET", `/learning/lessons/${les.id}`, S)).status === 404);
    const modAfter = await prisma.courseModule.findUnique({ where: { id: mod.id } });
    check("course unpublish did not rewrite module state", modAfter.isActive === true);

    // 9. other institute's admin-less role checks: student cannot publish
    check("student cannot call publish endpoint", (await call("POST", `/learning/publish/module/${mod.id}/publish`, S)).status === 403);
  } finally {
    await prisma.course.delete({ where: { id: course.id } }).catch((e) => console.log("cleanup course:", e.message));
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, student.id] } } }).catch((e) => console.log("cleanup users:", e.message));
    await prisma.academicGroup.delete({ where: { id: group.id } }).catch((e) => console.log("cleanup group:", e.message));
  }
  const after = { progress: await prisma.lessonProgress.count(), attempts: await prisma.moduleCodingAttempt.count(), subs: await prisma.moduleCodingSubmission.count() };
  check("no real student data lost (progress/attempts/submissions unchanged)", before.progress === after.progress && before.attempts === after.attempts && before.subs === after.subs, JSON.stringify({ before, after }));
  console.log(failures === 0 ? "\nPUBLISH HIERARCHY VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
