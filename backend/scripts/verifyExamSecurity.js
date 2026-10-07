// End-to-end verification of the exam-security engine against the live API on this instance, using the JAVA Practice
// Level 0 attempt flow. Disposable data only (@example.invalid users, a throwaway group, a temporary course assignment);
// the level's security settings are changed for the test and restored afterwards. Never prints credentials.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const X = require("../src/utils/examSecurity");
const { pruneExamSecurityEvents } = require("../src/utils/testAttemptAutoFinalizeScheduler");

const BASE = "http://localhost:4000/api";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const rand = () => crypto.randomBytes(18).toString("base64url");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", "User-Agent": DESKTOP_UA, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-es-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { batch: "ZZ-VERIFY-ES" } });
}

(async () => {
  await cleanup();

  // ---- pure engine checks (no network)
  const std = X.resolvePolicy({ securityLevel: "STANDARD", requireFullscreen: false });
  const prc = X.resolvePolicy({ securityLevel: "PROCTORED" });
  const lck = X.resolvePolicy({ securityLevel: "LOCKDOWN" });
  check("STANDARD preset keeps today's behaviour (blocks clipboard, flags duplicate tabs, follows test fullscreen)", std.blockPaste && std.multiSession === "FLAG" && std.requireFullscreen === false && std.mobileAllowed && !std.secureBrowserRequired);
  check("PROCTORED requires fullscreen and one tab", prc.requireFullscreen && prc.multiSession === "BLOCK");
  check("LOCKDOWN requires secure browser, no mobile, tighter insertion threshold", lck.secureBrowserRequired && !lck.mobileAllowed && lck.insertionCharThreshold < prc.insertionCharThreshold);
  check("policy overrides are type-checked and unknown keys dropped", JSON.stringify(X.sanitizePolicyOverrides({ blockPaste: "yes", mobileAllowed: false, evil: true, insertionCharThreshold: 99999999, multiSession: "NOPE" })) === JSON.stringify({ mobileAllowed: false, insertionCharThreshold: 100000 }));
  check("unknown security level falls back to STANDARD", X.resolvePolicy({ securityLevel: "WEIRD" }).level === "STANDARD");
  check("risk bands: nothing = LOW, a few weak signals = LOW/MEDIUM, repeated strong evidence = HIGH+", X.computeRisk([]).level === "LOW" && X.computeRisk([{ type: "PAGE_HIDDEN" }]).level === "LOW" && X.computeRisk([{ type: "TAB_SWITCH" }, { type: "SUSPICIOUS_CODE_INSERTION" }]).level === "MEDIUM" && ["HIGH", "CRITICAL"].includes(X.computeRisk([{ type: "MULTIPLE_SESSION" }, { type: "TAB_SWITCH" }, { type: "TAB_SWITCH" }]).level));
  check("a reviewer's LEGITIMATE decision removes that event from the risk score", X.computeRisk([{ type: "MULTIPLE_SESSION", reviewStatus: "LEGITIMATE" }]).score === 0);

  const ts = Date.now();
  // ---- live API
  const course = await prisma.course.findUnique({ where: { slug: "java-practice" } });
  const groups = await prisma.academicGroup.findMany({ where: { isActive: true } });
  const off = await prisma.featureSetting.findMany({ where: { featureKey: { in: ["lms", "compiler"] }, enabled: false } });
  const offIds = new Set(off.map((f) => f.instituteId));
  const real = groups.find((g) => !offIds.has(g.instituteId));
  const { instituteId, departmentId } = real;
  const grp = await prisma.academicGroup.create({ data: { instituteId, departmentId, batch: "ZZ-VERIFY-ES", section: `ZZ-${ts}` } });
  const mk = async (name, role, group, inst = true) => { const pw = rand(); const u = await prisma.user.create({ data: { name, email: `verify-es-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId: inst ? instituteId : null, academicGroupId: group?.id || null, mustChangePassword: false } }); return { ...u, pw }; };
  const s1 = await mk("Alice", "STUDENT", grp), s2 = await mk("Bob", "STUDENT", grp);
  const admin = await mk("Admin", "ADMIN", null, false), instAdmin = await mk("Inst Admin", "INSTITUTE_ADMIN", null);
  await prisma.courseAcademicGroupAssignment.create({ data: { courseId: course.id, academicGroupId: grp.id, assignedByUserId: admin.id, assignedByName: admin.name } });
  const level = await prisma.moduleCodingTest.findFirst({ where: { chapter: { module: { courseId: course.id } }, isActive: true }, orderBy: { createdAt: "asc" } });
  const original = { securityLevel: level.securityLevel, securityPolicy: level.securityPolicy, maxAttempts: level.maxAttempts, proctoring: level.proctoring };
  const setLevel = (data) => prisma.moduleCodingTest.update({ where: { id: level.id }, data });

  try {
    const T1 = await login(s1.email, s1.pw), T2 = await login(s2.email, s2.pw), TA = await login(admin.email, admin.pw), TI = await login(instAdmin.email, instAdmin.pw);
    await setLevel({ maxAttempts: 20 });

    // -- PROCTORED: one tab only, server-enforced
    await setLevel({ securityLevel: "PROCTORED", securityPolicy: null });
    const st = await call("GET", `/module-coding/level/${level.id}`, T1);
    check("status exposes the resolved policy and a server-evaluated security check", st.body.security?.level === "PROCTORED" && st.body.security.multiSession === "BLOCK" && st.body.securityCheck && st.body.securityCheck.mobileBlocked === false);
    const start = await call("POST", `/module-coding/level/${level.id}/start`, T1);
    const attemptId = start.body.attemptId, session1 = start.body.sessionId;
    check("start issues a server session id and the policy", start.status === 200 && /^[0-9a-f]{32}$/.test(session1 || "") && start.body.security?.level === "PROCTORED");
    const q0 = start.body.questions[0].id;
    check("request with the right session works", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 1 }, { "X-Exam-Session": session1 })).status === 200);
    const noHeader = await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "x", seq: 2 });
    check("request WITHOUT the session id is refused (409 SESSION_REPLACED)", noHeader.status === 409 && noHeader.body.code === "SESSION_REPLACED");
    const resume = await call("POST", `/module-coding/level/${level.id}/start`, T1);
    const session2 = resume.body.sessionId;
    check("resuming (a second tab/refresh) issues a NEW session id", resume.status === 200 && resume.body.attemptId === attemptId && session2 && session2 !== session1);
    const stale = await call("POST", `/module-coding/attempts/${attemptId}/run`, T1, { questionId: q0, language: "java", code: "class Main{}" }, { "X-Exam-Session": session1 });
    check("the OLD tab is now refused", stale.status === 409 && stale.body.code === "SESSION_REPLACED");
    check("the NEW tab keeps working", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T1, { questionId: q0, language: "java", code: "class Main{}", seq: 3 }, { "X-Exam-Session": session2 })).status === 200);
    const sesEvents = await prisma.examSecurityEvent.count({ where: { attemptId, type: "SESSION_REPLACED" } });
    check("the duplicate session is recorded as evidence (throttled, not flooded)", sesEvents >= 1 && sesEvents <= 2, String(sesEvents));
    check("another student cannot use this attempt even with its session id", (await call("POST", `/module-coding/attempts/${attemptId}/autosave`, T2, { questionId: q0, language: "java", code: "x", seq: 4 }, { "X-Exam-Session": session2 })).status === 403);

    // -- evidence intake
    const long = "z".repeat(900);
    const ev = await call("POST", "/exam-security/events", T1, { attemptId, events: [
      { type: "SUSPICIOUS_CODE_INSERTION", questionId: q0, metadata: { chars: 812, lines: 40, note: long, severity: "CRITICAL" } },
      { type: "PAGE_HIDDEN", metadata: { seconds: 4 } },
      { type: "MULTIPLE_SESSION" }, // server-only: a client must not be able to forge it
      { type: "TOTALLY_MADE_UP" },
    ] }, { "X-Exam-Session": session2 });
    check("event batch accepts only client-reportable types", ev.status === 200 && ev.body.accepted === 2, JSON.stringify(ev.body));
    const stored = await prisma.examSecurityEvent.findMany({ where: { attemptId, type: { in: ["SUSPICIOUS_CODE_INSERTION", "PAGE_HIDDEN"] } } });
    const ins = stored.find((e) => e.type === "SUSPICIOUS_CODE_INSERTION");
    check("severity is assigned by the server, not the client", ins?.severity === "MEDIUM");
    check("metadata is bounded (long strings truncated, unknown shapes dropped)", ins?.metadata?.note?.length <= 200 && ins.metadata.chars === 812);
    check("a forged server-only type was not stored", (await prisma.examSecurityEvent.count({ where: { attemptId, type: "MULTIPLE_SESSION" } })) === 0);
    check("another student cannot post events to this attempt (404)", (await call("POST", "/exam-security/events", T2, { attemptId, events: [{ type: "PAGE_HIDDEN" }] })).status === 404);
    check("staff cannot use the student event endpoint", (await call("POST", "/exam-security/events", TA, { attemptId, events: [{ type: "PAGE_HIDDEN" }] })).status === 403);
    check("empty or malformed batches are rejected", (await call("POST", "/exam-security/events", T1, { attemptId, events: [] })).status === 400);
    let limited = 0;
    for (let i = 0; i < 35; i++) { const r = await call("POST", "/exam-security/events", T1, { attemptId, events: [{ type: "PAGE_HIDDEN" }] }); if (r.status === 429) limited++; }
    check("the event endpoint is rate limited (no traffic flood)", limited > 0, `${limited} of 35 limited`);

    // -- monitor, timeline, review, RBAC
    const mon = await call("GET", `/exam-security/tests/${level.id}/monitor`, TA);
    const row = mon.body?.rows?.find((r) => r.attemptId === attemptId);
    check("staff monitor lists the attempt with a risk band, strikes and last event", mon.status === 200 && row && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(row.risk) && row.lastEvent && row.eventCount >= 2, JSON.stringify(row && { risk: row.risk, events: row.eventCount }));
    check("monitor is paginated", mon.body.pageSize === 25 && mon.body.page === 1 && typeof mon.body.total === "number");
    check("students cannot open the monitor", (await call("GET", `/exam-security/tests/${level.id}/monitor`, T1)).status === 403);
    check("an institute admin cannot open the monitor of a GLOBAL course's test", (await call("GET", `/exam-security/tests/${level.id}/monitor`, TI)).status === 403);
    const tl = await call("GET", `/exam-security/attempts/${attemptId}/timeline`, TA);
    check("timeline is chronological with start, evidence and review flags", tl.status === 200 && tl.body.timeline[0].type === "EXAM_STARTED" && tl.body.timeline.some((e) => e.type === "SUSPICIOUS_CODE_INSERTION" && e.reviewable) && tl.body.timeline.every((e, i, a) => i === 0 || new Date(a[i - 1].at) <= new Date(e.at)));
    check("students cannot read a timeline", (await call("GET", `/exam-security/attempts/${attemptId}/timeline`, T2)).status === 403);
    const before = tl.body.riskScore;
    const insEvent = tl.body.timeline.find((e) => e.type === "SUSPICIOUS_CODE_INSERTION");
    check("review rejects an invalid status", (await call("PATCH", `/exam-security/events/${insEvent.id}/review`, TA, { reviewStatus: "GUILTY" })).status === 400);
    check("students cannot review evidence", (await call("PATCH", `/exam-security/events/${insEvent.id}/review`, T1, { reviewStatus: "LEGITIMATE" })).status === 403);
    check("an institute admin cannot review evidence of a global test", (await call("PATCH", `/exam-security/events/${insEvent.id}/review`, TI, { reviewStatus: "LEGITIMATE" })).status === 403);
    const rv = await call("PATCH", `/exam-security/events/${insEvent.id}/review`, TA, { reviewStatus: "LEGITIMATE", note: "student typed a long template, confirmed with them" });
    const tl2 = await call("GET", `/exam-security/attempts/${attemptId}/timeline`, TA);
    check("a reviewer can mark evidence legitimate, with a note, and the risk score drops", rv.status === 200 && tl2.body.riskScore < before && tl2.body.timeline.find((e) => e.id === insEvent.id).reviewNote?.includes("template"), `${before} -> ${tl2.body.riskScore}`);
    check("the review is audit-logged", (await prisma.auditLog.count({ where: { studentId: s1.id } })) >= 1);

    // -- server-authoritative timer
    await prisma.moduleCodingAttempt.update({ where: { id: attemptId }, data: { startedAt: new Date(Date.now() - 200 * 60 * 1000) } });
    const late = await call("POST", `/module-coding/attempts/${attemptId}/run`, T1, { questionId: q0, language: "java", code: "class Main{}" }, { "X-Exam-Session": session2 });
    check("timer is server-side: a run after the deadline is refused whatever the browser clock says", late.status === 403 && /Time is up/.test(late.body?.error || ""), `${late.status} ${late.body?.error}`);
    check("start response carries no hidden tests or answers", !/"isHidden":true/.test(JSON.stringify(start.body)) && !/100000 200000/.test(JSON.stringify(start.body)));
    await call("POST", `/module-coding/attempts/${attemptId}/finalize`, T1, { reason: "time" }, { "X-Exam-Session": session2 });

    // -- STANDARD: duplicate sessions are FLAGGED, not blocked (existing exams keep working)
    await setLevel({ securityLevel: "STANDARD", securityPolicy: null });
    await prisma.moduleCodingAttempt.deleteMany({ where: { studentId: s2.id } });
    const sb = await call("POST", `/module-coding/level/${level.id}/start`, T2);
    const sbA = sb.body.attemptId, sbQ = sb.body.questions[0].id;
    const flagged = await call("POST", `/module-coding/attempts/${sbA}/autosave`, T2, { questionId: sbQ, language: "java", code: "class Main{}", seq: 1 }, { "X-Exam-Session": "stale-session-id" });
    check("STANDARD mode: a mismatched session still works (existing exams unaffected)", flagged.status === 200);
    check("STANDARD mode: the mismatch is recorded as MULTIPLE_SESSION evidence", (await prisma.examSecurityEvent.count({ where: { attemptId: sbA, type: "MULTIPLE_SESSION" } })) === 1);
    const legacy = await call("POST", `/module-coding/attempts/${sbA}/autosave`, T2, { questionId: sbQ, language: "java", code: "class Main{}", seq: 2 }, { "X-Exam-Session": sb.body.sessionId });
    check("STANDARD mode: the right session is accepted", legacy.status === 200);
    await call("POST", `/module-coding/attempts/${sbA}/finalize`, T2, { reason: "manual" }, { "X-Exam-Session": sb.body.sessionId });

    // -- LOCKDOWN: mobile + secure browser enforced by the server at start
    await setLevel({ securityLevel: "LOCKDOWN", securityPolicy: null });
    await prisma.moduleCodingAttempt.deleteMany({ where: { studentId: s2.id } });
    const mob = await call("POST", `/module-coding/level/${level.id}/start`, T2, null, { "User-Agent": MOBILE_UA });
    check("LOCKDOWN: a phone is refused at start (MOBILE_NOT_SUPPORTED)", mob.status === 403 && mob.body.code === "MOBILE_NOT_SUPPORTED");
    const nosb = await call("POST", `/module-coding/level/${level.id}/start`, T2);
    check("LOCKDOWN: a normal browser without a secure session is refused (SECURE_CLIENT_REQUIRED or unavailable)", [403, 503].includes(nosb.status) && ["SECURE_CLIENT_REQUIRED", "SECURE_EXAM_UNAVAILABLE"].includes(nosb.body.code));
    check("LOCKDOWN: a made-up secure token is refused", (await call("POST", `/module-coding/level/${level.id}/start`, T2, null, { "X-Secure-Session": "AAAA.BBBB" })).status === 403);
    const chk = await call("GET", `/module-coding/level/${level.id}`, T2);
    check("LOCKDOWN: the pre-exam check reports the failure to the page", chk.body.securityCheck.secureBrowserRequired && !chk.body.securityCheck.secureBrowserOk);
    check("LOCKDOWN: no attempt was created by the refused starts", (await prisma.moduleCodingAttempt.count({ where: { studentId: s2.id } })) === 0);
    const sbm = await prisma.examSecurityEvent.count({ where: { studentId: s2.id, type: "SECURE_BROWSER_MISSING" } });
    check("LOCKDOWN: the missing secure browser was recorded", sbm >= 1);

    // -- admin config validation
    const bad = await call("PATCH", `/module-coding/admin/tests/${level.id}`, TA, { securityLevel: "ULTRA" });
    check("admin config rejects an unknown security level", bad.status === 400);
    const good = await call("PATCH", `/module-coding/admin/tests/${level.id}`, TA, { securityLevel: "PROCTORED", securityPolicy: { mobileAllowed: false, hack: 1 } });
    const after = await prisma.moduleCodingTest.findUnique({ where: { id: level.id } });
    check("admin can set the level and per-test overrides (unknown keys dropped)", good.status === 200 && after.securityLevel === "PROCTORED" && JSON.stringify(after.securityPolicy) === JSON.stringify({ mobileAllowed: false }));

    // -- retention
    await prisma.examSecurityEvent.create({ data: { attemptKind: "MODULE_CODING", attemptId: "old-attempt", studentId: s1.id, type: "PAGE_HIDDEN", createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000) } });
    await prisma.examSecurityEvent.create({ data: { attemptKind: "MODULE_CODING", attemptId: "old-attempt-escalated", studentId: s1.id, type: "MULTIPLE_SESSION", reviewStatus: "ESCALATED", createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000) } });
    await pruneExamSecurityEvents({ force: true });
    check("retention job deletes evidence older than the retention window", (await prisma.examSecurityEvent.count({ where: { attemptId: "old-attempt" } })) === 0);
    check("retention job keeps ESCALATED evidence", (await prisma.examSecurityEvent.count({ where: { attemptId: "old-attempt-escalated" } })) === 1);
    await prisma.examSecurityEvent.deleteMany({ where: { attemptId: { in: ["old-attempt", "old-attempt-escalated"] } } });
  } finally {
    await prisma.moduleCodingTest.update({ where: { id: level.id }, data: original }).catch((e) => console.log("restore failed:", e.message));
    await prisma.examSecurityEvent.deleteMany({ where: { studentId: { in: [s1.id, s2.id] } } });
    await prisma.courseAcademicGroupAssignment.deleteMany({ where: { courseId: course.id, academicGroupId: grp.id } });
    await cleanup();
  }
  const restored = await prisma.moduleCodingTest.findUnique({ where: { id: level.id } });
  check("level settings restored exactly", restored.securityLevel === original.securityLevel && restored.maxAttempts === original.maxAttempts && restored.proctoring === original.proctoring);
  console.log(failures === 0 ? "\nEXAM SECURITY VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
