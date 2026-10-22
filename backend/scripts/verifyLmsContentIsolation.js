// Live check: another institute's PRIVATE course content (lessons, practice questions, lesson lists) must not be readable by id or slug.
// REGRESSION (2026-10 audit): GET /learning/lessons/:id, GET /learning/practice/:id and GET /learning/courses/:slug/modules/:moduleId/lessons returned the
// full answer key and hidden test cases (or the lesson list) of any course to ANY staff/admin account of ANY institute that knew the id or slug.
// Rules checked here: staff read their own institute's courses and global (platform-authored) courses, never another institute's; a student never reaches an
// unassigned course; an unscoped platform admin still reads everything. Throwaway institutes, users and courses; cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token) {
  const res = await fetch(`${BASE}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let text = ""; try { text = await res.text(); } catch { /* empty */ }
  return { status: res.status, text };
}
async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await res.json().catch(() => ({}))).token;
}

async function cleanup() {
  await prisma.course.deleteMany({ where: { slug: { startsWith: "zz-verify-lms-" } } }); // modules, lessons and questions cascade
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-lms-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ Verify LMS " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify LMS A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify LMS B ${ts}` } });
  const mk = async (name, role, instituteId) => {
    const pw = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name, email: `verify-lms-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } });
    return { ...u, token: await login(u.email, pw) };
  };
  const SECRET_PRIVATE = `ZZ-PRIVATE-KEY-${ts}`, SECRET_GLOBAL = `ZZ-GLOBAL-KEY-${ts}`;
  const seedCourse = async (slug, instituteId, secret) => {
    const course = await prisma.course.create({ data: { slug, name: `ZZ ${slug}`, instituteId, status: "PUBLISHED", isActive: true } });
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: "ZZ Module", order: 1, isActive: true, publishedAt: new Date() } });
    const lesson = await prisma.lesson.create({ data: { moduleId: mod.id, title: "ZZ Lesson", order: 1, content: "<p>ZZ</p>", isActive: true, publishedAt: new Date() } });
    const question = await prisma.practiceQuestion.create({ data: { lessonId: lesson.id, type: "MCQ", prompt: "ZZ question?", options: ["a", "b"], correctAnswer: secret, order: 1 } });
    return { course, mod, lesson, question };
  };
  try {
    const priv = await seedCourse(`zz-verify-lms-private-${ts}`, B.id, SECRET_PRIVATE);
    const glob = await seedCourse(`zz-verify-lms-global-${ts}`, null, SECRET_GLOBAL);
    const staffA = await mk("Staff A", "STAFF", A.id);
    const staffB = await mk("Staff B", "STAFF", B.id);
    const adminA = await mk("Admin A", "INSTITUTE_ADMIN", A.id);
    const plat = await mk("Platform Admin", "ADMIN", null);
    const stuA = await mk("Student A", "STUDENT", A.id);
    check("test users could sign in", [staffA, staffB, adminA, plat, stuA].every((u) => !!u.token));

    // ---- lesson by id (carries the answer key for staff)
    const own = await call("GET", `/learning/lessons/${priv.lesson.id}`, staffB.token);
    check("the owning institute's staff read their own private lesson (sanity)", own.status === 200 && own.text.includes(SECRET_PRIVATE), `status ${own.status}`);
    for (const [who, u] of [["staff", staffA], ["institute admin", adminA]]) {
      const r = await call("GET", `/learning/lessons/${priv.lesson.id}`, u.token);
      check(`${who} of another institute cannot read a private lesson by id`, r.status === 403 && !r.text.includes(SECRET_PRIVATE), `status ${r.status}`);
    }
    const stu = await call("GET", `/learning/lessons/${priv.lesson.id}`, stuA.token);
    check("a student of another institute cannot read it either", stu.status === 404 && !stu.text.includes(SECRET_PRIVATE), `status ${stu.status}`);
    const platLesson = await call("GET", `/learning/lessons/${priv.lesson.id}`, plat.token);
    check("an unscoped platform admin still reads any lesson", platLesson.status === 200 && platLesson.text.includes(SECRET_PRIVATE), `status ${platLesson.status}`);
    const globLesson = await call("GET", `/learning/lessons/${glob.lesson.id}`, staffA.token);
    check("staff still read a global (platform-authored) lesson", globLesson.status === 200 && globLesson.text.includes(SECRET_GLOBAL), `status ${globLesson.status}`);

    // ---- practice question by id (answer key and hidden test cases)
    const qOwn = await call("GET", `/learning/practice/${priv.question.id}`, staffB.token);
    check("the owning institute's staff read their own practice question (sanity)", qOwn.status === 200 && qOwn.text.includes(SECRET_PRIVATE), `status ${qOwn.status}`);
    const qOther = await call("GET", `/learning/practice/${priv.question.id}`, staffA.token);
    check("staff of another institute cannot read a private practice question by id", qOther.status === 403 && !qOther.text.includes(SECRET_PRIVATE), `status ${qOther.status}`);
    const qPlat = await call("GET", `/learning/practice/${priv.question.id}`, plat.token);
    check("an unscoped platform admin still reads any practice question", qPlat.status === 200, `status ${qPlat.status}`);
    const qGlob = await call("GET", `/learning/practice/${glob.question.id}`, staffA.token);
    check("staff still read a global practice question", qGlob.status === 200 && qGlob.text.includes(SECRET_GLOBAL), `status ${qGlob.status}`);

    // ---- lesson list by (guessable) course slug
    const listOwn = await call("GET", `/learning/courses/${priv.course.slug}/modules/${priv.mod.id}/lessons`, staffB.token);
    check("the owning institute's staff list their own course's lessons (sanity)", listOwn.status === 200 && listOwn.text.includes("ZZ Lesson"), `status ${listOwn.status}`);
    const listOther = await call("GET", `/learning/courses/${priv.course.slug}/modules/${priv.mod.id}/lessons`, staffA.token);
    check("staff of another institute cannot list a private course's lessons by slug", listOther.status === 404 && !listOther.text.includes("ZZ Lesson"), `status ${listOther.status}`);
    const listGlob = await call("GET", `/learning/courses/${glob.course.slug}/modules/${glob.mod.id}/lessons`, staffA.token);
    check("staff still list a global course's lessons", listGlob.status === 200 && listGlob.text.includes("ZZ Lesson"), `status ${listGlob.status}`);
    const listPlat = await call("GET", `/learning/courses/${priv.course.slug}/modules/${priv.mod.id}/lessons`, plat.token);
    check("an unscoped platform admin still lists any course's lessons", listPlat.status === 200, `status ${listPlat.status}`);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nLMS CONTENT ISOLATION VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
