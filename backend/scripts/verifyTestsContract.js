// Characterization (contract) test for the /api/tests management and read endpoints: drives each route through success and failure paths with disposable
// data and compares a normalized record of every response (status + body shape and stable values) with test/snapshots/tests-contract.json. Used to prove a
// restructuring of routes/tests.js changes nothing except what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a database.
//   node scripts/verifyTestsContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifyTestsContract.js --record   (re)write the snapshot
// Deliberately NOT exercised: sending e-mail (notify with sendEmail), and the student attempt flow (/start, violations, AI assist), which have their own checks.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ TC";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "tests-contract.json");
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>").replace(/\d{13}/g, "<ts>"); // the per-run timestamp in disposable names
  if (Array.isArray(v)) {
    const items = v.map(norm);
    // Lists the API returns without an ORDER BY (a test's questions) come back in storage order, which differs between databases: compare them by their own `order`.
    return items.every((x) => x && typeof x === "object" && typeof x.order === "number") ? [...items].sort((a, b) => a.order - b.order) : items;
  }
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = norm(v[k]); return o; }
  return v;
}
async function call(name, method, p, token, body) {
  const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-json */ }
  if (p === "/tests" && Array.isArray(json)) json = json.filter((t) => String(t.title || "").startsWith(TAG));
  log.push({ name, status: res.status, body: json === null ? `<non-json ${text.slice(0, 40)}>` : norm(json) });
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { email: { startsWith: "zz-tc-", endsWith: "@example.invalid" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.test.deleteMany({ where: { OR: [{ instituteId: { in: ids } }, { createdById: { in: uids } }] } });
  await prisma.question.deleteMany({ where: { title: { startsWith: `${TAG} ` } } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} A ${ts}`, code: "ZZTA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} B ${ts}`, code: "ZZTB" } });
  const deptA = await prisma.department.create({ data: { name: "ZZ TC Dept A", instituteId: A.id } });
  const deptB = await prisma.department.create({ data: { name: "ZZ TC Dept B", instituteId: B.id } });
  const groupA = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: deptA.id, section: "Section A" } });
  const groupB = await prisma.academicGroup.create({ data: { instituteId: B.id, batch: "2026", departmentId: deptB.id, section: "Section B" } });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = crypto.randomBytes(14).toString("base64url");
    return prisma.user.create({ data: { name: `ZZ TC ${key}`, email: `zz-tc-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const platform = await mk("platform", "ADMIN", null);
  const instA = await mk("instA", "INSTITUTE_ADMIN", A.id);
  const instB = await mk("instB", "INSTITUTE_ADMIN", B.id);
  const staffA1 = await mk("staffA1", "STAFF", A.id);
  const staffA2 = await mk("staffA2", "STAFF", A.id);
  const staffB = await mk("staffB", "STAFF", B.id);
  const stuA = await mk("stuA", "STUDENT", A.id, { academicGroupId: groupA.id });
  const stuB = await mk("stuB", "STUDENT", B.id, { academicGroupId: groupB.id });
  const login = async (u, k) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, password: pw[k] }) })).json()).token;
  const T = { platform: await login(platform, "platform"), instA: await login(instA, "instA"), instB: await login(instB, "instB"), s1: await login(staffA1, "staffA1"), s2: await login(staffA2, "staffA2"), sB: await login(staffB, "staffB"), stuA: await login(stuA, "stuA"), stuB: await login(stuB, "stuB") };

  const mkQ = (n) => prisma.question.create({ data: { title: `${TAG} q${n}`, description: `pick ${n}`, questionType: "MCQ", points: 2, difficulty: "EASY", options: ["A", "B"], correctAnswer: [0], instituteId: A.id } });
  const q1 = await mkQ(1), q2 = await mkQ(2);
  const now = Date.now();
  const when = (offsetMin) => new Date(now + offsetMin * 60000).toISOString();
  const base = (title, extra = {}) => ({ title, durationMin: 30, startTime: when(60), endTime: when(180), questionIds: [q1.id, q2.id], academicGroupIds: [groupA.id], ...extra });
  const bogusId = crypto.randomUUID();

  // ---------- create ----------
  await call("create: anonymous", "POST", "/tests", null, base("ZZ TC anon"));
  await call("create: student refused", "POST", "/tests", T.stuA, base("ZZ TC stu"));
  const created = await call("create: staff creates a valid test", "POST", "/tests", T.s1, base("ZZ TC main", { code: " C1 ", instructions: " read ", subject: "ZZ Subj", unit: "U1", shuffleQuestions: false }));
  const testId = created.json && created.json.id;
  await call("create: same subject/unit/title is flagged as a duplicate", "POST", "/tests", T.s1, base("ZZ TC main", { subject: "ZZ Subj", unit: "U1" }));
  await call("create: duplicate allowed on request", "POST", "/tests", T.s1, base("ZZ TC main", { subject: "ZZ Subj", unit: "U1", allowDuplicate: true }));
  await call("create: invalid security input", "POST", "/tests", T.s1, base("ZZ TC sec", { securityLevel: "BOGUS" }));
  await call("create: group of another institute refused", "POST", "/tests", T.s1, base("ZZ TC foreign group", { academicGroupIds: [groupB.id] }));
  await call("create: institute-bound staff cannot pick another institute", "POST", "/tests", T.s1, base("ZZ TC inst override", { instituteId: B.id }));
  await call("create: platform admin with an unknown institute", "POST", "/tests", T.platform, base("ZZ TC bad inst", { instituteId: bogusId, academicGroupIds: [] }));
  await call("create: random mode without a bank folder", "POST", "/tests", T.s1, base("ZZ TC random", { questionSelectionMode: "RANDOM" }));
  await call("create: missing title", "POST", "/tests", T.s1, { startTime: when(60), endTime: when(180) });
  await call("create: admin creates a test with no questions", "POST", "/tests", T.instA, { title: "ZZ TC empty", startTime: when(60), endTime: when(180), academicGroupIds: [groupA.id] });
  const emptyTest = (await prisma.test.findFirst({ where: { title: "ZZ TC empty" }, select: { id: true } }));

  // ---------- read ----------
  await call("get: anonymous", "GET", `/tests/${testId}`, null);
  await call("get: owner", "GET", `/tests/${testId}`, T.s1);
  await call("get: other staff of the institute (not owner, not shared)", "GET", `/tests/${testId}`, T.s2);
  await call("get: institute admin of another institute", "GET", `/tests/${testId}`, T.instB);
  await call("get: institute admin of the same institute", "GET", `/tests/${testId}`, T.instA);
  await call("get: unknown id", "GET", `/tests/${bogusId}`, T.s1);
  await call("get: student before publish", "GET", `/tests/${testId}`, T.stuA);
  await call("list: owner sees own tests", "GET", "/tests", T.s1);
  await call("list: other staff sees none", "GET", "/tests", T.s2);
  await call("list: institute admin sees the institute", "GET", "/tests", T.instA);
  await call("list: student sees nothing before publish", "GET", "/tests", T.stuA);
  await call("list: anonymous", "GET", "/tests", null);

  // ---------- edit ----------
  await call("patch: owner edits the title", "PATCH", `/tests/${testId}`, T.s1, { title: "ZZ TC main (edited)", version: 0 });
  await call("patch: stale version conflicts", "PATCH", `/tests/${testId}`, T.s1, { title: "ZZ TC stale", version: 0 });
  await call("patch: other staff refused", "PATCH", `/tests/${testId}`, T.s2, { title: "x" });
  await call("patch: other institute refused", "PATCH", `/tests/${testId}`, T.instB, { title: "x" });
  await call("patch: unknown id", "PATCH", `/tests/${bogusId}`, T.s1, { title: "x" });
  await call("patch: student refused", "PATCH", `/tests/${testId}`, T.stuA, { title: "x" });
  await call("patch: scheduled publish in the past", "PATCH", `/tests/${testId}`, T.s1, { scheduledPublishAt: when(-5) });
  await call("patch: scheduled publish in the future", "PATCH", `/tests/${testId}`, T.s1, { scheduledPublishAt: when(30) });
  await call("patch: scheduled publish cleared", "PATCH", `/tests/${testId}`, T.s1, { scheduledPublishAt: null });
  await call("patch: replace the questions and groups", "PATCH", `/tests/${testId}`, T.s1, { questionIds: [q2.id, q1.id], academicGroupIds: [groupA.id], questionTimeLimits: { [q1.id]: 60 }, durationMin: 45, passingMarks: 2 });
  await call("patch: group of another institute refused", "PATCH", `/tests/${testId}`, T.s1, { academicGroupIds: [groupB.id] });
  await call("patch: platform admin moves the test to an unknown institute", "PATCH", `/tests/${testId}`, T.platform, { instituteId: bogusId });

  // ---------- sharing ----------
  await call("staff-directory: owner", "GET", "/tests/staff-directory", T.s1);
  await call("staff-directory: institute admin", "GET", "/tests/staff-directory", T.instA);
  await call("staff-directory: student refused", "GET", "/tests/staff-directory", T.stuA);
  await call("staff-directory: anonymous", "GET", "/tests/staff-directory", null);
  await call("share: non-owner staff refused", "POST", `/tests/${testId}/shares`, T.s2, { staffIds: [staffA2.id] });
  await call("share: staff from another institute is invalid", "POST", `/tests/${testId}/shares`, T.s1, { staffIds: [staffB.id] });
  await call("share: unknown test", "POST", `/tests/${bogusId}/shares`, T.s1, { staffIds: [staffA2.id] });
  await call("share: other institute admin refused", "POST", `/tests/${testId}/shares`, T.instB, { staffIds: [staffA2.id] });
  await call("share: owner shares with a colleague", "POST", `/tests/${testId}/shares`, T.s1, { staffIds: [staffA2.id] });
  note("shares after sharing", await prisma.testShare.findMany({ where: { testId }, select: { staffId: true, sharedByName: true } }).then((r) => r.map((x) => ({ staff: x.staffId === staffA2.id ? "A2" : "?", by: x.sharedByName }))));
  await call("get: the colleague can now open it", "GET", `/tests/${testId}`, T.s2);
  await call("patch: the colleague can edit it", "PATCH", `/tests/${testId}`, T.s2, { description: "edited by a colleague" });
  await call("share: the colleague cannot re-share", "POST", `/tests/${testId}/shares`, T.s2, { staffIds: [staffA1.id] });
  await call("unshare: the colleague cannot revoke", "DELETE", `/tests/${testId}/shares/${staffA2.id}`, T.s2);
  await call("unshare: other institute refused", "DELETE", `/tests/${testId}/shares/${staffA2.id}`, T.instB);
  await call("unshare: owner revokes", "DELETE", `/tests/${testId}/shares/${staffA2.id}`, T.s1);
  await call("get: the colleague is locked out again", "GET", `/tests/${testId}`, T.s2);
  await call("unshare: unknown test", "DELETE", `/tests/${bogusId}/shares/${staffA2.id}`, T.s1);

  // ---------- publish ----------
  await call("publish: other staff refused", "PATCH", `/tests/${testId}/publish`, T.s2, { isPublished: true });
  await call("publish: other institute refused", "PATCH", `/tests/${testId}/publish`, T.instB, { isPublished: true });
  await call("publish: unknown test", "PATCH", `/tests/${bogusId}/publish`, T.s1, { isPublished: true });
  await call("publish: a test with no questions cannot go live", "PATCH", `/tests/${emptyTest.id}/publish`, T.instA, { isPublished: true });
  await call("publish: owner publishes", "PATCH", `/tests/${testId}/publish`, T.s1, { isPublished: true });
  await call("patch: scheduling a published test is refused", "PATCH", `/tests/${testId}`, T.s1, { scheduledPublishAt: when(30) });
  await call("get: the assigned student sees a summary only", "GET", `/tests/${testId}`, T.stuA);
  await call("get: a student of another institute cannot see it", "GET", `/tests/${testId}`, T.stuB);
  await call("list: the assigned student sees it", "GET", "/tests", T.stuA);
  await call("list: the other institute's student sees nothing", "GET", "/tests", T.stuB);
  await call("publish: unpublish succeeds", "PATCH", `/tests/${testId}/publish`, T.s1, { isPublished: false });
  await call("publish: republish", "PATCH", `/tests/${testId}/publish`, T.s1, { isPublished: true });

  // ---------- notifications (in-app only; e-mail sending is not exercised) ----------
  await call("recipients: owner", "GET", `/tests/${testId}/notification-recipients`, T.s1);
  await call("recipients: other staff refused", "GET", `/tests/${testId}/notification-recipients`, T.s2);
  await call("recipients: other institute refused", "GET", `/tests/${testId}/notification-recipients`, T.instB);
  await call("recipients: unknown test", "GET", `/tests/${bogusId}/notification-recipients`, T.s1);
  await call("notify: no channel selected", "POST", `/tests/${testId}/notify`, T.s1, { idempotencyKey: "k0" });
  await call("notify: missing idempotency key", "POST", `/tests/${testId}/notify`, T.s1, { sendInApp: true });
  await call("notify: other staff refused", "POST", `/tests/${testId}/notify`, T.s2, { sendInApp: true, idempotencyKey: "k1" });
  await call("notify: other institute refused", "POST", `/tests/${testId}/notify`, T.instB, { sendInApp: true, idempotencyKey: "k1" });
  await call("notify: an unpublished test cannot be notified", "POST", `/tests/${emptyTest.id}/notify`, T.instA, { sendInApp: true, idempotencyKey: "k2" });
  const key = `zz-tc-${ts}`;
  await call("notify: in-app notification", "POST", `/tests/${testId}/notify`, T.s1, { sendInApp: true, idempotencyKey: key });
  await call("notify: the same key again is not re-sent", "POST", `/tests/${testId}/notify`, T.s1, { sendInApp: true, idempotencyKey: key });
  note("in-app notifications created for the student", await prisma.notification.count({ where: { recipientId: stuA.id, type: "TEST_NOTIFICATION" } }));
  await call("notification-log: owner", "GET", `/tests/${testId}/notification-log`, T.s1);
  await call("notification-log: other staff refused", "GET", `/tests/${testId}/notification-log`, T.s2);
  await call("notification-log: other institute refused", "GET", `/tests/${testId}/notification-log`, T.instB);

  // ---------- duplicate ----------
  await call("duplicate: other staff refused", "POST", `/tests/${testId}/duplicate`, T.s2);
  await call("duplicate: other institute refused", "POST", `/tests/${testId}/duplicate`, T.instB);
  await call("duplicate: unknown test", "POST", `/tests/${bogusId}/duplicate`, T.s1);
  const dup = await call("duplicate: owner clones it (unpublished, owned by the cloner)", "POST", `/tests/${testId}/duplicate`, T.s1);
  await call("duplicate: institute admin clones it", "POST", `/tests/${testId}/duplicate`, T.instA);

  // ---------- delete ----------
  await call("delete: staff refused", "DELETE", `/tests/${dup.json && dup.json.id}`, T.s1);
  await call("delete: other institute refused", "DELETE", `/tests/${dup.json && dup.json.id}`, T.instB);
  await call("delete: unknown test", "DELETE", `/tests/${bogusId}`, T.instA);
  await call("delete: institute admin deletes", "DELETE", `/tests/${dup.json && dup.json.id}`, T.instA);
  await call("delete: gone afterwards", "GET", `/tests/${dup.json && dup.json.id}`, T.instA);

  // ---------- audit trail (what the routes record) ----------
  const audits = await prisma.auditLog.findMany({ where: { instituteId: A.id, action: { startsWith: "TEST_" } }, select: { action: true, adminRole: true, details: true }, orderBy: { createdAt: "asc" } });
  note("audit actions recorded", audits.map((a) => `${a.action}:${a.adminRole}`));

  await cleanup();
  const out = JSON.stringify(log, null, 2) + "\n";
  if (record) { fs.mkdirSync(path.dirname(SNAP), { recursive: true }); fs.writeFileSync(SNAP, out); console.log(`Recorded ${log.length} entries to ${path.relative(process.cwd(), SNAP)}`); await prisma.$disconnect(); process.exit(0); }
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
