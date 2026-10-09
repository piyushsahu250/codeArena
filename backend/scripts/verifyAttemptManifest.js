// End-to-end verification of the assessment manifest, delivery and scoring denominators, against the running API (localhost:4000) with disposable data
// ("ZZ MANIFEST ...", removed at the end). Nothing outside that data is touched.
//   node scripts/verifyAttemptManifest.js
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { validateManifest, scoreBases } = require("../src/utils/attemptManifest");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ MANIFEST";
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); if (!ok) failed++; };

async function http(method, path, token, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.question.deleteMany({ where: { title: { startsWith: `${TAG} ` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-manifest-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const inst = await prisma.institute.create({ data: { name: `${TAG} Institute ${ts}`, code: "ZZMF" } });
  const dept = await prisma.department.create({ data: { name: "ZZ Manifest Dept", instituteId: inst.id } });
  const group = await prisma.academicGroup.create({ data: { instituteId: inst.id, batch: "2026", departmentId: dept.id, section: "Section M" } });
  const pw = {};
  const mk = async (key, role, extra = {}) => {
    pw[key] = crypto.randomBytes(14).toString("base64url");
    return prisma.user.create({ data: { name: `ZZ ${key}`, email: `zz-manifest-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId: inst.id, mustChangePassword: false, ...extra } });
  };
  const stu = { a: await mk("a", "STUDENT", { academicGroupId: group.id, department: "ZZ Manifest Dept" }), b: await mk("b", "STUDENT", { academicGroupId: group.id, department: "ZZ Manifest Dept" }), c: await mk("c", "STUDENT", { academicGroupId: group.id, department: "ZZ Manifest Dept" }), d: await mk("d", "STUDENT", { academicGroupId: group.id, department: "ZZ Manifest Dept" }) };
  const admin = await mk("admin", "INSTITUTE_ADMIN");
  const tokenOf = async (u, key) => (await http("POST", "/auth/login", null, { email: u.email, password: pw[key] })).json.token;
  const tok = { a: await tokenOf(stu.a, "a"), b: await tokenOf(stu.b, "b"), c: await tokenOf(stu.c, "c"), d: await tokenOf(stu.d, "d"), admin: await tokenOf(admin, "admin") };

  const POINTS = 2;
  const qs = [];
  for (let i = 1; i <= 40; i++) qs.push(await prisma.question.create({ data: { title: `${TAG} Q${i}`, description: `manifest question ${i}`, questionType: "MCQ", difficulty: "EASY", points: POINTS, options: ["A", "B", "C"], correctAnswer: [1], instituteId: inst.id } }));
  const now = Date.now();
  const mkTest = (title, questionList, extra = {}) => prisma.test.create({
    data: {
      title: `${TAG} ${title}`, durationMin: 30, startTime: new Date(now - 60000), endTime: new Date(now + 6 * 3600000), isPublished: true, showResults: true, requireFullscreen: false,
      createdById: admin.id, instituteId: inst.id, academicGroups: { create: [{ academicGroupId: group.id }] },
      questions: { create: questionList.map((q, order) => ({ questionId: q.id, order })) }, ...extra,
    },
  });

  // ---- 1. FIXED 30 questions: delivery, manifest, resume ----
  const t30 = await mkTest("Fixed 30", qs.slice(0, 30));
  let r = await http("POST", `/tests/${t30.id}/start`, tok.a);
  check("start a 30-question test", r.status === 200 && r.json.id, `status ${r.status}`);
  const attemptA = r.json;
  check("attempt records expectedQuestionCount = 30 and manifestVersion", attemptA.expectedQuestionCount === 30 && attemptA.manifestVersion === 1);
  check("manifest holds 30 unique question ids", Array.isArray(attemptA.questionOrder) && attemptA.questionOrder.length === 30 && new Set(attemptA.questionOrder).size === 30);
  r = await http("GET", `/tests/${t30.id}`, tok.a);
  check("GET delivers all 30 questions", r.json.questions.length === 30, `${r.json.questions.length}`);
  check("response carries the manifest (expected 30, no unavailable)", r.json.manifest?.expectedCount === 30 && r.json.manifest.unavailableCount === 0 && r.json.manifest.questionIds.length === 30);
  check("delivered ids equal manifest ids in order", JSON.stringify(r.json.questions.map((q) => q.questionId)) === JSON.stringify(r.json.manifest.questionIds));
  check("no answer key in the student payload", !r.text.includes("correctAnswer"));
  const firstOrder = JSON.stringify(attemptA.questionOrder);
  const r2 = await http("POST", `/tests/${t30.id}/start`, tok.a);
  check("refresh / reconnect (start again) returns the same question set and order", JSON.stringify(r2.json.questionOrder) === firstOrder);
  const g2 = await http("GET", `/tests/${t30.id}`, tok.a);
  check("refresh delivers the same 30 questions again", JSON.stringify(g2.json.questions.map((q) => q.questionId)) === firstOrder);

  // concurrent first start for another student: exactly one attempt, one order
  const conc = await Promise.all([1, 2, 3, 4, 5].map(() => http("POST", `/tests/${t30.id}/start`, tok.b)));
  const orders = new Set(conc.map((x) => JSON.stringify(x.json.questionOrder)));
  check("5 concurrent starts for one student -> one attempt and one question order", conc.every((x) => x.status === 200) && orders.size === 1 && (await prisma.testAttempt.count({ where: { testId: t30.id, studentId: stu.b.id } })) === 1);

  // ---- 2. answers: 28 answered of 30 -> out of 30 ----
  const ansIds = attemptA.questionOrder.slice(0, 28);
  for (const qid of ansIds) await http("POST", "/submissions/submit", tok.a, { attemptId: attemptA.id, questionId: qid, selectedOptions: [1] });
  // duplicate / retried save of one answer must not duplicate marks
  await http("POST", "/submissions/submit", tok.a, { attemptId: attemptA.id, questionId: ansIds[0], selectedOptions: [1] });
  await http("POST", "/submissions/submit", tok.a, { attemptId: attemptA.id, questionId: ansIds[0], selectedOptions: [1] });
  r = await http("POST", `/submissions/finalize/${attemptA.id}`, tok.a, { reason: null });
  check("finalize succeeds", r.status === 200 && r.json.status === "SUBMITTED", `status ${r.status}`);
  check("score = 28 correct x 2 = 56 (no duplicated marks from retried saves)", r.json.totalScore === 56, `${r.json.totalScore}`);
  const fin2 = await http("POST", `/submissions/finalize/${attemptA.id}`, tok.a, { reason: null });
  const after = await prisma.testAttempt.findUnique({ where: { id: attemptA.id } });
  check("repeated finalize leaves the score unchanged (idempotent)", after.totalScore === 56, `status ${fin2.status}, score ${after.totalScore}`);
  r = await http("GET", `/tests/${t30.id}/result`, tok.a);
  check("result is out of 30 questions / 60 points even though 28 were answered", r.json.maxScore === 60 && r.json.expectedQuestionCount === 30, JSON.stringify({ max: r.json.maxScore, exp: r.json.expectedQuestionCount }));
  check("result separates answered (28) from unanswered (2)", r.json.answeredCount === 28 && r.json.unansweredCount === 2);

  // ---- 3. admin edits the test after a student started: that student keeps 30 and the same denominator ----
  const attemptC = (await http("POST", `/tests/${t30.id}/start`, tok.c)).json;
  await prisma.testQuestion.deleteMany({ where: { testId: t30.id, questionId: { in: attemptC.questionOrder.slice(0, 2) } } });
  r = await http("GET", `/tests/${t30.id}`, tok.c);
  check("after 2 questions are removed from the test, the started student still receives all 30", r.json.questions.length === 30 && r.json.manifest.unavailableCount === 0, `${r.json.questions.length}`);
  for (const qid of attemptC.questionOrder) await http("POST", "/submissions/submit", tok.c, { attemptId: attemptC.id, questionId: qid, selectedOptions: [1] });
  r = await http("POST", `/submissions/finalize/${attemptC.id}`, tok.c, { reason: null });
  check("that student's 30 correct answers score 60", r.json.totalScore === 60, `${r.json.totalScore}`);
  r = await http("GET", `/tests/${t30.id}/result`, tok.c);
  check("result denominator stays 60 although the test now lists 28 questions", r.json.maxScore === 60 && r.json.expectedQuestionCount === 30);
  r = await http("GET", `/tests/${t30.id}/results/export?format=csv`, tok.admin);

  const csvOk = r.status === 200 && /Max Score/.test(r.text);
  check("results export is reachable", csvOk, `status ${r.status}`);
  if (csvOk) {
    const lines = r.text.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(",").map((h) => h.replace(/"/g, ""));
    const iMax = header.indexOf("Max Score"), iTotal = header.indexOf("Total Questions");
    const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.replace(/"/g, "")));
    check("export shows Max Score 60 and Total Questions 30 for every attempt, including the one whose test was edited", rows.length >= 3 && rows.every((x) => x[iMax] === "60" && x[iTotal] === "30"), JSON.stringify(rows.map((x) => [x[iMax], x[iTotal]])));
  }

  // ---- 4. RANDOM mode: per-student draw, unique, randomised, scored per draw ----
  const folder = await prisma.questionFolder.create({ data: { name: `${TAG} bank ${ts}`, instituteId: inst.id } }).catch(() => null);
  const rnd = await mkTest("Random 30 of 40", qs.slice(0, 40), { questionSelectionMode: "RANDOM", randomQuestionsPerStudent: 30, ...(folder ? { randomBankFolderId: folder.id } : {}) });
  const ra = (await http("POST", `/tests/${rnd.id}/start`, tok.a)).json;
  const rb = (await http("POST", `/tests/${rnd.id}/start`, tok.b)).json;
  check("RANDOM: each student gets exactly 30 unique questions out of a 40-question bank", ra.questionOrder?.length === 30 && new Set(ra.questionOrder).size === 30 && rb.questionOrder?.length === 30 && new Set(rb.questionOrder).size === 30);
  check("RANDOM: per-student randomisation is preserved (the two draws differ)", JSON.stringify(ra.questionOrder) !== JSON.stringify(rb.questionOrder));
  const bases = await scoreBases(prisma, [{ id: ra.id, testId: rnd.id, questionOrder: ra.questionOrder }]);
  check("RANDOM: denominator is the student's 30 questions (60), not the whole 40-question bank (80)", bases.get(ra.id).maxScore === 60 && bases.get(ra.id).expectedCount === 30, JSON.stringify(bases.get(ra.id)));

  // ---- 5. a configuration that cannot deliver the configured count is refused, never silently shortened ----
  const bad = await mkTest("Random 30 of 28", qs.slice(0, 28), { questionSelectionMode: "RANDOM", randomQuestionsPerStudent: 30 });
  r = await http("POST", `/tests/${bad.id}/start`, tok.d);
  check("30 configured but only 28 valid questions: start is blocked with 409 and an actionable message", r.status === 409 && r.json.code === "ASSESSMENT_CONFIG_INVALID" && /30/.test(r.json.error) && /28/.test(r.json.error), `${r.status} ${r.json?.error || ""}`);
  check("no 28-question attempt was created", (await prisma.testAttempt.count({ where: { testId: bad.id } })) === 0);

  // ---- 6. a hard-deleted assigned question is reported, not silently dropped ----
  const t5 = await mkTest("Fixed 5", qs.slice(30, 35));
  const at5 = (await http("POST", `/tests/${t5.id}/start`, tok.d)).json;
  await prisma.testQuestion.deleteMany({ where: { questionId: at5.questionOrder[0] } });
  await prisma.submission.deleteMany({ where: { questionId: at5.questionOrder[0] } });
  await prisma.question.delete({ where: { id: at5.questionOrder[0] } });
  r = await http("GET", `/tests/${t5.id}`, tok.d);
  check("a deleted assigned question is flagged in the manifest (unavailableCount 1, 4 delivered of 5 expected)", r.json.manifest?.unavailableCount === 1 && r.json.questions.length === 4 && r.json.manifest.expectedCount === 5, JSON.stringify(r.json.manifest && { u: r.json.manifest.unavailableCount, e: r.json.manifest.expectedCount, got: r.json.questions.length }));

  // ---- 7. pure validation rules ----
  const tq = (ids) => ids.map((id) => ({ questionId: id }));
  check("validator rejects duplicate ids", validateManifest({ questionSelectionMode: "FIXED", questions: tq(["a", "b", "c"]) }, ["a", "a", "c"]).errors.includes("DUPLICATE_IDS"));
  check("validator rejects an id that is not in the test", validateManifest({ questionSelectionMode: "FIXED", questions: tq(["a", "b"]) }, ["a", "z"]).errors.includes("NOT_IN_TEST"));
  check("validator rejects an empty draw", validateManifest({ questionSelectionMode: "FIXED", questions: tq([]) }, []).errors.includes("EMPTY"));
  check("validator accepts any configured count (not hard-coded to 30)", validateManifest({ questionSelectionMode: "FIXED", questions: tq(["a", "b", "c", "d", "e", "f", "g"]) }, ["a", "b", "c", "d", "e", "f", "g"]).ok);

  await cleanup();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await cleanup(); } catch { /* ignore */ } process.exit(1); });
