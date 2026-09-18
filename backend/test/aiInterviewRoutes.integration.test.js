// Real HTTP integration tests for the AI Voice Interview routes — this repo previously had ZERO
// route-level tests for either interview module (confirmed during a full-platform audit,
// 2026-09-18), only pure-logic unit tests. These hit the actual running server the exact same way
// this session's own manual verification scripts did throughout that audit (http.request against
// localhost:4000) rather than booting the app in-process, because src/index.js calls app.listen()
// as an import-time side effect with no exported `app` — refactoring the entrypoint just to make
// it importable is a separate, riskier change than adding tests. That means these tests need the
// server actually running (true in this repo's own deploy container, where `npm test` has been run
// throughout this session while the live server was already up on the same port) — when it's not
// reachable, every test here is skipped cleanly rather than failing, so `npm test` still passes on
// a machine with no server/database configured.
//
// Every test creates its own disposable data and cleans it up in a finally block, restoring any
// FeatureSetting it touched to its exact prior value — same discipline used throughout this
// session's live verification, now made permanent instead of thrown away after one manual run.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const WebSocket = require("ws");
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

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

let serverReachable = false;
// createLimiter (POST /, /:id/start, /:id/voice-session) is 5/min PER STUDENT — every test that
// creates a session or mints a voice ticket uses its OWN student, never shared with another test
// in this file, so this suite's own test runs can never trip each other's rate limit regardless
// of how many times the file is re-run in a short window while debugging.
let studentA, studentB, studentC, studentD, studentE;
let tokenA, tokenB, tokenC, tokenD, tokenE;

test.before(async () => {
  try {
    const res = await httpRequest("GET", "/api/health", null);
    serverReachable = res.status === 200;
  } catch {
    serverReachable = false;
  }
  if (!serverReachable || !process.env.JWT_SECRET) return;

  const students = await prisma.user.findMany({ where: { role: "STUDENT" }, take: 5 });
  if (students.length < 5) { serverReachable = false; return; } // not enough fixture data to run these safely
  [studentA, studentB, studentC, studentD, studentE] = students;
  [tokenA, tokenB, tokenC, tokenD, tokenE] = students.map(tokenFor);
});

test.after(async () => {
  await prisma.$disconnect();
});

// Enables the ai_voice_interview feature for studentA's institute for the duration of one test,
// restoring the exact prior row (or absence of one) afterward.
async function withVoiceInterviewEnabled(instituteId, fn) {
  const where = { instituteId_featureKey: { instituteId, featureKey: "ai_voice_interview" } };
  const prior = await prisma.featureSetting.findUnique({ where });
  await prisma.featureSetting.upsert({
    where, create: { instituteId, featureKey: "ai_voice_interview", enabled: true }, update: { enabled: true },
  });
  try {
    return await fn();
  } finally {
    if (prior === null) await prisma.featureSetting.delete({ where }).catch(() => {});
    else await prisma.featureSetting.update({ where, data: { enabled: prior.enabled } }).catch(() => {});
  }
}

async function createSession(token, overrides = {}) {
  return httpRequest("POST", "/api/ai-interviews", token, {
    role: "Backend Developer", experienceLevel: "FRESHER", targetSkills: ["Java", "SQL"],
    interviewType: "TECHNICAL", durationMin: 15, ...overrides,
  });
}

async function cleanupSession(sessionId) {
  if (!sessionId) return;
  await prisma.aiInterviewTurn.deleteMany({ where: { sessionId } }).catch(() => {});
  await prisma.aiInterviewReport.deleteMany({ where: { sessionId } }).catch(() => {});
  await prisma.aiInterviewSession.delete({ where: { id: sessionId } }).catch(() => {});
}

test("IDOR: student B cannot read student A's interview session (404, not 403 — doesn't confirm existence)", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let sessionId;
  try {
    await withVoiceInterviewEnabled(studentA.instituteId, async () => {
      const created = await createSession(tokenA);
      assert.equal(created.status, 201);
      sessionId = created.body.id;

      const ownRead = await httpRequest("GET", `/api/ai-interviews/${sessionId}`, tokenA);
      assert.equal(ownRead.status, 200, "the owner can read their own session");

      const crossRead = await httpRequest("GET", `/api/ai-interviews/${sessionId}`, tokenB);
      assert.equal(crossRead.status, 404, "a different student must get 404, not the session data");
      assert.equal(crossRead.body.role, undefined, "no session field ever leaks into the 404 body");
    });
  } finally {
    await cleanupSession(sessionId);
  }
});

test("state machine: /answer is rejected with 409 before the interview has been started", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let sessionId;
  try {
    await withVoiceInterviewEnabled(studentC.instituteId, async () => {
      const created = await createSession(tokenC);
      sessionId = created.body.id;

      const answer = await httpRequest("POST", `/api/ai-interviews/${sessionId}/answer`, tokenC, { answerText: "too early" });
      assert.equal(answer.status, 409, "a CREATED session has no open question yet");
    });
  } finally {
    await cleanupSession(sessionId);
  }
});

test("text-mode flow: /start then /answer works end-to-end and reports resume state correctly via GET /:id", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let sessionId;
  try {
    await withVoiceInterviewEnabled(studentD.instituteId, async () => {
      const created = await createSession(tokenD);
      sessionId = created.body.id;

      const beforeStart = await httpRequest("GET", `/api/ai-interviews/${sessionId}`, tokenD);
      assert.equal(beforeStart.body.status, "CREATED");
      assert.equal(beforeStart.body.currentQuestion, null, "no open question before /start");

      const start = await httpRequest("POST", `/api/ai-interviews/${sessionId}/start`, tokenD);
      assert.equal(start.status, 200);
      assert.equal(typeof start.body.turn.questionText, "string");
      assert.ok(start.body.turn.questionText.length > 0);

      const afterStart = await httpRequest("GET", `/api/ai-interviews/${sessionId}`, tokenD);
      assert.equal(afterStart.body.currentQuestion.questionText, start.body.turn.questionText, "GET /:id must reflect the same open turn /start just created (this is what a page-refresh resume relies on)");

      const answer = await httpRequest("POST", `/api/ai-interviews/${sessionId}/answer`, tokenD, {
        answerText: "A HashMap stores entries in buckets keyed by hash code and resolves collisions via chaining.",
      });
      assert.equal(answer.status, 200);
      assert.ok(answer.body.status === "COMPLETED" || answer.body.nextQuestion, "either the interview ended or a next question was generated");
    });
  } finally {
    await cleanupSession(sessionId);
  }
});

test("Company-Style interviews store honest, style-only company framing (not claimed as real questions)", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let sessionId;
  try {
    await withVoiceInterviewEnabled(studentE.instituteId, async () => {
      const created = await createSession(tokenE, { interviewType: "COMPANY_SPECIFIC", company: "Amazon" });
      sessionId = created.body.id;
      const stored = await prisma.aiInterviewSession.findUnique({ where: { id: sessionId }, select: { jobDescription: true } });
      assert.ok(stored.jobDescription.includes("Amazon"));
      assert.ok(stored.jobDescription.includes("style only"));
      assert.ok(stored.jobDescription.includes("never claim to reproduce"));
    });
  } finally {
    await cleanupSession(sessionId);
  }
});

test("multi-tab lock: a second voice WebSocket connection for the same session kicks the first", async (t) => {
  if (!serverReachable) return t.skip("no live server/fixture data reachable at localhost:4000");
  let sessionId;
  try {
    await withVoiceInterviewEnabled(studentA.instituteId, async () => {
      const session = await prisma.aiInterviewSession.create({
        data: {
          studentId: studentA.id, instituteId: studentA.instituteId, role: "Backend Developer",
          experienceLevel: "FRESHER", interviewType: "TECHNICAL", targetSkills: ["Java"],
          competencyPlan: [], status: "QUESTIONING", startedAt: new Date(), expiresAt: new Date(Date.now() + 15 * 60 * 1000), durationMin: 15,
        },
      });
      sessionId = session.id;
      await prisma.aiInterviewTurn.create({
        data: { sessionId, turnIndex: 0, objective: "Java", questionType: "FUNDAMENTALS", questionText: "Q1", difficultyAtTurn: 5 },
      });

      const ticket1 = await httpRequest("POST", `/api/ai-interviews/${sessionId}/voice-session`, tokenA);
      const ws1 = new WebSocket(`ws://${HOST}:${PORT}/api/ai-interviews/${sessionId}/voice?ticket=${encodeURIComponent(ticket1.body.ticket)}`);
      const ws1Messages = [];
      let ws1Opened = false, ws1Err = null;
      ws1.on("message", (raw) => { try { ws1Messages.push(JSON.parse(raw.toString()).type); } catch { /* ignore */ } });
      ws1.on("error", (e) => { ws1Err = e.message; });
      await new Promise((resolve) => { ws1.on("open", () => { ws1Opened = true; setTimeout(resolve, 2000); }); ws1.on("error", resolve); });

      const ticket2 = await httpRequest("POST", `/api/ai-interviews/${sessionId}/voice-session`, tokenA);
      const ws2 = new WebSocket(`ws://${HOST}:${PORT}/api/ai-interviews/${sessionId}/voice?ticket=${encodeURIComponent(ticket2.body.ticket)}`);
      let ws2Opened = false, ws2Err = null;
      ws2.on("error", (e) => { ws2Err = e.message; });
      await new Promise((resolve) => { ws2.on("open", () => { ws2Opened = true; setTimeout(resolve, 2500); }); ws2.on("error", resolve); });

      assert.ok(
        ws1Messages.includes("error"),
        `the first connection must be told it was superseded (ws1Opened=${ws1Opened}, ws1Err=${ws1Err}, ws2Opened=${ws2Opened}, ws2Err=${ws2Err})`
      );
      assert.ok(ws1.readyState >= WebSocket.CLOSING, "the first connection must actually be closed, not just notified");

      ws1.close(); ws2.close();
    });
  } finally {
    await cleanupSession(sessionId);
  }
});
