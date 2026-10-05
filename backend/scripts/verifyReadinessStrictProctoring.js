// One-off live verification of the strict/proctored Readiness flow against the running API:
// no score/correctness leakage while in progress, server-enforced violation termination, attempt
// cap counting TERMINATED, grading-at-finalize, server-side expiry (resume/GET/sweep), proctoring
// snapshot semantics. Creates disposable students and deletes everything afterward. The one
// deliberate persistent change: proctoring is switched ON for the DSA subject (webcam+mic,
// maxViolations 3) as requested -- the temporary maxAttempts tweak is restored.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { shuffleQuestionOptions, toOriginalSelection } = require("../src/utils/optionShuffle");

const BASE = "http://localhost:4000/api";
let failures = 0;
function check(label, ok, extra = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
}

async function main() {
  const poolCounts = await prisma.readinessQuestionPool.groupBy({ by: ["subjectId"], _count: true });
  if (!poolCounts.length) throw new Error("No subject with question pool");
  const subject = await prisma.readinessSubject.findUnique({ where: { id: poolCounts[0].subjectId }, include: { academicGroupAssignments: { include: { academicGroup: true } } } });
  const assignment = subject.academicGroupAssignments[0] || null;
  const instituteId = assignment ? assignment.academicGroup.instituteId : (await prisma.institute.findFirst({ where: { isActive: true } })).id;
  const origMaxAttempts = subject.maxAttempts;
  const mode = "FOUNDATION";
  console.log(`Subject "${subject.name}" ${subject.id}; mode ${mode}; original maxAttempts=${origMaxAttempts}`);

  await prisma.readinessSubject.update({ where: { id: subject.id }, data: { proctoringEnabled: true, requireWebcam: true, requireMicrophone: true, maxViolations: 3, maxAttempts: null } });

  const created = [];
  async function makeStudent(tag) {
    const email = `verify-strict-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
    const password = crypto.randomBytes(18).toString("base64url");
    const user = await prisma.user.create({
      data: { name: `Verify Strict ${tag}`, email, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT", instituteId, mustChangePassword: false, academicGroupId: assignment?.academicGroupId || null, program: assignment?.program || null },
    });
    created.push(user.id);
    const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const body = await res.json();
    if (!res.ok) throw new Error(`login failed ${JSON.stringify(body)}`);
    return { user, auth: { Authorization: `Bearer ${body.token}`, "Content-Type": "application/json" } };
  }
  const call = async (auth, method, path, body) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
  const hasLeak = (o) => JSON.stringify(o).match(/"(isCorrect|score)"/) !== null;
  const start = (s, m = mode) => call(s.auth, "POST", "/readiness/assessments", { subjectId: subject.id, assessmentMode: m, questionCount: 5 });

  try {
    // ===== 1. Proctored attempt: snapshot, no leakage, violation termination =====
    console.log("\n=== 1. Proctored attempt ===");
    const s1 = await makeStudent("a");
    const st = await start(s1);
    check("start OK", st.status === 200, `HTTP ${st.status} ${st.status !== 200 ? JSON.stringify(st.body) : ""}`);
    const A = st.body.assessment;
    check("config.proctoring snapshotted (enabled, cam, mic, max 3)", A.config?.proctoring?.enabled && A.config.proctoring.requireWebcam && A.config.proctoring.requireMicrophone && A.config.proctoring.maxViolations === 3, JSON.stringify(A.config?.proctoring));
    check("serverTime returned", !!st.body.serverTime);

    // pick the correct MCQ option (display space) for one question, wrong for code
    let sawQuiz = false;
    for (const q of st.body.questions) {
      let payload;
      if (["MCQ", "TRUE_FALSE", "MULTISELECT"].includes(q.questionType)) {
        const full = await prisma.question.findUnique({ where: { id: q.id } });
        const order = shuffleQuestionOptions(full.options, null, `${A.id}:${q.id}`).order;
        const correct = Array.isArray(full.correctAnswer) ? full.correctAnswer : [full.correctAnswer];
        const display = correct.map((c) => { for (let d = 0; d < order.length; d++) if (toOriginalSelection([d], order)[0] === Number(c)) return d; return 0; });
        payload = { questionId: q.id, selectedOptions: display, skipped: false };
        sawQuiz = true;
      } else payload = { questionId: q.id, code: "print('x')", language: "python", skipped: false };
      const r = await call(s1.auth, "POST", `/readiness/assessments/${A.id}/answer`, payload);
      check(`/answer [${q.questionType}] saved, no score/isCorrect in response`, r.status === 200 && r.body.saved && !hasLeak(r.body), `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    }
    const get1 = await call(s1.auth, "GET", `/readiness/assessments/${A.id}`);
    check("GET in-progress has no score/isCorrect anywhere in answers", get1.status === 200 && !JSON.stringify(get1.body.questions.map((q) => q.answer)).match(/"(isCorrect|score)"/) && !JSON.stringify(get1.body.assessment.answers).match(/"(isCorrect|score)"/));
    const row = await prisma.readinessAnswer.findFirst({ where: { assessmentId: A.id, skipped: false } });
    check("drafts stored ungraded server-side (isCorrect null) until finalize", row && row.isCorrect === null);
    const resumed = await start(s1);
    check("re-start resumes same attempt (answers stripped)", resumed.body.resumed === true && resumed.body.assessment.id === A.id && !JSON.stringify(resumed.body.assessment.answers).match(/"(isCorrect|score)"/));
    const forged = await call(s1.auth, "POST", `/readiness/assessments/${A.id}/answer`, { questionId: crypto.randomUUID(), selectedOptions: [0] });
    check("answer for question outside assessment rejected", forged.status === 403 || forged.status === 404, `HTTP ${forged.status}`);

    const v = async (type) => (await call(s1.auth, "POST", `/readiness/assessments/${A.id}/violation`, { type })).body;
    const f1 = await v("FACE_MISSING");
    check("INTERRUPTION (face missing) never penalized", f1.penalized === false && f1.violationCount === 0, JSON.stringify(f1));
    const c1 = await v("COPY");
    check("1st COPY is SUSPICIOUS, not penalized", c1.severity === "SUSPICIOUS" && c1.penalized === false, JSON.stringify(c1));
    const t1 = await v("TAB_SWITCH"); const t2 = await v("TAB_SWITCH");
    check("TAB_SWITCH x2 penalized, counted 2/3, not terminated", t1.violationCount === 1 && t2.violationCount === 2 && !t2.autoSubmitted, JSON.stringify(t2));
    const t3 = await v("FULLSCREEN_EXIT");
    check("3rd penalized violation auto-terminates", t3.autoSubmitted === true && t3.violationCount === 3, JSON.stringify(t3));
    const after = await prisma.readinessAssessment.findUnique({ where: { id: A.id }, include: { report: true } });
    check("status TERMINATED + MAX_VIOLATIONS + report built", after.status === "TERMINATED" && after.terminationReason === "MAX_VIOLATIONS" && !!after.report, `${after.status}/${after.terminationReason}`);
    const late = await call(s1.auth, "POST", `/readiness/assessments/${A.id}/answer`, { questionId: st.body.questions[0].id, selectedOptions: [0] });
    check("answer after termination rejected", late.status === 400, `HTTP ${late.status}`);
    const again = await v("TAB_SWITCH");
    check("violation after termination is a no-op", again.autoSubmitted === true && again.violationCount === 3);
    const fin = await call(s1.auth, "POST", `/readiness/assessments/${A.id}/finalize`);
    check("finalize after termination is idempotent, stays TERMINATED", fin.status === 200 && fin.body.assessment.status === "TERMINATED");
    const certs = await prisma.certificate.count({ where: { studentId: s1.user.id } });
    check("no certificate for terminated attempt", certs === 0);

    // cap counts TERMINATED
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { maxAttempts: 1 } });
    const capped = await start(s1);
    check("TERMINATED attempt consumes the attempt cap", capped.status === 403 && capped.body.maxAttemptsReached === true, `HTTP ${capped.status}`);
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { maxAttempts: null } });

    // ===== 2. Normal submit grades drafts at finalize =====
    console.log("\n=== 2. Normal submit ===");
    const s2 = await makeStudent("b");
    const st2 = await start(s2, "COMPLETE");
    const B = st2.body.assessment;
    let quizCount = 0;
    // DSA's pool is coding-only; splice a real MCQ into this attempt so the shuffle->original grading path is exercised.
    const mcq = await prisma.question.findFirst({ where: { questionType: "MCQ", correctAnswer: { not: null } } });
    if (mcq) await prisma.readinessAnswer.create({ data: { assessmentId: B.id, questionId: mcq.id, skipped: true } });
    for (const q of [...st2.body.questions, ...(mcq ? [{ id: mcq.id, questionType: "MCQ" }] : [])]) {
      if (!["MCQ", "TRUE_FALSE", "MULTISELECT"].includes(q.questionType)) continue;
      const full = await prisma.question.findUnique({ where: { id: q.id } });
      const order = shuffleQuestionOptions(full.options, null, `${B.id}:${q.id}`).order;
      const correct = Array.isArray(full.correctAnswer) ? full.correctAnswer : [full.correctAnswer];
      const display = correct.map((c) => { for (let d = 0; d < order.length; d++) if (toOriginalSelection([d], order)[0] === Number(c)) return d; return 0; });
      await call(s2.auth, "POST", `/readiness/assessments/${B.id}/answer`, { questionId: q.id, selectedOptions: display, skipped: false });
      quizCount++;
    }
    const ungraded = await prisma.readinessAnswer.count({ where: { assessmentId: B.id, skipped: false, isCorrect: null } });
    check("answers ungraded before submit", ungraded === quizCount, `${ungraded}/${quizCount}`);
    const fin2 = await call(s2.auth, "POST", `/readiness/assessments/${B.id}/finalize`);
    check("finalize COMPLETED", fin2.status === 200 && fin2.body.assessment.status === "COMPLETED", `${fin2.status} ${fin2.body?.assessment?.status}`);
    const graded = (await prisma.readinessAnswer.findMany({ where: { assessmentId: B.id, skipped: false }, include: { question: { select: { questionType: true } } } })).filter((a) => ["MCQ", "TRUE_FALSE", "MULTISELECT"].includes(a.question?.questionType));
    check("quiz answers graded correct at finalize (shuffle mapped back)", quizCount > 0 && graded.every((a) => a.isCorrect === true), JSON.stringify(graded.map((a) => [a.isCorrect, a.score])));
    check("no answered draft left ungraded after finalize", (await prisma.readinessAnswer.count({ where: { assessmentId: B.id, skipped: false, isCorrect: null } })) === 0);
    check("report overallScore > 0", fin2.body.report?.overallScore > 0, String(fin2.body.report?.overallScore));
    const get2 = await call(s2.auth, "GET", `/readiness/assessments/${B.id}`);
    check("completed attempt DOES show results to student", JSON.stringify(get2.body.questions.map((q) => q.answer)).includes("isCorrect"));

    // ===== 3. Server-side expiry =====
    console.log("\n=== 3. Expiry ===");
    const s3 = await makeStudent("c");
    const st3 = await start(s3);
    const C = st3.body.assessment;
    await call(s3.auth, "POST", `/readiness/assessments/${C.id}/answer`, { questionId: st3.body.questions[0].id, selectedOptions: [0], skipped: false });
    await prisma.readinessAssessment.update({ where: { id: C.id }, data: { startedAt: new Date(Date.now() - (C.durationMin + 1) * 60000) } });
    const late3 = await call(s3.auth, "POST", `/readiness/assessments/${C.id}/answer`, { questionId: st3.body.questions[0].id, selectedOptions: [1], skipped: false });
    check("answer after deadline rejected (403 time up)", late3.status === 403, `HTTP ${late3.status}`);
    const g3 = await call(s3.auth, "GET", `/readiness/assessments/${C.id}`);
    check("GET on expired in-progress attempt closes it (409 finalized)", g3.status === 409 && g3.body.finalized === true, `HTTP ${g3.status}`);
    const c3 = await prisma.readinessAssessment.findUnique({ where: { id: C.id } });
    check("expired attempt status EXPIRED", c3.status === "EXPIRED", c3.status);

    const s4 = await makeStudent("d");
    const st4 = await start(s4);
    const D = st4.body.assessment;
    await prisma.readinessAssessment.update({ where: { id: D.id }, data: { startedAt: new Date(Date.now() - (D.durationMin + 30) * 60000) } });
    const { runOnce } = require("../src/utils/testAttemptAutoFinalizeScheduler");
    const sweep = await runOnce();
    const d4 = await prisma.readinessAssessment.findUnique({ where: { id: D.id } });
    check("sweep closes abandoned expired attempt", d4.status === "EXPIRED" && sweep.readinessClosed >= 1, `${d4.status}, closed=${sweep.readinessClosed}`);

    const s5 = await makeStudent("e");
    const st5 = await start(s5);
    await prisma.readinessAssessment.update({ where: { id: st5.body.assessment.id }, data: { startedAt: new Date(Date.now() - (st5.body.assessment.durationMin + 5) * 60000) } });
    const restart = await start(s5);
    check("start on a stale in-progress attempt closes it and begins a fresh one", restart.status === 200 && restart.body.resumed === false && restart.body.assessment.id !== st5.body.assessment.id, `HTTP ${restart.status}`);

    // ===== 4. Snapshot semantics =====
    console.log("\n=== 4. Snapshot ===");
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { proctoringEnabled: false } });
    const s6 = await makeStudent("f");
    const st6 = await start(s6);
    check("proctoring off => new attempt has enabled:false", st6.body.assessment.config?.proctoring?.enabled === false);
    const forge = await call(s6.auth, "POST", `/readiness/assessments/${st6.body.assessment.id}/violation`, { type: "TAB_SWITCH" });
    check("violations on unproctored attempt never terminate/count", forge.body.autoSubmitted === false && forge.body.violationCount === 0, JSON.stringify(forge.body));
    const old = await call(s1.auth, "GET", `/readiness/assessments/${A.id}`);
    check("earlier attempt keeps its own snapshot", old.body.assessment.config?.proctoring?.enabled === true);
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { proctoringEnabled: true } });
  } finally {
    await prisma.readinessAssessment.deleteMany({ where: { studentId: { in: created } } }).catch((e) => console.log("cleanup assessments:", e.message));
    await prisma.certificate.deleteMany({ where: { studentId: { in: created } } }).catch(() => {});
    await prisma.loginSession.deleteMany({ where: { userId: { in: created } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: created } } }).catch((e) => console.log("cleanup users:", e.message));
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { maxAttempts: origMaxAttempts, proctoringEnabled: true, requireWebcam: true, requireMicrophone: true, maxViolations: 3 } });
    console.log(`\nCleaned up ${created.length} temp students; maxAttempts restored to ${origMaxAttempts}; DSA proctoring left ENABLED.`);
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
}

main().then(() => process.exit(failures ? 1 : 0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
