// Characterization (contract) test for /api/auth: drives every route through success and failure paths with disposable data and compares a normalized
// record of every response (status + body shape and stable values) with test/snapshots/auth-contract.json. Used to prove a restructuring of routes/auth.js
// changes nothing except what is deliberately changed. Needs the API on localhost:4000 (or VERIFY_API) and a database.
//   node scripts/verifyAuthContract.js            compare with the stored snapshot (exit 1 on any difference)
//   node scripts/verifyAuthContract.js --record   (re)write the snapshot
// Rate-limit buckets are keyed by client IP; every case sends its own X-Forwarded-For address from the documentation range 203.0.113.0/24 (the API trusts one
// proxy hop, so that is the address it keys on) and those rows are removed again, so nothing here touches a real user's budget.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const API = process.env.VERIFY_API || "http://localhost:4000/api";
const TAG = "ZZ AC";
const SNAP = path.join(__dirname, "..", "test", "snapshots", "auth-contract.json");
const record = process.argv.includes("--record");

const log = [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.replace(UUID, "<id>").replace(ISO, "<time>").replace(/\d{13}/g, "<ts>");
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = k === "token" ? (v[k] ? "<token>" : null) : norm(v[k]); return o; }
  return v;
}
let ipSeq = 0;
const nextIp = () => `203.0.113.${++ipSeq}`;
async function call(name, method, p, token, body, ip = nextIp()) {
  const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-json */ }
  log.push({ name, status: res.status, body: json !== null ? norm(json) : `<non-json ${text.slice(0, 40)}>` });
  return { status: res.status, json };
}
const note = (name, value) => log.push({ name, db: norm(value) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(900); // fire-and-forget audit, e-mail and flag writes land shortly after the response
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  const users = await prisma.user.findMany({ where: { email: { startsWith: "zz-ac-", endsWith: "@example.invalid" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: uids } }, { instituteId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: uids } }, { recipientEmail: { startsWith: "zz-ac-" } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: "203.0.113." } }, { key: { contains: "zz-ac-" } }] } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const mkInst = (key, extra = {}) => prisma.institute.create({ data: { name: `${TAG} ${key} ${ts}`, code: `ZZA${key}`.slice(0, 8), ...extra } });
  const iPlain = await mkInst("P");
  const iSingle = await mkInst("S", { singleSessionOnly: true });
  const iProfile = await mkInst("R", { requireProfileCompletion: true });
  const iExpiry = await mkInst("E", { passwordExpiryDays: 1 });
  const iDead = await mkInst("D", { isActive: false });
  const pw = {};
  const mk = async (key, role, instituteId, extra = {}) => {
    pw[key] = `Zz9!${crypto.randomBytes(8).toString("base64url")}`;
    return prisma.user.create({ data: { name: `ZZ AC ${key}`, email: `zz-ac-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw[key], 10), role, instituteId, mustChangePassword: false, ...extra } });
  };
  const stu = await mk("stu", "STUDENT", iPlain.id);
  const gone = await mk("gone", "STUDENT", iPlain.id, { isActive: false });
  const mcp = await mk("mcp", "STUDENT", iPlain.id, { mustChangePassword: true });
  const stale = await mk("stale", "STUDENT", iExpiry.id, { passwordChangedAt: new Date(Date.now() - 3 * 86400000) });
  const single = await mk("single", "STAFF", iSingle.id);
  const prof = await mk("prof", "STUDENT", iProfile.id);
  const dead = await mk("dead", "STAFF", iDead.id);
  const admin = await mk("admin", "ADMIN", null);
  const lim = await mk("lim", "STUDENT", iPlain.id);
  const login = (name, u, password, ip) => call(name, "POST", "/auth/login", null, { email: u.email, password: password === undefined ? pw[u.name.replace("ZZ AC ", "")] : password }, ip);

  // ---------- register ----------
  await call("register: disabled", "POST", "/auth/register", null, { email: "zz-ac-x@example.invalid", password: "Whatever1!" });

  // ---------- login ----------
  await call("login: no body fields", "POST", "/auth/login", null, {});
  await call("login: email not a string", "POST", "/auth/login", null, { email: 123, password: "x" });
  await call("login: unknown email", "POST", "/auth/login", null, { email: `zz-ac-nobody-${ts}@example.invalid`, password: "Whatever1!" });
  await call("login: wrong password", "POST", "/auth/login", null, { email: stu.email, password: "Wrong1!pass" });
  await call("login: missing password", "POST", "/auth/login", null, { email: stu.email });
  const okStu = await login("login: student succeeds", stu);
  await login("login: same student again (known device)", stu);
  await login("login: deactivated account, right password", gone);
  await login("login: deactivated account, wrong password", gone, "Wrong1!pass");
  await login("login: institute deactivated", dead);
  await login("login: must change password", mcp);
  await login("login: password past the institute expiry", stale);
  await login("login: profile completion required", prof);
  const okAdmin = await login("login: platform admin", admin);
  const s1 = await login("login: single-session institute, first login", single);
  const s2 = await login("login: single-session institute, second login", single);
  await settle();
  note("expired password sets the stored flag", (await prisma.user.findUnique({ where: { id: stale.id }, select: { mustChangePassword: true } })));
  note("login sessions per user", { stu: await prisma.loginSession.count({ where: { userId: stu.id } }), single: await prisma.loginSession.count({ where: { userId: single.id } }), singleActive: await prisma.loginSession.count({ where: { userId: single.id, isActive: true } }), gone: await prisma.loginSession.count({ where: { userId: gone.id } }) });
  note("last login stamped", { stu: !!(await prisma.user.findUnique({ where: { id: stu.id }, select: { lastLoginAt: true } })).lastLoginAt, gone: !(await prisma.user.findUnique({ where: { id: gone.id }, select: { lastLoginAt: true } })).lastLoginAt });
  await call("session: first single-session token is dead", "GET", "/auth/permissions", s1.json && s1.json.token);
  await call("session: second single-session token works", "GET", "/auth/permissions", s2.json && s2.json.token);

  // login rate limit: five failures then the bucket is full, even for the right password
  const limIp = nextIp();
  for (let i = 1; i <= 5; i++) { await login(`login limit: wrong attempt ${i}`, lim, "Wrong1!pass", limIp); await sleep(250); }
  await login("login limit: sixth attempt with the right password", lim, undefined, limIp);
  await login("login limit: another address is not affected", lim);

  // ---------- permissions / logout ----------
  await call("permissions: anonymous", "GET", "/auth/permissions", null);
  await call("permissions: student", "GET", "/auth/permissions", okStu.json && okStu.json.token);
  await call("permissions: platform admin", "GET", "/auth/permissions", okAdmin.json && okAdmin.json.token);
  await call("logout: anonymous", "POST", "/auth/logout", null);
  await call("logout: student", "POST", "/auth/logout", okStu.json && okStu.json.token);
  await call("logout: the same token afterwards", "GET", "/auth/permissions", okStu.json && okStu.json.token);
  await call("logout: the same token logs out again", "POST", "/auth/logout", okStu.json && okStu.json.token);

  // ---------- forgot password ----------
  const fp = nextIp();
  await call("forgot: no email", "POST", "/auth/forgot-password", null, {}, fp);
  await call("forgot: unknown email gets the same answer", "POST", "/auth/forgot-password", null, { email: `zz-ac-nobody-${ts}@example.invalid` }, fp);
  await call("forgot: registered email", "POST", "/auth/forgot-password", null, { email: stu.email }, fp);
  await settle();
  const afterForgot = await prisma.user.findUnique({ where: { id: stu.id }, select: { resetTokenHash: true, resetTokenExpiry: true, lastPasswordResetRequestedAt: true } });
  note("forgot: what was stored", { tokenStored: !!afterForgot.resetTokenHash, expiresInMinutes: afterForgot.resetTokenExpiry ? Math.round((afterForgot.resetTokenExpiry.getTime() - Date.now()) / 60000 / 5) * 5 : null, cooldownStamped: !!afterForgot.lastPasswordResetRequestedAt });
  const fp2 = nextIp();
  await call("forgot: second request within 24h gets the same answer", "POST", "/auth/forgot-password", null, { email: stu.email }, fp2);
  await settle();
  const fp3 = nextIp();
  for (let i = 1; i <= 3; i++) await call(`forgot limit: request ${i}`, "POST", "/auth/forgot-password", null, { email: `zz-ac-nobody-${ts}@example.invalid` }, fp3);
  await call("forgot limit: fourth request from one address", "POST", "/auth/forgot-password", null, { email: `zz-ac-nobody-${ts}@example.invalid` }, fp3);
  const forgotAudit = await prisma.auditLog.findMany({ where: { adminId: stu.id, action: { startsWith: "PASSWORD_RESET" } }, select: { action: true, adminRole: true, instituteId: true, details: true } });
  note("forgot: audit rows", forgotAudit.map((a) => `${a.action}:${a.adminRole}:${a.instituteId ? "inst" : "-"}:${JSON.stringify(a.details)}`).sort());

  // ---------- reset password ----------
  const newPw = `Nn7#${crypto.randomBytes(8).toString("base64url")}`;
  const seedToken = async (user, token, minutes) => prisma.user.update({ where: { id: user.id }, data: { resetTokenHash: sha(token), resetTokenExpiry: new Date(Date.now() + minutes * 60000) } });
  const rp = nextIp();
  await call("reset: nothing sent", "POST", "/auth/reset-password", null, {}, rp);
  await call("reset: weak password", "POST", "/auth/reset-password", null, { token: "x", newPassword: "short" }, rp);
  await call("reset: no uppercase", "POST", "/auth/reset-password", null, { token: "x", newPassword: "lowercase1!" }, rp);
  await call("reset: unknown token", "POST", "/auth/reset-password", null, { token: "no-such-token", newPassword: newPw }, rp);
  const expiredTok = crypto.randomBytes(16).toString("hex");
  await seedToken(stu, expiredTok, -5);
  await call("reset: expired token", "POST", "/auth/reset-password", null, { token: expiredTok, newPassword: newPw }, rp);
  // a password already in the account's history is refused
  const reusedTok = crypto.randomBytes(16).toString("hex");
  await seedToken(stu, reusedTok, 30);
  await prisma.passwordHistory.create({ data: { userId: stu.id, passwordHash: await bcrypt.hash(newPw, 10) } });
  await call("reset: password used recently", "POST", "/auth/reset-password", null, { token: reusedTok, newPassword: newPw }, rp);
  await prisma.passwordHistory.deleteMany({ where: { userId: stu.id } });
  const liveSession = await login("reset: a session open before the reset", stu);
  const goodTok = crypto.randomBytes(16).toString("hex");
  await seedToken(stu, goodTok, 30);
  await call("reset: succeeds", "POST", "/auth/reset-password", null, { token: goodTok, newPassword: newPw }, rp);
  await settle();
  await call("reset: the token cannot be used twice", "POST", "/auth/reset-password", null, { token: goodTok, newPassword: newPw }, rp);
  await call("reset: sessions open before it are closed", "GET", "/auth/permissions", liveSession.json && liveSession.json.token);
  await login("reset: old password no longer works", stu);
  await call("reset: new password works", "POST", "/auth/login", null, { email: stu.email, password: newPw });
  const afterReset = await prisma.user.findUnique({ where: { id: stu.id }, select: { resetTokenHash: true, resetTokenExpiry: true, passwordChangedAt: true } });
  note("reset: what was stored", { tokenCleared: afterReset.resetTokenHash === null && afterReset.resetTokenExpiry === null, historyRows: await prisma.passwordHistory.count({ where: { userId: stu.id } }) });
  const resetAudit = await prisma.auditLog.findMany({ where: { adminId: stu.id, action: { startsWith: "PASSWORD_RESET" } }, select: { action: true, details: true } });
  note("reset: audit rows", resetAudit.map((a) => `${a.action}:${JSON.stringify(a.details)}`).sort());
  await settle();
  const mails = await prisma.emailLog.findMany({ where: { studentId: stu.id }, select: { emailType: true } });
  note("e-mails queued for the student", mails.map((m) => m.emailType).sort());
  const rpLimit = nextIp();
  for (let i = 1; i <= 10; i++) await call(`reset limit: attempt ${i}`, "POST", "/auth/reset-password", null, { token: "no-such-token", newPassword: newPw }, rpLimit);
  await call("reset limit: eleventh attempt", "POST", "/auth/reset-password", null, { token: "no-such-token", newPassword: newPw }, rpLimit);

  // ---------- verify e-mail ----------
  const ve = nextIp();
  const pending = `zz-ac-new-${ts}@example.invalid`;
  const seedPending = (user, token, minutes, email) => prisma.user.update({ where: { id: user.id }, data: { pendingEmail: email, pendingEmailTokenHash: sha(token), pendingEmailTokenExpiry: new Date(Date.now() + minutes * 60000) } });
  await call("verify: no token", "POST", "/auth/verify-email", null, {}, ve);
  await call("verify: unknown token", "POST", "/auth/verify-email", null, { token: "no-such-token" }, ve);
  const oldTok = crypto.randomBytes(16).toString("hex");
  await seedPending(mcp, oldTok, -5, pending);
  await call("verify: expired token", "POST", "/auth/verify-email", null, { token: oldTok }, ve);
  const clashTok = crypto.randomBytes(16).toString("hex");
  await seedPending(mcp, clashTok, 30, gone.email);
  await call("verify: address taken meanwhile", "POST", "/auth/verify-email", null, { token: clashTok }, ve);
  note("verify: pending state after the clash", await prisma.user.findUnique({ where: { id: mcp.id }, select: { pendingEmail: true, pendingEmailTokenHash: true, pendingEmailTokenExpiry: true } }));
  await call("verify: the same token again", "POST", "/auth/verify-email", null, { token: clashTok }, ve);
  const goodMail = crypto.randomBytes(16).toString("hex");
  await seedPending(mcp, goodMail, 30, pending);
  await call("verify: succeeds", "POST", "/auth/verify-email", null, { token: goodMail }, ve);
  await call("verify: token cannot be replayed", "POST", "/auth/verify-email", null, { token: goodMail }, ve);
  const verified = await prisma.user.findUnique({ where: { id: mcp.id }, select: { email: true, emailVerified: true, emailVerifiedAt: true, pendingEmail: true, pendingEmailTokenHash: true } });
  note("verify: stored state", { email: verified.email, emailVerified: verified.emailVerified, stamped: !!verified.emailVerifiedAt, pendingCleared: verified.pendingEmail === null && verified.pendingEmailTokenHash === null });
  await settle();
  const verifyAudit = await prisma.auditLog.findMany({ where: { adminId: mcp.id, action: "EMAIL_VERIFIED" }, select: { action: true, adminRole: true, studentId: true, instituteId: true, details: true } });
  note("verify: audit rows", verifyAudit.map((a) => ({ action: a.action, role: a.adminRole, student: a.studentId ? "set" : null, institute: a.instituteId ? "set" : null, details: a.details })));
  const vLimit = nextIp();
  for (let i = 1; i <= 10; i++) await call(`verify limit: attempt ${i}`, "POST", "/auth/verify-email", null, { token: "no-such-token" }, vLimit);
  await call("verify limit: eleventh attempt", "POST", "/auth/verify-email", null, { token: "no-such-token" }, vLimit);

  // ---------- audit trail written by login ----------
  const audits = await prisma.auditLog.findMany({ where: { adminId: { in: [stu.id, gone.id, single.id, stale.id, dead.id, lim.id] }, action: { in: ["LOGIN", "LOGIN_FAILED", "LOGOUT"] } }, select: { action: true, adminRole: true, instituteId: true, studentId: true, details: true } });
  note("login audit rows", audits.map((a) => `${a.action}:${a.adminRole}:${a.instituteId ? "inst" : "-"}:${a.studentId ? "student" : "-"}:${JSON.stringify(a.details)}`).sort());
  const alerts = await prisma.emailLog.findMany({ where: { studentId: { in: [stu.id, single.id, stale.id, prof.id, admin.id] }, emailType: "LOGIN_ALERT" }, select: { emailType: true, studentId: true } });
  note("login alerts queued", ["stu", "single", "stale", "prof", "admin"].map((k, i) => `${k}:${alerts.filter((a) => a.studentId === [stu, single, stale, prof, admin][i].id).length}`));

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
