// Live check of the formal Test engine's security: question-enumeration guard, policy validation, phone refusal,
// one-active-session control, IDOR on attempts, evidence + monitor RBAC, overview scoping, answer-key leakage.
// Uses two throwaway institutes; cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: "ZZ Verify TS " } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.question.deleteMany({ where: { title: { startsWith: "ZZ Verify TS " } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-ts-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify TS A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify TS B ${ts}` } });
  const mk = async (name, role, instituteId) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-ts-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } }); return { ...u, pw }; };
  const staffA = await mk("Staff A", "STAFF", A.id), staffB = await mk("Staff B", "STAFF", B.id), stuA = await mk("Student A", "STUDENT", A.id), stuA2 = await mk("Student A2", "STUDENT", A.id), stuB = await mk("Student B", "STUDENT", B.id);
  try {
    const qs = [];
    for (let i = 1; i <= 3; i++) qs.push(await prisma.question.create({ data: { title: `ZZ Verify TS Q${i}`, description: `Pick the right option ${i}`, questionType: "MCQ", difficulty: "EASY", points: 5, options: ["a", "b", "c"], correctAnswer: [1], instituteId: A.id } }));
    const now = Date.now();
    const mkTest = (title, extra = {}) => prisma.test.create({ data: { title, durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 3600000), isPublished: true, requireFullscreen: false, createdById: staffA.id, instituteId: A.id, questions: { create: qs.map((q, order) => ({ questionId: q.id, order })) }, ...extra } });
    const std = await mkTest("ZZ Verify TS standard");
    const prc = await mkTest("ZZ Verify TS proctored", { securityLevel: "PROCTORED" });
    const future = await mkTest("ZZ Verify TS future", { startTime: new Date(now + 7200000), endTime: new Date(now + 9000000) });
    const T = {}; for (const [k, u] of Object.entries({ staffA, staffB, stuA, stuA2, stuB })) T[k] = await login(u.email, u.pw);

    // --- policy validation (admin side)
    const mkBody = (extra) => ({ title: `ZZ Verify TS created ${rand().slice(0, 4)}`, durationMin: 20, startTime: new Date(now + 1000).toISOString(), endTime: new Date(now + 7200000).toISOString(), questionIds: [qs[0].id], ...extra });
    const bad = await call("POST", "/tests", T.staffA, mkBody({ securityLevel: "LOCKDOWN" }));
    check("LOCKDOWN is refused for formal tests (needs the secure client)", bad.status === 400 && /LOCKDOWN/.test(bad.body?.error || ""));
    check("unknown security level is refused", (await call("POST", "/tests", T.staffA, mkBody({ securityLevel: "NOPE" }))).status === 400);
    const made = await call("POST", "/tests", T.staffA, mkBody({ securityLevel: "PROCTORED", securityPolicy: { mobileAllowed: true, secureBrowserRequired: true, bogus: 1 } }));
    check("staff can create a PROCTORED test", made.status === 201 || made.status === 200, String(made.status));
    const madeRow = made.body?.id ? await prisma.test.findUnique({ where: { id: made.body.id } }) : null;
    check("unsupported/unknown policy keys are dropped, valid ones kept", madeRow?.securityLevel === "PROCTORED" && madeRow?.securityPolicy?.mobileAllowed === true && !("secureBrowserRequired" in (madeRow?.securityPolicy || {})) && !("bogus" in (madeRow?.securityPolicy || {})), JSON.stringify(madeRow?.securityPolicy));

    // --- question enumeration guard
    const pre = await call("GET", `/tests/${std.id}`, T.stuA);
    check("before starting, a student gets NO questions (aggregate summary only)", pre.status === 200 && pre.body.questions.length === 0 && pre.body.questionSummary?.count === 3 && pre.body.questionSummary?.maxMarks === 15, JSON.stringify(pre.body?.questionSummary));
    check("pre-start payload carries no answer keys or question text", !/correctAnswer|Pick the right option/.test(JSON.stringify(pre.body)));
    const fut = await call("GET", `/tests/${future.id}`, T.stuA);
    check("a test that has not opened yet leaks no questions either", fut.status === 200 && fut.body.questions.length === 0);
    check("another institute's student cannot see the test at all", (await call("GET", `/tests/${std.id}`, T.stuB)).status === 404);
    const stSt = await call("POST", `/tests/${std.id}/start`, T.stuA);
    check("student starts the test and receives a session id", stSt.status === 200 && typeof stSt.body.sessionId === "string" && stSt.body.sessionId.length >= 16);
    const inProg = await call("GET", `/tests/${std.id}`, T.stuA);
    check("once started, the assigned questions are delivered without answer keys", inProg.body.questions.length === 3 && !JSON.stringify(inProg.body).includes("correctAnswer"));
    check("a not-yet-open test cannot be started", (await call("POST", `/tests/${future.id}/start`, T.stuA)).status === 403);

    // --- phone refusal + session control on the proctored test
    const phone = await call("POST", `/tests/${prc.id}/start`, T.stuA2, null, { "User-Agent": PHONE_UA });
    check("PROCTORED test refuses a phone browser at the server (403 MOBILE_NOT_SUPPORTED)", phone.status === 403 && phone.body?.code === "MOBILE_NOT_SUPPORTED");
    check("the page cannot lower this: STANDARD test still allows a phone", (await call("POST", `/tests/${std.id}/start`, T.stuA2, null, { "User-Agent": PHONE_UA })).status === 200);
    const p1 = await call("POST", `/tests/${prc.id}/start`, T.stuA);
    check("desktop start on the PROCTORED test works and returns the policy", p1.status === 200 && p1.body.security?.level === "PROCTORED" && p1.body.security?.multiSession === "BLOCK" && p1.body.security?.mobileAllowed === false);
    const att = p1.body.id, s1 = p1.body.sessionId;
    const qid = qs[0].id;
    const ok1 = await call("POST", "/submissions/submit", T.stuA, { attemptId: att, questionId: qid, selectedOptions: [1] }, { "X-Exam-Session": s1 });
    check("answer with the owning session id is accepted", ok1.status === 200, String(ok1.status));
    const p2 = await call("POST", `/tests/${prc.id}/start`, T.stuA);
    check("a second start (refresh / other tab) takes the session over", p2.status === 200 && p2.body.sessionId !== s1);
    const stale = await call("POST", "/submissions/submit", T.stuA, { attemptId: att, questionId: qid, selectedOptions: [2] }, { "X-Exam-Session": s1 });
    check("the stale tab is refused with 409 SESSION_REPLACED", stale.status === 409 && stale.body?.code === "SESSION_REPLACED");
    const noHeader = await call("POST", "/submissions/submit", T.stuA, { attemptId: att, questionId: qid, selectedOptions: [2] });
    check("a request with no session header is refused too (PROCTORED)", noHeader.status === 409);
    check("the new session still works", (await call("POST", "/submissions/submit", T.stuA, { attemptId: att, questionId: qid, selectedOptions: [0] }, { "X-Exam-Session": p2.body.sessionId })).status === 200);
    check("the stale session was recorded as evidence", (await prisma.examSecurityEvent.count({ where: { attemptKind: "TEST", attemptId: att, type: "SESSION_REPLACED" } })) >= 1);

    // --- IDOR on attempts
    check("another student cannot submit into this attempt", [403, 404].includes((await call("POST", "/submissions/submit", T.stuA2, { attemptId: att, questionId: qid, selectedOptions: [1] }, { "X-Exam-Session": p2.body.sessionId })).status));
    check("another student cannot report violations on this attempt", (await call("POST", `/tests/attempts/${att}/violation`, T.stuA2, { type: "COPY" })).status === 403);
    check("staff role cannot call student-only start/violation", (await call("POST", `/tests/${std.id}/start`, T.staffA)).status === 403);

    // --- evidence: new signal types + server-side classification
    const v1 = await call("POST", `/tests/attempts/${att}/violation`, T.stuA, { type: "POSSIBLE_EXTERNAL_ASSISTANT" }, { "X-Exam-Session": p2.body.sessionId });
    check("focus-lost-while-visible is recorded as SUSPICIOUS (not penalized the first time)", v1.status === 200 && v1.body.severity === "SUSPICIOUS" && v1.body.penalized === false, JSON.stringify(v1.body));
    const v2 = await call("POST", `/tests/attempts/${att}/violation`, T.stuA, { type: "SPLIT_SCREEN_SUSPECTED" }, { "X-Exam-Session": p2.body.sessionId });
    check("split-screen signal is recorded as SUSPICIOUS", v2.status === 200 && v2.body.severity === "SUSPICIOUS");
    const v3 = await call("POST", `/tests/attempts/${att}/violation`, T.stuA, { type: "POSSIBLE_EXTERNAL_ASSISTANT", severity: "INTERRUPTION", penalized: false }, { "X-Exam-Session": p2.body.sessionId });
    check("the client cannot choose severity: the third SUSPICIOUS event escalates to a strike", v3.status === 200 && v3.body.penalized === true, JSON.stringify(v3.body));

    // --- monitor + overview RBAC / isolation
    const mon = await call("GET", `/exam-security/exams/${prc.id}/monitor`, T.staffA);
    check("creator staff sees the monitor with this attempt, counts and policy", mon.status === 200 && mon.body.rows.some((r) => r.attemptId === att && r.counts.focusLoss >= 2 && r.counts.sessionConflicts >= 1) && mon.body.policy.level === "PROCTORED", JSON.stringify(mon.body?.rows?.[0]?.counts));
    check("staff of another institute cannot open this test's monitor", (await call("GET", `/exam-security/exams/${prc.id}/monitor`, T.staffB)).status === 403);
    check("students cannot open the monitor or a timeline", (await call("GET", `/exam-security/exams/${prc.id}/monitor`, T.stuA)).status === 403 && (await call("GET", `/exam-security/exam-attempts/${att}/timeline`, T.stuA)).status === 403);
    const tl = await call("GET", `/exam-security/exam-attempts/${att}/timeline`, T.staffA);
    check("timeline shows start, signals and the session conflict in order", tl.status === 200 && tl.body.timeline[0].type === "EXAM_STARTED" && tl.body.timeline.some((e) => e.type === "SESSION_REPLACED") && tl.body.timeline.some((e) => e.type === "POSSIBLE_EXTERNAL_ASSISTANT"));
    check("staff of another institute cannot read the timeline", (await call("GET", `/exam-security/exam-attempts/${att}/timeline`, T.staffB)).status === 403);
    const ov = await call("GET", "/exam-security/overview", T.staffA);
    check("staff cannot use the platform overview", ov.status === 403);

    // --- a finished attempt gets no questions while the window is open (no sharing with others)
    await call("POST", `/submissions/finalize/${att}`, T.stuA, { reason: "manual" }, { "X-Exam-Session": p2.body.sessionId });
    const done = await call("GET", `/tests/${prc.id}`, T.stuA);
    check("after submitting, questions are withheld again while the test window is open", done.status === 200 && done.body.questions.length === 0);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nTEST SECURITY VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
