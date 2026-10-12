// Characterization (contract) test for the question-bank import and export routes of /api/questions: the template downloads, the export, and the quiz, coding and
// combined bulk imports (direct, preview and confirm). It drives each route through success and failure paths with disposable data and compares a normalized record
// of every response, and of what the routes stored, with test/snapshots/question-import-export-contract.json. Used to prove a restructuring of routes/questions.js
// changes nothing except what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a database.
//   node scripts/verifyQuestionImportExportContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifyQuestionImportExportContract.js --record   (re)write the snapshot
// Deliberately NOT exercised, because they need object storage that differs between production and CI: storing an image from an images ZIP. A row that names an
// image without a ZIP IS exercised (it is refused before storage is touched).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ QX";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "question-import-export-contract.json");
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const MASKED = new Set(["ipAddress", "deviceInfo", "lastLoginAt", "questionNumber"]);
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>").replace(/\d{13}/g, "<ts>").replace(/Q\d+/g, "Q<n>").replace(/Subjects available to you: .*/s, "Subjects available to you: <list>");
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = MASKED.has(k) ? "<masked>" : norm(v[k]); return o; }
  return v;
}
let ipSeq = 0;
const nextIp = () => `203.0.113.${ 60 + ++ipSeq}`;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// opts.headers = response headers to keep; downloads are read back: a workbook as its sheets (name, header row, number of rows, first rows), a text file as its hash.
async function call(name, method, p, token, body, opts = {}) {
  const headers = { "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body instanceof FormData) payload = body; else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${p}`, { method, headers, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  const entry = { name, status: res.status };
  if (opts.headers) entry.headers = Object.fromEntries(opts.headers.map((h) => [h, res.headers.get(h)]));
  const type = res.headers.get("content-type") || "";
  if (json !== null) entry.body = norm(json);
  else if (type.includes("spreadsheetml")) {
    const wb = XLSX.read(buf, { type: "buffer" });
    entry.workbook = wb.SheetNames.map((n) => { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }); return { sheet: n, header: norm(rows[0] || []), rowCount: rows.length - 1, rows: norm(rows.slice(1, opts.sampleRows ?? 4)) }; });
  } else if (type.includes("text/plain")) entry.text = { sha1: crypto.createHash("sha1").update(text).digest("hex"), bytes: buf.length, firstLine: text.split("\n")[0] };
  else entry.body = `<non-json ${text.slice(0, 40)}>`;
  log.push(entry);
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(900);

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-qx-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-qx-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-qx-" } }] } });
  await prisma.question.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }, { description: { startsWith: TAG } }] } });
  await prisma.questionFolder.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }, { name: { startsWith: TAG } }] } });
  await prisma.staffSubjectAssignment.deleteMany({ where: { staffId: { in: uids } } });
  await prisma.subject.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { name: { startsWith: TAG } }] } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}
const auditRows = async (where) => (await prisma.auditLog.findMany({ where, select: { action: true, adminRole: true, studentId: true, instituteId: true, details: true }, orderBy: { createdAt: "asc" } }))
  .map((a) => `${a.action}|role:${a.adminRole || "-"}|inst:${a.instituteId ? "set" : "-"}|keys:${Object.keys(a.details || {}).sort().join(",")}`);

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZXA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZXB" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
    return prisma.user.create({ data: { name: `ZZ QX ${key}`, email: `zz-qx-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const platform = await mk("platform", "ADMIN", null);
  const instA = await mk("instA", "INSTITUTE_ADMIN", A.id);
  const instB = await mk("instB", "INSTITUTE_ADMIN", B.id);
  const staffA = await mk("staffA", "STAFF", A.id);
  const staffA2 = await mk("staffA2", "STAFF", A.id);
  const student = await mk("student", "STUDENT", A.id);
  const login = async (u, k) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": nextIp() }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
  const T = {};
  for (const [k, u] of Object.entries({ platform, instA, instB, staffA, staffA2, student })) T[k] = await login(u, k);
  const bogus = crypto.randomUUID();

  const subA = await prisma.subject.create({ data: { name: `${TAG} Subject A ${ts}`, instituteId: A.id, createdById: instA.id } });
  const unitA1 = await prisma.unit.create({ data: { subjectId: subA.id, name: "Unit 1" } });
  await prisma.unit.create({ data: { subjectId: subA.id, name: "Unit IV" } }); // a Roman-numeral unit, matched by "Unit 4"
  await prisma.staffSubjectAssignment.create({ data: { staffId: staffA.id, subjectId: subA.id, assignedById: instA.id } });
  const subB = await prisma.subject.create({ data: { name: `${TAG} Subject B ${ts}`, instituteId: B.id, createdById: instB.id } });
  const folderA = await prisma.questionFolder.create({ data: { name: `${TAG} folder A`, instituteId: A.id, createdById: instA.id } });
  const folderB = await prisma.questionFolder.create({ data: { name: `${TAG} folder B`, instituteId: B.id, createdById: instB.id } });
  const sA = subA.name;

  const wbBuffer = (sheets) => { const wb = XLSX.utils.book_new(); for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); };
  const form = (buffer, filename, fields = {}) => { const f = new FormData(); if (buffer) f.append("file", new Blob([buffer]), filename); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f; };
  const mcq = (n, extra = {}) => ({ "Question Text": `${TAG} quiz ${n}`, "Option A": "Red", "Option B": "Green", "Option C": "Blue", "Option D": "Pink", "Correct Option": "B", Explanation: "because", "Difficulty Level": "Medium", Subject: sA, Unit: "Unit 1", Topic: "Colours", ...extra });
  const hidden = (k) => Array.from({ length: k }, (_, i) => `${i + 10}->${(i + 10) * 2}`).join("||");
  const cod = (n, extra = {}) => ({ "Question Title": `${TAG} code ${n}`, Subject: sA, Unit: "Unit 1", Topic: "Loops", "Problem Statement": `${TAG} Print double of the input ${n}`, Difficulty: "Easy", BTL: "BTL-2", "Programming Languages": "Java, Python", "Time Limit (seconds)": 2, "Memory Limit (MB)": 256, Marks: 10, Constraints: "1 <= n", "Input Format": "n", "Output Format": "2n", "Sample Input 1": "1", "Sample Output 1": "2", "Sample Input 2": "2", "Sample Output 2": "4", "Hidden Test Cases (input->output pairs, separated by ||)": hidden(5), "Evaluation Mode (STDIO or Function)": "STDIO", "Starter Code (Java)": "class Main {}", "Starter Code (Python)": "pass", "Starter Code (Cpp)": "int main(){}", Tags: "a, b", ...extra });

  // ---------- template downloads ----------
  const dl = ["content-type", "content-disposition"];
  await call("template: anonymous", "GET", "/questions/bulk-template", null);
  await call("template: student refused", "GET", "/questions/bulk-template", T.student);
  await call("template: quiz", "GET", "/questions/bulk-template", T.staffA, undefined, { headers: dl });
  await call("template: coding", "GET", "/questions/bulk-template?type=coding", T.staffA, undefined, { headers: dl });
  await call("template: combined", "GET", "/questions/bulk-template?type=combined", T.instA, undefined, { headers: dl });
  await call("template: quiz as text", "GET", "/questions/bulk-template?format=txt", T.instA, undefined, { headers: dl });
  await call("template: coding as text", "GET", "/questions/bulk-template?type=coding&format=txt", T.instA, undefined, { headers: dl });

  // ---------- quiz import: preview ----------
  const quizFile = wbBuffer({ MCQ: [
    mcq(1), mcq(2, { "Question Text": `${TAG} quiz 2 multi`, "Correct Option": "A, C", Unit: "Unit 4", Topic: "New topic" }), mcq(3, { "Option C": "", "Option D": "", "Option A": "True", "Option B": "False", "Correct Option": "(a)" }),
    mcq(1), // the same text twice in the file
    mcq(4, { "Question Text": "" }), mcq(5, { "Question Type": "Poem" }), mcq(6, { Subject: "No Such Subject" }), mcq(7, { "Difficulty Level": "Confusing", "Correct Option": " b ." }),
    mcq(8, { "Correct Option": "A,B" }), mcq(9, { "Option B": "Red" }), mcq(10, { Unit: "Brand New Unit", Topic: "" }), mcq(11, { "Image File Name": "figure.png" }), mcq(12, { Marks: 5, BTL: "BTL-3", "Question Name": "named" }),
    mcq(13, { BTL: "high" }), { "Question Text": "", Subject: "", "Option A": "" },
    { ...mcq(14), "Teacher Notes": "ignored column" },
  ] });
  await call("quiz preview: anonymous", "POST", "/questions/bulk-import/preview", null, form(quizFile, "q.xlsx"));
  await call("quiz preview: student refused", "POST", "/questions/bulk-import/preview", T.student, form(quizFile, "q.xlsx"));
  await call("quiz preview: no file", "POST", "/questions/bulk-import/preview", T.instA, form(null, ""));
  await call("quiz preview: file that is not a spreadsheet", "POST", "/questions/bulk-import/preview", T.instA, form(Buffer.from("hello"), "q.bin"));
  await call("quiz preview: no data rows", "POST", "/questions/bulk-import/preview", T.instA, form(wbBuffer({ MCQ: [{ "Question Text": "" }].slice(1) }), "q.xlsx"));
  await call("quiz preview: the question text column is missing", "POST", "/questions/bulk-import/preview", T.instA, form(wbBuffer({ MCQ: [{ Option: "x" }] }), "q.xlsx"));
  await call("quiz preview: folder of another institute", "POST", "/questions/bulk-import/preview", T.instA, form(quizFile, "q.xlsx", { folderId: folderB.id }));
  const quizPrev = await call("quiz preview: a mixed file", "POST", "/questions/bulk-import/preview", T.instA, form(quizFile, "q.xlsx", { folderId: folderA.id }));
  note("quiz preview: nothing was stored, not even the units and topics it resolved", {
    questions: await prisma.question.count({ where: { description: { startsWith: `${TAG} quiz` } } }),
    units: (await prisma.unit.findMany({ where: { subjectId: subA.id }, select: { name: true }, orderBy: { name: "asc" } })).map((u) => u.name),
    topics: (await prisma.topic.findMany({ where: { unit: { subjectId: subA.id } }, select: { name: true }, orderBy: { name: "asc" } })).map((t) => t.name),
  });
  await call("quiz preview: staff without access to the subject", "POST", "/questions/bulk-import/preview", T.staffA2, form(wbBuffer({ MCQ: [mcq(20)] }), "q.xlsx"));
  await call("quiz preview: a notepad text file", "POST", "/questions/bulk-import/preview", T.instA, form(Buffer.from(`Subject:\n${sA}\n\nUnit:\nUnit 1\n\nTopic:\nText\n\nQuestion:\n${TAG} quiz text 1\n\nOption A:\nOne\n\nOption B:\nTwo\n\nCorrect Answer:\nB\n\nDifficulty:\nEasy\n`), "q.txt"));
  await call("quiz preview: every row has an unrecognized type", "POST", "/questions/bulk-import/preview", T.instA, form(wbBuffer({ MCQ: [mcq(30, { "Question Type": "x" }), mcq(31, { "Question Type": "y" }), mcq(32, { "Question Type": "z" })] }), "q.xlsx"));
  await call("quiz preview: a coding row in the quiz file", "POST", "/questions/bulk-import/preview", T.instA, form(wbBuffer({ MCQ: [mcq(33, { "Question Type": "Coding" })] }), "q.xlsx"));

  // ---------- quiz import: confirm and direct ----------
  const validRows = (quizPrev.json && quizPrev.json.validRows) || [];
  await call("quiz confirm: anonymous", "POST", "/questions/bulk-import/confirm", null, { rows: validRows });
  await call("quiz confirm: no rows", "POST", "/questions/bulk-import/confirm", T.instA, { rows: [] });
  await call("quiz confirm: invalid rows payload", "POST", "/questions/bulk-import/confirm", T.instA, { rows: "{not json" });
  await call("quiz confirm: folder of another institute", "POST", "/questions/bulk-import/confirm", T.instA, { rows: validRows, folderId: folderB.id });
  await call("quiz confirm: the previewed rows", "POST", "/questions/bulk-import/confirm", T.instA, { rows: validRows, folderId: folderA.id });
  await call("quiz confirm: the same rows again are skipped as duplicates", "POST", "/questions/bulk-import/confirm", T.instA, { rows: validRows, folderId: folderA.id });
  await call("quiz confirm: duplicates imported on request", "POST", "/questions/bulk-import/confirm", T.instA, { rows: validRows.slice(0, 1), folderId: folderA.id, duplicateAction: "import" });
  await call("quiz direct: anonymous", "POST", "/questions/bulk-import", null, form(wbBuffer({ MCQ: [mcq(40)] }), "q.xlsx"));
  await call("quiz direct: a file", "POST", "/questions/bulk-import", T.instA, form(wbBuffer({ MCQ: [mcq(40), mcq(41, { "Correct Option": "D" })] }), "q.xlsx"));
  await call("quiz direct: a notepad file", "POST", "/questions/bulk-import", T.instA, form(Buffer.from(`Subject:\n${sA}\n\nUnit:\nUnit 1\n\nQuestion:\n${TAG} quiz text 2\n\nOption A:\nOne\n\nOption B:\nTwo\n\nCorrect Answer:\nA\n`), "q.txt"));
  await call("quiz direct: staff with access", "POST", "/questions/bulk-import", T.staffA, form(wbBuffer({ MCQ: [mcq(42)] }), "q.xlsx"));
  await settle();
  note("quiz import: stored", (await prisma.question.findMany({ where: { description: { startsWith: `${TAG} quiz` } }, select: { description: true, questionType: true, difficulty: true, points: true, btlLevel: true, title: true, options: true, correctAnswer: true, folderId: true, unitId: true, topicId: true, instituteId: true, createdById: true, questionStatus: true }, orderBy: [{ description: "asc" }, { createdAt: "asc" }] }))
    .map((q) => ({ ...q, folderId: q.folderId ? "set" : null, unitId: q.unitId ? "set" : null, topicId: q.topicId ? "set" : null, instituteId: q.instituteId === A.id ? "A" : null, createdById: q.createdById === staffA.id ? "staffA" : "instA" })));
  note("quiz import: units and topics after the imports", { units: (await prisma.unit.findMany({ where: { subjectId: subA.id }, select: { name: true }, orderBy: { name: "asc" } })).map((u) => u.name), topics: (await prisma.topic.findMany({ where: { unit: { subjectId: subA.id } }, select: { name: true }, orderBy: { name: "asc" } })).map((t) => t.name) });
  note("quiz import: audit rows", await auditRows({ action: "QUESTION_IMPORTED", adminId: { in: [instA.id, staffA.id] } }));

  // ---------- coding import ----------
  const codingFile = wbBuffer({ CODING: [
    cod(1), cod(2, { "Evaluation Mode (STDIO or Function)": "Function", "Function Name": "twice", "Return Type": "int", "Parameters (name:type, comma separated)": "n:int", "Question Bank": `${TAG} new bank` }),
    cod(1), cod(3, { "Question Title": "" }), cod(4, { "Problem Statement": "" }), cod(5, { "Time Limit (seconds)": "abc" }), cod(6, { "Memory Limit (MB)": "-3" }), cod(7, { "Programming Languages": "Brainfuck" }),
    cod(8, { "Sample Output 2": "" }), cod(9, { "Hidden Test Cases (input->output pairs, separated by ||)": hidden(4) }), cod(10, { Subject: "No Such Subject" }), cod(11, { Difficulty: "Confusing", BTL: "9" }),
    cod(12, { "Evaluation Mode (STDIO or Function)": "Function", "Function Name": "1bad", "Return Type": "int" }), cod(13, { "Image File Name": "figure.png" }), cod(14, { "Programming Languages": "Python", Tags: "" }), cod(15, { Marks: 7, Subtopic: "Doubling" }),
  ] });
  await call("coding preview: anonymous", "POST", "/questions/bulk-import-coding/preview", null, form(codingFile, "c.xlsx"));
  await call("coding preview: student refused", "POST", "/questions/bulk-import-coding/preview", T.student, form(codingFile, "c.xlsx"));
  await call("coding preview: no file", "POST", "/questions/bulk-import-coding/preview", T.instA, form(null, ""));
  await call("coding preview: required columns missing", "POST", "/questions/bulk-import-coding/preview", T.instA, form(wbBuffer({ CODING: [{ Subject: "x" }] }), "c.xlsx"));
  await call("coding preview: folder of another institute", "POST", "/questions/bulk-import-coding/preview", T.instA, form(codingFile, "c.xlsx", { folderId: folderB.id }));
  const codPrev = await call("coding preview: a mixed file", "POST", "/questions/bulk-import-coding/preview", T.instA, form(codingFile, "c.xlsx", { folderId: folderA.id }));
  note("coding preview: nothing was stored, and no bank was created", { questions: await prisma.question.count({ where: { description: { startsWith: `${TAG} Print` } } }), newBank: await prisma.questionFolder.count({ where: { name: `${TAG} new bank` } }) });
  const codRows = (codPrev.json && codPrev.json.validRows) || [];
  await call("coding confirm: anonymous", "POST", "/questions/bulk-import-coding/confirm", null, { rows: codRows });
  await call("coding confirm: no rows", "POST", "/questions/bulk-import-coding/confirm", T.instA, { rows: [] });
  await call("coding confirm: invalid rows payload", "POST", "/questions/bulk-import-coding/confirm", T.instA, { rows: "{nope" });
  await call("coding confirm: the previewed rows", "POST", "/questions/bulk-import-coding/confirm", T.instA, { rows: codRows, folderId: folderA.id });
  await call("coding confirm: the same rows again are skipped", "POST", "/questions/bulk-import-coding/confirm", T.instA, { rows: codRows, folderId: folderA.id });
  await call("coding direct: a file", "POST", "/questions/bulk-import-coding", T.instA, form(wbBuffer({ CODING: [cod(20), cod(21, { Difficulty: "Hard" })] }), "c.xlsx"));
  await call("coding direct: a notepad file", "POST", "/questions/bulk-import-coding", T.instA, form(Buffer.from(`QUESTION: ${TAG} Notepad coding one\nLANGUAGE: Java, Python\nSAMPLE_INPUT: 1\nSAMPLE_OUTPUT: 2\nSAMPLE_INPUT_2: 2\nSAMPLE_OUTPUT_2: 4\nSUBJECT: ${sA}\nUNIT: Unit 1\nTEST_CASES:\nINPUT: 3\nOUTPUT: 6\nINPUT: 4\nOUTPUT: 8\nINPUT: 5\nOUTPUT: 10\nINPUT: 6\nOUTPUT: 12\nINPUT: 7\nOUTPUT: 14\n`), "c.txt"));
  await settle();
  note("coding import: stored", (await prisma.question.findMany({ where: { questionType: "CODING", OR: [{ title: { startsWith: `${TAG} code` } }, { description: { startsWith: `${TAG} Print` } }, { description: { startsWith: `${TAG} Notepad` } }] }, select: { title: true, difficulty: true, points: true, btlLevel: true, timeLimitMs: true, memoryLimitKb: true, evaluationType: true, functionSignature: true, starterCodeByLanguage: true, tags: true, subtopic: true, folderId: true, instituteId: true, _count: { select: { testCases: true } } }, orderBy: [{ title: "asc" }, { createdAt: "asc" }] }))
    .map((q) => ({ ...q, folderId: q.folderId ? "set" : null, instituteId: q.instituteId === A.id ? "A" : null, tests: q._count.testCases, _count: undefined })));
  note("coding import: the bank created by name", await prisma.questionFolder.count({ where: { name: `${TAG} new bank` } }));
  note("coding import: audit rows", await auditRows({ action: "QUESTION_IMPORTED", adminId: instA.id, details: { path: ["coding"], equals: true } }));

  // ---------- combined import ----------
  const combined = wbBuffer({ MCQ: [mcq(50), mcq(51, { "Question Text": "" })], CODING: [cod(50), cod(51, { "Hidden Test Cases (input->output pairs, separated by ||)": hidden(1) })] });
  await call("combined preview: anonymous", "POST", "/questions/bulk-import-combined/preview", null, form(combined, "x.xlsx"));
  await call("combined preview: no file", "POST", "/questions/bulk-import-combined/preview", T.instA, form(null, ""));
  await call("combined preview: a text file", "POST", "/questions/bulk-import-combined/preview", T.instA, form(Buffer.from("x"), "x.txt"));
  await call("combined preview: no recognised sheet", "POST", "/questions/bulk-import-combined/preview", T.instA, form(wbBuffer({ Other: [{ a: 1 }] }), "x.xlsx"));
  await call("combined preview: both sheets empty", "POST", "/questions/bulk-import-combined/preview", T.instA, form(wbBuffer({ MCQ: [], CODING: [] }), "x.xlsx"));
  await call("combined preview: a column missing on the MCQ sheet", "POST", "/questions/bulk-import-combined/preview", T.instA, form(wbBuffer({ MCQ: [{ Option: "x" }], CODING: [cod(52)] }), "x.xlsx"));
  const combPrev = await call("combined preview: both sheets", "POST", "/questions/bulk-import-combined/preview", T.instA, form(combined, "x.xlsx", { folderId: folderA.id }));
  await call("combined confirm: anonymous", "POST", "/questions/bulk-import-combined/confirm", null, { mcqRows: [], codingRows: [] });
  await call("combined confirm: no rows", "POST", "/questions/bulk-import-combined/confirm", T.instA, { mcqRows: [], codingRows: [] });
  await call("combined confirm: invalid rows payload", "POST", "/questions/bulk-import-combined/confirm", T.instA, { mcqRows: "{nope" });
  await call("combined confirm: both halves", "POST", "/questions/bulk-import-combined/confirm", T.instA, { mcqRows: (combPrev.json && combPrev.json.mcqValidRows) || [], codingRows: (combPrev.json && combPrev.json.codingValidRows) || [], folderId: folderA.id });
  await call("combined confirm: the same rows again", "POST", "/questions/bulk-import-combined/confirm", T.instA, { mcqRows: (combPrev.json && combPrev.json.mcqValidRows) || [], codingRows: (combPrev.json && combPrev.json.codingValidRows) || [], folderId: folderA.id });

  // ---------- export ----------
  const ex = await prisma.question.findMany({ where: { description: { startsWith: TAG } }, select: { id: true, description: true }, orderBy: { description: "asc" } });
  await call("export: anonymous", "GET", "/questions/export", null);
  await call("export: student refused", "GET", "/questions/export", T.student);
  await call("export: the institute's questions by text", "GET", `/questions/export?q=${encodeURIComponent(`${TAG} quiz 4`)}`, T.instA, undefined, { headers: dl, sampleRows: 30 });
  await call("export: by type", "GET", `/questions/export?questionType=MCQ&q=${encodeURIComponent(`${TAG} quiz 1`)}`, T.instA, undefined, { headers: dl, sampleRows: 30 });
  await call("export: selected ids", "GET", `/questions/export?questionIds=${ex.slice(0, 3).map((q) => q.id).join(",")}`, T.instA, undefined, { sampleRows: 30 });
  await call("export: selected ids of another institute are left out", "GET", `/questions/export?questionIds=${ex.slice(0, 3).map((q) => q.id).join(",")}`, T.instB, undefined, { sampleRows: 30 });
  await call("export: unknown ids", "GET", `/questions/export?questionIds=${bogus}`, T.instA, undefined, { sampleRows: 30 });
  await call("export: staff exports only their own", "GET", `/questions/export?q=${encodeURIComponent(TAG)}&questionType=MCQ`, T.staffA, undefined, { sampleRows: 3 });
  await settle();
  note("export: audit rows", await auditRows({ action: "QUESTION_EXPORTED", adminId: { in: [instA.id, instB.id, staffA.id] } }));

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
