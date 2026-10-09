// Characterization (contract) test for the /api/submissions endpoints: drives every route through its success and failure paths with disposable data and compares a
// normalized record of every response (status + body shape and stable values) with test/snapshots/submissions-contract.json. Used to prove a restructuring of the
// module changes nothing except what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a database; the coding scenarios need the judge.
//   node scripts/verifySubmissionsContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifySubmissionsContract.js --record   (re)write the snapshot
//   CONTRACT_SKIP_JUDGE=1 skips the scenarios that execute code
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ CONTRACT";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "submissions-contract.json");
const SKIP_JUDGE = process.env.CONTRACT_SKIP_JUDGE === "1";
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const VOLATILE_NUM = new Set(["timeMs", "memoryKb", "maxTimeMs", "maxMemoryKb", "serverNow", "deadline", "active", "waiting"]);
function norm(v, key) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>");
  if (typeof v === "number") return VOLATILE_NUM.has(key) ? "<n>" : v;
  if (Array.isArray(v)) return v.map((x) => norm(x));
  if (typeof v === "object") {
    if (key === "gamification") return "<gamification object>";
    const o = {};
    for (const k of Object.keys(v).sort()) { if (k === "sessionId") { o[k] = v[k] ? "<session>" : null; continue; } o[k] = norm(v[k], k); }
    return o;
  }
  return v;
}
async function call(name, method, p, token, body, headers = {}) {
  const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-json */ }
  log.push({ name, status: res.status, body: json === null ? `<non-json ${text.slice(0, 40)}>` : norm(json) });
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.question.deleteMany({ where: { title: { startsWith: `${TAG} ` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-contract-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZCA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZCB" } });
  const dept = await prisma.department.create({ data: { name: "ZZ Contract Dept", instituteId: A.id } });
  const group = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section C" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = crypto.randomBytes(14).toString("base64url");
    return prisma.user.create({ data: { name: `ZZ ${key}`, email: `zz-contract-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const stuA = await mk("a", "STUDENT", A.id, { academicGroupId: group.id, department: "ZZ Contract Dept" });
  const stuB = await mk("b", "STUDENT", A.id, { academicGroupId: group.id, department: "ZZ Contract Dept" });
  const staff = await mk("staff", "STAFF", A.id, { department: "ZZ Contract Dept" });
  const login = async (u, k) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
  const tA = await login(stuA, "a"), tB = await login(stuB, "b"), tStaff = await login(staff, "staff");

  const q = (data) => prisma.question.create({ data: { instituteId: A.id, difficulty: "EASY", ...data } });
  const mcq1 = await q({ title: `${TAG} mcq1`, description: "pick B", questionType: "MCQ", points: 4, options: ["A", "B", "C"], correctAnswer: [1] });
  const mcq2 = await q({ title: `${TAG} mcq2 (not on the test)`, description: "pick A", questionType: "MCQ", points: 4, options: ["A", "B"], correctAnswer: [0] });
  const num1 = await q({ title: `${TAG} num1`, description: "answer 42", questionType: "NUMERICAL", points: 3, numericAnswer: 42, numericTolerance: 0, numericAnswerDisplay: "42" });
  const pyCases = [{ input: "2\n", expected: "4", isHidden: false }, { input: "5\n", expected: "10", isHidden: true }, { input: "0\n", expected: "0", isHidden: true }];
  const code1 = await q({ title: `${TAG} code1`, description: "print double", questionType: "CODING", points: 10, evaluationType: "STDIO", testCases: { create: pyCases } });
  const code2 = await q({ title: `${TAG} code2 (not on the test)`, description: "print double", questionType: "CODING", points: 10, evaluationType: "STDIO", testCases: { create: pyCases } });
  const codeOther = await prisma.question.create({ data: { title: `${TAG} code other institute`, description: "x", questionType: "CODING", points: 5, difficulty: "EASY", evaluationType: "STDIO", instituteId: B.id, testCases: { create: pyCases } } });
  const now = Date.now();
  const mkTest = (title) => prisma.test.create({
    data: {
      title: `${TAG} ${title}`, durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 6 * 3600000), isPublished: true, showResults: true, requireFullscreen: false, shuffleQuestions: false,
      createdById: staff.id, instituteId: A.id, academicGroups: { create: [{ academicGroupId: group.id }] },
      questions: { create: [mcq1, num1, code1].map((qq, order) => ({ questionId: qq.id, order })) },
    },
  });
  const test = await mkTest("Contract Test");
  const test2 = await mkTest("Contract Test (late)");

  const startA = (await call("setup: student A starts", "POST", `/tests/${test.id}/start`, tA)).json;
  const startB = (await call("setup: student B starts", "POST", `/tests/${test2.id}/start`, tB)).json;
  log.length = 0; // setup responses are covered by other tests
  const att = startA.id, attB = startB.id;
  const good = "n = int(input())\nprint(n * 2)\n", bad = "print(1)\n";

  // ---------- access ----------
  await call("queue-status: authenticated", "GET", "/submissions/queue-status", tA);
  await call("queue-status: anonymous", "GET", "/submissions/queue-status", null);
  await call("submit: anonymous", "POST", "/submissions/submit", null, { attemptId: att, questionId: mcq1.id, selectedOptions: [1] });
  await call("submit: staff role refused", "POST", "/submissions/submit", tStaff, { attemptId: att, questionId: mcq1.id, selectedOptions: [1] });
  await call("finalize: anonymous", "POST", `/submissions/finalize/${att}`, null, {});

  // ---------- /run ----------
  await call("run: unknown question", "POST", "/submissions/run", tA, { questionId: crypto.randomUUID(), language: "python", code: good });
  await call("run: not a coding question", "POST", "/submissions/run", tA, { questionId: mcq1.id, language: "python", code: good });
  await call("run: question of another institute", "POST", "/submissions/run", tA, { questionId: codeOther.id, language: "python", code: good });
  if (!SKIP_JUDGE) {
    const r = await call("run: correct code on the sample case", "POST", "/submissions/run", tA, { questionId: code1.id, language: "python", code: good });
    note("run result never lists the hidden cases", { totalCases: r.json?.totalCases, hasDetails: Array.isArray(r.json?.details) });
  }

  // ---------- /autosave ----------
  await call("autosave: unknown attempt", "POST", "/submissions/autosave", tA, { attemptId: crypto.randomUUID(), questionId: code1.id, language: "python", code: good });
  await call("autosave: another student's attempt", "POST", "/submissions/autosave", tB, { attemptId: att, questionId: code1.id, language: "python", code: good });
  await call("autosave: question not on this test", "POST", "/submissions/autosave", tA, { attemptId: att, questionId: code2.id, language: "python", code: good });
  await call("autosave: not a coding question", "POST", "/submissions/autosave", tA, { attemptId: att, questionId: mcq1.id, language: "python", code: good });
  await call("autosave: unknown question", "POST", "/submissions/autosave", tA, { attemptId: att, questionId: crypto.randomUUID(), language: "python", code: good });
  await call("autosave: missing attemptId", "POST", "/submissions/autosave", tA, { questionId: code1.id, language: "python", code: good });
  await call("autosave: saves a draft", "POST", "/submissions/autosave", tA, { attemptId: att, questionId: code1.id, language: "python", code: bad, seq: 200 });
  await call("autosave: a stale (older) save is dropped", "POST", "/submissions/autosave", tA, { attemptId: att, questionId: code1.id, language: "python", code: "print('older')", seq: 100 });
  const afterStale = await prisma.submission.findUnique({ where: { attemptId_questionId: { attemptId: att, questionId: code1.id } }, select: { code: true, verdict: true } });
  note("draft after the stale save", afterStale);
  await call("autosave: a newer save wins", "POST", "/submissions/autosave", tA, { attemptId: att, questionId: code1.id, language: "python", code: good, seq: 300 });
  note("draft after the newer save", await prisma.submission.findUnique({ where: { attemptId_questionId: { attemptId: att, questionId: code1.id } }, select: { code: true, verdict: true } }));

  // ---------- /submit-code ----------
  await call("submit-code: question not on this test", "POST", "/submissions/submit-code", tA, { attemptId: att, questionId: code2.id, language: "python", code: good });
  await call("submit-code: not a coding question", "POST", "/submissions/submit-code", tA, { attemptId: att, questionId: mcq1.id, language: "python", code: good });
  await call("submit-code: another student's attempt", "POST", "/submissions/submit-code", tB, { attemptId: att, questionId: code1.id, language: "python", code: good });
  if (!SKIP_JUDGE) {
    const s1 = await call("submit-code: correct solution is judged on hidden cases", "POST", "/submissions/submit-code", tA, { attemptId: att, questionId: code1.id, language: "python", code: good });
    note("submit-code response hides per-case details", { hasDetails: s1.json && "details" in s1.json });
    await call("submit-code: a worse resubmission still reports its own verdict", "POST", "/submissions/submit-code", tA, { attemptId: att, questionId: code1.id, language: "python", code: bad });
    note("stored best is kept after the worse resubmission", await prisma.submission.findUnique({ where: { attemptId_questionId: { attemptId: att, questionId: code1.id } }, select: { verdict: true, score: true, code: true } }));
  }

  // ---------- /submit (quiz) ----------
  await call("submit: unknown attempt", "POST", "/submissions/submit", tA, { attemptId: crypto.randomUUID(), questionId: mcq1.id, selectedOptions: [1] });
  await call("submit: another student's attempt", "POST", "/submissions/submit", tB, { attemptId: att, questionId: mcq1.id, selectedOptions: [1] });
  await call("submit: unknown question", "POST", "/submissions/submit", tA, { attemptId: att, questionId: crypto.randomUUID(), selectedOptions: [1] });
  await call("submit: coding question refused", "POST", "/submissions/submit", tA, { attemptId: att, questionId: code1.id, selectedOptions: [1] });
  await call("submit: missing attemptId", "POST", "/submissions/submit", tA, { questionId: mcq1.id, selectedOptions: [1] });
  await call("submit: wrong answer", "POST", "/submissions/submit", tA, { attemptId: att, questionId: mcq1.id, selectedOptions: [0] });
  note("score after a wrong MCQ answer", (await prisma.testAttempt.findUnique({ where: { id: att }, select: { totalScore: true } })).totalScore);
  await call("submit: changing the answer replaces it", "POST", "/submissions/submit", tA, { attemptId: att, questionId: mcq1.id, selectedOptions: [1] });
  note("one row for the question, correct, and the score includes the coding best", { rows: await prisma.submission.count({ where: { attemptId: att, questionId: mcq1.id } }), score: (await prisma.testAttempt.findUnique({ where: { id: att }, select: { totalScore: true } })).totalScore });
  await call("submit: numeric answer (exact)", "POST", "/submissions/submit", tA, { attemptId: att, questionId: num1.id, numericResponse: "42" });
  await call("submit: numeric answer (wrong)", "POST", "/submissions/submit", tA, { attemptId: att, questionId: num1.id, numericResponse: "41" });
  // an MCQ that was never assigned to this attempt (the quiz route's assigned-question check)
  const scoreBefore = (await prisma.testAttempt.findUnique({ where: { id: att }, select: { totalScore: true } })).totalScore;
  await call("submit: an MCQ that is NOT part of this student's test", "POST", "/submissions/submit", tA, { attemptId: att, questionId: mcq2.id, selectedOptions: [0] }); // the correct answer for a 4-point question
  note("score change caused by answering a question that is not on the student's test", (await prisma.testAttempt.findUnique({ where: { id: att }, select: { totalScore: true } })).totalScore - scoreBefore);
  note("rows saved for the unassigned MCQ", await prisma.submission.count({ where: { attemptId: att, questionId: mcq2.id } }));

  // ---------- /finalize ----------
  await call("finalize: another student's attempt", "POST", `/submissions/finalize/${att}`, tB, {});
  await call("finalize: automatic 'time' call before the deadline is not honoured", "POST", `/submissions/finalize/${att}`, tA, { reason: "time" });
  await call("finalize: manual submit", "POST", `/submissions/finalize/${att}`, tA, {});
  await call("finalize: repeating it returns the current state", "POST", `/submissions/finalize/${att}`, tA, {});
  await call("submit: after the attempt is finalized", "POST", "/submissions/submit", tA, { attemptId: att, questionId: mcq1.id, selectedOptions: [1] });
  await call("autosave: after the attempt is finalized", "POST", "/submissions/autosave", tA, { attemptId: att, questionId: code1.id, language: "python", code: good });
  await call("submit-code: after the attempt is finalized", "POST", "/submissions/submit-code", tA, { attemptId: att, questionId: code1.id, language: "python", code: good });
  note("final attempt row", await prisma.testAttempt.findUnique({ where: { id: att }, select: { status: true, totalScore: true } }));

  // ---------- deadline ----------
  await prisma.testAttempt.update({ where: { id: attB }, data: { startedAt: new Date(Date.now() - 2 * 3600000) } });
  await call("submit: after the student's own deadline", "POST", "/submissions/submit", tB, { attemptId: attB, questionId: mcq1.id, selectedOptions: [1] });
  await call("autosave: after the student's own deadline", "POST", "/submissions/autosave", tB, { attemptId: attB, questionId: code1.id, language: "python", code: good });
  await call("submit-code: after the student's own deadline", "POST", "/submissions/submit-code", tB, { attemptId: attB, questionId: code1.id, language: "python", code: good });
  await call("finalize: past the deadline closes it as auto-submitted", "POST", `/submissions/finalize/${attB}`, tB, { reason: "time" });

  await cleanup();

  // ---------- compare / record ----------
  if (record) {
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    fs.writeFileSync(SNAP, JSON.stringify(log, null, 2) + "\n");
    console.log(`recorded ${log.length} entries to ${path.relative(process.cwd(), SNAP)}`);
    process.exit(0);
  }
  if (!fs.existsSync(SNAP)) { console.log("FAIL  no snapshot found; run with --record on a known-good build first"); process.exit(1); }
  const base = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const skipName = (n) => SKIP_JUDGE && /judge|correct code|worse resubmission|stored best|run result|response hides/.test(n);
  const baseMap = new Map(base.map((e) => [e.name, e])), curMap = new Map(log.map((e) => [e.name, e]));
  let diffs = 0;
  for (const [name, b] of baseMap) {
    if (skipName(name)) continue;
    const c = curMap.get(name);
    if (!c) { console.log(`DIFF  missing now: ${name}`); diffs++; continue; }
    if (JSON.stringify(b) !== JSON.stringify(c)) { console.log(`DIFF  ${name}\n      was: ${JSON.stringify(b).slice(0, 260)}\n      now: ${JSON.stringify(c).slice(0, 260)}`); diffs++; }
  }
  for (const name of curMap.keys()) if (!baseMap.has(name)) { console.log(`DIFF  new scenario not in the snapshot: ${name}`); diffs++; }
  console.log(diffs ? `\n${diffs} difference(s) from the recorded contract` : `\nAll ${base.length} recorded responses match the contract`);
  process.exit(diffs ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await cleanup(); } catch { /* ignore */ } process.exit(1); });
