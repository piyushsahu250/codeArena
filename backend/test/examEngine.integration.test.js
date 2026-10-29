// Real HTTP integration tests for the section-wise examination (backend/src/modules/exams). They talk to the running API on localhost:4000 and use real database rows they create
// themselves (two institutes, an administrator for each, students, small question banks, an examination) and remove afterwards. With REQUIRE_INTEGRATION=1 (set by the CI
// integration job) a missing prerequisite FAILS the file instead of skipping it, so a green run there always means the tests ran.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");

const HOST = "localhost";
const PORT = 4000;
const tag = `exmtest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function request(method, path, token, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({ hostname: HOST, port: PORT, path, method, headers: { "Content-Type": "application/json", "X-Client-Features": "exam-session-v1", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}), ...extraHeaders } }, (res) => {
      let chunks = "";
      res.on("data", (d) => (chunks += d));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks || "{}"), raw: chunks }); } catch { resolve({ status: res.statusCode, body: {}, raw: chunks }); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const tokenFor = (u) => jwt.sign({ id: u.id, role: u.role, email: u.email }, process.env.JWT_SECRET, { expiresIn: "30m" });

let ready = false;
const F = { created: { users: [], institutes: [] } }; // fixtures
function notReady(reason) { ready = false; if (process.env.REQUIRE_INTEGRATION === "1") throw new Error(`examEngine integration prerequisites missing: ${reason}`); }

const READY = { camera: true, microphone: true, fullscreen: true, browser: true, connectivity: true };
const sec = (key, order, maxMarks, questionCount, extra = {}) => ({ key, order, maxMarks, questionCount, navigation: "FREE", answerEditing: "EDITABLE_UNTIL_SECTION_SUBMIT", ...extra });
function blueprint(over = {}) {
  const now = Date.now();
  return {
    title: `Exam ${tag}`, mode: "PROCTORED", practiceEnabled: true, startAt: new Date(now - 3600e3).toISOString(), endAt: new Date(now + 3 * 3600e3).toISOString(), durationMin: 60, graceSec: 0,
    totalMarks: 40, passingMarks: 16, timingPolicy: "OVERALL_ONLY",
    sections: [
      sec("APTITUDE", 1, 10, 5, { source: { distribution: [{ category: "QUANTITATIVE", count: 3 }, { category: "LOGICAL", count: 2 }] } }),
      sec("TECHNICAL", 2, 10, 4, { source: { subjects: [{ subjectId: F.subjectId, count: 4 }] } }),
      sec("CODING", 3, 10, 1, { source: { questionIds: [F.codingId] }, maxSubmissionsPerProblem: 5 }),
      sec("AI_INTERVIEW", 4, 10, 3, { interview: { category: "HR", difficulty: "EASY", answerInput: "TYPED_OR_SPEECH", cameraRequired: true, speechToText: true, rubricVersion: "hr-v1", evaluationMode: "RULES" } }),
    ],
    proctoring: { cameraRequired: true, microphoneRequired: true, fullscreenRequired: true, autoSubmitOnExpiry: true, reviewRequired: true, maxWarnings: 3, networkGraceSec: 30, cameraLossPolicy: "WARN", evidenceRetentionDays: 30 },
    ...over,
  };
}

async function mkUser(role, instituteId, label) {
  const u = await prisma.user.create({ data: { name: `${label} ${tag}`, email: `${tag}-${label}@example.test`, passwordHash: "not-a-real-hash", role, instituteId, registrationNumber: role === "STUDENT" ? `PRN-${tag}-${label}`.slice(0, 40) : null } });
  F.created.users.push(u.id);
  return u;
}

test.before(async () => {
  let reachable = false;
  try { reachable = (await request("GET", "/api/health", null)).status === 200; } catch { reachable = false; }
  if (!reachable) return notReady("the API is not answering on localhost:4000");
  if (!process.env.JWT_SECRET) return notReady("JWT_SECRET is not set");
  try {
    const instA = await prisma.institute.create({ data: { name: `${tag}-A` } });
    const instB = await prisma.institute.create({ data: { name: `${tag}-B` } });
    F.created.institutes.push(instA.id, instB.id);
    F.instA = instA.id; F.instB = instB.id;
    F.adminA = await mkUser("ADMIN", instA.id, "adminA");
    F.adminB = await mkUser("ADMIN", instB.id, "adminB");
    F.s1 = await mkUser("STUDENT", instA.id, "s1");
    F.s2 = await mkUser("STUDENT", instA.id, "s2");
    F.s3 = await mkUser("STUDENT", instB.id, "s3");
    F.tokens = { adminA: tokenFor(F.adminA), adminB: tokenFor(F.adminB), s1: tokenFor(F.s1), s2: tokenFor(F.s2), s3: tokenFor(F.s3) };
    const subject = await prisma.subject.create({ data: { name: `Subj ${tag}`, instituteId: instA.id } });
    F.subjectId = subject.id;
    // aptitude bank: key is option index 1 for every question
    F.aptitude = {};
    for (const [cat, n] of [["QUANTITATIVE", 4], ["LOGICAL", 3]]) {
      for (let i = 0; i < n; i++) {
        const q = await prisma.interviewQuestion.create({ data: { category: "APTITUDE", aptitudeCategory: cat, prompt: `${tag} ${cat} question ${i}`, options: ["wrong A", "right", "wrong B", "wrong C"], correctAnswer: 1, instituteId: instA.id } });
        F.aptitude[q.id] = 1;
      }
    }
    // one aptitude question with NO key (must never be used)
    F.badAptitude = (await prisma.interviewQuestion.create({ data: { category: "APTITUDE", aptitudeCategory: "QUANTITATIVE", prompt: `${tag} broken`, options: ["x", "y"], instituteId: instA.id } })).id;
    // technical bank: key is option 0
    F.technical = {};
    for (let i = 0; i < 5; i++) {
      const q = await prisma.question.create({ data: { description: `${tag} technical ${i}`, questionType: "MCQ", questionStatus: "PUBLISHED", options: ["correct", "no", "nope", "never"], correctAnswer: [0], subjectId: subject.id, instituteId: instA.id, points: 1 } });
      F.technical[q.id] = 0;
    }
    const coding = await prisma.question.create({ data: { title: `Sum ${tag}`, description: "Print a+b", questionType: "CODING", questionStatus: "PUBLISHED", instituteId: instA.id, points: 10, testCases: { create: [{ input: "1 2", expected: "3", isHidden: false }, { input: "20 22", expected: "42", isHidden: true }] } } });
    F.codingId = coding.id;
    for (let i = 0; i < 4; i++) await prisma.interviewQuestion.create({ data: { category: "HR", prompt: `${tag} Tell me about a time you worked in a team (${i})`, expectedKeywords: ["team", "result"], instituteId: instA.id } });
    ready = true;
  } catch (err) { return notReady(`could not create fixtures: ${String(err.message).slice(0, 300)}`); }
});

test.after(async () => {
  const ids = F.created.users;
  await prisma.examDefinition.deleteMany({ where: { createdById: { in: ids } } }).catch(() => {});
  if (F.instA) {
    await prisma.question.deleteMany({ where: { instituteId: F.instA } }).catch(() => {});
    await prisma.interviewQuestion.deleteMany({ where: { instituteId: F.instA } }).catch(() => {});
    await prisma.subject.deleteMany({ where: { instituteId: F.instA } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.institute.deleteMany({ where: { id: { in: F.created.institutes } } }).catch(() => {});
  await prisma.$disconnect();
});

// ---- helpers ------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function publishedExam(over = {}) {
  const c = await request("POST", "/api/exams/admin/exams", F.tokens.adminA, { blueprint: blueprint(over) });
  assert.equal(c.status, 201, c.raw);
  assert.equal(c.body.validation.valid, true, JSON.stringify(c.body.validation.errors));
  const id = c.body.exam.id;
  const p = await request("POST", `/api/exams/admin/exams/${id}/publish`, F.tokens.adminA);
  assert.equal(p.status, 200, p.raw);
  return id;
}
async function startAndBegin(examId, token, mode = "PROCTORED") {
  const s = await request("POST", `/api/exams/${examId}/attempts`, token, { mode });
  assert.ok(s.status === 200 || s.status === 201, s.raw);
  const attemptId = s.body.attemptId;
  const b = await request("POST", `/api/exams/attempts/${attemptId}/begin`, token, { readiness: READY });
  assert.equal(b.status, 200, b.raw);
  return { attemptId, session: { "X-Exam-Session": b.body.sessionId || "" } };
}
const open = (a, token, key) => request("POST", `/api/exams/attempts/${a.attemptId}/sections/${key}/open`, token, {}, a.session);
const put = (a, token, ref, version, payload, finalize) => request("PUT", `/api/exams/attempts/${a.attemptId}/answers/${ref}`, token, { version, payload, finalize }, a.session);
const complete = (a, token, key, expectedAnswered) => request("POST", `/api/exams/attempts/${a.attemptId}/sections/${key}/complete`, token, { expectedAnswered }, a.session);
const view = (a, token) => request("GET", `/api/exams/attempts/${a.attemptId}`, token, undefined, a.session);

async function doObjective(a, token, key, bank, { wrongCount = 0, skipCount = 0 } = {}) {
  const o = await open(a, token, key);
  assert.equal(o.status, 200, o.raw);
  assert.ok(!/correctAnswer|explanation/.test(o.raw), "the answer key must never be sent to the student");
  const items = o.body.current.items;
  let answered = 0;
  for (const [i, item] of items.entries()) {
    if (i >= items.length - skipCount) continue;
    const key_ = bank[item.id];
    const selected = i < wrongCount ? (key_ === 0 ? 1 : 0) : key_;
    const r = await put(a, token, item.id, 0, { selected });
    assert.equal(r.status, 200, r.raw);
    answered++;
  }
  return { items, answered };
}

// ---- tests --------------------------------------------------------------------------------------------------------------------------------------------------------------------
test("a student completes all four sections in one attempt and gets one consolidated report after publication", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const avail = await request("GET", "/api/exams/available", F.tokens.s1);
  assert.ok(avail.body.exams.some((e) => e.id === examId), "the published examination is offered to an eligible student");
  const a = await startAndBegin(examId, F.tokens.s1);

  const apt = await doObjective(a, F.tokens.s1, "APTITUDE", F.aptitude, { wrongCount: 1, skipCount: 1 });
  assert.equal(apt.items.length, 5);
  assert.ok(!apt.items.some((i) => i.id === F.badAptitude), "a question without a valid key is never used");
  assert.equal((await complete(a, F.tokens.s1, "APTITUDE", apt.answered)).status, 200);

  const tech = await doObjective(a, F.tokens.s1, "TECHNICAL", F.technical);
  assert.equal(tech.items.length, 4);
  assert.equal((await complete(a, F.tokens.s1, "TECHNICAL", tech.answered)).status, 200);

  const co = await open(a, F.tokens.s1, "CODING");
  assert.equal(co.status, 200, co.raw);
  const problem = co.body.current.items[0];
  assert.equal(problem.samples.length, 1, "only the sample case is shown");
  assert.ok(!/20 22|"42"/.test(co.raw), "the hidden test case never reaches the student");
  const sub = await request("POST", `/api/exams/attempts/${a.attemptId}/items/${problem.id}/submit-code`, F.tokens.s1, { language: "python", code: "a,b=map(int,input().split())\nprint(a+b)\n" }, a.session);
  assert.equal(sub.status, 200, sub.raw);
  assert.ok(["DONE", "PENDING"].includes(sub.body.submission.status));
  if (sub.body.submission.status === "DONE") { assert.equal(sub.body.submission.passedCases, 2); assert.equal(sub.body.submission.totalCases, 2, "graded on all cases when the hidden ones are the grading set"); }
  assert.equal((await complete(a, F.tokens.s1, "CODING", 1)).status, 200);

  const iv = await open(a, F.tokens.s1, "AI_INTERVIEW");
  assert.equal(iv.status, 200, iv.raw);
  const qs = iv.body.current.items;
  assert.equal(qs.length, 3);
  const text = "In my last project our team of four split the work, agreed deadlines every week, and I took the integration task. We shipped on time and the result was a stable release; I learned to communicate blockers early.";
  assert.equal((await put(a, F.tokens.s1, qs[0].id, 0, { text, input: "TYPED" })).status, 200);
  assert.equal((await put(a, F.tokens.s1, qs[1].id, 0, { text, input: "SPEECH" })).status, 200);
  assert.equal((await complete(a, F.tokens.s1, "AI_INTERVIEW", 2)).status, 200);

  const sb = await request("POST", `/api/exams/attempts/${a.attemptId}/submit`, F.tokens.s1, {}, a.session);
  assert.equal(sb.status, 200, sb.raw);
  assert.ok(["EVALUATING", "COMPLETED"].includes(sb.body.attempt.status));
  assert.equal(sb.body.result, null, "no result is shown before the administrator publishes it");

  const before = await request("GET", `/api/exams/attempts/${a.attemptId}/report`, F.tokens.s1, undefined, a.session);
  assert.equal(before.body.released, false);

  const adminReport = await request("GET", `/api/exams/admin/attempts/${a.attemptId}/report`, F.tokens.adminA);
  assert.equal(adminReport.status, 200, adminReport.raw);
  const rep = adminReport.body;
  assert.equal(rep.header.attemptId, a.attemptId);
  assert.equal(rep.header.mode, "PROCTORED");
  assert.equal(rep.header.student.prn.startsWith("PRN-"), true);
  assert.deepEqual(rep.sections.map((s) => s.key), ["APTITUDE", "TECHNICAL", "CODING", "AI_INTERVIEW"]);
  const by = Object.fromEntries(rep.sections.map((s) => [s.key, s]));
  assert.equal(by.APTITUDE.obtained, 6, "3 correct of 5 at 2 marks each; the wrong and the skipped one earn nothing");
  assert.equal(by.APTITUDE.correct, 3);
  assert.equal(by.APTITUDE.incorrect, 1);
  assert.equal(by.APTITUDE.unanswered, 1);
  assert.equal(by.TECHNICAL.obtained, 10);
  assert.equal(by.AI_INTERVIEW.answered, 2);
  assert.equal(by.AI_INTERVIEW.skipped, 1);
  assert.ok(by.AI_INTERVIEW.perQuestion.every((q) => q.method === null || q.method === "RULES"));
  assert.equal(rep.result.totalMarks, 40);
  const sum = rep.sections.reduce((acc, s) => acc + (s.final ? s.obtained : s.provisionalObtained || 0), 0);
  assert.equal(Math.round(rep.result.obtained * 100), Math.round(sum * 100), "the total is exactly the sum of the sections");
  if (by.CODING.final) {
    assert.equal(rep.result.final, true);
    const pub = await request("POST", `/api/exams/admin/attempts/${a.attemptId}/publish-result`, F.tokens.adminA, {});
    assert.equal(pub.status, 200, pub.raw);
    const mine = await request("GET", `/api/exams/attempts/${a.attemptId}/report`, F.tokens.s1, undefined, a.session);
    assert.equal(mine.body.released, true);
    assert.equal(mine.body.header.student.prn.startsWith("PRN-"), true);
    assert.equal(mine.body.result.obtained, rep.result.obtained);
    assert.ok(!/correctAnswer/.test(JSON.stringify(mine.body)), "a student's report never carries the answer key");
  } else {
    assert.equal(rep.result.final, false, "while a coding result is pending the whole result is provisional");
    assert.equal(rep.result.passed, null);
    assert.ok(rep.pending.some((p) => p.section === "CODING"));
    const pub = await request("POST", `/api/exams/admin/attempts/${a.attemptId}/publish-result`, F.tokens.adminA, {});
    assert.equal(pub.status, 409, "a pending result cannot be published");
  }
});

test("a refresh resumes the same attempt; the server timer is not reset; a second start returns the same attempt", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  const v1 = await view(a, F.tokens.s1);
  await new Promise((r) => setTimeout(r, 1100));
  const v2 = await view(a, F.tokens.s1);
  assert.equal(v1.body.attempt.startedAt, v2.body.attempt.startedAt, "the start time is stored on the server");
  assert.ok(v2.body.timing.remaining.overall < v1.body.timing.remaining.overall, "time keeps running between requests");
  const again = await request("POST", `/api/exams/${examId}/attempts`, F.tokens.s1, { mode: "PROCTORED" });
  assert.equal(again.status, 200);
  assert.equal(again.body.attemptId, a.attemptId);
  assert.equal(again.body.resumed, true);
  const rb = await request("POST", `/api/exams/attempts/${a.attemptId}/begin`, F.tokens.s1, { readiness: READY });
  assert.equal(rb.status, 200, "begin is idempotent");
  assert.equal(await prisma.examAttempt.count({ where: { examId, studentId: F.s1.id, attemptKey: "FORMAL" } }), 1);
});

test("concurrent starts create exactly one formal attempt", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const results = await Promise.all(Array.from({ length: 8 }, () => request("POST", `/api/exams/${examId}/attempts`, F.tokens.s2, { mode: "PROCTORED" })));
  assert.ok(results.every((r) => r.status === 200 || r.status === 201), JSON.stringify(results.map((r) => r.status)));
  assert.equal(new Set(results.map((r) => r.body.attemptId)).size, 1, "every request ends up with the same attempt");
  assert.equal(await prisma.examAttempt.count({ where: { examId, studentId: F.s2.id } }), 1);
});

test("sections cannot be skipped or opened out of order, and a completed section cannot be reopened", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  for (const key of ["TECHNICAL", "CODING", "AI_INTERVIEW"]) {
    const r = await open(a, F.tokens.s1, key);
    assert.equal(r.status, 409, key);
    assert.equal(r.body.code, "SECTION_ORDER");
  }
  const apt = await doObjective(a, F.tokens.s1, "APTITUDE", F.aptitude);
  const second = await open(a, F.tokens.s1, "TECHNICAL");
  assert.equal(second.body.code, "ANOTHER_SECTION_OPEN", "only one section is open at a time");
  assert.equal((await complete(a, F.tokens.s1, "APTITUDE", apt.answered)).status, 200);
  assert.equal((await open(a, F.tokens.s1, "APTITUDE")).body.code, "ALREADY_COMPLETED");
  assert.equal((await open(a, F.tokens.s1, "CODING")).body.code, "SECTION_ORDER", "still no jump from B to C... A is done but B is not");
  const early = await request("POST", `/api/exams/attempts/${a.attemptId}/submit`, F.tokens.s1, {}, a.session);
  assert.equal(early.status, 409);
  assert.equal(early.body.code, "SECTIONS_INCOMPLETE");
  const stray = await put(a, F.tokens.s1, Object.keys(F.technical)[0], 0, { selected: 0 });
  assert.ok([404, 409].includes(stray.status), `an answer for a section that is not open (or a question outside the paper) is refused: ${stray.status}`);
});

test("a section cannot be completed over answers the server has not confirmed", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  const apt = await doObjective(a, F.tokens.s1, "APTITUDE", F.aptitude, { skipCount: 2 });
  const bad = await complete(a, F.tokens.s1, "APTITUDE", apt.answered + 2);
  assert.equal(bad.status, 409);
  assert.equal(bad.body.code, "UNSAVED_ANSWERS");
  assert.equal((await complete(a, F.tokens.s1, "APTITUDE", apt.answered)).status, 200);
});

test("answers are versioned: a stale write loses and the newer answer is kept; a bad option is refused", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  const o = await open(a, F.tokens.s1, "APTITUDE");
  const ref = o.body.current.items[0].id;
  const first = await put(a, F.tokens.s1, ref, 0, { selected: 2 });
  assert.equal(first.body.version, 1);
  const second = await put(a, F.tokens.s1, ref, 1, { selected: 1 });
  assert.equal(second.body.version, 2);
  const stale = await put(a, F.tokens.s1, ref, 1, { selected: 3 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "STALE_VERSION");
  assert.equal(stale.body.currentVersion, 2);
  const saved = (await view(a, F.tokens.s1)).body.current.answers.find((x) => x.itemRef === ref);
  assert.deepEqual(saved.payload, { selected: 1 }, "the stale request did not overwrite the newer answer");
  assert.equal((await put(a, F.tokens.s1, ref, 2, { selected: 9 })).status, 400);
  assert.equal((await put(a, F.tokens.s1, "00000000-0000-0000-0000-000000000000", 0, { selected: 1 })).status, 404, "a question outside the paper");
});

test("another student, and another institute, cannot reach the attempt, the examination or its results", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  assert.equal((await request("GET", `/api/exams/attempts/${a.attemptId}`, F.tokens.s2)).status, 404);
  assert.equal((await request("PUT", `/api/exams/attempts/${a.attemptId}/answers/x`, F.tokens.s2, { version: 0, payload: { selected: 1 } })).status, 404);
  assert.equal((await request("POST", `/api/exams/attempts/${a.attemptId}/submit`, F.tokens.s2, {})).status, 404);
  assert.equal((await request("GET", `/api/exams/attempts/${a.attemptId}/report`, F.tokens.s2)).status, 404);
  // a student of another institute does not even see the examination
  const other = await request("POST", `/api/exams/${examId}/attempts`, F.tokens.s3, { mode: "PROCTORED" });
  assert.equal(other.status, 404);
  assert.ok(!(await request("GET", "/api/exams/available", F.tokens.s3)).body.exams.some((e) => e.id === examId));
  // an administrator of another institute cannot read, publish or export it
  for (const [m, p, b] of [["GET", `/api/exams/admin/exams/${examId}`], ["POST", `/api/exams/admin/exams/${examId}/publish`, {}], ["GET", `/api/exams/admin/exams/${examId}/analytics`], ["GET", `/api/exams/admin/exams/${examId}/export.csv`], ["GET", `/api/exams/admin/attempts/${a.attemptId}/report`], ["POST", `/api/exams/admin/attempts/${a.attemptId}/invalidate`, { reason: "not mine to touch" }]]) {
    assert.equal((await request(m, p, F.tokens.adminB, b)).status, 404, `${m} ${p}`);
  }
  // a student cannot use the administration routes at all
  assert.equal((await request("GET", "/api/exams/admin/exams", F.tokens.s1)).status, 403);
  // and nobody can terminate or reset a formal attempt from the student side
  for (const p of ["terminate", "reset", "restart"]) assert.equal((await request("POST", `/api/exams/attempts/${a.attemptId}/${p}`, F.tokens.s1, {}, a.session)).status, 404);
});

test("a second tab or device with an old session id is refused", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  const claim = await request("POST", `/api/exams/attempts/${a.attemptId}/claim`, F.tokens.s1, {});
  assert.ok(claim.body.sessionId && claim.body.sessionId !== a.session["X-Exam-Session"]);
  const old = await request("POST", `/api/exams/attempts/${a.attemptId}/sections/APTITUDE/open`, F.tokens.s1, {}, a.session);
  assert.equal(old.status, 409);
  assert.equal(old.body.code, "SESSION_REPLACED");
  assert.equal((await request("POST", `/api/exams/attempts/${a.attemptId}/sections/APTITUDE/open`, F.tokens.s1, {}, { "X-Exam-Session": claim.body.sessionId })).status, 200);
});

test("readiness checks: a required camera, microphone, fullscreen, browser or connection that is not reported blocks the start", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const s = await request("POST", `/api/exams/${examId}/attempts`, F.tokens.s1, { mode: "PROCTORED" });
  const id = s.body.attemptId;
  const noCam = await request("POST", `/api/exams/attempts/${id}/begin`, F.tokens.s1, { readiness: { ...READY, camera: false } });
  assert.equal(noCam.status, 400);
  assert.equal(noCam.body.code, "READINESS_INCOMPLETE");
  assert.deepEqual(noCam.body.missing, ["camera"]);
  assert.equal((await request("POST", `/api/exams/attempts/${id}/begin`, F.tokens.s1, {})).status, 400);
  assert.equal((await request("POST", `/api/exams/attempts/${id}/sections/APTITUDE/open`, F.tokens.s1, {})).status, 409, "no section opens before the examination has started");
  assert.equal((await request("POST", `/api/exams/attempts/${id}/begin`, F.tokens.s1, { readiness: READY })).status, 200);
});

test("an expired attempt takes no more answers, is closed by the server and scored from what was saved", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  const apt = await doObjective(a, F.tokens.s1, "APTITUDE", F.aptitude);
  assert.ok(apt.answered > 0);
  await prisma.examAttempt.update({ where: { id: a.attemptId }, data: { startedAt: new Date(Date.now() - 2 * 3600e3) } }); // the clock ran out (60 min exam)
  const late = await put(a, F.tokens.s1, apt.items[0].id, 1, { selected: 0 });
  assert.equal(late.status === 409 || late.status === 404, true, late.raw);
  const row = await prisma.examAttempt.findUnique({ where: { id: a.attemptId }, include: { sections: true } });
  assert.ok(["EXPIRED", "EVALUATING", "COMPLETED"].includes(row.status), `status is ${row.status}`);
  assert.ok(row.sections.every((s) => s.status === "COMPLETED"), "every section is closed by the server");
  assert.ok(row.sections.some((s) => s.completedBy === "EXAM_DEADLINE"));
  const saved = await prisma.examAnswer.count({ where: { attemptId: a.attemptId, sectionKey: "APTITUDE" } });
  assert.equal(saved, apt.answered, "what was saved before the deadline is kept");
  assert.ok(row.result && row.result.sections.find((s) => s.key === "APTITUDE").obtained > 0, "and it is scored");
  const v = await view(a, F.tokens.s1);
  assert.ok(["EXPIRED", "EVALUATING", "COMPLETED"].includes(v.body.attempt.status));
});

test("submitting twice is harmless: one result, the same marks", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  for (const [key, bank] of [["APTITUDE", F.aptitude], ["TECHNICAL", F.technical]]) { const r = await doObjective(a, F.tokens.s1, key, bank); assert.equal((await complete(a, F.tokens.s1, key, r.answered)).status, 200); }
  assert.equal((await open(a, F.tokens.s1, "CODING")).status, 200);
  assert.equal((await complete(a, F.tokens.s1, "CODING", 0)).status, 200);
  assert.equal((await open(a, F.tokens.s1, "AI_INTERVIEW")).status, 200);
  assert.equal((await complete(a, F.tokens.s1, "AI_INTERVIEW", 0)).status, 200);
  const both = await Promise.all([1, 2, 3].map(() => request("POST", `/api/exams/attempts/${a.attemptId}/submit`, F.tokens.s1, {}, a.session)));
  assert.ok(both.every((r) => r.status === 200), JSON.stringify(both.map((r) => r.status)));
  const r1 = await prisma.examAttempt.findUnique({ where: { id: a.attemptId } });
  const r2 = await request("POST", `/api/exams/attempts/${a.attemptId}/submit`, F.tokens.s1, {}, a.session);
  assert.equal(r2.status, 200);
  const r3 = await prisma.examAttempt.findUnique({ where: { id: a.attemptId } });
  assert.equal(r1.result.obtained, r3.result.obtained);
  assert.equal(await prisma.examAttemptSection.count({ where: { attemptId: a.attemptId, status: "COMPLETED" } }), 4);
  const late = await put(a, F.tokens.s1, Object.keys(F.aptitude)[0], 1, { selected: 1 });
  assert.equal(late.status, 409, "a submitted attempt accepts no answers");
});

test("proctoring events are stored on the attempt, de-duplicated, never auto-fail, and are only confirmed by a reviewer", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s1);
  await open(a, F.tokens.s1, "APTITUDE");
  const ev = (type) => request("POST", `/api/exams/attempts/${a.attemptId}/events`, F.tokens.s1, { type, sectionKey: "APTITUDE", clientAt: new Date().toISOString() }, a.session);
  const burst = await Promise.all([ev("TAB_SWITCH"), ev("TAB_SWITCH"), ev("TAB_SWITCH")]);
  assert.ok(burst.every((r) => r.status === 200));
  assert.equal(await prisma.examEvent.count({ where: { attemptId: a.attemptId, type: "TAB_SWITCH" } }), 1, "the same event within the window is stored once");
  assert.equal((await ev("NOT_A_REAL_EVENT")).status, 400);
  await ev("FULLSCREEN_EXIT"); await ev("CAMERA_DROPPED"); await ev("MIC_DROPPED");
  const row = await prisma.examAttempt.findUnique({ where: { id: a.attemptId } });
  assert.ok(row.warningCount >= 3, "warnings are counted");
  assert.equal(row.status, "IN_PROGRESS", "reaching the warning limit does not end or fail the attempt");
  assert.equal(row.needsReview, true);
  const events = await prisma.examEvent.findMany({ where: { attemptId: a.attemptId } });
  assert.ok(events.every((e) => e.attemptId === a.attemptId && e.sectionKey === "APTITUDE"));
  assert.ok(events.filter((e) => e.requiresReview).every((e) => e.reviewStatus === "PENDING"), "nothing is confirmed automatically");
  // a student cannot review an event; an administrator can, and a violation needs a note
  const some = events[0].id;
  assert.equal((await request("POST", `/api/exams/admin/attempts/${a.attemptId}/events/${some}/review`, F.tokens.s1, { status: "CONFIRMED", note: "x".repeat(10) })).status, 403);
  assert.equal((await request("POST", `/api/exams/admin/attempts/${a.attemptId}/events/${some}/review`, F.tokens.adminA, { status: "CONFIRMED", note: "" })).status, 400);
  assert.equal((await request("POST", `/api/exams/admin/attempts/${a.attemptId}/events/${some}/review`, F.tokens.adminA, { status: "DISMISSED", note: "left to answer a phone call" })).status, 200);
  await new Promise((r) => setTimeout(r, 600)); // the audit write is fire-and-forget
  const audit = await prisma.auditLog.count({ where: { action: "EXAM_EVENT_REVIEWED", studentId: F.s1.id } });
  assert.ok(audit >= 1, "the review is in the audit log");
});

test("an administrator can invalidate an attempt only with a reason, and it is audited; a student cannot", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const a = await startAndBegin(examId, F.tokens.s2);
  assert.equal((await request("POST", `/api/exams/admin/attempts/${a.attemptId}/invalidate`, F.tokens.s2, { reason: "I would like to restart" })).status, 403);
  assert.equal((await request("POST", `/api/exams/admin/attempts/${a.attemptId}/invalidate`, F.tokens.adminA, { reason: "x" })).status, 400);
  assert.equal((await request("POST", `/api/exams/admin/attempts/${a.attemptId}/invalidate`, F.tokens.adminA, { reason: "Confirmed impersonation by the invigilator" })).status, 200);
  const row = await prisma.examAttempt.findUnique({ where: { id: a.attemptId } });
  assert.equal(row.status, "INVALIDATED");
  assert.equal((await request("POST", `/api/exams/${examId}/attempts`, F.tokens.s2, { mode: "PROCTORED" })).body.attemptId, a.attemptId, "invalidating does not hand the student a fresh formal attempt");
  await new Promise((r) => setTimeout(r, 600)); // the audit write is fire-and-forget
  assert.ok((await prisma.auditLog.count({ where: { action: "EXAM_ATTEMPT_INVALIDATED", studentId: F.s2.id } })) >= 1);
});

test("practice attempts are separate: repeatable, unofficial, and never in the official results", async (t) => {
  if (!ready) return t.skip("not ready");
  const examId = await publishedExam();
  const formal = await startAndBegin(examId, F.tokens.s1);
  const p1 = await startAndBegin(examId, F.tokens.s1, "PRACTICE");
  assert.notEqual(p1.attemptId, formal.attemptId, "practice does not consume or touch the formal attempt");
  const rows = await prisma.examAttempt.findMany({ where: { examId, studentId: F.s1.id } });
  assert.deepEqual(rows.map((r) => r.attemptKey).sort(), ["FORMAL", "PRACTICE-1"]);
  const apt = await doObjective(p1, F.tokens.s1, "APTITUDE", F.aptitude);
  assert.equal((await complete(p1, F.tokens.s1, "APTITUDE", apt.answered)).status, 200);
  const list = await request("GET", `/api/exams/admin/exams/${examId}/attempts`, F.tokens.adminA);
  assert.ok(list.body.attempts.every((x) => x.mode === "PROCTORED"), "the official list never includes practice");
  const an = await request("GET", `/api/exams/admin/exams/${examId}/analytics`, F.tokens.adminA);
  assert.equal(an.body.started, 1, "analytics count only the formal attempt");
  const csv = await request("GET", `/api/exams/admin/exams/${examId}/export.csv`, F.tokens.adminA);
  assert.equal(csv.status, 200);
  assert.equal(csv.raw.trim().split("\n").length, 2, "header plus the one formal attempt");
  const done = await request("POST", `/api/exams/attempts/${p1.attemptId}/submit`, F.tokens.s1, {}, p1.session);
  assert.equal(done.status, 409, "sections must still be completed in order in practice");
  // a second practice attempt can start once the first is finished or left; the same one resumes meanwhile
  const resumed = await request("POST", `/api/exams/${examId}/attempts`, F.tokens.s1, { mode: "PRACTICE" });
  assert.equal(resumed.body.attemptId, p1.attemptId);
});

test("an interview answer survives an AI evaluation failure: the result stays pending and unpublishable", async (t) => {
  if (!ready) return t.skip("not ready");
  const bp = blueprint();
  bp.sections = bp.sections.map((s) => (s.key === "AI_INTERVIEW" ? { ...s, interview: { ...s.interview, evaluationMode: "AI" } } : s));
  const examId = await publishedExam({ sections: bp.sections });
  const a = await startAndBegin(examId, F.tokens.s1);
  for (const [key, bank] of [["APTITUDE", F.aptitude], ["TECHNICAL", F.technical]]) { const r = await doObjective(a, F.tokens.s1, key, bank); await complete(a, F.tokens.s1, key, r.answered); }
  await open(a, F.tokens.s1, "CODING"); await complete(a, F.tokens.s1, "CODING", 0);
  const iv = await open(a, F.tokens.s1, "AI_INTERVIEW");
  const text = "A detailed answer about a team project with a concrete result and what I learned from it.";
  await put(a, F.tokens.s1, iv.body.current.items[0].id, 0, { text });
  assert.equal((await complete(a, F.tokens.s1, "AI_INTERVIEW", 1)).status, 200);
  assert.equal((await request("POST", `/api/exams/attempts/${a.attemptId}/submit`, F.tokens.s1, {}, a.session)).status, 200);
  await new Promise((r) => setTimeout(r, 1500));
  const ans = await prisma.examAnswer.findFirst({ where: { attemptId: a.attemptId, sectionKey: "AI_INTERVIEW" } });
  assert.equal(ans.payload.text, text, "the answer is never changed or lost by evaluation");
  assert.ok(["PENDING", "FAILED", "DONE"].includes(ans.evaluation.status));
  if (ans.evaluation.status !== "DONE") {
    const row = await prisma.examAttempt.findUnique({ where: { id: a.attemptId } });
    assert.equal(row.resultStatus, "EVALUATION_PENDING", "no final score while the evaluation is pending or failed");
    assert.equal(row.result.passed, null);
    assert.notEqual(row.result.sections.find((s) => s.key === "AI_INTERVIEW").obtained, 0, "a failed evaluation is not a zero");
    assert.equal((await request("POST", `/api/exams/admin/attempts/${a.attemptId}/publish-result`, F.tokens.adminA, {})).status, 409);
    const retry = await request("POST", `/api/exams/admin/attempts/${a.attemptId}/retry-evaluation`, F.tokens.adminA, {});
    assert.equal(retry.status, 200, retry.raw);
  }
});

test("the configuration is validated on the server: an invalid examination can be saved as a draft but never published", async (t) => {
  if (!ready) return t.skip("not ready");
  const bad = blueprint({ totalMarks: 55 });
  const c = await request("POST", "/api/exams/admin/exams", F.tokens.adminA, { blueprint: bad });
  assert.equal(c.status, 201);
  assert.equal(c.body.validation.valid, false);
  assert.ok(c.body.validation.errors.some((e) => e.code === "MARKS_MISMATCH"));
  const p = await request("POST", `/api/exams/admin/exams/${c.body.exam.id}/publish`, F.tokens.adminA);
  assert.equal(p.status, 422);
  assert.equal(p.body.code, "INVALID_CONFIGURATION");
  const noTitle = await request("POST", "/api/exams/admin/exams", F.tokens.adminA, { blueprint: { ...bad, title: " " } });
  assert.equal(noTitle.status, 400);
  const notVisible = await request("GET", "/api/exams/available", F.tokens.s1);
  assert.ok(!notVisible.body.exams.some((e) => e.id === c.body.exam.id), "a draft is never offered to students");
  // not enough valid questions in the bank: refused with the numbers
  const short = blueprint();
  short.sections = short.sections.map((s) => (s.key === "TECHNICAL" ? { ...s, questionCount: 9, maxMarks: 10, source: { subjects: [{ subjectId: F.subjectId, count: 9 }] } } : s));
  const c2 = await request("POST", "/api/exams/admin/exams", F.tokens.adminA, { blueprint: short });
  const p2 = await request("POST", `/api/exams/admin/exams/${c2.body.exam.id}/publish`, F.tokens.adminA);
  assert.equal(p2.status, 422);
  assert.equal(p2.body.code, "NOT_ENOUGH_QUESTIONS");
  assert.ok(p2.body.shortages.some((s) => s.section === "TECHNICAL" && s.needed === 9 && s.available === 5));
});

test("an examination outside its window cannot be started; a practice-only examination offers no formal attempt", async (t) => {
  if (!ready) return t.skip("not ready");
  const future = await publishedExam({ startAt: new Date(Date.now() + 2 * 3600e3).toISOString(), endAt: new Date(Date.now() + 6 * 3600e3).toISOString() });
  const r = await request("POST", `/api/exams/${future}/attempts`, F.tokens.s2, { mode: "PROCTORED" });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "NOT_STARTED");
  const noPractice = await publishedExam({ practiceEnabled: false });
  assert.equal((await request("POST", `/api/exams/${noPractice}/attempts`, F.tokens.s2, { mode: "PRACTICE" })).body.code, "PRACTICE_DISABLED");
  assert.equal((await request("POST", `/api/exams/${noPractice}/attempts`, F.tokens.s2, { mode: "NONSENSE" })).status, 400);
});
