// Characterization (contract) test for the question-bank folders and bulk operations of /api/questions: folder list, create, rename and move, delete preview,
// recursive delete, sharing, merge, clear, and bulk move / assign subject / review status / delete / copy. It drives each route through success and failure
// paths with disposable data and compares a normalized record of every response, and of what the routes stored, with test/snapshots/question-folders-contract.json.
// Used to prove a restructuring of routes/questions.js changes nothing except what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a
// database.
//   node scripts/verifyQuestionFoldersContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifyQuestionFoldersContract.js --record   (re)write the snapshot
// Deliberately NOT exercised: a folder move that would create a loop (the recursive routes walk a loop forever, so it must never be created against a live
// database; it is covered by a unit test of the pure check), and VERIFIED on a question with a stored reference solution (runs code through the judge).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ QF";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "question-folders-contract.json");
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const MASKED = new Set(["ipAddress", "deviceInfo", "lastLoginAt", "questionNumber"]);
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>").replace(/\d{13}/g, "<ts>");
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = MASKED.has(k) ? "<masked>" : norm(v[k]); return o; }
  return v;
}
let ipSeq = 0;
const nextIp = () => `203.0.113.${230 + ++ipSeq}`;
// opts.onlyTagged: keep only folders created by this script (production has real platform-wide folders a bound requester can also see).
async function call(name, method, p, token, body, opts = {}) {
  const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (opts.onlyTagged && Array.isArray(json)) json = json.filter((f) => String(f.name || "").startsWith(TAG));
  log.push({ name, status: res.status, body: json !== null ? norm(json) : `<non-json ${text.slice(0, 40)}>` });
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(900);

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { OR: [{ email: { startsWith: "zz-qf-" } }, { instituteId: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { studentId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { contains: "zz-qf-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-qf-" } }] } });
  await prisma.submission.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.testAttempt.deleteMany({ where: { studentId: { in: uids } } });
  await prisma.test.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }] } });
  await prisma.question.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }, { description: { startsWith: TAG } }] } });
  await prisma.questionFolder.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }, { name: { startsWith: TAG } }] } });
  await prisma.staffSubjectAssignment.deleteMany({ where: { staffId: { in: uids } } });
  await prisma.subject.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { name: { startsWith: TAG } }] } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}
const auditRows = async (where) => (await prisma.auditLog.findMany({ where, select: { action: true, adminRole: true, studentId: true, instituteId: true, details: true }, orderBy: { createdAt: "asc" } }))
  .map((a) => `${a.action}|role:${a.adminRole || "-"}|student:${a.studentId ? "set" : "-"}|inst:${a.instituteId ? "set" : "-"}|keys:${Object.keys(a.details || {}).sort().join(",")}`);

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZFA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZFB" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
    return prisma.user.create({ data: { name: `ZZ QF ${key}`, email: `zz-qf-${key.toLowerCase()}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
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

  const subA = await prisma.subject.create({ data: { name: `${TAG} Subject A ${ts}`, instituteId: A.id, createdById: instA.id } });
  const unitA = await prisma.unit.create({ data: { subjectId: subA.id, name: "Unit 1" } });
  const subB = await prisma.subject.create({ data: { name: `${TAG} Subject B ${ts}`, instituteId: B.id, createdById: instB.id } });
  const unitB = await prisma.unit.create({ data: { subjectId: subB.id, name: "Unit 1" } });
  const folder = (name, instituteId, createdById, parentId = null) => prisma.questionFolder.create({ data: { name: `${TAG} ${name}`, instituteId, createdById, parentId } });
  const question = (n, extra = {}) => prisma.question.create({ data: { description: `${TAG} q ${n}`, questionType: "MCQ", options: ["a", "b"], correctAnswer: [0], instituteId: A.id, createdById: instA.id, ...extra } });

  // ---------- folders: list, create ----------
  await call("folders list: anonymous", "GET", "/questions/folders", null);
  await call("folders list: student refused", "GET", "/questions/folders", T.student);
  const fRoot = await folder("root", A.id, instA.id);
  const fChild = await folder("child", A.id, instA.id, fRoot.id);
  const fB = await folder("foreign", B.id, instB.id);
  await call("folders list: institute admin", "GET", "/questions/folders", T.instA, undefined, { onlyTagged: true });
  await call("folders list: other institute", "GET", "/questions/folders", T.instB, undefined, { onlyTagged: true });
  await call("folders list: staff without access sees none of the institute's", "GET", "/questions/folders", T.staffA, undefined, { onlyTagged: true });
  await call("folders create: anonymous", "POST", "/questions/folders", null, { name: `${TAG} x` });
  await call("folders create: student refused", "POST", "/questions/folders", T.student, { name: `${TAG} x` });
  await call("folders create: no name", "POST", "/questions/folders", T.instA, { name: "  " });
  await call("folders create: parent of another institute", "POST", "/questions/folders", T.instA, { name: `${TAG} x`, parentId: fB.id });
  await call("folders create: parent that does not exist", "POST", "/questions/folders", T.instA, { name: `${TAG} x`, parentId: bogus });
  const made = await call("folders create: top level", "POST", "/questions/folders", T.instA, { name: ` ${TAG} made `, category: "Technical", description: "d" });
  const madeChild = await call("folders create: nested", "POST", "/questions/folders", T.instA, { name: `${TAG} made child`, parentId: made.json && made.json.id });
  await call("folders create: same name again", "POST", "/questions/folders", T.instA, { name: `${TAG} made` });
  await call("folders create: by a staff member", "POST", "/questions/folders", T.staffA, { name: `${TAG} staff folder` });
  await call("folders create: by the platform admin", "POST", "/questions/folders", T.platform, { name: `${TAG} platform folder` });
  const staffFolder = await prisma.questionFolder.findFirst({ where: { name: `${TAG} staff folder` } });
  note("folders create: stored", (await prisma.questionFolder.findMany({ where: { name: { startsWith: `${TAG} ` }, createdById: { in: [instA.id, staffA.id, platform.id] } }, select: { name: true, category: true, description: true, instituteId: true, parentId: true, createdById: true }, orderBy: [{ name: "asc" }, { createdAt: "asc" }] }))
    .map((f) => ({ ...f, instituteId: f.instituteId === A.id ? "A" : f.instituteId === B.id ? "B" : null, parentId: f.parentId ? "set" : null, createdById: f.createdById === instA.id ? "instA" : f.createdById === staffA.id ? "staffA" : "platform" })));

  // ---------- folders: rename and move ----------
  await call("folders edit: anonymous", "PATCH", `/questions/folders/${fRoot.id}`, null, { name: "x" });
  await call("folders edit: student refused", "PATCH", `/questions/folders/${fRoot.id}`, T.student, { name: "x" });
  await call("folders edit: unknown folder", "PATCH", `/questions/folders/${bogus}`, T.instA, { name: "x" });
  await call("folders edit: folder of another institute", "PATCH", `/questions/folders/${fRoot.id}`, T.instB, { name: "x" });
  await call("folders edit: blank name", "PATCH", `/questions/folders/${fRoot.id}`, T.instA, { name: " " });
  await call("folders edit: rename and describe", "PATCH", `/questions/folders/${fRoot.id}`, T.instA, { name: `${TAG} root renamed`, category: "Aptitude", description: "" });
  await call("folders edit: its own parent", "PATCH", `/questions/folders/${fRoot.id}`, T.instA, { parentId: fRoot.id });
  await call("folders edit: move under a folder of this institute", "PATCH", `/questions/folders/${fChild.id}`, T.instA, { parentId: made.json.id });
  await call("folders edit: move under a folder of another institute", "PATCH", `/questions/folders/${fChild.id}`, T.instA, { parentId: fB.id });
  await call("folders edit: move to the top level", "PATCH", `/questions/folders/${fChild.id}`, T.instA, { parentId: null });
  await call("folders edit: staff edits an institute folder they can see", "PATCH", `/questions/folders/${staffFolder.id}`, T.staffA, { description: "by staff" });

  // ---------- folders: delete preview and recursive delete ----------
  const dRoot = await folder("del root", A.id, instA.id);
  const dKid = await folder("del kid", A.id, instA.id, dRoot.id);
  const dKid2 = await folder("del kid two", A.id, instA.id, dKid.id);
  const qFree = await question("free", { folderId: dRoot.id });
  const qKidFree = await question("kid free", { folderId: dKid.id });
  const qInTest = await question("in a test", { folderId: dKid2.id });
  const qStaffOwn = await question("staff own", { folderId: dKid.id, createdById: staffA.id });
  const test = await prisma.test.create({ data: { title: `${TAG} test ${ts}`, durationMin: 30, startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() + 86400000), isPublished: true, instituteId: A.id, createdById: instA.id } });
  await prisma.testQuestion.create({ data: { testId: test.id, questionId: qInTest.id, order: 0 } });
  const qGraded = await question("graded", { folderId: dKid2.id });
  const attempt = await prisma.testAttempt.create({ data: { testId: test.id, studentId: student.id, status: "SUBMITTED" } });
  await prisma.submission.create({ data: { attemptId: attempt.id, questionId: qGraded.id, studentId: student.id, language: "text", code: "x" } });
  await call("folders preview: anonymous", "GET", `/questions/folders/${dRoot.id}/delete-preview`, null);
  await call("folders preview: unknown folder", "GET", `/questions/folders/${bogus}/delete-preview`, T.instA);
  await call("folders preview: folder of another institute", "GET", `/questions/folders/${dRoot.id}/delete-preview`, T.instB);
  await call("folders preview: counts questions, sub-banks and blocked ones", "GET", `/questions/folders/${dRoot.id}/delete-preview`, T.instA);
  await call("folders delete: anonymous", "DELETE", `/questions/folders/${dRoot.id}`, null);
  await call("folders delete: unknown folder", "DELETE", `/questions/folders/${bogus}`, T.instA);
  await call("folders delete: folder of another institute", "DELETE", `/questions/folders/${dRoot.id}`, T.instB);
  await call("folders delete: a tree with a question used in a test", "DELETE", `/questions/folders/${dRoot.id}`, T.instA);
  await settle();
  note("folders delete: what is left", {
    folders: (await prisma.questionFolder.findMany({ where: { id: { in: [dRoot.id, dKid.id, dKid2.id] } }, select: { name: true }, orderBy: { name: "asc" } })).map((f) => f.name),
    questions: (await prisma.question.findMany({ where: { id: { in: [qFree.id, qKidFree.id, qInTest.id, qStaffOwn.id, qGraded.id] } }, select: { description: true }, orderBy: { description: "asc" } })).map((q) => q.description),
  });
  note("folders delete: audit rows", await auditRows({ action: "QUESTION_DELETED", adminId: instA.id }));
  const eRoot = await folder("empty root", A.id, instA.id);
  const eKid = await folder("empty kid", A.id, instA.id, eRoot.id);
  await question("empty tree q", { folderId: eKid.id });
  await call("folders delete: a tree with nothing blocking it", "DELETE", `/questions/folders/${eRoot.id}`, T.instA);
  note("folders delete: the clean tree is gone", { folders: await prisma.questionFolder.count({ where: { id: { in: [eRoot.id, eKid.id] } } }) });

  // ---------- folders: sharing ----------
  const sh = await folder("shared", A.id, staffA.id);
  await call("shares list: anonymous", "GET", `/questions/folders/${sh.id}/shares`, null);
  await call("shares list: unknown folder", "GET", `/questions/folders/${bogus}/shares`, T.instA);
  await call("shares list: other institute", "GET", `/questions/folders/${sh.id}/shares`, T.instB);
  await call("shares list: staff who is not the creator", "GET", `/questions/folders/${sh.id}/shares`, T.staffA2);
  await call("shares add: staff who is not the creator", "POST", `/questions/folders/${sh.id}/shares`, T.staffA2, { staffIds: [staffA2.id] });
  await call("shares add: unknown folder", "POST", `/questions/folders/${bogus}/shares`, T.instA, { staffIds: [] });
  await call("shares add: other institute", "POST", `/questions/folders/${sh.id}/shares`, T.instB, { staffIds: [] });
  await call("shares add: a staff member of another institute", "POST", `/questions/folders/${sh.id}/shares`, T.instA, { staffIds: [staffB.id] });
  await call("shares add: a student", "POST", `/questions/folders/${sh.id}/shares`, T.instA, { staffIds: [student.id] });
  await call("shares add: nobody", "POST", `/questions/folders/${sh.id}/shares`, T.instA, { staffIds: [] });
  await call("shares add: the creator shares with a colleague", "POST", `/questions/folders/${sh.id}/shares`, T.staffA, { staffIds: [staffA2.id] });
  await call("shares add: the same colleague again", "POST", `/questions/folders/${sh.id}/shares`, T.instA, { staffIds: [staffA2.id] });
  await call("shares list: the creator", "GET", `/questions/folders/${sh.id}/shares`, T.staffA);
  await call("shares list: an institute admin", "GET", `/questions/folders/${sh.id}/shares`, T.instA);
  await call("shares revoke: staff who is not the creator", "DELETE", `/questions/folders/${sh.id}/shares/${staffA2.id}`, T.staffA2);
  await call("shares revoke: unknown folder", "DELETE", `/questions/folders/${bogus}/shares/${staffA2.id}`, T.instA);
  await call("shares revoke: the creator", "DELETE", `/questions/folders/${sh.id}/shares/${staffA2.id}`, T.staffA);
  await call("shares revoke: someone with no share", "DELETE", `/questions/folders/${sh.id}/shares/${bogus}`, T.instA);
  await settle();
  note("shares: stored", { rows: await prisma.questionFolderShare.count({ where: { folderId: sh.id } }) });
  note("shares: audit rows", await auditRows({ action: "QUESTION_BANK_SHARED", adminId: { in: [staffA.id, instA.id] } }));

  // ---------- folders: merge ----------
  const mSrc = await folder("merge source", A.id, instA.id);
  const mSrcKid = await folder("merge source kid", A.id, instA.id, mSrc.id);
  const mDst = await folder("merge target", A.id, instA.id);
  const mSrcQ = await question("merge q", { folderId: mSrc.id });
  const mForeign = await folder("merge foreign content", A.id, instA.id);
  await question("merge staff q", { folderId: mForeign.id, createdById: staffA.id });
  await call("merge: anonymous", "POST", `/questions/folders/${mSrc.id}/merge`, null, { targetId: mDst.id });
  await call("merge: no target", "POST", `/questions/folders/${mSrc.id}/merge`, T.instA, {});
  await call("merge: into itself", "POST", `/questions/folders/${mSrc.id}/merge`, T.instA, { targetId: mSrc.id });
  await call("merge: unknown target", "POST", `/questions/folders/${mSrc.id}/merge`, T.instA, { targetId: bogus });
  await call("merge: target of another institute", "POST", `/questions/folders/${mSrc.id}/merge`, T.instA, { targetId: fB.id });
  await call("merge: a source holding another staff member's questions", "POST", `/questions/folders/${mForeign.id}/merge`, T.staffA, { targetId: mDst.id });
  await call("merge: succeeds", "POST", `/questions/folders/${mSrc.id}/merge`, T.instA, { targetId: mDst.id });
  note("merge: stored", { sourceGone: !(await prisma.questionFolder.findUnique({ where: { id: mSrc.id } })), questionMoved: (await prisma.question.findUnique({ where: { id: mSrcQ.id }, select: { folderId: true } })).folderId === mDst.id, kidMoved: (await prisma.questionFolder.findUnique({ where: { id: mSrcKid.id }, select: { parentId: true } })).parentId === mDst.id });

  // ---------- bulk move ----------
  const bf = await folder("bulk target", A.id, instA.id);
  const b1 = await question("bulk 1"), b2 = await question("bulk 2");
  const bForeign = await question("bulk foreign", { instituteId: B.id, createdById: instB.id });
  const bStaff = await question("bulk staff", { createdById: staffA.id });
  await call("move: anonymous", "POST", "/questions/bulk-move", null, { questionIds: [b1.id], folderId: bf.id });
  await call("move: student refused", "POST", "/questions/bulk-move", T.student, { questionIds: [b1.id], folderId: bf.id });
  await call("move: nothing selected", "POST", "/questions/bulk-move", T.instA, { questionIds: [], folderId: bf.id });
  await call("move: folder of another institute", "POST", "/questions/bulk-move", T.instA, { questionIds: [b1.id], folderId: fB.id });
  await call("move: none of the questions are the requester's", "POST", "/questions/bulk-move", T.instA, { questionIds: [bForeign.id, bogus], folderId: bf.id });
  await call("move: own and foreign questions together", "POST", "/questions/bulk-move", T.instA, { questionIds: [b1.id, b2.id, bForeign.id, bogus], folderId: bf.id });
  await call("move: staff cannot move another staff member's question", "POST", "/questions/bulk-move", T.staffA2, { questionIds: [bStaff.id], folderId: null });
  await call("move: out of the folder", "POST", "/questions/bulk-move", T.instA, { questionIds: [b1.id], folderId: null });
  note("move: stored", (await prisma.question.findMany({ where: { id: { in: [b1.id, b2.id, bForeign.id, bStaff.id] } }, select: { description: true, folderId: true }, orderBy: { description: "asc" } })).map((q) => ({ d: q.description, folder: q.folderId ? "set" : null })));

  // ---------- bulk assign subject ----------
  await call("assign: anonymous", "POST", "/questions/bulk-assign-subject", null, { questionIds: [b1.id], subjectId: subA.id, unitId: unitA.id });
  await call("assign: nothing selected", "POST", "/questions/bulk-assign-subject", T.instA, { questionIds: [], subjectId: subA.id, unitId: unitA.id });
  await call("assign: no subject", "POST", "/questions/bulk-assign-subject", T.instA, { questionIds: [b1.id] });
  await call("assign: unit of another subject", "POST", "/questions/bulk-assign-subject", T.instA, { questionIds: [b1.id], subjectId: subA.id, unitId: unitB.id });
  await call("assign: none of the questions are the requester's", "POST", "/questions/bulk-assign-subject", T.instA, { questionIds: [bForeign.id], subjectId: subA.id, unitId: unitA.id });
  await call("assign: own and foreign questions together", "POST", "/questions/bulk-assign-subject", T.instA, { questionIds: [b1.id, b2.id, bForeign.id], subjectId: subA.id, unitId: unitA.id });
  await settle();
  note("assign: stored", (await prisma.question.findMany({ where: { id: { in: [b1.id, b2.id, bForeign.id] } }, select: { description: true, subjectId: true, unitId: true }, orderBy: { description: "asc" } })).map((q) => ({ d: q.description, subject: q.subjectId ? "set" : null, unit: q.unitId ? "set" : null })));
  note("assign: audit rows", await auditRows({ action: "QUESTION_UPDATED", adminId: instA.id }));

  // ---------- bulk review status ----------
  const codingBare = await prisma.question.create({ data: { description: `${TAG} coding bare`, questionType: "CODING", instituteId: A.id, createdById: instA.id } });
  await call("status: anonymous", "POST", "/questions/bulk-status", null, { questionIds: [b1.id], questionStatus: "ARCHIVED" });
  await call("status: nothing selected", "POST", "/questions/bulk-status", T.instA, { questionIds: [], questionStatus: "ARCHIVED" });
  await call("status: unknown status", "POST", "/questions/bulk-status", T.instA, { questionIds: [b1.id], questionStatus: "WHATEVER" });
  await call("status: none of the questions are the requester's", "POST", "/questions/bulk-status", T.instA, { questionIds: [bForeign.id], questionStatus: "ARCHIVED" });
  await call("status: archive own and foreign questions", "POST", "/questions/bulk-status", T.instA, { questionIds: [b1.id, b2.id, bForeign.id], questionStatus: "ARCHIVED" });
  await call("status: verify a multiple-choice question", "POST", "/questions/bulk-status", T.instA, { questionIds: [b1.id], questionStatus: "VERIFIED" });
  await call("status: verify a coding question that has no tests", "POST", "/questions/bulk-status", T.instA, { questionIds: [codingBare.id, b2.id], questionStatus: "VERIFIED" });
  await settle();
  note("status: stored", (await prisma.question.findMany({ where: { id: { in: [b1.id, b2.id, bForeign.id, codingBare.id] } }, select: { description: true, questionStatus: true, updatedById: true }, orderBy: { description: "asc" } })).map((q) => ({ d: q.description, status: q.questionStatus, by: q.updatedById ? "set" : null })));
  note("status: audit rows", await auditRows({ action: "QUESTION_UPDATED", adminId: instA.id, details: { path: ["questionStatus"], not: "zzz" } }));

  // ---------- bulk delete ----------
  const x1 = await question("del free"), x2 = await question("del staff", { createdById: staffA.id }), xHist = await question("del graded"), xTest = await question("del in test");
  await prisma.submission.create({ data: { attemptId: attempt.id, questionId: xHist.id, studentId: student.id, language: "text", code: "x" } });
  await prisma.testQuestion.create({ data: { testId: test.id, questionId: xTest.id, order: 1 } });
  await call("delete: anonymous", "POST", "/questions/bulk-delete", null, { questionIds: [x1.id] });
  await call("delete: nothing selected", "POST", "/questions/bulk-delete", T.instA, { questionIds: [] });
  await call("delete: free, foreign, graded and unknown ids", "POST", "/questions/bulk-delete", T.instA, { questionIds: [x1.id, bForeign.id, xHist.id, bogus] });
  await call("delete: staff cannot delete another staff member's question", "POST", "/questions/bulk-delete", T.staffA2, { questionIds: [x2.id] });
  await call("delete: a question used in a test", "POST", "/questions/bulk-delete", T.instA, { questionIds: [xTest.id] });
  await settle();
  note("delete: stored", { free: !(await prisma.question.findUnique({ where: { id: x1.id } })), staffKept: !!(await prisma.question.findUnique({ where: { id: x2.id } })), gradedKept: !!(await prisma.question.findUnique({ where: { id: xHist.id } })), inTestKept: !!(await prisma.question.findUnique({ where: { id: xTest.id } })) });
  note("delete: audit rows", await auditRows({ action: "QUESTION_DELETED", adminId: instA.id, details: { path: ["bulk"], equals: true } }));

  // ---------- bulk copy ----------
  const cf = await folder("copy target", A.id, instA.id);
  const cSrc = await prisma.question.create({ data: { description: `${TAG} copy source`, title: "copy me", questionType: "CODING", instituteId: A.id, createdById: instA.id, imageKey: "zz-qf/image-key", imageMimeType: "image/png", testCases: { create: [{ input: "1", expected: "2", isHidden: false }, { input: "3", expected: "6", isHidden: true }] } } });
  const cAlready = await question("copy already there", { folderId: cf.id });
  await call("copy: anonymous", "POST", "/questions/bulk-copy", null, { questionIds: [cSrc.id], folderId: cf.id });
  await call("copy: nothing selected", "POST", "/questions/bulk-copy", T.instA, { questionIds: [], folderId: cf.id });
  await call("copy: no destination", "POST", "/questions/bulk-copy", T.instA, { questionIds: [cSrc.id] });
  await call("copy: destination of another institute", "POST", "/questions/bulk-copy", T.instA, { questionIds: [cSrc.id], folderId: fB.id });
  await call("copy: own, already-there, foreign and unknown ids", "POST", "/questions/bulk-copy", T.instA, { questionIds: [cSrc.id, cAlready.id, bForeign.id, bogus], folderId: cf.id });
  await settle();
  note("copy: stored", (await prisma.question.findMany({ where: { description: `${TAG} copy source` }, select: { folderId: true, imageKey: true, imageMimeType: true, createdById: true, _count: { select: { testCases: true } } }, orderBy: { createdAt: "asc" } }))
    .map((q) => ({ folder: q.folderId ? "set" : null, imageKey: q.imageKey, imageMimeType: q.imageMimeType, creator: q.createdById ? "set" : null, tests: q._count.testCases })));

  // ---------- clear a folder ----------
  const clr = await folder("clear me", A.id, instA.id);
  const cl1 = await question("clear free", { folderId: clr.id }), clHist = await question("clear graded", { folderId: clr.id }), clTest = await question("clear in test", { folderId: clr.id }), clStaff = await question("clear staff", { folderId: clr.id, createdById: staffA.id });
  await prisma.submission.create({ data: { attemptId: attempt.id, questionId: clHist.id, studentId: student.id, language: "text", code: "x" } });
  await prisma.testQuestion.create({ data: { testId: test.id, questionId: clTest.id, order: 2 } });
  await call("clear: anonymous", "POST", `/questions/folders/${clr.id}/clear`, null);
  await call("clear: unknown folder", "POST", `/questions/folders/${bogus}/clear`, T.instA);
  await call("clear: folder of another institute", "POST", `/questions/folders/${clr.id}/clear`, T.instB);
  await call("clear: a folder with free, graded, used-in-test and another staff member's questions", "POST", `/questions/folders/${clr.id}/clear`, T.instA);
  await settle();
  note("clear: what is left", (await prisma.question.findMany({ where: { id: { in: [cl1.id, clHist.id, clTest.id, clStaff.id] } }, select: { description: true }, orderBy: { description: "asc" } })).map((q) => q.description));

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
