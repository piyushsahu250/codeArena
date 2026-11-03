// Real HTTP integration test for the seeded "Python Zero to Hero" course: seed -> invisible while Draft -> publish through the admin API
// -> invisible until assigned -> visible only to the assigned institute -> lesson content, quiz grading, coding judge and progress
// persistence as a student -> no answer/hidden-case leakage -> re-seed is idempotent. Talks to the API on localhost:4000 and removes
// everything it created. With REQUIRE_INTEGRATION=1 (CI) a missing prerequisite FAILS the file instead of skipping it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { spawnSync } = require("child_process");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { seedPythonCourse, SLUG } = require("../scripts/seedPythonCourse");

const PORT = 4000;
const tag = `pycourse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let lastCall = "";
const strictEqual = assert.equal;
assert.equal = (a, b, m) => strictEqual(a, b, m || `last call: ${lastCall}`);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: "localhost", port: PORT, path, method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let chunks = "";
      res.on("data", (d) => (chunks += d));
      res.on("end", () => { lastCall = `${method} ${path} -> ${res.statusCode} ${chunks.slice(0, 300)}`; try { resolve({ status: res.statusCode, body: JSON.parse(chunks || "{}") }); } catch { resolve({ status: res.statusCode, body: {} }); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const tokenFor = (u) => jwt.sign({ id: u.id, role: u.role, email: u.email, name: u.name }, process.env.JWT_SECRET, { expiresIn: "30m" });

const F = { users: [], institutes: [], preExisting: false };
let ready = false, admin, adminT, studentA, studentAT, studentB, studentBT, course;
const haveReason = (r) => { ready = false; if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(`pythonCourse integration prerequisites missing: ${r}`); };
const mkUser = async (role, instituteId, label) => {
  const u = await prisma.user.create({ data: { name: `${label} ${tag}`, email: `${tag}-${label}@example.test`, passwordHash: "not-a-real-hash", role, instituteId, registrationNumber: role === "STUDENT" ? `PRN-${tag}-${label}`.slice(0, 40) : null } });
  F.users.push(u.id);
  return u;
};

test.before(async () => {
  let up = false;
  try { up = (await request("GET", "/api/health", null)).status === 200; } catch { up = false; }
  if (!up) return haveReason("the API is not answering on localhost:4000");
  if (!process.env.JWT_SECRET) return haveReason("JWT_SECRET is not set");
  F.preExisting = !!(await prisma.course.findUnique({ where: { slug: SLUG } }));
  if (F.preExisting) return haveReason(`a course with slug ${SLUG} already exists; refusing to touch real content`);
  const A = await prisma.institute.create({ data: { name: `${tag}-A` } });
  const B = await prisma.institute.create({ data: { name: `${tag}-B` } });
  F.institutes.push(A.id, B.id);
  F.A = A.id;
  admin = await mkUser("SUPER_ADMIN", null, "admin");
  studentA = await mkUser("STUDENT", A.id, "sa");
  studentB = await mkUser("STUDENT", B.id, "sb");
  [adminT, studentAT, studentBT] = [admin, studentA, studentB].map(tokenFor);
  ready = true;
});

test.after(async () => {
  try {
    if (!F.preExisting) {
      const c = await prisma.course.findUnique({ where: { slug: SLUG }, select: { id: true } });
      if (c) {
        await prisma.certificate.deleteMany({ where: { OR: [{ courseId: c.id }, { studentId: { in: F.users } }] } }).catch((e) => console.error("cleanup certificates:", e.message));
        await prisma.question.deleteMany({ where: { moduleCodingTest: { OR: [{ chapter: { module: { courseId: c.id } } }, { module: { courseId: c.id } }] } } }).catch(() => {});
        await prisma.course.delete({ where: { id: c.id } }).catch((e) => console.error("cleanup course:", e.message));
      }
    }
    await prisma.user.deleteMany({ where: { id: { in: F.users } } }).catch(() => {});
    await prisma.institute.deleteMany({ where: { id: { in: F.institutes } } }).catch(() => {});
  } finally { await prisma.$disconnect(); }
});

const needs = (t) => { if (!ready) { t.skip("prerequisites missing"); return false; } return true; };
const quiet = () => {};

test("seeding creates a Draft, unassigned course that no student can see", async (t) => {
  if (!needs(t)) return;
  const stats = await seedPythonCourse(prisma, { log: quiet });
  assert.ok(stats.created > 40, "should create course, module, chapter, lessons, questions and an assessment");
  course = await prisma.course.findUnique({ where: { slug: SLUG }, include: { modules: { orderBy: { order: "asc" }, include: { chapters: { orderBy: { order: "asc" }, include: { topics: { orderBy: { order: "asc" } }, levels: true } } } } } });
  assert.equal(course.status, "DRAFT");
  assert.equal(course.isActive, false);
  assert.equal(await prisma.courseInstituteAssignment.count({ where: { courseId: course.id } }), 0);
  const mod = course.modules[0], ch = mod.chapters[0];
  assert.equal(mod.isActive, false); assert.equal(ch.isActive, false);
  const teaching = ch.topics.filter((l) => !l.isModuleTest);
  assert.ok(teaching.length >= 6 && ch.topics.every((l) => !l.isActive) && teaching.every((l) => (l.content || "").includes("<svg")), "all lessons Draft, each teaching lesson carrying real content with a diagram");
  assert.equal(ch.topics.filter((l) => l.isModuleTest).length, 1, "the module ends with exactly one practice test");
  assert.ok(ch.topics.find((l) => l.isModuleTest).order >= teaching.length, "and it comes after the teaching lessons");
  assert.equal(ch.levels[0].isActive, false);
  // Phase 6: 21 unpublished projects (15 mini, 6 major), each with at least three tasks, some auto-judged and some manual
  const projects = await prisma.courseProject.findMany({ where: { module: { courseId: course.id } }, include: { tasks: true } });
  assert.equal(projects.length, 21);
  assert.equal(projects.filter((p) => p.level === "COURSE_PROJECT").length, 6);
  assert.equal(projects.filter((p) => p.level === "MINI_PROJECT").length, 15);
  assert.ok(projects.every((p) => !p.isActive && p.tasks.length >= 3 && Array.isArray(p.requirements) && p.requirements.length >= 4), "projects are Draft and complete");
  const allTasks = projects.flatMap((p) => p.tasks);
  assert.ok(allTasks.some((tk) => Array.isArray(tk.testCases) && tk.testCases.length) && allTasks.some((tk) => !tk.testCases), "both judged and manual project tasks exist");
  const r = await request("GET", `/api/learning/courses/${SLUG}`, studentAT);
  assert.equal(r.status, 404, "a Draft course must not be visible to a student");
});

test("re-running the seed creates nothing and changes nothing", async (t) => {
  if (!needs(t)) return;
  const before = await prisma.lesson.count({ where: { module: { courseId: course.id } } });
  const stats = await seedPythonCourse(prisma, { log: quiet });
  assert.equal(stats.created, 0);
  assert.equal(await prisma.lesson.count({ where: { module: { courseId: course.id } } }), before);
});

test("admin publishes the content, and the course stays invisible until it is assigned", async (t) => {
  if (!needs(t)) return;
  const mod = course.modules[0], ch = mod.chapters[0];
  const pub = async (entity, id) => assert.equal((await request("POST", `/api/learning/publish/${entity}/${id}/publish`, adminT)).status, 200);
  await pub("course", course.id);
  await pub("module", mod.id);
  await pub("chapter", ch.id);
  for (const l of ch.topics) await pub("lesson", l.id);
  await pub("level", ch.levels[0].id);
  const r = await request("GET", `/api/learning/courses/${SLUG}`, studentAT);
  assert.equal(r.status, 404, "published but unassigned = still invisible");
});

test("only the assigned institute's student can open the course and lessons", async (t) => {
  if (!needs(t)) return;
  const asg = await request("POST", `/api/learning/courses/${course.id}/assignments`, adminT, { instituteIds: [F.A] });
  assert.equal(asg.status, 200);
  assert.equal((await request("GET", `/api/learning/courses/${SLUG}`, studentAT)).status, 200);
  assert.equal((await request("GET", `/api/learning/courses/${SLUG}`, studentBT)).status, 404, "another institute's student must not see it");
  const lessonId = course.modules[0].chapters[0].topics[0].id;
  assert.equal((await request("GET", `/api/learning/lessons/${lessonId}`, studentBT)).status, 404);
  const ok = await request("GET", `/api/learning/lessons/${lessonId}`, studentAT);
  assert.equal(ok.status, 200);
  assert.match(ok.body.lesson.content, /<svg[^>]*role="img"/);
  assert.match(ok.body.lesson.content, /Interview perspective/);
});

test("students never receive answers or hidden test cases", async (t) => {
  if (!needs(t)) return;
  for (const l of course.modules[0].chapters[0].topics) {
    const r = await request("GET", `/api/learning/lessons/${l.id}`, studentAT);
    assert.equal(r.status, 200);
    const raw = JSON.stringify(r.body);
    assert.ok(!raw.includes("correctAnswer"), "no correctAnswer key in the student payload");
    for (const q of r.body.questions) if (q.type === "CODING") {
      // A fixed-output program has one distinct sample; every sample sent must be visible and none may repeat.
      assert.ok(q.testCases.length >= 1 && q.testCases.every((c) => !c.isHidden), "only sample cases are sent");
      assert.equal(new Set(q.testCases.map((c) => `${c.input}\u0000${c.expected}`)).size, q.testCases.length, "no sample case is shown twice");
    }
  }
});

test("quiz grading, progress persistence and the real coding judge", async (t) => {
  if (!needs(t)) return;
  const lessonId = course.modules[0].chapters[0].topics[0].id;
  const lesson = await request("GET", `/api/learning/lessons/${lessonId}`, studentAT);
  const mcq = lesson.body.questions.find((q) => q.type === "MCQ");
  const wrong = await request("POST", `/api/learning/practice/${mcq.id}/check`, studentAT, { answer: 99 });
  assert.equal(wrong.body.correct, false);
  // The student sees shuffled options; the server tells us which shuffled index is right only after an attempt, so find it.
  let solved = false, solvedAt = -1;
  for (let i = 0; i < mcq.options.length && !solved; i++) { solved = (await request("POST", `/api/learning/practice/${mcq.id}/check`, studentAT, { answer: i })).body.correct === true; if (solved) solvedAt = i; }
  assert.ok(solved, "exactly one option must grade as correct");
  // A wrong answer is answered with the correct one (the page shows it): it must be the position of the option the student can actually click, in the order they were shown.
  assert.equal(Number(wrong.body.correctAnswer), solvedAt, "the correct answer in a wrong-answer response is the option that grades correct");
  assert.equal(typeof wrong.body.explanation, "string", "and the explanation comes with it");

  const done = await request("POST", `/api/learning/lessons/${lessonId}/progress`, studentAT, { status: "COMPLETED" });
  assert.equal(done.status, 200);
  const again = await request("GET", `/api/learning/lessons/${lessonId}`, studentAT);
  assert.equal(again.body.progress.status, "COMPLETED", "progress must persist across requests");

  const py = spawnSync("python3", ["--version"]);
  if (py.status !== 0) return console.log("python3 not available here; judge step skipped");
  const task = lesson.body.questions.find((q) => q.type === "CODING");
  const solution = (await prisma.practiceQuestion.findUnique({ where: { id: task.id } })).testCases;
  const expected = solution.find((c) => c.isHidden).expected;
  const print = expected.split("\n").map((ln) => `print(${JSON.stringify(ln)})`).join("\n");
  const ok = await request("POST", `/api/learning/practice/${task.id}/submit`, studentAT, { language: "python", code: print });
  assert.equal(ok.body.verdict, "ACCEPTED", "the reference answer must be accepted by the real judge");
  const bad = await request("POST", `/api/learning/practice/${task.id}/submit`, studentAT, { language: "python", code: 'print("wrong")' });
  assert.ok(bad.body.verdict && bad.body.verdict !== "ACCEPTED", "a wrong answer must be rejected");
});

test("the module assessment exists as an unlocked-by-admin Python-only level with hidden cases", async (t) => {
  if (!needs(t)) return;
  const level = await prisma.moduleCodingTest.findFirst({ where: { chapterId: course.modules[0].chapters[0].id }, include: { questions: { include: { testCases: true } } } });
  assert.deepEqual(level.allowedLanguages, ["python"]);
  assert.equal(level.proctoring, true);
  assert.ok(level.questions.length >= 3);
  for (const q of level.questions) assert.ok(q.testCases.some((c) => c.isHidden) && q.testCases.some((c) => !c.isHidden), "every question needs sample and hidden cases");
});

test("a student has to pass every module test, and the certificate is issued automatically when the whole course is done, not before", async (t) => {
  if (!needs(t)) return;
  const { modules: specs } = require("../content/python");
  const now = new Date(), live = { isActive: true, archivedAt: null, publishedAt: now };
  // Earlier tests published only Module 1; publish the rest as an administrator would.
  await prisma.courseModule.updateMany({ where: { courseId: course.id }, data: live });
  await prisma.chapter.updateMany({ where: { module: { courseId: course.id } }, data: live });
  await prisma.lesson.updateMany({ where: { module: { courseId: course.id } }, data: live });

  const mods = await prisma.courseModule.findMany({ where: { courseId: course.id }, orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } });
  assert.equal(mods.length, specs.length);
  const testsPerModule = mods.map((m) => m.lessons.filter((l) => l.isModuleTest));
  assert.equal(testsPerModule.filter((x) => x.length === 1).length, 23, "23 modules end with a practice test");
  assert.equal(testsPerModule.filter((x) => x.length === 0).length, 1, "only the projects module has none");

  // Correct option TEXT per prompt, from the authored content: the student sees the options shuffled, so an answer is the position of that text in what the server sent.
  const correctText = new Map();
  for (const sp of specs) for (const c of sp.module.chapters) for (const L of c.lessons) if (L.moduleTest) for (const q of L.quiz) correctText.set(q.prompt, q.options[q.correctAnswer]);
  const takeTest = async (lessonId, mode) => {
    const view = await request("GET", `/api/learning/lessons/${lessonId}`, studentAT);
    assert.equal(view.status, 200);
    assert.ok(!JSON.stringify(view.body).includes("correctAnswer"), "the test never carries its answers");
    const answers = {};
    for (const q of view.body.questions.filter((x) => x.type !== "CODING")) {
      const right = q.options.indexOf(correctText.get(q.prompt));
      assert.ok(right >= 0, `the right option is among those shown: ${q.prompt.slice(0, 40)}`);
      answers[q.id] = mode === "all-right" ? right : (right + 1) % q.options.length; // "all-wrong" picks a different option for every question
    }
    return request("POST", `/api/learning/lessons/${lessonId}/test-submit`, studentAT, { answers });
  };

  let certificateBeforeEnd = null, lastResult = null;
  for (const [mi, m] of mods.entries()) {
    const test = m.lessons.find((l) => l.isModuleTest);
    for (const l of m.lessons.filter((x) => !x.isModuleTest)) assert.equal((await request("POST", `/api/learning/lessons/${l.id}/progress`, studentAT, { status: "COMPLETED" })).status, 200);
    if (!test) continue;

    // The test lesson cannot be completed by hand
    assert.equal((await request("POST", `/api/learning/lessons/${test.id}/progress`, studentAT, { status: "COMPLETED" })).status, 400, "no completing a test by clicking");
    // A failed attempt does not complete it, and the next module stays locked
    const failed = await takeTest(test.id, "all-wrong");
    assert.equal(failed.status, 200);
    assert.equal(failed.body.passed, false);
    assert.ok(failed.body.score < failed.body.passThreshold);
    const next = mods[mi + 1];
    if (next) assert.equal((await request("GET", `/api/learning/lessons/${next.lessons[0].id}`, studentAT)).status, 403, `module ${mi + 2} stays locked after a failed test`);
    if (mi === mods.length - 1) {
      // everything except the final test is done: still no certificate
      certificateBeforeEnd = await request("GET", `/api/learning/courses/${SLUG}/certificate`, studentAT);
      assert.equal(await prisma.certificate.count({ where: { studentId: studentA.id, courseId: course.id } }), 0, "no certificate issued before the end");
    }
    // Passing completes it and opens the next module
    const passed = await takeTest(test.id, "all-right");
    assert.equal(passed.body.passed, true);
    assert.equal(passed.body.score, 100);
    if (next) assert.equal((await request("GET", `/api/learning/lessons/${next.lessons[0].id}`, studentAT)).status, 200, `module ${mi + 2} opens after the test is passed`);
    lastResult = passed;
  }
  assert.equal(certificateBeforeEnd.status, 400, "the certificate page refuses an unfinished course");
  assert.equal(lastResult.body.courseCompleted, true, "finishing the last test reports that the course is complete");
  assert.equal(lastResult.body.certificateIssued, true);
  assert.equal(await prisma.certificate.count({ where: { studentId: studentA.id, courseId: course.id, type: "LEARNING_MODULE" } }), 1, "issued automatically, without the student asking for it");
  const cert = await request("GET", `/api/learning/courses/${SLUG}/certificate`, studentAT);
  assert.equal(cert.status, 200);
  assert.ok(cert.body.certificateCode);
  assert.equal(await prisma.certificate.count({ where: { studentId: studentA.id, courseId: course.id } }), 1, "asking again never issues a second one");
  const overview = await request("GET", `/api/learning/courses/${SLUG}`, studentAT);
  assert.equal(overview.body.overall.percent, 100);
  assert.equal((await request("GET", `/api/learning/courses/${SLUG}/certificate`, studentBT)).status === 200, false, "another student gets nothing");
});
