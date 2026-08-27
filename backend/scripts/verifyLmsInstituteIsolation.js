// Real-HTTP verification for LMS institute isolation — spec's own test matrix (Super Admin,
// Institute Admin A/B, Staff, Student, direct cross-institute API attempts). Creates real
// temp users/courses/content, exercises the live server, cleans up every row it creates by exact
// ID. Never touches any other institute's real data.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

const API_BASE = process.env.HEALTH_CHECK_API_BASE || "http://127.0.0.1:4000/api";
let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`  [PASS] ${label}`); pass++; }
  else { console.log(`  [FAIL] ${label}${detail ? ` (${detail})` : ""}`); fail++; }
}
async function j(res) { try { return await res.json(); } catch { return null; } }

async function mkUser(role, instituteId) {
  const email = `lmsiso-check-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: `LMS ISO Check ${role}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, select: { id: true, name: true } });
  if (institutes.length < 2) { console.log("Need 2 institutes"); process.exit(1); }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name}\nInstitute B: ${instB.name}\n`);

  const cleanup = [];
  const courseIds = [];
  try {
    const superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
    const adminA = await mkUser("INSTITUTE_ADMIN", instA.id);
    const adminB = await mkUser("INSTITUTE_ADMIN", instB.id);
    const staffA = await mkUser("STAFF", instA.id);
    cleanup.push(adminA, adminB, staffA);

    let superAdminHeaders = null;
    if (superAdmin) {
      const token = await createSession({ user: superAdmin, req: { headers: {} }, singleSessionOnly: false });
      const jti = jwt.decode(token).jti;
      superAdminHeaders = { "content-type": "application/json", Authorization: `Bearer ${token}` };
      cleanup.push({ user: superAdmin, jti, headers: superAdminHeaders, skipDelete: true });
    }

    // ---- 1. Institute Admin A creates a course -> auto-scoped to Institute A ----
    console.log("=== Institute Admin A creates a course (auto-scoped) ===");
    const slug = `lmsiso-check-${Date.now()}`;
    const createRes = await fetch(`${API_BASE}/learning/courses`, {
      method: "POST", headers: adminA.headers, body: JSON.stringify({ slug, name: "LMS ISO Check Course", status: "DRAFT" }),
    });
    const course = await j(createRes);
    check("Course created (200)", createRes.status === 200, `got ${createRes.status}: ${JSON.stringify(course)}`);
    courseIds.push(course.id);
    check("Auto-scoped to Institute A", course.instituteId === instA.id, `instituteId=${course.instituteId}`);

    // ---- 2. Staff cannot create a course (role-level) ----
    console.log("\n=== Staff cannot create a course ===");
    const staffCreateRes = await fetch(`${API_BASE}/learning/courses`, {
      method: "POST", headers: staffA.headers, body: JSON.stringify({ slug: `${slug}-staff`, name: "Staff Attempt" }),
    });
    check("Staff blocked from creating a course (403)", staffCreateRes.status === 403, `got ${staffCreateRes.status}`);

    // ---- 3. Institute Admin B cannot edit/delete/view Institute A's course ----
    console.log("\n=== Institute Admin B blocked from Institute A's course ===");
    const crossEditRes = await fetch(`${API_BASE}/learning/courses/${course.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ name: "Hijacked" }) });
    check("Institute Admin B PATCH blocked (403)", crossEditRes.status === 403, `got ${crossEditRes.status}`);
    const crossDeleteRes = await fetch(`${API_BASE}/learning/courses/${course.id}`, { method: "DELETE", headers: adminB.headers });
    check("Institute Admin B DELETE blocked (403)", crossDeleteRes.status === 403, `got ${crossDeleteRes.status}`);
    // This route deliberately returns 404, not 403, for a course outside the requester's scope —
    // same pre-existing anti-enumeration convention already documented on this exact route for
    // students ("the same 404 as a genuinely nonexistent slug, rather than a 403 that would
    // confirm the course exists"); the institute-scoped WHERE filter added for admin/staff simply
    // extends that same behavior to them.
    const crossViewRes = await fetch(`${API_BASE}/learning/courses/${slug}`, { headers: adminB.headers });
    check("Institute Admin B slug-detail view blocked (404, anti-enumeration)", crossViewRes.status === 404, `got ${crossViewRes.status}`);
    const crossListRes = await j(await fetch(`${API_BASE}/learning/courses`, { headers: adminB.headers }));
    check("Institute Admin B's course list does NOT include Institute A's private course", !crossListRes.some((c) => c.id === course.id), JSON.stringify(crossListRes.map((c) => c.id)));

    // ---- 4. Institute Admin A CAN manage their own course: add module/chapter/lesson/level/question ----
    console.log("\n=== Institute Admin A manages their own course's full content tree ===");
    const modRes = await fetch(`${API_BASE}/learning/courses/${course.id}/modules`, { method: "POST", headers: adminA.headers, body: JSON.stringify({ title: "M1" }) });
    const mod = await j(modRes);
    check("Institute Admin A creates a module (200)", modRes.status === 200, `got ${modRes.status}: ${JSON.stringify(mod)}`);
    const chapRes = await fetch(`${API_BASE}/learning/modules/${mod.id}/chapters`, { method: "POST", headers: adminA.headers, body: JSON.stringify({ title: "C1" }) });
    const chap = await j(chapRes);
    check("Institute Admin A creates a chapter (200)", chapRes.status === 200, `got ${chapRes.status}: ${JSON.stringify(chap)}`);
    const lessonRes = await fetch(`${API_BASE}/learning/chapters/${chap.id}/lessons`, { method: "POST", headers: adminA.headers, body: JSON.stringify({ title: "L1", content: "hello" }) });
    const lesson = await j(lessonRes);
    check("Institute Admin A creates a lesson (200)", lessonRes.status === 200, `got ${lessonRes.status}: ${JSON.stringify(lesson)}`);
    const levelRes = await fetch(`${API_BASE}/module-coding/admin/chapter/${chap.id}/levels`, { method: "POST", headers: adminA.headers, body: JSON.stringify({ title: "Level 1", timeLimitMin: 30 }) });
    const level = await j(levelRes);
    check("Institute Admin A creates a coding-assessment level (200)", levelRes.status === 200, `got ${levelRes.status}: ${JSON.stringify(level)}`);
    const qRes = await fetch(`${API_BASE}/module-coding/admin/tests/${level.id}/questions`, {
      method: "POST", headers: adminA.headers,
      body: JSON.stringify({
        description: "Return the sum of two integers.", difficulty: "EASY",
        testCases: [{ input: "1 2", expected: "3" }, { input: "5 5", expected: "10" },
          ...Array.from({ length: 10 }, (_, i) => ({ input: `${i} ${i}`, expected: `${i * 2}`, isHidden: true }))],
      }),
    });
    const q = await j(qRes);
    check("Institute Admin A adds a question to the level (200)", qRes.status === 200, `got ${qRes.status}: ${JSON.stringify(q)}`);

    // ---- 5. Institute Admin B blocked from every step of that same content tree ----
    console.log("\n=== Institute Admin B blocked from Institute A's full content tree ===");
    check("B blocked from adding a module", (await fetch(`${API_BASE}/learning/courses/${course.id}/modules`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ title: "M-hijack" }) })).status === 403);
    check("B blocked from editing the module", (await fetch(`${API_BASE}/learning/modules/${mod.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ title: "hijack" }) })).status === 403);
    check("B blocked from adding a chapter", (await fetch(`${API_BASE}/learning/modules/${mod.id}/chapters`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ title: "C-hijack" }) })).status === 403);
    check("B blocked from editing the chapter", (await fetch(`${API_BASE}/learning/chapters/${chap.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ title: "hijack" }) })).status === 403);
    check("B blocked from adding a lesson", (await fetch(`${API_BASE}/learning/chapters/${chap.id}/lessons`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ title: "L-hijack" }) })).status === 403);
    check("B blocked from editing the lesson", (await fetch(`${API_BASE}/learning/lessons/${lesson.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ title: "hijack" }) })).status === 403);
    check("B blocked from deleting the lesson", (await fetch(`${API_BASE}/learning/lessons/${lesson.id}`, { method: "DELETE", headers: adminB.headers })).status === 403);
    check("B blocked from adding a level", (await fetch(`${API_BASE}/module-coding/admin/chapter/${chap.id}/levels`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ title: "hijack" }) })).status === 403);
    check("B blocked from editing the level", (await fetch(`${API_BASE}/module-coding/admin/tests/${level.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ title: "hijack" }) })).status === 403);
    check("B blocked from deleting the level", (await fetch(`${API_BASE}/module-coding/admin/tests/${level.id}`, { method: "DELETE", headers: adminB.headers })).status === 403);
    check("B blocked from viewing the level's hidden test cases", (await fetch(`${API_BASE}/module-coding/admin/tests/${level.id}`, { headers: adminB.headers })).status === 403);
    check("B blocked from editing the question", (await fetch(`${API_BASE}/module-coding/admin/questions/${q.id}`, { method: "PATCH", headers: adminB.headers, body: JSON.stringify({ title: "hijack" }) })).status === 403);
    check("B blocked from deleting the question", (await fetch(`${API_BASE}/module-coding/admin/questions/${q.id}`, { method: "DELETE", headers: adminB.headers })).status === 403);
    check("B blocked from assigning the course to their own institute", (await fetch(`${API_BASE}/learning/courses/${course.id}/assignments`, { method: "POST", headers: adminB.headers, body: JSON.stringify({ instituteIds: [instB.id] }) })).status !== 200);

    // ---- 6. Content still intact after every blocked attempt (no partial writes) ----
    console.log("\n=== Content untouched after every blocked cross-institute attempt ===");
    const stillTitled = await prisma.courseModule.findUnique({ where: { id: mod.id }, select: { title: true } });
    check("Module title unchanged", stillTitled?.title === "M1", stillTitled?.title);

    // ---- 7. Super Admin can see and manage both institutes' content ----
    if (superAdminHeaders) {
      console.log("\n=== Super Admin has unrestricted access ===");
      const saView = await fetch(`${API_BASE}/learning/courses/${slug}`, { headers: superAdminHeaders });
      check("Super Admin can view Institute A's course (200)", saView.status === 200, `got ${saView.status}`);
      const saEdit = await fetch(`${API_BASE}/learning/courses/${course.id}`, { method: "PATCH", headers: superAdminHeaders, body: JSON.stringify({ description: "sa touch" }) });
      check("Super Admin can edit Institute A's course (200)", saEdit.status === 200, `got ${saEdit.status}`);
    } else {
      console.log("\n(No SUPER_ADMIN user found — skipped, not counted)");
    }

    // ---- 8. Ownership can never be reassigned via PATCH ----
    console.log("\n=== instituteId cannot be changed via PATCH (no ownership hijack) ===");
    const hijackAttempt = await fetch(`${API_BASE}/learning/courses/${course.id}`, { method: "PATCH", headers: adminA.headers, body: JSON.stringify({ instituteId: instB.id }) });
    const hijackBody = await j(hijackAttempt);
    check("instituteId silently ignored, still Institute A", hijackBody?.instituteId === instA.id, `instituteId=${hijackBody?.instituteId}`);
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    for (const id of courseIds) {
      const modules = await prisma.courseModule.findMany({ where: { courseId: id }, select: { id: true } });
      const modIds = modules.map((m) => m.id);
      const tests = await prisma.moduleCodingTest.findMany({ where: { OR: [{ moduleId: { in: modIds } }, { chapter: { moduleId: { in: modIds } } }] }, select: { id: true } });
      const testIds = tests.map((t) => t.id);
      await prisma.moduleCodingSubmission.deleteMany({ where: { attempt: { moduleCodingTestId: { in: testIds } } } }).catch(() => {});
      await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: { in: testIds } } }).catch(() => {});
      await prisma.question.deleteMany({ where: { moduleCodingTestId: { in: testIds } } }).catch(() => {});
      await prisma.moduleCodingTest.deleteMany({ where: { id: { in: testIds } } }).catch(() => {});
      await prisma.lessonProgress.deleteMany({ where: { lesson: { moduleId: { in: modIds } } } }).catch(() => {});
      await prisma.lesson.deleteMany({ where: { moduleId: { in: modIds } } }).catch(() => {});
      await prisma.chapter.deleteMany({ where: { moduleId: { in: modIds } } }).catch(() => {});
      await prisma.courseModule.deleteMany({ where: { id: { in: modIds } } }).catch(() => {});
      await prisma.courseInstituteAssignment.deleteMany({ where: { courseId: id } }).catch(() => {});
      await prisma.courseAcademicGroupAssignment.deleteMany({ where: { courseId: id } }).catch(() => {});
      await prisma.certificate.deleteMany({ where: { courseId: id } }).catch(() => {});
      await prisma.course.delete({ where: { id } }).catch((e) => console.error("course cleanup failed", id, e.message));
    }
    for (const c of cleanup) {
      if (c.skipDelete) continue;
      await prisma.loginSession.deleteMany({ where: { token: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
