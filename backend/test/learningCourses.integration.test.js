// Real HTTP integration tests for LMS course management (backend/src/routes/learning.js) — this
// module had zero route-level tests before this (confirmed 2026-09-23 during a full-platform LMS
// audit triggered by a real production incident: "Java Bootcamp", an abandoned empty course, got
// silently exposed to every institute by a backfill-script bug, and separately a course-delete
// route had no guard against wiping real student progress). Two of these tests convert that
// incident's manual, disposable-data verification into a permanent regression test instead of a
// one-off; the third is a fresh institute-isolation IDOR check the incident investigation didn't
// happen to cover.
//
// Same infra as aiInterviewRoutes.integration.test.js: hits the real running server via
// http.request (src/index.js has no exported `app` to boot in-process — see that file's own header
// comment for the full reasoning), skips cleanly when no server/fixture data is reachable, and
// every test creates its own disposable data cleaned up in a finally block.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");

const HOST = "localhost";
const PORT = 4000;

function httpRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: HOST, port: PORT, path, method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (d) => (chunks += d));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(chunks || "{}") }); }
          catch { resolve({ status: res.statusCode, body: chunks }); }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Must match the real shape utils/sessions.js signs at login ({ id, role, email, name, jti }) --
// omitting `name` here was confirmed live to be the reason "assign a course" returned 500
// (assignedByName: req.user.name), which looked exactly like a real app bug until checking
// sessions.js's actual jwt.sign() call showed name genuinely is included for every real session.
function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

let serverReachable = false;
let superAdmin, superAdminToken;
let instituteAdminA, instituteAdminAToken; // two DIFFERENT institutes, for the IDOR test
let instituteAdminB, instituteAdminBToken;
let student;
let studentX, studentXToken; // two DIFFERENT institutes, for the visibility isolation test
let studentY, studentYToken;

test.before(async () => {
  try {
    const res = await httpRequest("GET", "/api/health", null);
    serverReachable = res.status === 200;
  } catch {
    serverReachable = false;
  }
  if (!serverReachable || !process.env.JWT_SECRET) return;

  superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  student = await prisma.user.findFirst({ where: { role: "STUDENT" } });
  if (!superAdmin || !student) { serverReachable = false; return; }
  superAdminToken = tokenFor(superAdmin);

  // Two institute-scoped admins from two DIFFERENT institutes, for the cross-institute IDOR check.
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "INSTITUTE_ADMIN"] }, instituteId: { not: null } },
    select: { id: true, role: true, email: true, instituteId: true },
    take: 50,
  });
  const byInstitute = new Map();
  for (const a of admins) if (!byInstitute.has(a.instituteId)) byInstitute.set(a.instituteId, a);
  const distinct = [...byInstitute.values()];
  if (distinct.length >= 2) {
    [instituteAdminA, instituteAdminB] = distinct;
    instituteAdminAToken = tokenFor(instituteAdminA);
    instituteAdminBToken = tokenFor(instituteAdminB);
  }

  // Two students from two DIFFERENT institutes, for the visibility isolation test.
  const students = await prisma.user.findMany({
    where: { role: "STUDENT", instituteId: { not: null } },
    select: { id: true, role: true, email: true, instituteId: true },
    take: 100,
  });
  const studentsByInstitute = new Map();
  for (const s of students) if (!studentsByInstitute.has(s.instituteId)) studentsByInstitute.set(s.instituteId, s);
  const distinctStudents = [...studentsByInstitute.values()];
  if (distinctStudents.length >= 2) {
    [studentX, studentY] = distinctStudents;
    studentXToken = tokenFor(studentX);
    studentYToken = tokenFor(studentY);
  }
});

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanupCourse(courseId) {
  if (!courseId) return;
  await prisma.lessonProgress.deleteMany({ where: { lesson: { module: { courseId } } } }).catch(() => {});
  await prisma.lesson.deleteMany({ where: { module: { courseId } } }).catch(() => {});
  await prisma.courseModule.deleteMany({ where: { courseId } }).catch(() => {});
  await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
}

test("course creation normalizes a messy slug to a clean, URL-safe one", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let courseId;
  try {
    const create = await httpRequest("POST", "/api/learning/courses", superAdminToken, {
      slug: "  Regression TEST!! Course_Slug  ", name: "P1 Regression Slug Course", status: "DRAFT",
    });
    assert.equal(create.status, 200);
    courseId = create.body.id;
    assert.equal(create.body.slug, "regression-test-course-slug", "messy input must normalize to lowercase, hyphen-separated, URL-safe form");
  } finally {
    await cleanupCourse(courseId);
  }
});

test("deleting a course is blocked when real student progress exists under it (regression test for a confirmed live data-loss bug)", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let courseId, moduleId, lessonId, progressId;
  try {
    const create = await httpRequest("POST", "/api/learning/courses", superAdminToken, {
      slug: `regression-delete-guard-${Date.now()}`, name: "P1 Regression Delete-Guard Course", status: "DRAFT",
    });
    courseId = create.body.id;

    const mod = await prisma.courseModule.create({ data: { courseId, title: "M1", order: 0 } });
    moduleId = mod.id;
    const lesson = await prisma.lesson.create({ data: { moduleId, title: "L1", order: 0, content: "hello" } });
    lessonId = lesson.id;
    const progress = await prisma.lessonProgress.create({ data: { studentId: student.id, lessonId, status: "COMPLETED" } });
    progressId = progress.id;

    const del = await httpRequest("DELETE", `/api/learning/courses/${courseId}`, superAdminToken);
    assert.equal(del.status, 409, "a course with real student progress must never be deletable with no guard");
    assert.match(del.body.error, /lesson-progress/);

    const stillExists = await prisma.course.findUnique({ where: { id: courseId } });
    assert.ok(stillExists, "the course must genuinely still exist after the blocked delete attempt, not just return an error code");
  } finally {
    if (progressId) await prisma.lessonProgress.delete({ where: { id: progressId } }).catch(() => {});
    if (lessonId) await prisma.lesson.delete({ where: { id: lessonId } }).catch(() => {});
    if (moduleId) await prisma.courseModule.delete({ where: { id: moduleId } }).catch(() => {});
    await cleanupCourse(courseId);
  }
});

test("an institute-scoped admin cannot edit or delete another institute's course (IDOR)", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  if (!instituteAdminA || !instituteAdminB) return t.skip("fewer than 2 institute-scoped admins across distinct institutes in fixture data");
  let courseId;
  try {
    // Institute A's admin creates a course scoped to their own institute.
    const create = await httpRequest("POST", "/api/learning/courses", instituteAdminAToken, {
      slug: `regression-idor-${Date.now()}`, name: "P1 Regression IDOR Course", status: "DRAFT",
    });
    assert.equal(create.status, 200);
    courseId = create.body.id;
    assert.equal(create.body.instituteId, instituteAdminA.instituteId, "an institute-scoped admin's course must be auto-scoped to their own institute, never left global");

    // Institute B's admin must not be able to edit it.
    const edit = await httpRequest("PATCH", `/api/learning/courses/${courseId}`, instituteAdminBToken, { name: "Hijacked" });
    assert.equal(edit.status, 403, "a different institute's admin must be rejected editing this course");

    // ...or delete it.
    const del = await httpRequest("DELETE", `/api/learning/courses/${courseId}`, instituteAdminBToken);
    assert.equal(del.status, 403, "a different institute's admin must be rejected deleting this course");

    // Confirm it's genuinely untouched.
    const stillThere = await prisma.course.findUnique({ where: { id: courseId } });
    assert.equal(stillThere.name, "P1 Regression IDOR Course", "the course must be completely unchanged after both rejected attempts");
  } finally {
    await cleanupCourse(courseId);
  }
});

test("student course visibility respects institute assignment (the core institute-isolation guarantee)", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  if (!studentX || !studentY) return t.skip("fewer than 2 students across distinct institutes in fixture data");
  let courseId, moduleId;
  try {
    const create = await httpRequest("POST", "/api/learning/courses", superAdminToken, {
      slug: `regression-visibility-${Date.now()}`, name: "P1 Regression Visibility Course", status: "DRAFT",
    });
    assert.equal(create.status, 200);
    courseId = create.body.id;
    const slug = create.body.slug;

    const mod = await prisma.courseModule.create({ data: { courseId, title: "M1", order: 0 } });
    moduleId = mod.id;

    const publish = await httpRequest("PATCH", `/api/learning/courses/${courseId}`, superAdminToken, { status: "PUBLISHED" });
    assert.equal(publish.status, 200, "a course with one module must be publishable");

    const assign = await httpRequest("POST", `/api/learning/courses/${courseId}/assignments`, superAdminToken, { instituteIds: [studentX.instituteId] });
    assert.equal(assign.status, 200, `assignment to ${studentX.instituteId} must succeed`);

    // The assigned student's institute sees it in their course list...
    const listX = await httpRequest("GET", "/api/learning/courses", studentXToken);
    assert.ok(listX.body.some((c) => c.id === courseId), "student X (assigned institute) must see the course in their list");

    // ...and can open it directly by slug.
    const openX = await httpRequest("GET", `/api/learning/courses/${slug}`, studentXToken);
    assert.equal(openX.status, 200, "student X must be able to open the course they're assigned to");

    // A DIFFERENT institute's student sees neither.
    const listY = await httpRequest("GET", "/api/learning/courses", studentYToken);
    assert.ok(!listY.body.some((c) => c.id === courseId), "student Y (unassigned institute) must NOT see the course in their list");

    // ...and cannot open it directly by slug either, even knowing it exists (URL-guessing / IDOR
    // per the spec's "server must verify, not just filter the list" requirement) -- 404, not 403,
    // same "don't confirm it exists" convention used elsewhere on this platform.
    const openY = await httpRequest("GET", `/api/learning/courses/${slug}`, studentYToken);
    assert.equal(openY.status, 404, "student Y must be rejected opening a course from another institute directly by slug, not just filtered out of the list");
  } finally {
    if (moduleId) await prisma.courseModule.delete({ where: { id: moduleId } }).catch(() => {});
    if (courseId) await prisma.courseInstituteAssignment.deleteMany({ where: { courseId } }).catch(() => {});
    await cleanupCourse(courseId);
  }
});

test("an institute-scoped admin cannot READ another institute's chapters/lessons/projects (IDOR info-disclosure, regression test for a confirmed live gap)", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  if (!instituteAdminA || !instituteAdminB) return t.skip("fewer than 2 institute-scoped admins across distinct institutes in fixture data");
  let courseId, moduleId, chapterId, projectId;
  try {
    // Institute A's admin builds a course with a chapter (containing a lesson) and a project
    // (containing test cases / starter code) under their own institute.
    const create = await httpRequest("POST", "/api/learning/courses", instituteAdminAToken, {
      slug: `regression-read-idor-${Date.now()}`, name: "P1 Regression Read-IDOR Course", status: "DRAFT",
    });
    assert.equal(create.status, 200);
    courseId = create.body.id;

    const modRes = await httpRequest("POST", `/api/learning/courses/${courseId}/modules`, instituteAdminAToken, { title: "M1", order: 0 });
    assert.equal(modRes.status, 200);
    moduleId = modRes.body.id;

    const chapterRes = await httpRequest("POST", `/api/learning/modules/${moduleId}/chapters`, instituteAdminAToken, { title: "Ch1", order: 0 });
    assert.equal(chapterRes.status, 200);
    chapterId = chapterRes.body.id;

    const projectRes = await httpRequest("POST", `/api/learning/modules/${moduleId}/projects`, instituteAdminAToken, { title: "Proj1" });
    assert.equal(projectRes.status, 200);
    projectId = projectRes.body.id;

    // Institute B's admin must be rejected reading ANY of these by ID -- 403, not a silent
    // cross-institute content leak (this used to return 200 with the full chapter/lesson/project
    // content, including project test cases and starter code, before the ownership check was added).
    const chapters = await httpRequest("GET", `/api/learning/modules/${moduleId}/chapters`, instituteAdminBToken);
    assert.equal(chapters.status, 403, "reading another institute's chapter list must be rejected");

    const lessons = await httpRequest("GET", `/api/learning/chapters/${chapterId}/lessons`, instituteAdminBToken);
    assert.equal(lessons.status, 403, "reading another institute's lesson content by chapter id must be rejected");

    const projects = await httpRequest("GET", `/api/learning/modules/${moduleId}/projects`, instituteAdminBToken);
    assert.equal(projects.status, 403, "reading another institute's project list must be rejected");

    const projectAdmin = await httpRequest("GET", `/api/learning/projects/${projectId}/admin`, instituteAdminBToken);
    assert.equal(projectAdmin.status, 403, "reading another institute's project detail (including task test cases/starter code) must be rejected");

    // Institute A's own admin must still be able to read all of these normally (the fix must not
    // have broken the legitimate same-institute case).
    const ownChapters = await httpRequest("GET", `/api/learning/modules/${moduleId}/chapters`, instituteAdminAToken);
    assert.equal(ownChapters.status, 200, "the owning institute's admin must still be able to read their own chapters");
  } finally {
    if (projectId) await prisma.courseProject.delete({ where: { id: projectId } }).catch(() => {});
    if (chapterId) await prisma.chapter.delete({ where: { id: chapterId } }).catch(() => {});
    await cleanupCourse(courseId);
  }
});

test("publishing a course with zero modules is rejected", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let courseId;
  try {
    const create = await httpRequest("POST", "/api/learning/courses", superAdminToken, {
      slug: `regression-empty-publish-${Date.now()}`, name: "P1 Regression Empty-Publish Course", status: "DRAFT",
    });
    courseId = create.body.id;

    const publish = await httpRequest("PATCH", `/api/learning/courses/${courseId}`, superAdminToken, { status: "PUBLISHED" });
    assert.equal(publish.status, 400, "a course with no modules must not be publishable");

    const stillDraft = await prisma.course.findUnique({ where: { id: courseId } });
    assert.equal(stillDraft.status, "DRAFT");
  } finally {
    await cleanupCourse(courseId);
  }
});
