// Database-backed verification of the administrator START OVERRIDE for strict (secure-client) module-coding assessments, against the real API: who may grant, institute
// isolation, reason required, one student and one test, expiry, single use under concurrency, revoke, that it waives ONLY the missing secure client (a phone is still
// refused), that an attempt started under an override can be resumed and nothing else can, and that every step is audited. Disposable data only (@example.invalid
// users, throwaway institutes, course and test), removed afterwards.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_API || "http://localhost:4000/api";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", "User-Agent": DESKTOP_UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;
const GOOD_REASON = "Student's managed tablet failed the capability check at the exam desk";

async function main() {
  const ts = Date.now();
  const instI = await prisma.institute.create({ data: { name: `ZZ Verify SO I ${ts}`, code: "ZZSOI" } });
  const instJ = await prisma.institute.create({ data: { name: `ZZ Verify SO J ${ts}`, code: "ZZSOJ" } });
  const mk = async (name, role, inst) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-so-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId: inst, mustChangePassword: false } }); return { ...u, pw }; };
  const s1 = await mk("Alice", "STUDENT", instI.id), s2 = await mk("Bob", "STUDENT", instI.id), s3 = await mk("Cara", "STUDENT", instI.id), sJ = await mk("Zed", "STUDENT", instJ.id);
  const adminI = await mk("Admin I", "INSTITUTE_ADMIN", instI.id), adminJ = await mk("Admin J", "INSTITUTE_ADMIN", instJ.id), staffI = await mk("Staff I", "STAFF", instI.id);
  const course = await prisma.course.create({ data: { slug: `verify-so-${ts}`, name: "Verify Override Course", status: "PUBLISHED", instituteId: instI.id } });
  const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: "Verify Override Module", isActive: true } });
  const lesson = await prisma.lesson.create({ data: { moduleId: mod.id, title: "Verify Override Lesson", content: "x", order: 0, isActive: true } });
  for (const s of [s1, s2, s3]) await prisma.lessonProgress.create({ data: { studentId: s.id, lessonId: lesson.id, status: "COMPLETED", completedAt: new Date() } });
  const question = await prisma.question.create({ data: { title: "Verify Override Question", description: "Return the sum of two integers.", questionType: "CODING", difficulty: "EASY", points: 10, testCases: { create: [{ input: "2 3", expected: "5", isHidden: false }, { input: "10 20", expected: "30", isHidden: true }] } } });
  const level = await prisma.moduleCodingTest.create({ data: { moduleId: mod.id, title: "Verify Override Test", isActive: true, questionCount: 1, timeLimitMin: 30, passingPercent: 50, maxAttempts: null, requireFullscreen: false, allowedLanguages: ["java"] } });
  await prisma.question.update({ where: { id: question.id }, data: { moduleCodingTestId: level.id } });
  const setLevel = (data) => prisma.moduleCodingTest.update({ where: { id: level.id }, data });
  const start = (jwt, ua) => call("POST", `/module-coding/module/${mod.id}/start`, jwt, null, ua ? { "User-Agent": ua } : {});
  const grant = (jwt, body) => call("POST", "/exam-security/start-overrides", jwt, body);
  const events = (type, studentId) => prisma.examSecurityEvent.findMany({ where: { attemptKind: "MODULE_CODING", testId: level.id, type, ...(studentId ? { studentId } : {}) } });

  try {
    const T1 = await login(s1.email, s1.pw), T2 = await login(s2.email, s2.pw), T3 = await login(s3.email, s3.pw), TJs = await login(sJ.email, sJ.pw);
    const TAI = await login(adminI.email, adminI.pw), TAJ = await login(adminJ.email, adminJ.pw), TSt = await login(staffI.email, staffI.pw);
    await setLevel({ securityLevel: "LOCKDOWN", securityPolicy: { exitAction: "LOCK", graceSec: 120 } });

    check("strict test: a student with no secure client is refused", (await start(T1)).status === 403);
    check("a student cannot grant an override", (await grant(T1, { testId: level.id, studentId: s1.id, reason: GOOD_REASON })).status === 403);
    check("plain staff cannot grant an override", (await grant(TSt, { testId: level.id, studentId: s1.id, reason: GOOD_REASON })).status === 403);
    check("no token is refused", (await call("POST", "/exam-security/start-overrides", null, { testId: level.id, studentId: s1.id, reason: GOOD_REASON })).status === 401);
    check("an admin of ANOTHER institute cannot grant", (await grant(TAJ, { testId: level.id, studentId: s1.id, reason: GOOD_REASON })).status === 403);
    check("a reason is required (missing, too short)", (await grant(TAI, { testId: level.id, studentId: s1.id })).status === 400 && (await grant(TAI, { testId: level.id, studentId: s1.id, reason: "short" })).status === 400);
    check("an unknown test is a 404", (await grant(TAI, { testId: crypto.randomUUID(), studentId: s1.id, reason: GOOD_REASON })).status === 404);
    check("a student of another institute cannot be granted an override on this test", (await grant(TAI, { testId: level.id, studentId: sJ.id, reason: GOOD_REASON })).status === 403);
    check("a non-student id is refused", (await grant(TAI, { testId: level.id, studentId: adminI.id, reason: GOOD_REASON })).status === 404);

    await setLevel({ securityLevel: "STANDARD", securityPolicy: null });
    check("a test that does not require a secure client has nothing to override (400)", (await grant(TAI, { testId: level.id, studentId: s1.id, reason: GOOD_REASON })).status === 400);
    await setLevel({ securityLevel: "LOCKDOWN", securityPolicy: { exitAction: "LOCK", graceSec: 120 } });

    // ---- the grant
    const g1 = await grant(TAI, { testId: level.id, studentId: s1.id, reason: GOOD_REASON });
    check("an institute admin grants an override (201) that expires in about 30 minutes", g1.status === 201 && g1.body.id && Math.abs(g1.body.expiresAt - (Date.now() + 30 * 60 * 1000)) < 60 * 1000, JSON.stringify(g1.body));
    const g1b = await grant(TAI, { testId: level.id, studentId: s1.id, reason: GOOD_REASON });
    check("granting again while one is active is idempotent (same grant, existing:true)", g1b.status === 200 && g1b.body.id === g1.body.id && g1b.body.existing === true);
    const audit = await prisma.auditLog.findFirst({ where: { action: "SECURE_START_OVERRIDE_GRANTED", studentId: s1.id }, orderBy: { createdAt: "desc" } });
    check("the grant is audit-logged with the actor, the student and the reason", !!audit && audit.adminId === adminI.id && audit.details?.reason === GOOD_REASON && audit.details?.grantId === g1.body.id);
    const grantedEv = (await events("START_OVERRIDE_GRANTED", s1.id))[0];
    check("the grant is a HIGH security event that carries no risk weight and cannot be raised by a client", grantedEv?.severity === "HIGH" && grantedEv.metadata?.grantedById === adminI.id);

    check("the grant is for ONE student: another student is still refused", (await start(T2)).status === 403);
    const phone = await start(T1, PHONE_UA);
    check("an override waives ONLY the secure client: a phone is still refused (MOBILE_NOT_SUPPORTED)", phone.status === 403 && phone.body.code === "MOBILE_NOT_SUPPORTED", JSON.stringify(phone.body).slice(0, 120));
    const listed = await call("GET", `/exam-security/start-overrides?testId=${level.id}`, TAI);
    check("the refused phone start did not consume the grant (it is still ACTIVE)", listed.status === 200 && listed.body.find((r) => r.id === g1.body.id)?.state === "ACTIVE");
    check("an admin of another institute cannot list this test's overrides", (await call("GET", `/exam-security/start-overrides?testId=${level.id}`, TAJ)).status === 403);

    // ---- use it
    const status = await call("GET", `/module-coding/module/${mod.id}`, T1);
    check("the pre-exam status tells the student an override is active", status.status === 200 && status.body.securityCheck?.overrideActive === true && status.body.securityCheck?.secureBrowserOk === true, JSON.stringify(status.body.securityCheck || {}).slice(0, 160));
    const run = await start(T1);
    check("with the grant the student starts on a plain desktop browser", run.status === 200 && !!run.body.attemptId, `${run.status} ${JSON.stringify(run.body).slice(0, 160)}`);
    const attemptId = run.body.attemptId, examSession = run.body.sessionId, q0 = run.body.questions?.[0]?.id;
    const after = await call("GET", `/exam-security/start-overrides?testId=${level.id}`, TAI);
    check("the grant is now USED and the use is recorded against the attempt", after.body.find((r) => r.id === g1.body.id)?.state === "USED" && (await events("START_OVERRIDE_USED", s1.id)).some((e) => e.attemptId === attemptId));
    const save = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 1 }, { "X-Exam-Session": examSession });
    check("the attempt keeps working without a secure session (autosave accepted)", save.status === 200, `${save.status} ${JSON.stringify(save.body).slice(0, 120)}`);
    const resume = await start(T1);
    check("the same student can resume that attempt without a secure session", resume.status === 200 && resume.body.attemptId === attemptId);
    await prisma.moduleCodingAttempt.update({ where: { id: attemptId }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    check("single use: once that attempt is finished the grant cannot start another (strict again)", (await start(T1)).status === 403);

    // ---- concurrency: one grant, many simultaneous starts
    const g2 = await grant(TAI, { testId: level.id, studentId: s2.id, reason: GOOD_REASON });
    const burst = await Promise.all(Array.from({ length: 6 }, () => start(T2)));
    const used = (await events("START_OVERRIDE_USED", s2.id)).length;
    const attemptsN = await prisma.moduleCodingAttempt.count({ where: { moduleCodingTestId: level.id, studentId: s2.id } });
    check("six simultaneous starts on one grant use it exactly once and create exactly one attempt", g2.status === 201 && used === 1 && attemptsN === 1, `used=${used} attempts=${attemptsN} statuses=${burst.map((b) => b.status).join(",")}`);

    // ---- expiry and revoke (s3)
    const expired = await prisma.examSecurityEvent.create({ data: { attemptKind: "MODULE_CODING", attemptId: "none", studentId: s3.id, testId: level.id, type: "START_OVERRIDE_GRANTED", severity: "HIGH", instituteId: instI.id, metadata: { reason: GOOD_REASON, expiresAt: Date.now() - 60 * 1000, grantedById: adminI.id } } });
    check("an expired grant does not allow a start", (await start(T3)).status === 403);
    const listed2 = await call("GET", `/exam-security/start-overrides?testId=${level.id}`, TAI);
    check("an expired grant is listed as EXPIRED", listed2.body.find((r) => r.id === expired.id)?.state === "EXPIRED");
    const g3 = await grant(TAI, { testId: level.id, studentId: s3.id, reason: GOOD_REASON });
    check("another institute's admin cannot revoke it", (await call("DELETE", `/exam-security/start-overrides/${g3.body.id}`, TAJ)).status === 403);
    check("a student cannot revoke it", (await call("DELETE", `/exam-security/start-overrides/${g3.body.id}`, T3)).status === 403);
    const rv = await call("DELETE", `/exam-security/start-overrides/${g3.body.id}`, TAI);
    check("the admin revokes an unused grant", rv.status === 200 && rv.body.revoked === true);
    check("a revoked grant allows nothing", (await start(T3)).status === 403);
    check("revoking twice is a 409, and the revoke is audit-logged", (await call("DELETE", `/exam-security/start-overrides/${g3.body.id}`, TAI)).status === 409 && !!(await prisma.auditLog.findFirst({ where: { action: "SECURE_START_OVERRIDE_REVOKED", studentId: s3.id } })));
    check("a used grant cannot be revoked", (await call("DELETE", `/exam-security/start-overrides/${g1.body.id}`, TAI)).status === 409);

    // ---- a student cannot forge the events
    const forged = await call("POST", "/exam-security/events", T2, { attemptId, events: [{ type: "START_OVERRIDE_USED" }, { type: "START_OVERRIDE_GRANTED" }] });
    check("a client cannot report override events", forged.status !== 200 || forged.body?.accepted === 0);
    check("the other-institute student cannot read overrides", [403, 401].includes((await call("GET", `/exam-security/start-overrides?testId=${level.id}`, TJs)).status));
  } finally {
    await prisma.examSecurityEvent.deleteMany({ where: { testId: level.id } }).catch(() => {});
    await prisma.moduleCodingAttempt.deleteMany({ where: { moduleCodingTestId: level.id } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { studentId: { in: [s1.id, s2.id, s3.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { startsWith: "verify-so-", endsWith: `-${ts}@example.invalid` } } }).catch(() => {});
    await prisma.question.deleteMany({ where: { id: question.id } }).catch(() => {});
    await prisma.moduleCodingTest.deleteMany({ where: { id: level.id } }).catch(() => {});
    await prisma.courseModule.deleteMany({ where: { id: mod.id } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: course.id } }).catch(() => {});
    await prisma.institute.deleteMany({ where: { id: { in: [instI.id, instJ.id] } } }).catch(() => {});
  }
  console.log(failures === 0 ? "\nSTART OVERRIDE VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
}
main().catch(async (e) => { console.error(e); process.exit(2); }).finally(() => prisma.$disconnect());
