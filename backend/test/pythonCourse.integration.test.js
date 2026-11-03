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

function request(method, path, token, body, extra = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: "localhost", port: PORT, path, method, headers: { "Content-Type": "application/json", ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
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

test("a module assessment works end to end for a student: list, start, run, submit, finalize, result, retake, isolation", async (t) => {
  if (!needs(t)) return;
  if (spawnSync("python3", ["--version"]).status !== 0) return console.log("python3 not available here; assessment step skipped");
  const { modules: specs } = require("../content/python");
  const spec = specs[0].module.assessment;
  const mod = course.modules[0];
  const level = await prisma.moduleCodingTest.findFirst({ where: { chapterId: mod.chapters[0].id } });
  assert.equal(level.isActive, true, "published by the earlier test, as an administrator would");
  assert.deepEqual(level.allowedLanguages, ["python"]);

  // 1. the student sees it, not started, with its rules
  const list = await request("GET", `/api/module-coding/module/${mod.id}/levels`, studentAT);
  assert.equal(list.status, 200);
  const entry = list.body.find((l) => l.id === level.id);
  assert.ok(entry, "the published assessment is listed");
  assert.equal(entry.status, "NOT_STARTED");
  assert.equal(entry.questionCount, spec.questions.length);
  assert.equal(entry.passingPercent, level.passingPercent);

  // 2. another institute's student and an anonymous caller get nothing
  assert.equal((await request("POST", `/api/module-coding/level/${level.id}/start`, studentBT)).status, 404, "another institute's student cannot start it");
  assert.equal((await request("POST", `/api/module-coding/level/${level.id}/start`, null)).status, 401, "nor can an anonymous caller");

  // 3. start: questions arrive without hidden cases or reference solutions; there is a deadline in the future
  const start = await request("POST", `/api/module-coding/level/${level.id}/start`, studentAT);
  assert.equal(start.status, 200);
  const attemptId = start.body.attemptId;
  assert.ok(attemptId && start.body.deadline > Date.now());
  assert.deepEqual(start.body.allowedLanguages, ["python"]);
  assert.equal(start.body.questions.length, spec.questions.length);
  const raw = JSON.stringify(start.body);
  assert.ok(!/"isHidden":true/.test(raw), "no hidden test case is sent");
  assert.ok(!/"(referenceSolution|solution)"/.test(raw), "no reference solution is sent");
  for (const q of start.body.questions) assert.ok((q.testCases || []).every((c) => !c.isHidden) && (q.testCases || []).length >= 1, "only sample cases are shown");
  const solutionOf = (title) => spec.questions.find((q) => q.title === title).solution;

  // 4. starting again resumes the same attempt, it does not create a second one
  const again = await request("POST", `/api/module-coding/level/${level.id}/start`, studentAT);
  assert.equal(again.body.attemptId, attemptId, "resumes the attempt in progress");
  assert.ok(again.body.sessionId && again.body.sessionId !== start.body.sessionId, "a resume hands out a new session, the newest tab owns the attempt");
  const H = { "x-exam-session": again.body.sessionId }; // the page sends this on every call after start

  // 5. run (sample cases only), autosave, a wrong submission, then the right one
  const [first, ...others] = start.body.questions;
  const run = await request("POST", `/api/module-coding/attempts/${attemptId}/run`, studentAT, { questionId: first.id, language: "python", code: solutionOf(first.title) }, H);
  assert.equal(run.status, 200);
  assert.equal(run.body.verdict, "ACCEPTED", "the reference solution passes the sample cases");
  assert.equal((await request("POST", `/api/module-coding/attempts/${attemptId}/autosave`, studentAT, { questionId: first.id, language: "python", code: "# draft", seq: Date.now() }, H)).status, 200);
  const wrong = await request("POST", `/api/module-coding/attempts/${attemptId}/submit-code`, studentAT, { questionId: first.id, language: "python", code: 'print("wrong")' }, H);
  assert.equal(wrong.status, 200);
  assert.notEqual(wrong.body.verdict, "ACCEPTED", "a wrong submission is rejected");
  assert.ok(!JSON.stringify(wrong.body).includes('"details"'), "the submission result carries no per-case detail (hidden cases stay hidden)");
  const right = await request("POST", `/api/module-coding/attempts/${attemptId}/submit-code`, studentAT, { questionId: first.id, language: "python", code: solutionOf(first.title) }, H);
  assert.equal(right.body.verdict, "ACCEPTED");
  for (const q of others) assert.equal((await request("POST", `/api/module-coding/attempts/${attemptId}/submit-code`, studentAT, { questionId: q.id, language: "python", code: solutionOf(q.title) }, H)).body.verdict, "ACCEPTED", q.title);

  // 6. a question that is not part of this attempt is refused
  assert.equal((await request("POST", `/api/module-coding/attempts/${attemptId}/run`, studentAT, { questionId: "00000000-0000-0000-0000-000000000000", language: "python", code: "print(1)" }, H)).status, 403);
  // and another student cannot touch this attempt
  assert.equal((await request("POST", `/api/module-coding/attempts/${attemptId}/submit-code`, studentBT, { questionId: first.id, language: "python", code: "print(1)" })).status, 403);

  // 7. finalize: graded on the server, passed, every question accounted for
  const fin = await request("POST", `/api/module-coding/attempts/${attemptId}/finalize`, studentAT, {}, H);
  assert.equal(fin.status, 200);
  assert.equal(fin.body.passed, true);
  assert.equal(fin.body.score, 100);
  assert.notEqual(fin.body.status, "IN_PROGRESS");
  assert.equal((fin.body.questionBreakdown || []).length, spec.questions.length);
  assert.equal((await request("POST", `/api/module-coding/attempts/${attemptId}/finalize`, studentAT, {}, H)).body.passed, true, "finalizing twice is harmless");
  assert.equal((await request("POST", `/api/module-coding/attempts/${attemptId}/submit-code`, studentAT, { questionId: first.id, language: "python", code: "print(1)" }, H)).status >= 400, true, "no submitting after the attempt is finished");

  // 8. the result persists and shows on the list
  const after = (await request("GET", `/api/module-coding/module/${mod.id}/levels`, studentAT)).body.find((l) => l.id === level.id);
  assert.equal(after.status, "PASSED");
  assert.equal(after.bestScore, 100);

  // 9. a retake that scores worse never undoes the pass or the best score
  const retake = await request("POST", `/api/module-coding/level/${level.id}/start`, studentAT);
  assert.equal(retake.status, 200);
  assert.notEqual(retake.body.attemptId, attemptId, "a new attempt after the first was finished");
  const weak = await request("POST", `/api/module-coding/attempts/${retake.body.attemptId}/finalize`, studentAT, {}, { "x-exam-session": retake.body.sessionId });
  assert.equal(weak.body.passed, false);
  const kept = (await request("GET", `/api/module-coding/module/${mod.id}/levels`, studentAT)).body.find((l) => l.id === level.id);
  assert.equal(kept.status, "PASSED", "the earlier pass stands");
  assert.equal(kept.bestScore, 100, "and so does the best score");
});

test("proctoring on a module assessment: refresh recovery, what is never penalised, escalation, auto-submit at the limit, what is stored", async (t) => {
  if (!needs(t)) return;
  if (spawnSync("python3", ["--version"]).status !== 0) return console.log("python3 not available here; proctoring step skipped");
  const { SUSPICIOUS_ESCALATION_THRESHOLD } = require("../src/utils/proctoringSeverity");
  const { modules: specs } = require("../content/python");
  const spec = specs[0].module.assessment;
  const mod = course.modules[0];
  const level = await prisma.moduleCodingTest.findFirst({ where: { chapterId: mod.chapters[0].id } });
  assert.equal(level.proctoring, true, "the course assessments are proctored");
  assert.equal(level.maxViolations, 3);
  const url = (p) => `/api/module-coding/${p}`;
  const solutionOf = (title) => spec.questions.find((q) => q.title === title).solution;

  const start = await request("POST", url(`level/${level.id}/start`), studentAT);
  assert.equal(start.status, 200, "a third attempt is allowed (three are configured)");
  const attemptId = start.body.attemptId;
  let H = { "x-exam-session": start.body.sessionId };
  const [q1, q2] = start.body.questions;

  // 1. work is kept across a refresh: a draft saved before, comes back when the page asks to start again
  assert.equal((await request("POST", url(`attempts/${attemptId}/autosave`), studentAT, { questionId: q2.id, language: "python", code: "# my unfinished draft", seq: Date.now() }, H)).status, 200);
  const resumed = await request("POST", url(`level/${level.id}/start`), studentAT);
  assert.equal(resumed.body.attemptId, attemptId, "a refresh resumes the same attempt");
  assert.equal(resumed.body.savedAnswers[q2.id].code, "# my unfinished draft", "and the saved draft is restored");
  H = { "x-exam-session": resumed.body.sessionId };
  assert.equal((await request("POST", url(`attempts/${attemptId}/submit-code`), studentAT, { questionId: q1.id, language: "python", code: solutionOf(q1.title) }, H)).body.verdict, "ACCEPTED");

  const report = async (type) => (await request("POST", url(`attempts/${attemptId}/violation`), studentAT, { type }, H)).body;
  const countRows = () => prisma.proctoringViolation.count({ where: { attemptId } });

  // 2. events that are usually innocent are logged and never counted, however often they happen: a lost face, a dropped network, a refresh, an unknown event from a newer client
  for (const type of ["FACE_MISSING", "MULTIPLE_FACES", "NETWORK_LOSS", "REFRESH_ATTEMPT", "SOME_FUTURE_EVENT_NOBODY_KNOWS"]) {
    const r = await report(type);
    assert.equal(r.penalized, false, `${type} is never a strike`);
    assert.equal(r.violationCount, 0);
    assert.equal(r.autoSubmitted, false);
  }
  assert.equal(await countRows(), 5, "all five were still recorded for the reviewer");

  // 3. ambiguous actions are warnings until they repeat: every SUSPICIOUS_ESCALATION_THRESHOLD-th one becomes a strike
  const warnings = ["COPY", "PASTE", "RIGHT_CLICK"].slice(0, SUSPICIOUS_ESCALATION_THRESHOLD - 1);
  for (const type of warnings) { const r = await report(type); assert.equal(r.severity, "SUSPICIOUS"); assert.equal(r.penalized, false, `a first ${type} is only a warning`); assert.equal(r.violationCount, 0); }
  const third = await report("RIGHT_CLICK");
  assert.equal(third.penalized, true, "the repeat that reaches the threshold is a strike");
  assert.equal(third.violationCount, 1);

  // 4. leaving the proctored environment is a strike at once, and the strike that reaches the limit submits the attempt
  const tab = await report("TAB_SWITCH");
  assert.equal(tab.severity, "CONFIRMED_VIOLATION"); assert.equal(tab.penalized, true); assert.equal(tab.violationCount, 2); assert.equal(tab.autoSubmitted, false);
  const last = await report("CAMERA_DROPPED");
  assert.equal(last.violationCount, 3);
  assert.equal(last.maxViolations, 3);
  assert.equal(last.autoSubmitted, true, "reaching the limit submits the attempt");

  // 5. after that: finished, graded from what was saved, nothing more can be changed or counted
  const attempt = await prisma.moduleCodingAttempt.findUnique({ where: { id: attemptId } });
  assert.notEqual(attempt.status, "IN_PROGRESS");
  assert.equal(attempt.violationCount, 3);
  const graded = await prisma.moduleCodingSubmission.findFirst({ where: { attemptId, questionId: q1.id } });
  assert.equal(graded.verdict, "ACCEPTED", "the answer submitted before the auto-submit is kept and graded");
  const draftOnly = await prisma.moduleCodingSubmission.findFirst({ where: { attemptId, questionId: q2.id } });
  assert.notEqual(draftOnly.verdict, "PENDING", "an unfinished draft is graded too, not left pending");
  assert.ok(attempt.score > 0 && attempt.score < 100, `a partly done attempt gets a partial score (${attempt.score})`);
  const late = await report("TAB_SWITCH");
  assert.equal(late.autoSubmitted, true); assert.equal(late.violationCount, 3, "no further strikes after the attempt ended");
  assert.ok((await request("POST", url(`attempts/${attemptId}/submit-code`), studentAT, { questionId: q1.id, language: "python", code: "print(1)" }, H)).status >= 400, "no submitting after the auto-submit");

  // 6. what is stored for the reviewer: every event, its severity and whether it counted, with no student code in the log
  const rows = await prisma.proctoringViolation.findMany({ where: { attemptId }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 5 + warnings.length + 1 + 1 + 1, "every event is on record");
  const { classifyViolation } = require("../src/utils/proctoringSeverity");
  let suspicious = 0;
  for (const row of rows) {
    const want = classifyViolation(row.type, suspicious);
    if (want.severity === "SUSPICIOUS") suspicious++;
    assert.equal(row.severity, want.severity, `${row.type} is stored as ${want.severity}`);
    assert.equal(row.penalized, want.penalized, `${row.type} penalised=${want.penalized}`);
  }
  assert.equal(rows.filter((r) => r.penalized).length, 3, "exactly three strikes were counted");
  assert.ok(!JSON.stringify(rows).includes("my unfinished draft"), "the log holds no student code");

  // 7. only the student who owns the attempt can report on it, and only when signed in
  assert.equal((await request("POST", url(`attempts/${attemptId}/violation`), studentBT, { type: "TAB_SWITCH" })).status, 403);
  assert.equal((await request("POST", url(`attempts/${attemptId}/violation`), null, { type: "TAB_SWITCH" })).status, 401);
});

test("permissions: who can read, change, publish and assign the Python course, for every role", async (t) => {
  if (!needs(t)) return;
  // Runs last on purpose: the write attempts below must all be refused, and if one were not it would damage the course the earlier tests used.
  const staffA = await mkUser("STAFF", F.A, "staffa"), instA = await mkUser("INSTITUTE_ADMIN", F.A, "iaa"), instB = await mkUser("INSTITUTE_ADMIN", F.institutes[1], "iab");
  const T = { anon: null, studentA: studentAT, studentB: studentBT, staff: tokenFor(staffA), instA: tokenFor(instA), instB: tokenFor(instB), admin: adminT };
  const lessonId = course.modules[0].chapters[0].topics[0].id;
  const before = await prisma.lesson.findUnique({ where: { id: lessonId } });

  // 1. The platform's own course (no owning institute) can be changed by a platform administrator and nobody else, whatever the role or institute.
  const writes = [
    ["edit a lesson", "PATCH", `/api/learning/lessons/${lessonId}`, { title: "changed by a role that must not" }],
    ["unpublish a lesson", "POST", `/api/learning/publish/lesson/${lessonId}/unpublish`, {}],
    ["rename the course", "PATCH", `/api/learning/courses/${course.id}`, { name: "changed by a role that must not" }],
    ["assign the course to an institute", "POST", `/api/learning/courses/${course.id}/assignments`, { instituteIds: [F.A] }],
    ["add a module", "POST", `/api/learning/courses/${course.id}/modules`, { title: "extra module" }],
    ["delete a lesson", "DELETE", `/api/learning/lessons/${lessonId}`, undefined],
    ["delete the course", "DELETE", `/api/learning/courses/${course.id}`, undefined],
  ];
  for (const who of ["anon", "studentA", "studentB", "staff", "instA", "instB"]) {
    for (const [what, method, path, body] of writes) {
      const r = await request(method, path, T[who], body);
      assert.ok([401, 403, 404].includes(r.status), `${who} must not ${what}: got ${r.status}`);
    }
  }
  const after = await prisma.lesson.findUnique({ where: { id: lessonId } });
  assert.equal(after.title, before.title, "the lesson title is untouched");
  assert.equal(after.isActive, true, "the lesson is still published");
  assert.equal((await prisma.course.findUnique({ where: { id: course.id } })).name, course.name, "the course is untouched");
  assert.equal(await prisma.courseModule.count({ where: { courseId: course.id } }), 24, "no module was added or removed");
  // Positive control: the same route does work for a platform administrator, so the refusals above mean something.
  assert.equal((await request("PATCH", `/api/learning/lessons/${lessonId}`, T.admin, { order: before.order })).status, 200, "a platform administrator can edit");

  // 2. Reading: the assigned institute's student, any administrator or staff member (the course belongs to the platform), but not an unassigned student, and nobody anonymous.
  for (const [who, want] of [["studentA", 200], ["studentB", 404], ["staff", 200], ["instA", 200], ["instB", 200], ["admin", 200], ["anon", 401]]) {
    assert.equal((await request("GET", `/api/learning/courses/${SLUG}`, T[who])).status, want, `${who} reading the course`);
  }
  // Only a student's own view is trimmed: staff see the full question data (answers) for review, a student never does.
  const asStudent = JSON.stringify((await request("GET", `/api/learning/lessons/${lessonId}`, T.studentA)).body);
  const asStaff = JSON.stringify((await request("GET", `/api/learning/lessons/${lessonId}`, T.staff)).body);
  assert.ok(!asStudent.includes("correctAnswer"), "a student never sees an answer key");
  assert.ok(asStaff.includes("correctAnswer"), "staff can review the answer key");

  // 3. Learner actions belong to students: an administrator or staff member cannot record progress, take a test, or start an assessment.
  const testLesson = (await prisma.lesson.findFirst({ where: { module: { courseId: course.id }, isModuleTest: true }, orderBy: { order: "asc" } }));
  const level = await prisma.moduleCodingTest.findFirst({ where: { chapterId: course.modules[0].chapters[0].id } });
  for (const who of ["staff", "instA", "instB", "admin", "anon"]) {
    for (const [what, method, path, body] of [
      ["record lesson progress", "POST", `/api/learning/lessons/${lessonId}/progress`, { status: "COMPLETED" }],
      ["submit a module test", "POST", `/api/learning/lessons/${testLesson.id}/test-submit`, { answers: {} }],
      ["start an assessment", "POST", `/api/module-coding/level/${level.id}/start`, {}],
    ]) {
      const r = await request(method, path, T[who], body);
      assert.ok([401, 403].includes(r.status), `${who} must not ${what}: got ${r.status}`);
    }
  }
  // and no student can write progress for a course that was not assigned to them
  assert.equal((await request("POST", `/api/learning/lessons/${lessonId}/progress`, T.studentB, { status: "COMPLETED" })).status, 404, "an unassigned student cannot record progress");
  assert.equal(await prisma.lessonProgress.count({ where: { studentId: studentB.id } }), 0, "and nothing was written for them");

  // 4. A student cannot read another student's work: practice drafts are keyed to the signed-in student.
  const practice = await prisma.practiceQuestion.findFirst({ where: { lessonId, type: "CODING" } });
  assert.equal((await request("POST", `/api/learning/practice/${practice.id}/autosave`, T.studentA, { language: "python", code: "# only mine" })).status, 200);
  const mine = await request("GET", `/api/learning/practice/${practice.id}/draft`, T.studentA);
  assert.equal(mine.body.code, "# only mine");
  const theirs = await request("GET", `/api/learning/practice/${practice.id}/draft`, T.studentB);
  assert.ok(theirs.status === 404 || !theirs.body || theirs.body.code !== "# only mine", "another student does not get my draft");
});
