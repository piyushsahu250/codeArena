// Characterization (contract) test for the question-authoring half of /api/questions: create, list, filters, read one, edit, duplicate, delete, image removal,
// analytics, and the starter-code preview. It drives each route through success and failure paths with disposable data and compares a normalized record of every
// response, and of what the routes stored, with test/snapshots/questions-contract.json. Used to prove a restructuring of routes/questions.js changes nothing except
// what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a database.
//   node scripts/verifyQuestionsContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifyQuestionsContract.js --record   (re)write the snapshot
// Deliberately NOT exercised, because they depend on services that differ between production and CI: running code through the judge (validate-test-cases with a
// solution, a starter code that is checked against the tests, VERIFIED with a stored reference solution) and storing an image in object storage (image upload).
// Platform-wide reads are recorded as a SHAPE (keys only) because production holds real rows the snapshot must not depend on.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ QC";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "questions-contract.json");
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const MASKED = new Set(["ipAddress", "deviceInfo", "lastLoginAt", "questionNumber"]);
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>").replace(/\d{13}/g, "<ts>");
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = MASKED.has(k) ? "<masked>" : k === "token" ? (v[k] ? "<token>" : null) : norm(v[k]); return o; }
  return v;
}
const shapeOf = (v) => (Array.isArray(v) ? (v.length ? [shapeOf(v[0])] : []) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shapeOf(v[k])])) : ".");
let ipSeq = 0;
const nextIp = () => `203.0.113.${200 + ++ipSeq}`;
async function call(name, method, p, token, body, opts = {}) {
  const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  log.push({ name, status: res.status, body: json !== null ? (opts.shape ? shapeOf(json) : norm(json)) : `<non-json ${text.slice(0, 40)}>` });
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(900);

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-qc-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-qc-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-qc-" } }] } });
  await prisma.submission.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.testAttempt.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.test.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }] } });
  await prisma.question.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }, { description: { startsWith: TAG } }] } });
  await prisma.questionFolder.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }] } });
  await prisma.staffSubjectAssignment.deleteMany({ where: { staffId: { in: uids } } });
  await prisma.subject.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { name: { startsWith: TAG } }] } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}
const auditRows = async (where) => (await prisma.auditLog.findMany({ where, select: { action: true, adminRole: true, studentId: true, instituteId: true, details: true }, orderBy: { createdAt: "asc" } }))
  .map((a) => `${a.action}|role:${a.adminRole || "-"}|student:${a.studentId ? "set" : "-"}|inst:${a.instituteId ? "set" : "-"}|keys:${Object.keys(a.details || {}).sort().join(",")}`);

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZQA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZQB" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
    return prisma.user.create({ data: { name: `ZZ QC ${key}`, email: `zz-qc-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const platform = await mk("platform", "ADMIN", null);
  const instA = await mk("instA", "INSTITUTE_ADMIN", A.id);
  const instB = await mk("instB", "INSTITUTE_ADMIN", B.id);
  const staffA = await mk("staffA", "STAFF", A.id);
  const staffA2 = await mk("staffA2", "STAFF", A.id);
  const staffB = await mk("staffB", "STAFF", B.id);
  const student = await mk("student", "STUDENT", A.id);
  const login = async (u, k) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
  const T = {};
  for (const [k, u] of Object.entries({ platform, instA, instB, staffA, staffA2, staffB, student })) T[k] = await login(u, k);
  const bogus = crypto.randomUUID();

  // classification and folders (made directly: their own routes are covered elsewhere)
  const subA = await prisma.subject.create({ data: { name: `${TAG} Subject A ${ts}`, instituteId: A.id, createdById: instA.id } });
  const subB = await prisma.subject.create({ data: { name: `${TAG} Subject B ${ts}`, instituteId: B.id, createdById: instB.id } });
  const unitA1 = await prisma.unit.create({ data: { subjectId: subA.id, name: "Unit 1" } });
  const unitA2 = await prisma.unit.create({ data: { subjectId: subA.id, name: "Unit 2" } });
  const unitB1 = await prisma.unit.create({ data: { subjectId: subB.id, name: "Unit 1" } });
  const topicA1 = await prisma.topic.create({ data: { unitId: unitA1.id, name: "Topic 1" } });
  await prisma.staffSubjectAssignment.create({ data: { staffId: staffA.id, subjectId: subA.id, assignedById: instA.id } });
  const folderA = await prisma.questionFolder.create({ data: { name: "ZZ QC folder A", instituteId: A.id, createdById: instA.id } });
  const folderB = await prisma.questionFolder.create({ data: { name: "ZZ QC folder B", instituteId: B.id, createdById: instB.id } });
  const folderShared = await prisma.questionFolder.create({ data: { name: "ZZ QC shared", instituteId: A.id, createdById: instA.id } });
  await prisma.questionFolderShare.create({ data: { folderId: folderShared.id, staffId: staffA2.id, sharedByUserId: instA.id, sharedByName: instA.name } });

  const cls = (extra = {}) => ({ subjectId: subA.id, unitId: unitA1.id, ...extra });
  const mcq = (n, extra = {}) => ({ description: `${TAG} mcq ${n}`, questionType: "MCQ", options: ["Red", "Green", "Blue"], correctAnswer: [1], ...cls(), ...extra });
  const tc = (i, hidden) => ({ input: String(i), expected: String(i * 2), isHidden: hidden });
  const cases = (visible, hidden) => [...Array.from({ length: visible }, (_, i) => tc(i + 1, false)), ...Array.from({ length: hidden }, (_, i) => tc(i + 10, true))];
  const coding = (n, extra = {}) => ({ description: `${TAG} coding ${n}`, questionType: "CODING", title: `${TAG} coding title ${n}`, testCases: cases(2, 5), ...cls(), ...extra });

  // ---------- create ----------
  await call("create: anonymous", "POST", "/questions", null, mcq(0));
  await call("create: student refused", "POST", "/questions", T.student, mcq(0));
  await call("create: no question text", "POST", "/questions", T.instA, { questionType: "MCQ" });
  await call("create: no subject or unit", "POST", "/questions", T.instA, { description: `${TAG} no class`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0] });
  await call("create: unit of another subject", "POST", "/questions", T.instA, mcq(0, { unitId: unitB1.id }));
  await call("create: topic of another unit", "POST", "/questions", T.instA, mcq(0, { topicId: bogus }));
  await call("create: staff without access to the subject", "POST", "/questions", T.staffA2, mcq(0));
  await call("create: a subject of another institute is accepted for an admin", "POST", "/questions", T.instA, mcq(90, { subjectId: subB.id, unitId: unitB1.id }));
  await call("create: folder of another institute", "POST", "/questions", T.instA, mcq(0, { folderId: folderB.id }));
  await call("create: folder that does not exist", "POST", "/questions", T.instA, mcq(0, { folderId: bogus }));
  await call("create: one option only", "POST", "/questions", T.instA, mcq(0, { options: ["only"] }));
  await call("create: duplicate options", "POST", "/questions", T.instA, mcq(0, { options: ["a", "a"], correctAnswer: [0] }));
  await call("create: no correct answer", "POST", "/questions", T.instA, mcq(0, { correctAnswer: [] }));
  const m1 = await call("create: MCQ", "POST", "/questions", T.instA, mcq(1, { title: " MCQ one ", difficulty: "MEDIUM", points: 3, btlLevel: 2, explanation: "because", tags: ["x"], folderId: folderA.id }));
  await call("create: the same text again is a duplicate", "POST", "/questions", T.instA, mcq(1, { folderId: folderA.id }));
  await call("create: the same text in another folder is not", "POST", "/questions", T.instA, mcq(1));
  await call("create: duplicate allowed on request", "POST", "/questions", T.instA, mcq(1, { folderId: folderA.id, allowDuplicate: true }));
  await call("create: true/false", "POST", "/questions", T.instA, { description: `${TAG} tf 1`, questionType: "TRUE_FALSE", correctAnswer: ["False"], ...cls() });
  await call("create: true/false without an answer", "POST", "/questions", T.instA, { description: `${TAG} tf 2`, questionType: "TRUE_FALSE", ...cls() });
  await call("create: multiple select", "POST", "/questions", T.instA, mcq(2, { questionType: "MULTISELECT", correctAnswer: [0, 2] }));
  await call("create: MCQ with two correct answers", "POST", "/questions", T.instA, mcq(3, { correctAnswer: [0, 1] }));
  await call("create: numerical", "POST", "/questions", T.instA, { description: `${TAG} num 1`, questionType: "NUMERICAL", numericAnswer: "3.5", numericTolerance: 0.1, ...cls() });
  await call("create: numerical with a negative tolerance", "POST", "/questions", T.instA, { description: `${TAG} num 2`, questionType: "NUMERICAL", numericAnswer: "1", numericTolerance: -1, ...cls() });
  await call("create: numerical without an answer", "POST", "/questions", T.instA, { description: `${TAG} num 3`, questionType: "NUMERICAL", ...cls() });
  await call("create: coding with one visible sample", "POST", "/questions", T.instA, coding(0, { testCases: cases(1, 5) }));
  await call("create: coding with four hidden cases", "POST", "/questions", T.instA, coding(0, { testCases: cases(2, 4) }));
  await call("create: coding with an unknown comparison mode", "POST", "/questions", T.instA, coding(0, { comparisonMode: "FUZZY" }));
  const c1 = await call("create: coding", "POST", "/questions", T.instA, coding(1, { comparisonMode: "TOKEN", floatAbsoluteTolerance: 0.5, timeLimitMs: 1500, tags: ["dp", "easy"], starterCode: "// start" }));
  await call("create: coding with a function signature that is invalid", "POST", "/questions", T.instA, coding(2, { evaluationType: "FUNCTION", functionSignature: { methodName: "1bad", returnType: "int", params: [] } }));
  await call("create: SQL without setup", "POST", "/questions", T.instA, { description: `${TAG} sql 1`, questionType: "SQL", testCases: cases(1, 5), ...cls() });
  await call("create: SQL with four hidden cases", "POST", "/questions", T.instA, { description: `${TAG} sql 2`, questionType: "SQL", sqlSchema: "create table t(a int);", testCases: cases(1, 4), ...cls() });
  await call("create: SQL", "POST", "/questions", T.instA, { description: `${TAG} sql 3`, questionType: "SQL", sqlSchema: "create table t(a int);", testCases: cases(1, 5), ...cls() });
  await call("create: AI drafted defaults to DRAFT", "POST", "/questions", T.instA, mcq(4, { aiGenerated: true }));
  await call("create: unknown status falls back to published", "POST", "/questions", T.instA, mcq(5, { questionStatus: "WHATEVER", btlLevel: 9 }));
  await call("create: unknown type becomes coding and needs tests", "POST", "/questions", T.instA, { description: `${TAG} weird`, questionType: "POEM", ...cls() });
  const sOwn = await call("create: staff with access", "POST", "/questions", T.staffA, mcq(6, { topicId: topicA1.id }));
  await call("create: by the platform admin has no institute", "POST", "/questions", T.platform, mcq(7));
  const mB = await call("create: another institute", "POST", "/questions", T.instB, { description: `${TAG} mcq B`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], subjectId: subB.id, unitId: unitB1.id });
  await settle();
  note("create: stored", (await prisma.question.findMany({ where: { description: { startsWith: TAG } }, select: { description: true, questionType: true, questionStatus: true, difficulty: true, points: true, btlLevel: true, instituteId: true, folderId: true, subjectId: true, topicId: true, createdById: true, comparisonMode: true, timeLimitMs: true, evaluationType: true, aiGenerated: true, options: true, correctAnswer: true, numericAnswer: true, numericTolerance: true, tags: true, _count: { select: { testCases: true } } }, orderBy: { description: "asc" } }))
    .map((q) => ({ ...q, instituteId: q.instituteId === A.id ? "A" : q.instituteId === B.id ? "B" : null, folderId: q.folderId ? "set" : null, subjectId: q.subjectId === subA.id ? "A" : q.subjectId === subB.id ? "B" : null, topicId: q.topicId ? "set" : null, createdById: q.createdById ? "set" : null, tests: q._count.testCases, _count: undefined })));
  note("create: audit rows", await auditRows({ action: "QUESTION_CREATED", adminId: { in: [instA.id, staffA.id, platform.id, instB.id] } }));
  const m1Id = m1.json && m1.json.id;
  const c1Id = c1.json && c1.json.id;
  const sOwnId = sOwn.json && sOwn.json.id;
  const mBId = mB.json && mB.json.id;

  // ---------- list and filters ----------
  await call("list: anonymous", "GET", "/questions", null);
  await call("list: student refused", "GET", "/questions", T.student);
  await call("list: institute admin sees the own institute", "GET", "/questions?pageSize=100&q=ZZ%20QC", T.instA);
  await call("list: second page of five", "GET", "/questions?page=2&pageSize=5&q=ZZ%20QC", T.instA);
  await call("list: page size is floored", "GET", "/questions?pageSize=0&page=-3&q=ZZ%20QC", T.instA);
  await call("list: other institute", "GET", "/questions?pageSize=100&q=ZZ%20QC", T.instB);
  await call("list: staff sees own and shared content only", "GET", "/questions?pageSize=100&q=ZZ%20QC", T.staffA);
  await call("list: a staff member with only a shared folder", "GET", "/questions?pageSize=100&q=ZZ%20QC", T.staffA2);
  await call("list: by type", "GET", "/questions?questionType=CODING&q=ZZ%20QC", T.instA);
  await call("list: by difficulty", "GET", "/questions?difficulty=MEDIUM&q=ZZ%20QC", T.instA);
  await call("list: by an unknown difficulty (ignored)", "GET", "/questions?difficulty=NOPE&pageSize=2&q=ZZ%20QC", T.instA);
  await call("list: by BTL level", "GET", "/questions?btlLevel=2&q=ZZ%20QC", T.instA);
  await call("list: by status", "GET", "/questions?questionStatus=DRAFT&q=ZZ%20QC", T.instA);
  await call("list: AI generated only", "GET", "/questions?aiGenerated=true&q=ZZ%20QC", T.instA);
  await call("list: in a folder", "GET", `/questions?folderId=${folderA.id}&q=ZZ%20QC`, T.instA);
  await call("list: in no folder", "GET", "/questions?folderId=__none__&pageSize=3&q=ZZ%20QC", T.instA);
  await call("list: by subject and unit", "GET", `/questions?subjectId=${subA.id}&unitId=${unitA1.id}&pageSize=3&q=ZZ%20QC`, T.instA);
  await call("list: without a unit", "GET", "/questions?unitId=__none__&q=ZZ%20QC", T.instA);
  await call("list: text search", "GET", "/questions?q=ZZ%20QC%20coding%20title", T.instA);
  await call("list: platform admin (shape)", "GET", "/questions?pageSize=1", T.platform, undefined, { shape: true });
  await call("filters: anonymous", "GET", "/questions/meta/filters", null);
  await call("filters: student refused", "GET", "/questions/meta/filters", T.student);
  await call("filters: institute admin", "GET", "/questions/meta/filters", T.instA, undefined, { shape: true });
  await call("filters: staff does not see creators", "GET", "/questions/meta/filters", T.staffA, undefined, { shape: true });
  await call("filters: platform admin (shape)", "GET", "/questions/meta/filters", T.platform, undefined, { shape: true });

  // ---------- read one ----------
  await call("one: anonymous", "GET", `/questions/${m1Id}`, null);
  await call("one: student refused", "GET", `/questions/${m1Id}`, T.student);
  await call("one: owner institute", "GET", `/questions/${m1Id}`, T.instA);
  await call("one: another institute", "GET", `/questions/${m1Id}`, T.instB);
  await call("one: staff who did not create it", "GET", `/questions/${m1Id}`, T.staffA);
  await call("one: staff who created it", "GET", `/questions/${sOwnId}`, T.staffA);
  await call("one: platform admin", "GET", `/questions/${mBId}`, T.platform);
  await call("one: unknown id", "GET", `/questions/${bogus}`, T.instA);
  const inShared = await prisma.question.create({ data: { description: `${TAG} in shared`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, folderId: folderShared.id, createdById: instA.id } });
  await call("one: staff through a shared folder", "GET", `/questions/${inShared.id}`, T.staffA2);

  // ---------- edit ----------
  await call("edit: anonymous", "PATCH", `/questions/${m1Id}`, null, { title: "x" });
  await call("edit: student refused", "PATCH", `/questions/${m1Id}`, T.student, { title: "x" });
  await call("edit: unknown question", "PATCH", `/questions/${bogus}`, T.instA, { title: "x" });
  await call("edit: another institute", "PATCH", `/questions/${m1Id}`, T.instB, { title: "x" });
  await call("edit: staff who did not create it", "PATCH", `/questions/${m1Id}`, T.staffA, { title: "x" });
  await call("edit: title, difficulty and explanation", "PATCH", `/questions/${m1Id}`, T.instA, { title: "MCQ one edited", difficulty: "HARD", explanation: "new" });
  await call("edit: nothing sent", "PATCH", `/questions/${m1Id}`, T.instA, {});
  await call("edit: folder of another institute", "PATCH", `/questions/${m1Id}`, T.instA, { folderId: folderB.id });
  await call("edit: unit of another subject", "PATCH", `/questions/${m1Id}`, T.instA, { subjectId: subA.id, unitId: unitB1.id });
  await call("edit: move to another unit", "PATCH", `/questions/${m1Id}`, T.instA, { subjectId: subA.id, unitId: unitA2.id });
  await call("edit: clear the folder", "PATCH", `/questions/${m1Id}`, T.instA, { folderId: null });
  await call("edit: options replaced", "PATCH", `/questions/${m1Id}`, T.instA, { options: ["One", "Two"], correctAnswer: [1] });
  await call("edit: duplicate options", "PATCH", `/questions/${m1Id}`, T.instA, { options: ["One", "One"], correctAnswer: [0] });
  await call("edit: status published to archived", "PATCH", `/questions/${m1Id}`, T.instA, { questionStatus: "ARCHIVED" });
  await call("edit: unknown status keeps the old one", "PATCH", `/questions/${m1Id}`, T.instA, { questionStatus: "WHATEVER", btlLevel: 4 });
  await call("edit: verified, a multiple-choice question has no further gate", "PATCH", `/questions/${m1Id}`, T.instA, { questionStatus: "VERIFIED" });
  await call("edit: MCQ becomes true/false", "PATCH", `/questions/${m1Id}`, T.instA, { questionType: "TRUE_FALSE", correctAnswer: ["True"] });
  await call("edit: MCQ becomes numerical", "PATCH", `/questions/${m1Id}`, T.instA, { questionType: "NUMERICAL", numericAnswer: "42", numericTolerance: 0 });
  await call("edit: numerical with a bad tolerance", "PATCH", `/questions/${m1Id}`, T.instA, { numericTolerance: "abc" });
  await call("edit: coding, test cases replaced", "PATCH", `/questions/${c1Id}`, T.instA, { testCases: cases(3, 6), title: "coding edited" });
  await call("edit: coding, too few visible", "PATCH", `/questions/${c1Id}`, T.instA, { testCases: cases(1, 6) });
  await call("edit: coding, too few hidden", "PATCH", `/questions/${c1Id}`, T.instA, { testCases: cases(2, 2) });
  await call("edit: coding, unknown comparison mode", "PATCH", `/questions/${c1Id}`, T.instA, { comparisonMode: "FUZZY" });
  await call("edit: coding, a float tolerance and a time limit", "PATCH", `/questions/${c1Id}`, T.instA, { comparisonMode: "FLOAT_TOLERANCE", floatAbsoluteTolerance: 0.01, timeLimitMs: 2500, tags: [] });
  await call("edit: coding verified, structurally ready", "PATCH", `/questions/${c1Id}`, T.instA, { questionStatus: "VERIFIED" });
  await call("edit: coding verified again with other points", "PATCH", `/questions/${c1Id}`, T.instA, { questionStatus: "VERIFIED", points: 12 });
  await call("edit: coding becomes SQL without setup", "PATCH", `/questions/${c1Id}`, T.instA, { questionType: "SQL", testCases: cases(1, 5) });
  await call("edit: coding becomes SQL", "PATCH", `/questions/${c1Id}`, T.instA, { questionType: "SQL", sqlSchema: "create table t(a int);", testCases: cases(1, 5) });
  await call("edit: SQL with too few hidden cases", "PATCH", `/questions/${c1Id}`, T.instA, { testCases: cases(1, 3) });
  const blankQ = await prisma.question.create({ data: { description: `${TAG} blank target`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: instA.id } });
  await call("edit: a blank question text", "PATCH", `/questions/${blankQ.id}`, T.instA, { description: "" });
  await call("edit: staff edits their own question", "PATCH", `/questions/${sOwnId}`, T.staffA, { title: "staff edited", points: 7 });
  await settle();
  note("edit: stored", (await prisma.question.findMany({ where: { id: { in: [m1Id, c1Id, sOwnId] } }, select: { description: true, title: true, questionType: true, questionStatus: true, difficulty: true, points: true, btlLevel: true, folderId: true, unitId: true, updatedById: true, options: true, correctAnswer: true, numericAnswer: true, numericTolerance: true, sqlSchema: true, comparisonMode: true, timeLimitMs: true, evaluationType: true, tags: true, _count: { select: { testCases: true } } }, orderBy: { description: "asc" } }))
    .map((q) => ({ ...q, folderId: q.folderId ? "set" : null, unitId: q.unitId === unitA2.id ? "A2" : q.unitId === unitA1.id ? "A1" : null, updatedById: q.updatedById ? "set" : null, tests: q._count.testCases, _count: undefined })));
  note("edit: audit rows", await auditRows({ action: "QUESTION_UPDATED", adminId: { in: [instA.id, staffA.id] } }));

  // ---------- duplicate ----------
  await call("duplicate: anonymous", "POST", `/questions/${c1Id}/duplicate`, null);
  await call("duplicate: student refused", "POST", `/questions/${c1Id}/duplicate`, T.student);
  await call("duplicate: another institute", "POST", `/questions/${c1Id}/duplicate`, T.instB);
  await call("duplicate: unknown id", "POST", `/questions/${bogus}/duplicate`, T.instA);
  const dup = await call("duplicate: an institute admin copies a question", "POST", `/questions/${c1Id}/duplicate`, T.instA);
  await call("duplicate: staff copies their own", "POST", `/questions/${sOwnId}/duplicate`, T.staffA);
  note("duplicate: stored", await prisma.question.findUnique({ where: { id: dup.json.id }, select: { title: true, questionStatus: true, createdById: true, imageKey: true, _count: { select: { testCases: true } } } }).then((q) => ({ title: q.title, status: q.questionStatus, creator: q.createdById ? "set" : null, image: q.imageKey, tests: q._count.testCases })));

  // ---------- delete ----------
  const used = await prisma.question.create({ data: { description: `${TAG} used in a test`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: instA.id } });
  const test = await prisma.test.create({ data: { title: `${TAG} test ${ts}`, durationMin: 30, startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() + 86400000), isPublished: true, instituteId: A.id, createdById: instA.id } });
  await prisma.testQuestion.create({ data: { testId: test.id, questionId: used.id, order: 0 } });
  const graded = await prisma.question.create({ data: { description: `${TAG} graded`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: instA.id } });
  const attempt = await prisma.testAttempt.create({ data: { testId: test.id, studentId: student.id, status: "SUBMITTED" } });
  await prisma.submission.create({ data: { attemptId: attempt.id, questionId: graded.id, studentId: student.id, language: "text", code: "x" } });
  const plain = await prisma.question.create({ data: { description: `${TAG} plain`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: instA.id } });
  const staffOwn = await prisma.question.create({ data: { description: `${TAG} staff own`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: staffA.id } });
  await call("delete: anonymous", "DELETE", `/questions/${plain.id}`, null);
  await call("delete: student refused", "DELETE", `/questions/${plain.id}`, T.student);
  await call("delete: unknown id", "DELETE", `/questions/${bogus}`, T.instA);
  await call("delete: another institute", "DELETE", `/questions/${plain.id}`, T.instB);
  await call("delete: staff who did not create it", "DELETE", `/questions/${plain.id}`, T.staffA);
  await call("delete: used in a test", "DELETE", `/questions/${used.id}`, T.instA);
  await call("delete: already graded", "DELETE", `/questions/${graded.id}`, T.instA);
  await call("delete: an institute admin deletes one", "DELETE", `/questions/${plain.id}`, T.instA);
  await call("delete: the same one again", "DELETE", `/questions/${plain.id}`, T.instA);
  await call("delete: staff deletes their own", "DELETE", `/questions/${staffOwn.id}`, T.staffA);
  await settle();
  note("delete: stored", { plain: !(await prisma.question.findUnique({ where: { id: plain.id } })), staffOwn: !(await prisma.question.findUnique({ where: { id: staffOwn.id } })), used: !!(await prisma.question.findUnique({ where: { id: used.id } })), graded: !!(await prisma.question.findUnique({ where: { id: graded.id } })) });
  note("delete: audit rows", await auditRows({ action: "QUESTION_DELETED", adminId: { in: [instA.id, staffA.id] } }));

  // ---------- image, analytics, authoring helpers ----------
  await call("image: remove, anonymous", "DELETE", `/questions/${m1Id}/image`, null);
  await call("image: remove, student refused", "DELETE", `/questions/${m1Id}/image`, T.student);
  await call("image: remove, another institute", "DELETE", `/questions/${m1Id}/image`, T.instB);
  await call("image: remove from a question with none", "DELETE", `/questions/${m1Id}/image`, T.instA);
  await call("image: upload, anonymous", "POST", `/questions/${m1Id}/image`, null);
  await call("image: upload, student refused", "POST", `/questions/${m1Id}/image`, T.student);
  await call("analytics: anonymous", "GET", "/questions/analytics/summary", null);
  await call("analytics: student refused", "GET", "/questions/analytics/summary", T.student);
  await call("analytics: institute admin", "GET", "/questions/analytics/summary", T.instA, undefined, { shape: true });
  await call("analytics: staff", "GET", "/questions/analytics/summary", T.staffA, undefined, { shape: true });
  await call("analytics: platform admin (shape)", "GET", "/questions/analytics/summary", T.platform, undefined, { shape: true });
  const sig = { methodName: "twoSum", returnType: "int[]", params: [{ name: "nums", type: "int[]" }, { name: "target", type: "int" }] };
  await call("starter code: anonymous", "POST", "/questions/preview-starter-code", null, { functionSignature: sig });
  await call("starter code: student refused", "POST", "/questions/preview-starter-code", T.student, { functionSignature: sig });
  await call("starter code: staff", "POST", "/questions/preview-starter-code", T.staffA, { functionSignature: sig });
  await call("starter code: scalar signature", "POST", "/questions/preview-starter-code", T.instA, { functionSignature: { methodName: "add", returnType: "int", params: [{ name: "a", type: "int" }, { name: "b", type: "int" }] } });
  await call("starter code: no signature", "POST", "/questions/preview-starter-code", T.instA, {});
  await call("starter code: bad method name", "POST", "/questions/preview-starter-code", T.instA, { functionSignature: { methodName: "1x", returnType: "int", params: [] } });
  await call("validate: anonymous", "POST", "/questions/validate-test-cases", null, {});
  await call("validate: student refused", "POST", "/questions/validate-test-cases", T.student, {});
  await call("validate: no reference solution", "POST", "/questions/validate-test-cases", T.instA, { language: "python", code: "  ", testCases: cases(2, 1) });
  await call("validate: no test cases", "POST", "/questions/validate-test-cases", T.instA, { language: "python", code: "print(1)", testCases: [] });

  await cleanup();
  const out = JSON.stringify(log, null, 2) + "\n";
  if (record) { fs.mkdirSync(path.dirname(SNAP), { recursive: true }); fs.writeFileSync(SNAP, out); console.log(`Recorded ${log.length} entries to ${path.relative(process.cwd(), SNAP)}`); await prisma.$disconnect(); return; }
  const expected = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const diffs = [];
  const n = Math.max(expected.length, log.length);
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(expected[i]), b = JSON.stringify(log[i]);
    if (a !== b) {
      let k = 0;
      while (a && b && a[k] === b[k]) k++;
      const win = (s) => (s ? s.slice(Math.max(0, k - 120), k + 160) : "(none)");
      diffs.push(`#${i} ${log[i] ? log[i].name : expected[i].name}\n  expected ...${win(a)}\n  actual   ...${win(b)}`);
    }
  }
  await prisma.$disconnect();
  if (diffs.length) { console.log(`${diffs.length} of ${n} recorded responses differ from the contract:\n${diffs.join("\n")}`); process.exit(1); }
  console.log(`All ${n} recorded responses match the contract`);
})().catch(async (e) => { console.error(e); try { await cleanup(); } catch { /* ignore */ } await prisma.$disconnect(); process.exit(1); });
