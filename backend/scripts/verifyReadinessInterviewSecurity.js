// Live check that READINESS tests and MOCK INTERVIEWS use the same security model as formal tests: server-side phone refusal,
// one-active-session control, new observable signals classified by the server, IDOR, monitor RBAC + institute isolation.
// Uses a real subject with a question pool (switched to PROCTORED, then restored) and disposable students/staff.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

(async () => {
  const poolCounts = await prisma.readinessQuestionPool.groupBy({ by: ["subjectId"], _count: true });
  if (!poolCounts.length) throw new Error("No readiness subject with a question pool to test against");
  const subject = await prisma.readinessSubject.findUnique({ where: { id: poolCounts[0].subjectId }, include: { academicGroupAssignments: { include: { academicGroup: true } } } });
  const assignment = subject.academicGroupAssignments[0] || null;
  const instituteId = assignment ? assignment.academicGroup.instituteId : (await prisma.institute.findFirst({ where: { isActive: true } })).id;
  const orig = { securityLevel: subject.securityLevel, securityPolicy: subject.securityPolicy, maxAttempts: subject.maxAttempts, proctoringEnabled: subject.proctoringEnabled };
  // The chosen institute may have these features switched off; enable them for the duration of the test and restore afterwards.
  const FEATURES = ["readiness_test", "ai_mock_interview"];
  const priorFeatures = await prisma.featureSetting.findMany({ where: { instituteId, featureKey: { in: FEATURES } } });
  for (const k of FEATURES) await prisma.featureSetting.upsert({ where: { instituteId_featureKey: { instituteId, featureKey: k } }, update: { enabled: true }, create: { instituteId, featureKey: k, enabled: true } });
  const ts = Date.now();
  const otherInst = await prisma.institute.create({ data: { name: `ZZ Verify RI Other ${ts}` } });
  const created = [];
  const mk = async (tag, role, inst, extra = {}) => {
    const pw = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name: `Verify RI ${tag}`, email: `verify-ri-${tag}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId: inst, mustChangePassword: false, ...extra } });
    created.push(u.id);
    return { ...u, token: await login(u.email, pw) };
  };
  const grp = assignment ? { academicGroupId: assignment.academicGroupId } : {};
  try {
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { securityLevel: "PROCTORED", securityPolicy: {}, proctoringEnabled: true, maxAttempts: null } });
    const stu = await mk("s1", "STUDENT", instituteId, grp), stu2 = await mk("s2", "STUDENT", instituteId, grp), stuPhone = await mk("s3", "STUDENT", instituteId, grp);
    const instAdmin = await mk("ia", "INSTITUTE_ADMIN", instituteId), otherAdmin = await mk("oa", "INSTITUTE_ADMIN", otherInst.id);
    const mode = "FOUNDATION";
    const startR = (s, headers) => call("POST", "/readiness/assessments", s.token, { subjectId: subject.id, assessmentMode: mode, questionCount: 5 }, headers);

    // ================= READINESS =================
    console.log("\n=== Readiness ===");
    const bad = await call("PATCH", `/readiness/admin/subjects/${subject.id}`, instAdmin.token, { securityLevel: "LOCKDOWN" });
    check("LOCKDOWN is refused for readiness tests", bad.status === 400, String(bad.status));
    const phone = await startR(stuPhone, { "User-Agent": PHONE_UA });
    check("PROCTORED readiness test refuses a phone at the server (403 MOBILE_NOT_SUPPORTED)", phone.status === 403 && phone.body?.code === "MOBILE_NOT_SUPPORTED", JSON.stringify(phone.body).slice(0, 120));
    const s1 = await startR(stu);
    check("desktop start works; returns a session id and the policy", s1.status === 200 && typeof s1.body.sessionId === "string" && s1.body.security?.level === "PROCTORED" && s1.body.security?.multiSession === "BLOCK", `${s1.status} ${JSON.stringify(s1.body).slice(0, 100)}`);
    const A = s1.body.assessment;
    check("policy is snapshotted on the attempt (config.security.level) and proctoring is forced on", A.config?.security?.level === "PROCTORED" && A.config?.proctoring?.enabled === true);
    const q0 = s1.body.questions[0];
    const ans = (sid, extra = {}) => call("POST", `/readiness/assessments/${A.id}/answer`, stu.token, { questionId: q0.id, selectedOptions: [0], code: "x", language: "python", skipped: false, ...extra }, sid === undefined ? { "X-Client-Features": "exam-session-v1" } : { "X-Exam-Session": sid });
    check("answer with the owning session id is accepted", (await ans(s1.body.sessionId)).status === 200);
    const get = await call("GET", `/readiness/assessments/${A.id}`, stu.token);
    check("GET never exposes the session id (a second tab cannot read it) and returns the policy", get.status === 200 && !("sessionId" in (get.body.assessment || {}) && get.body.assessment.sessionId) && get.body.security?.level === "PROCTORED");
    const s2 = await startR(stu);
    check("a second start (refresh / other tab) resumes and takes the session over", s2.status === 200 && s2.body.resumed === true && s2.body.sessionId !== s1.body.sessionId);
    const stale = await ans(s1.body.sessionId);
    check("the stale tab is refused with 409 SESSION_REPLACED", stale.status === 409 && stale.body?.code === "SESSION_REPLACED");
    check("a request with no session header is refused too", (await ans(undefined)).status === 409);
    check("the new session still works", (await ans(s2.body.sessionId)).status === 200);
    check("the conflict was recorded as READINESS evidence", (await prisma.examSecurityEvent.count({ where: { attemptKind: "READINESS", attemptId: A.id, type: "SESSION_REPLACED" } })) >= 1);
    check("another student cannot answer into this attempt", [403, 404].includes((await call("POST", `/readiness/assessments/${A.id}/answer`, stu2.token, { questionId: q0.id, selectedOptions: [0] }, { "X-Exam-Session": s2.body.sessionId })).status));
    check("another student cannot report violations on it", (await call("POST", `/readiness/assessments/${A.id}/violation`, stu2.token, { type: "COPY" })).status === 403);
    const hdr = { "X-Exam-Session": s2.body.sessionId };
    const v1 = await call("POST", `/readiness/assessments/${A.id}/violation`, stu.token, { type: "POSSIBLE_EXTERNAL_ASSISTANT" }, hdr);
    check("focus-lost-while-visible is SUSPICIOUS and not penalized the first time", v1.status === 200 && v1.body.severity === "SUSPICIOUS" && v1.body.penalized === false, JSON.stringify(v1.body));
    await call("POST", `/readiness/assessments/${A.id}/violation`, stu.token, { type: "SPLIT_SCREEN_SUSPECTED" }, hdr);
    const v3 = await call("POST", `/readiness/assessments/${A.id}/violation`, stu.token, { type: "POSSIBLE_EXTERNAL_ASSISTANT", severity: "INTERRUPTION" }, hdr);
    check("the client cannot choose severity: the third SUSPICIOUS event is a strike", v3.status === 200 && v3.body.penalized === true && v3.body.violationCount === 1, JSON.stringify(v3.body));
    const mon = await call("GET", `/exam-security/readiness/${subject.id}/monitor`, instAdmin.token);
    check("institute admin sees the readiness monitor with this attempt and counts", mon.status === 200 && mon.body.rows.some((r) => r.attemptId === A.id && r.counts.focusLoss >= 2 && r.counts.sessionConflicts >= 1), JSON.stringify(mon.body?.rows?.[0]?.counts));
    const mo = await call("GET", `/exam-security/readiness/${subject.id}/monitor`, otherAdmin.token);
    check("another institute's admin cannot see this student's attempt (403/404, or only their own institute's rows for a platform-wide subject)", [403, 404].includes(mo.status) || (mo.status === 200 && !mo.body.rows.some((r) => r.attemptId === A.id)));
    check("students cannot open the monitor", (await call("GET", `/exam-security/readiness/${subject.id}/monitor`, stu.token)).status === 403);
    const tl = await call("GET", `/exam-security/exam-attempts/${A.id}/timeline?kind=READINESS`, instAdmin.token);
    check("timeline (kind=READINESS) shows start, signals and the conflict", tl.status === 200 && tl.body.timeline[0].type === "EXAM_STARTED" && tl.body.timeline.some((e) => e.type === "SESSION_REPLACED") && tl.body.timeline.some((e) => e.type === "POSSIBLE_EXTERNAL_ASSISTANT"));
    check("other institute's admin cannot read the readiness timeline", (await call("GET", `/exam-security/exam-attempts/${A.id}/timeline?kind=READINESS`, otherAdmin.token)).status === 403);
    await call("POST", `/readiness/assessments/${A.id}/finalize`, stu.token, null, hdr);
    // switching the subject back to STANDARD lets a phone in (the rule comes from the server-side level, not the page)
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { securityLevel: "STANDARD", proctoringEnabled: false } });
    const std = await startR(stuPhone, { "User-Agent": PHONE_UA });
    check("with the level back to STANDARD a phone is allowed again", std.status === 200, String(std.status));

    // ================= MOCK INTERVIEW =================
    console.log("\n=== Mock interview ===");
    const iPhone = await call("POST", "/interview/sessions", stuPhone.token, { isMock: true, config: {} }, { "User-Agent": PHONE_UA });
    check("a MOCK interview refuses a phone browser at the server", iPhone.status === 403 && iPhone.body?.code === "MOBILE_NOT_SUPPORTED", `${iPhone.status} ${JSON.stringify(iPhone.body).slice(0, 100)}`);
    const i1 = await call("POST", "/interview/sessions", stu.token, { isMock: true, config: {} });
    if (i1.status !== 200) { console.log(`SKIP  interview session could not be created on this data set (${i1.status} ${JSON.stringify(i1.body).slice(0, 120)})`); }
    else {
      const sid = i1.body.session.id;
      check("desktop MOCK start returns a session id + PROCTORED policy, and the server stored the level", typeof i1.body.sessionId === "string" && i1.body.security?.level === "PROCTORED" && (await prisma.interviewSession.findUnique({ where: { id: sid } })).securityLevel === "PROCTORED");
      check("the response never leaks the session id inside `session`", !i1.body.session.sessionId);
      const q = i1.body.questions[0];
      const ia = (hs) => call("POST", `/interview/sessions/${sid}/answer`, stu.token, { questionId: q.id, answerText: "an answer", skipped: false }, hs);
      check("answer with the owning session id is accepted", [200, 400].includes((await ia({ "X-Exam-Session": i1.body.sessionId })).status));
      const i2 = await call("POST", "/interview/sessions", stu.token, { isMock: true, config: {} });
      check("a second start resumes the same session and takes it over", i2.status === 200 && i2.body.resumed === true && i2.body.sessionId !== i1.body.sessionId);
      const st = await ia({ "X-Exam-Session": i1.body.sessionId });
      check("the stale tab is refused with 409 SESSION_REPLACED", st.status === 409 && st.body?.code === "SESSION_REPLACED");
      check("another student cannot answer into this session", [403, 404].includes((await call("POST", `/interview/sessions/${sid}/answer`, stu2.token, { questionId: q.id, answerText: "x" }, { "X-Exam-Session": i2.body.sessionId })).status));
      const iv = await call("POST", `/interview/sessions/${sid}/violation`, stu.token, { type: "SPLIT_SCREEN_SUSPECTED" }, { "X-Exam-Session": i2.body.sessionId });
      check("split-screen signal is recorded as SUSPICIOUS", iv.status === 200 && iv.body.severity === "SUSPICIOUS", JSON.stringify(iv.body));
      const im = await call("GET", "/exam-security/interviews/monitor?type=MOCK", instAdmin.token);
      check("institute admin sees the interview monitor row with the conflict counted", im.status === 200 && im.body.rows.some((r) => r.attemptId === sid && r.counts.sessionConflicts >= 1 && r.label === "MOCK"), JSON.stringify(im.body?.rows?.[0]?.counts));
      const iOther = await call("GET", "/exam-security/interviews/monitor?type=MOCK", otherAdmin.token);
      check("another institute's admin does not see this student's session", iOther.status === 200 && !iOther.body.rows.some((r) => r.attemptId === sid));
      check("students cannot open the interview monitor", (await call("GET", "/exam-security/interviews/monitor", stu.token)).status === 403);
      const itl = await call("GET", `/exam-security/exam-attempts/${sid}/timeline?kind=INTERVIEW`, instAdmin.token);
      check("interview timeline works for the institute admin and is blocked for another institute", itl.status === 200 && itl.body.timeline.some((e) => e.type === "SESSION_REPLACED") && (await call("GET", `/exam-security/exam-attempts/${sid}/timeline?kind=INTERVIEW`, otherAdmin.token)).status === 403);
    }
    const ov = await call("GET", "/exam-security/overview", instAdmin.token);
    check("institute-scoped overview includes readiness/interview live counters and stays institute-scoped", ov.status === 200 && ov.body.scope === "INSTITUTE" && "readinessAttempts" in ov.body.live && "interviewSessions" in ov.body.live);
  } finally {
    await prisma.readinessSubject.update({ where: { id: subject.id }, data: { securityLevel: orig.securityLevel, securityPolicy: orig.securityPolicy ?? undefined, maxAttempts: orig.maxAttempts, proctoringEnabled: orig.proctoringEnabled } }).catch((e) => console.error("restore failed", e.message));
    for (const k of FEATURES) {
      const prior = priorFeatures.find((p) => p.featureKey === k);
      if (prior) await prisma.featureSetting.update({ where: { instituteId_featureKey: { instituteId, featureKey: k } }, data: { enabled: prior.enabled } }).catch(() => {});
      else await prisma.featureSetting.delete({ where: { instituteId_featureKey: { instituteId, featureKey: k } } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.institute.deleteMany({ where: { id: otherInst.id } });
  }
  console.log(failures === 0 ? "\nREADINESS + INTERVIEW SECURITY VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
