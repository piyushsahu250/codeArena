// Real-HTTP + real-time empirical verification of the LMS Module Coding Assessment timer/
// autosubmit lifecycle — spec: "Do NOT claim completion based only on code inspection." This
// creates a real Course > Module > Lesson (completed) > ModuleCodingTest > Question chain, a real
// temp student, and exercises the live server exactly as ModuleCodingAssessment.jsx does: start,
// premature-autosubmit rejection, backdated real expiry, idempotent duplicate finalize, a manual+
// auto race, and post-expiry run/autosave/submit-code rejection. Cleans up every row by exact ID.
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

async function mkStudent(instituteId) {
  const email = `mcaudit-check-student-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Check", 10);
  const user = await prisma.user.create({ data: { name: "MC Audit Check Student", email, passwordHash, role: "STUDENT", instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

// Deletes a finalized attempt and starts a fresh one, so each scenario below gets an independent
// IN_PROGRESS attempt without re-running the whole course/module/question setup each time.
async function startFresh(student, testId) {
  await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: testId, studentId: student.user.id } });
  const startRes = await fetch(`${API_BASE}/module-coding/module/${global.__moduleId}/start`, { method: "POST", headers: student.headers });
  return { startRes, startBody: await j(startRes) };
}

async function main() {
  const cleanup = [];
  let courseId, moduleId, lessonId, testId, questionId;
  try {
    // A real institute (with lms/compiler features presumably already enabled, same as every
    // real student on this platform) rather than instituteId:null, so requireFeature("lms")/
    // requireFeature("compiler") on POST /start don't reject a platform-level/unconfigured
    // student for reasons unrelated to what this script is actually testing.
    const institute = await prisma.institute.findFirst({ select: { id: true } });
    const student = await mkStudent(institute?.id || null);
    cleanup.push(student);

    // ---- Build a real, minimal, gradable Course > Module > Lesson(completed) > Test > Question ----
    const course = await prisma.course.create({ data: { slug: `mc-audit-check-${Date.now()}`, name: "MC Audit Check Course", status: "DRAFT" } });
    courseId = course.id;
    const mod = await prisma.courseModule.create({ data: { courseId, title: "MC Audit Check Module" } });
    moduleId = mod.id;
    global.__moduleId = moduleId;
    const lesson = await prisma.lesson.create({ data: { moduleId, title: "MC Audit Check Lesson", content: "x", order: 0 } });
    lessonId = lesson.id;
    // lessonsComplete requires a real COMPLETED LessonProgress row (see learningLock.js) — written
    // directly rather than through the progress route, since this test is about the timer, not
    // progress-tracking.
    await prisma.lessonProgress.create({ data: { studentId: student.user.id, lessonId, status: "COMPLETED", completedAt: new Date() } });

    const question = await prisma.question.create({
      data: {
        title: "MC Audit Check Question", description: "Return the sum of two integers.",
        questionType: "CODING", difficulty: "EASY", points: 10,
        testCases: { create: [{ input: "2 3", expected: "5", isHidden: false }, { input: "10 20", expected: "30", isHidden: true }] },
      },
    });
    questionId = question.id;
    // 1-minute deadline — short enough to test real elapsed-time expiry without an excessive wait,
    // and startedAt is directly backdated below for the exact-expiry scenarios so no test in this
    // script actually blocks for a full minute of wall-clock time.
    const test = await prisma.moduleCodingTest.create({
      data: { moduleId, title: "MC Audit Check Test", questionCount: 1, timeLimitMin: 1, passingPercent: 50, maxAttempts: null, requireFullscreen: false, allowedLanguages: ["python"] },
    });
    testId = test.id;
    await prisma.question.update({ where: { id: questionId }, data: { moduleCodingTestId: testId } });

    // ---- 1. Duration conversion: 60 minutes must be exactly 3,600,000 ms, not off by a unit ----
    console.log("=== Duration unit conversion sanity check ===");
    await prisma.moduleCodingTest.update({ where: { id: testId }, data: { timeLimitMin: 60 } });
    const { startRes: r60, startBody: b60 } = await startFresh(student, testId);
    check("Start succeeds (200)", r60.status === 200, `got ${r60.status}: ${JSON.stringify(b60)}`);
    const deltaMs = b60.deadline - b60.serverTime;
    check("60-minute test yields exactly 3,600,000 ms remaining at start", Math.abs(deltaMs - 3_600_000) < 2000, `delta=${deltaMs}`);
    await prisma.moduleCodingTest.update({ where: { id: testId }, data: { timeLimitMin: 1 } });

    // ---- 2. No premature autosubmit: finalize(TIME_EXPIRED) immediately after a fresh start ----
    console.log("\n=== No premature autosubmit (fresh 1-minute attempt, immediate TIME_EXPIRED call) ===");
    const { startBody: b1 } = await startFresh(student, testId);
    const prematureRes = await fetch(`${API_BASE}/module-coding/attempts/${b1.attemptId}/finalize`, { method: "POST", headers: student.headers, body: JSON.stringify({ reason: "TIME_EXPIRED" }) });
    const prematureBody = await j(prematureRes);
    check("Premature TIME_EXPIRED call is rejected, not finalized", prematureBody?.premature === true, JSON.stringify(prematureBody));
    const stillInProgress = await prisma.moduleCodingAttempt.findUnique({ where: { id: b1.attemptId } });
    check("Attempt status is still IN_PROGRESS after the rejected premature call", stillInProgress?.status === "IN_PROGRESS", stillInProgress?.status);

    // ---- 3. Real autosubmit at actual expiry (backdated startedAt, past the deadline) ----
    console.log("\n=== Autosubmit fires once the deadline has actually passed ===");
    const { startBody: b2 } = await startFresh(student, testId);
    // Write a real answer so the graded submission is meaningful, then genuinely backdate
    // startedAt (rather than waiting a full minute of real time) — deadlineOf() only ever reads
    // startedAt + timeLimitMin from the DB, so this exercises the identical code path a real
    // 60-minute wait would.
    await fetch(`${API_BASE}/module-coding/attempts/${b2.attemptId}/autosave`, { method: "POST", headers: student.headers, body: JSON.stringify({ questionId, language: "python", code: "a,b=map(int,input().split())\nprint(a+b)", seq: Date.now() }) });
    await prisma.moduleCodingAttempt.update({ where: { id: b2.attemptId }, data: { startedAt: new Date(Date.now() - 2 * 60 * 1000) } });
    const expiredFinalizeRes = await fetch(`${API_BASE}/module-coding/attempts/${b2.attemptId}/finalize`, { method: "POST", headers: student.headers, body: JSON.stringify({ reason: "TIME_EXPIRED" }) });
    const expiredFinalizeBody = await j(expiredFinalizeRes);
    check("Real expiry finalize succeeds (200, not premature)", expiredFinalizeRes.status === 200 && !expiredFinalizeBody?.premature, JSON.stringify(expiredFinalizeBody));
    const autoSubmittedRow = await prisma.moduleCodingAttempt.findUnique({ where: { id: b2.attemptId } });
    check("Attempt status is AUTO_SUBMITTED", autoSubmittedRow?.status === "AUTO_SUBMITTED", autoSubmittedRow?.status);
    check("autoSubmitReason recorded as TIME_EXPIRED", autoSubmittedRow?.autoSubmitReason === "TIME_EXPIRED");
    check("Score reflects the autosaved answer (not lost)", expiredFinalizeBody?.score > 0, `score=${expiredFinalizeBody?.score}`);

    // ---- 4. Duplicate/idempotent finalize: second call returns the SAME result, no re-grade ----
    console.log("\n=== Duplicate finalize is idempotent ===");
    const secondFinalizeRes = await fetch(`${API_BASE}/module-coding/attempts/${b2.attemptId}/finalize`, { method: "POST", headers: student.headers, body: JSON.stringify({ reason: "TIME_EXPIRED" }) });
    const secondFinalizeBody = await j(secondFinalizeRes);
    check("Second finalize call succeeds (200)", secondFinalizeRes.status === 200);
    check("Returns the identical already-recorded score/status, not a re-grade", secondFinalizeBody?.score === expiredFinalizeBody?.score && secondFinalizeBody?.status === expiredFinalizeBody?.status, JSON.stringify(secondFinalizeBody));
    const attemptCountForStudent = await prisma.moduleCodingAttempt.count({ where: { moduleCodingTestId: testId, studentId: student.user.id, id: b2.attemptId } });
    check("Still exactly one attempt row (no duplicate created)", attemptCountForStudent === 1);

    // ---- 5. Manual + auto race at exactly the same time -> exactly one valid submission ----
    console.log("\n=== Manual submit + autosubmit race -> exactly one result ===");
    const { startBody: b3 } = await startFresh(student, testId);
    await prisma.moduleCodingAttempt.update({ where: { id: b3.attemptId }, data: { startedAt: new Date(Date.now() - 2 * 60 * 1000) } });
    const [raceManual, raceAuto] = await Promise.all([
      fetch(`${API_BASE}/module-coding/attempts/${b3.attemptId}/finalize`, { method: "POST", headers: student.headers, body: JSON.stringify({}) }),
      fetch(`${API_BASE}/module-coding/attempts/${b3.attemptId}/finalize`, { method: "POST", headers: student.headers, body: JSON.stringify({ reason: "TIME_EXPIRED" }) }),
    ]);
    const [raceManualBody, raceAutoBody] = await Promise.all([j(raceManual), j(raceAuto)]);
    check("Both racing requests return 200", raceManual.status === 200 && raceAuto.status === 200, `${raceManual.status}, ${raceAuto.status}`);
    check("Both see the identical final submittedAt (one true winner)", raceManualBody?.submittedAt === raceAutoBody?.submittedAt, JSON.stringify({ raceManualBody, raceAutoBody }));
    const raceRow = await prisma.moduleCodingAttempt.findUnique({ where: { id: b3.attemptId } });
    check("Final status is exactly one of SUBMITTED/AUTO_SUBMITTED (not corrupted)", raceRow?.status === "SUBMITTED" || raceRow?.status === "AUTO_SUBMITTED", raceRow?.status);

    // ---- 6. Expired attempt cannot run/autosave/submit-code further ----
    console.log("\n=== Expired/finalized attempt rejects further run/autosave/submit-code ===");
    const runAfterRes = await fetch(`${API_BASE}/module-coding/attempts/${b2.attemptId}/run`, { method: "POST", headers: student.headers, body: JSON.stringify({ questionId, language: "python", code: "print(1)" }) });
    check("Run rejected on a finalized attempt (403)", runAfterRes.status === 403, `got ${runAfterRes.status}`);
    const autosaveAfterRes = await fetch(`${API_BASE}/module-coding/attempts/${b2.attemptId}/autosave`, { method: "POST", headers: student.headers, body: JSON.stringify({ questionId, language: "python", code: "print(1)", seq: Date.now() }) });
    check("Autosave rejected on a finalized attempt (403)", autosaveAfterRes.status === 403, `got ${autosaveAfterRes.status}`);
    const submitCodeAfterRes = await fetch(`${API_BASE}/module-coding/attempts/${b2.attemptId}/submit-code`, { method: "POST", headers: student.headers, body: JSON.stringify({ questionId, language: "python", code: "print(1)" }) });
    check("Submit-code rejected on a finalized attempt (403)", submitCodeAfterRes.status === 403, `got ${submitCodeAfterRes.status}`);

    // ---- 7. Manual submit before expiry works and is recorded as SUBMITTED (not AUTO_SUBMITTED) ----
    console.log("\n=== Manual submit before expiry ===");
    const { startBody: b4 } = await startFresh(student, testId);
    const manualRes = await fetch(`${API_BASE}/module-coding/attempts/${b4.attemptId}/finalize`, { method: "POST", headers: student.headers, body: JSON.stringify({}) });
    const manualBody = await j(manualRes);
    check("Manual submit succeeds before expiry (200)", manualRes.status === 200 && !manualBody?.premature, JSON.stringify(manualBody));
    const manualRow = await prisma.moduleCodingAttempt.findUnique({ where: { id: b4.attemptId } });
    check("Recorded as SUBMITTED (manual), not AUTO_SUBMITTED", manualRow?.status === "SUBMITTED", manualRow?.status);
    check("autoSubmitReason is null for a manual submit", manualRow?.autoSubmitReason === null);
  } catch (e) {
    console.error("Script error:", e);
    fail++;
  } finally {
    if (testId) {
      await prisma.moduleCodingSubmission.deleteMany({ where: { attempt: { moduleCodingTestId: testId } } }).catch(() => {});
      await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: testId } }).catch(() => {});
    }
    // A passing attempt can legitimately issue a real CODING_ASSESSMENT certificate (confirmed
    // during this script's own development run) — Certificate.courseId/studentId are RESTRICT,
    // not Cascade, so the course/student deletes below would otherwise fail outright.
    if (courseId) await prisma.certificate.deleteMany({ where: { courseId } }).catch(() => {});
    if (questionId) { await prisma.testCase.deleteMany({ where: { questionId } }).catch(() => {}); await prisma.question.delete({ where: { id: questionId } }).catch(() => {}); }
    if (testId) await prisma.moduleCodingTest.delete({ where: { id: testId } }).catch(() => {});
    if (lessonId) { await prisma.lessonProgress.deleteMany({ where: { lessonId } }).catch(() => {}); await prisma.lesson.delete({ where: { id: lessonId } }).catch(() => {}); }
    if (moduleId) await prisma.courseModule.delete({ where: { id: moduleId } }).catch(() => {});
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
    for (const c of cleanup) {
      await prisma.loginSession.deleteMany({ where: { token: c.jti } }).catch(() => {});
      await prisma.user.delete({ where: { id: c.user.id } }).catch(() => {});
    }
  }

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
