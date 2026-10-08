// Live check of the security level on the AI VOICE interview (aiInterview.js): server-side phone refusal for PROCTORED types,
// one-active-session claim, server-assigned severity for client-reported signals, IDOR, monitor RBAC + institute isolation.
// No AI calls are made. Uses two throwaway institutes; cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const CF = { "X-Client-Features": "exam-session-v1" };
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: "ZZ Verify AI " } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.featureSetting.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-ai-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify AI A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify AI B ${ts}` } });
  const mk = async (name, role, instituteId) => { const pw = crypto.randomBytes(18).toString("base64url"); const u = await prisma.user.create({ data: { name, email: `verify-ai-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } }); return { ...u, token: await login(u.email, pw) }; };
  try {
    const stu = await mk("Stu A", "STUDENT", A.id), stu2 = await mk("Stu A2", "STUDENT", A.id), adA = await mk("Admin A", "INSTITUTE_ADMIN", A.id), adB = await mk("Admin B", "INSTITUTE_ADMIN", B.id);
    const body = (interviewType) => ({ role: "Java Developer", experienceLevel: "FRESHER", interviewType, targetSkills: ["Java"], durationMin: 10 });

    const phoneP = await call("POST", "/ai-interviews", stu.token, body("PLACEMENT"), { "User-Agent": PHONE_UA });
    check("a PLACEMENT AI interview refuses a phone at creation (403 MOBILE_NOT_SUPPORTED)", phoneP.status === 403 && phoneP.body?.code === "MOBILE_NOT_SUPPORTED", `${phoneP.status} ${JSON.stringify(phoneP.body).slice(0, 90)}`);
    const phoneT = await call("POST", "/ai-interviews", stu.token, body("TECHNICAL"), { "User-Agent": PHONE_UA });
    check("a practice (TECHNICAL) AI interview still allows a phone and is STANDARD", phoneT.status === 201 && phoneT.body?.securityLevel === "STANDARD", String(phoneT.status));
    const p = await call("POST", "/ai-interviews", stu.token, body("PLACEMENT"));
    check("desktop creation works and the server stores the PROCTORED level", p.status === 201 && p.body?.securityLevel === "PROCTORED", String(p.status));
    const id = p.body.id;
    const g = await call("GET", `/ai-interviews/${id}`, stu.token);
    check("GET returns the policy and never exposes the session id", g.status === 200 && g.body.security?.level === "PROCTORED" && g.body.security?.mobileAllowed === false && !g.body.sessionId);
    const cPhone = await call("POST", `/ai-interviews/${id}/claim`, stu.token, null, { "User-Agent": PHONE_UA });
    check("claim refuses a phone for a PROCTORED interview", cPhone.status === 403 && cPhone.body?.code === "MOBILE_NOT_SUPPORTED");
    check("another student cannot claim or read it", (await call("POST", `/ai-interviews/${id}/claim`, stu2.token)).status === 404 && (await call("GET", `/ai-interviews/${id}`, stu2.token)).status === 404);
    const c1 = await call("POST", `/ai-interviews/${id}/claim`, stu.token);
    check("desktop claim returns a session id and the policy", c1.status === 200 && typeof c1.body.sessionId === "string" && c1.body.security?.multiSession === "BLOCK");
    const c2 = await call("POST", `/ai-interviews/${id}/claim`, stu.token);
    check("a second claim (refresh / other tab) takes the session over", c2.status === 200 && c2.body.sessionId !== c1.body.sessionId);
    const ans = (headers) => call("POST", `/ai-interviews/${id}/answer`, stu.token, { answerText: "x" }, headers);
    const stale = await ans({ "X-Exam-Session": c1.body.sessionId });
    check("the stale tab is refused with 409 SESSION_REPLACED", stale.status === 409 && stale.body?.code === "SESSION_REPLACED");
    check("a current client with no session id (a second tab) is refused", (await ans(CF)).body?.code === "SESSION_REPLACED");
    check("the owning session passes the guard (it then fails only because no question is open yet)", (await ans({ "X-Exam-Session": c2.body.sessionId })).body?.code !== "SESSION_REPLACED");
    check("a page bundle that predates session control (no headers) is not blocked by the guard", (await ans({})).body?.code !== "SESSION_REPLACED");
    check("the conflict was recorded as AI_INTERVIEW evidence", (await prisma.examSecurityEvent.count({ where: { attemptKind: "AI_INTERVIEW", attemptId: id, type: "SESSION_REPLACED" } })) >= 1);

    // evidence intake needs an open interview: set the state directly (no AI call involved)
    check("events are ignored while the interview is not open", (await call("POST", `/ai-interviews/${id}/events`, stu.token, { events: [{ type: "FULLSCREEN_EXIT" }] })).body?.closed === true);
    await prisma.aiInterviewSession.update({ where: { id }, data: { status: "QUESTIONING", startedAt: new Date(), expiresAt: new Date(Date.now() + 600000) } });
    const ev = await call("POST", `/ai-interviews/${id}/events`, stu.token, { events: [
      { type: "FULLSCREEN_EXIT", severity: "LOW" }, { type: "POSSIBLE_EXTERNAL_ASSISTANT" }, { type: "PASTE" }, { type: "NOT_A_REAL_TYPE" }, { type: "GEMINI_DETECTED" },
    ] });
    check("only allow-listed signal types are stored (unknown ones, including claims about a named app, are dropped)", ev.status === 200 && ev.body.accepted === 3, JSON.stringify(ev.body));
    const rows = await prisma.examSecurityEvent.findMany({ where: { attemptKind: "AI_INTERVIEW", attemptId: id, type: { in: ["FULLSCREEN_EXIT", "POSSIBLE_EXTERNAL_ASSISTANT", "PASTE"] } } });
    const sev = Object.fromEntries(rows.map((r) => [r.type, r.severity]));
    check("the server assigns severity (the client's 'LOW' for a fullscreen exit is ignored)", sev.FULLSCREEN_EXIT === "HIGH" && sev.POSSIBLE_EXTERNAL_ASSISTANT === "MEDIUM", JSON.stringify(sev));
    check("another student cannot post events to this interview", (await call("POST", `/ai-interviews/${id}/events`, stu2.token, { events: [{ type: "PASTE" }] })).status === 404);
    check("an empty batch is rejected", (await call("POST", `/ai-interviews/${id}/events`, stu.token, { events: [] })).status === 400);

    // monitor / timeline / overview
    const mon = await call("GET", "/exam-security/ai-interviews/monitor", adA.token);
    check("institute admin sees this interview with its counts", mon.status === 200 && mon.body.rows.some((r) => r.attemptId === id && r.counts.fullscreenExits >= 1 && r.counts.focusLoss >= 1 && r.counts.paste >= 1 && r.counts.sessionConflicts >= 1), JSON.stringify(mon.body?.rows?.[0]?.counts));
    const monB = await call("GET", "/exam-security/ai-interviews/monitor", adB.token);
    check("another institute's admin does not see it", monB.status === 200 && !monB.body.rows.some((r) => r.attemptId === id));
    check("students cannot open the monitor", (await call("GET", "/exam-security/ai-interviews/monitor", stu.token)).status === 403);
    const tl = await call("GET", `/exam-security/exam-attempts/${id}/timeline?kind=AI_INTERVIEW`, adA.token);
    check("timeline shows start, signals and the conflict", tl.status === 200 && tl.body.timeline[0].type === "EXAM_STARTED" && tl.body.timeline.some((e) => e.type === "FULLSCREEN_EXIT") && tl.body.timeline.some((e) => e.type === "SESSION_REPLACED"));
    check("another institute's admin cannot read the timeline", (await call("GET", `/exam-security/exam-attempts/${id}/timeline?kind=AI_INTERVIEW`, adB.token)).status === 403);
    const ov = await call("GET", "/exam-security/overview", adA.token);
    check("overview counts AI voice interviews and stays institute-scoped", ov.status === 200 && ov.body.scope === "INSTITUTE" && ov.body.live.aiInterviewSessions >= 1, JSON.stringify(ov.body?.live));
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nAI VOICE INTERVIEW SECURITY VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
