// Live check of the first-login password change (POST /auth/login for an account that must choose a new password, then POST /auth/change-temporary-password).
// REGRESSION it guards against: a student who signed in with an administrator-issued temporary password received a full session at once, and the requirement to change the
// password was enforced only by the web page (a flag kept in the browser's localStorage). Editing that flag, or calling the API directly with the token, skipped the change; the
// page also accepted passwords of 6 characters although the server needs 8 with four kinds of character. Now the server issues NO session until the password has been changed,
// repeats every rule, and replaces the password atomically (compare-and-swap), so a temporary password works exactly once.
// Throwaway institutes and accounts (prefix verify-flpc-); cleans up after itself. Needs the API on localhost:4000 (or VERIFY_BASE) and its database.
// VERIFY_API_LOG (optional): the API process's log file; when given, it is searched for every password used here (passwords must never reach a log).
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const sessions = require("../src/utils/sessions");
const authService = require("../src/modules/auth/auth.service");
const { generateTempPassword } = require("../src/utils/password");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const API_LOG = process.env.VERIFY_API_LOG || "";
const PREFIX = "verify-flpc-";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(900); // fire-and-forget audit writes, e-mail rows and flag writes land shortly after the response
let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`; // documentation range; the API keys its rate limits on the one trusted X-Forwarded-For hop
const secrets = []; // every password this run used, searched for in the API log at the end
const newPassword = () => { const p = `Nn7#${crypto.randomBytes(9).toString("base64url")}`; secrets.push(p); return p; };

async function http(method, path, { token, body, ip } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(ip ? { "X-Forwarded-For": ip } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const login = (email, password, ip) => http("POST", "/auth/login", { body: { email, password }, ip });
const change = (email, temporaryPassword, newPw, confirm, ip) => http("POST", "/auth/change-temporary-password", { body: { email, temporaryPassword, newPassword: newPw, confirmPassword: confirm === undefined ? newPw : confirm }, ip });

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX, endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { studentId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: ids } }, { recipientEmail: { startsWith: PREFIX } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { key: { contains: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // sessions and password history cascade
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ Verify FLPC " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  try {
    const A = await prisma.institute.create({ data: { name: `ZZ Verify FLPC A ${ts}`, passwordHistoryDepth: 3 } });
    const B = await prisma.institute.create({ data: { name: `ZZ Verify FLPC B ${ts}` } });
    const E = await prisma.institute.create({ data: { name: `ZZ Verify FLPC E ${ts}`, passwordExpiryDays: 1 } });
    const D = await prisma.institute.create({ data: { name: `ZZ Verify FLPC D ${ts}`, isActive: false } });
    const mk = async (key, { instituteId = A.id, flagged = true, role = "STUDENT", extra = {} } = {}) => {
      const password = generateTempPassword();
      secrets.push(password);
      const u = await prisma.user.create({ data: { name: `ZZ FLPC ${key}`, email: `${PREFIX}${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), role, instituteId, mustChangePassword: flagged, ...extra } });
      return { id: u.id, email: u.email, password };
    };
    const dbUser = (id) => prisma.user.findUnique({ where: { id } });
    const activeSessions = (userId) => prisma.loginSession.count({ where: { userId, isActive: true } });
    const allSessions = (userId) => prisma.loginSession.count({ where: { userId } });

    // ---- 1. Signing in with a temporary password opens no session, and says only what the page needs
    const first = await mk("first");
    const ip1 = nextIp();
    const wrongFlagged = await login(first.email, "Wrong#1pass", ip1);
    const unknown = await login(`${PREFIX}nobody-${ts}@example.invalid`, "Wrong#1pass", nextIp());
    check("a wrong password for an account that must change its password is an ordinary 401", wrongFlagged.status === 401 && wrongFlagged.json && wrongFlagged.json.error === "Invalid email or password.", `status ${wrongFlagged.status}`);
    check("and reads exactly like an unknown e-mail address (nothing reveals which accounts exist)", JSON.stringify(wrongFlagged.json) === JSON.stringify(unknown.json) && wrongFlagged.status === unknown.status);
    const asked = await login(first.email, first.password, nextIp());
    check("the right temporary password answers 200 'passwordChangeRequired' with the reason", asked.status === 200 && asked.json && asked.json.passwordChangeRequired === true && asked.json.reason === "TEMPORARY_PASSWORD", `status ${asked.status} ${asked.text.slice(0, 120)}`);
    check("with NO token", !asked.json.token, `token ${JSON.stringify(asked.json.token)}`);
    check("and nothing about the account beyond the flag", JSON.stringify(Object.keys(asked.json.user || {})) === JSON.stringify(["mustChangePassword"]) && !asked.text.includes(first.email) && !asked.text.includes("ZZ FLPC"), asked.text.slice(0, 160));
    await settle();
    check("no session row was created and no sign-in was stamped", (await allSessions(first.id)) === 0 && (await dbUser(first.id)).lastLoginAt === null, `${await allSessions(first.id)} sessions`);
    const forged = await http("POST", "/auth/login", { body: { email: first.email, password: first.password, mustChangePassword: false, passwordChangeRequired: false, reason: "NONE" }, ip: nextIp() });
    check("client-supplied 'flags' in the request are ignored: the server still asks for a new password", forged.status === 200 && forged.json.passwordChangeRequired === true && !forged.json.token);
    const dash = await http("GET", "/dashboard/student", {});
    const dashNull = await http("GET", "/dashboard/student", { token: "null" });
    check("the dashboard API cannot be reached with what the login returned (no token, or the string 'null')", dash.status === 401 && dashNull.status === 401, `${dash.status}/${dashNull.status}`);

    // ---- 2. The change endpoint repeats every rule, and a rejected NEW password never uses up the budget that protects the credential
    const val = await mk("val");
    const ipV = nextIp();
    await prisma.passwordHistory.create({ data: { userId: val.id, passwordHash: await bcrypt.hash("Old#Password9x", 10) } });
    const attempts = [
      ["a mismatch is refused", () => change(val.email, val.password, "Aa1!aaaaaa", "Aa1!bbbbbb", ipV), 400, /do not match/i],
      ["no uppercase letter", () => change(val.email, val.password, "alllower1!x", undefined, ipV), 400, /uppercase/i],
      ["no lowercase letter", () => change(val.email, val.password, "ALLUPPER1!X", undefined, ipV), 400, /lowercase/i],
      ["no number", () => change(val.email, val.password, "NoDigits!!xx", undefined, ipV), 400, /number/i],
      ["no special character", () => change(val.email, val.password, "NoSpecial11xx", undefined, ipV), 400, /special/i],
      ["fewer than 8 characters", () => change(val.email, val.password, "Aa1!aaa", undefined, ipV), 400, /at least 8/i],
      ["the temporary password itself", () => change(val.email, val.password, val.password, undefined, ipV), 400, /cannot be the same/i],
      ["a password used recently", () => change(val.email, val.password, "Old#Password9x", undefined, ipV), 400, /used this password recently/i],
    ];
    for (const [label, fn, status, pattern] of attempts) {
      const r = await fn();
      check(`${label}: ${status} with a message the student can act on`, r.status === status && r.json && pattern.test(r.json.error || ""), `status ${r.status} ${r.text.slice(0, 100)}`);
    }
    const bodies = [["no body", undefined], ["missing field", { email: val.email, temporaryPassword: val.password, newPassword: "Aa1!aaaaaa" }], ["a filter object instead of an e-mail", { email: { contains: "" }, temporaryPassword: val.password, newPassword: "Aa1!aaaaaa", confirmPassword: "Aa1!aaaaaa" }], ["a number instead of a password", { email: val.email, temporaryPassword: 12345678, newPassword: "Aa1!aaaaaa", confirmPassword: "Aa1!aaaaaa" }]];
    for (const [label, body] of bodies) {
      const r = await http("POST", "/auth/change-temporary-password", { body, ip: ipV });
      check(`a malformed request (${label}) is a plain 400, not a 500`, r.status === 400, `status ${r.status}`);
    }
    const stillSame = await dbUser(val.id);
    check("none of the refused requests changed anything", (await bcrypt.compare(val.password, stillSame.passwordHash)) && stillSame.mustChangePassword === true && (await allSessions(val.id)) === 0);
    const valNew = newPassword();
    const valOk = await change(val.email, val.password, valNew, undefined, ipV);
    check("after 12 refused requests from one address (none a wrong credential) the right ones still go through: they did not use up the budget", valOk.status === 200 && !!(valOk.json && valOk.json.token), `status ${valOk.status} ${valOk.text.slice(0, 100)}`);
    await settle();
    const valAudit = await prisma.auditLog.findMany({ where: { adminId: val.id, action: "LOGIN" }, select: { details: true } });
    check("the session the change opens is recorded as the account's first login", valAudit.length === 1 && valAudit[0].details.isFirstLogin === true, JSON.stringify(valAudit));

    // ---- 3. Wrong credentials, other accounts, and accounts with nothing to change
    const w1 = await mk("w1");
    const w2 = await mk("w2");
    const plain = await mk("plain", { flagged: false });
    const ipW = nextIp();
    const wrongTemp = await change(w1.email, "Wrong#1password", newPassword(), undefined, ipW);
    const unknownChange = await change(`${PREFIX}nobody-${ts}@example.invalid`, "Wrong#1password", newPassword(), undefined, nextIp());
    check("a wrong temporary password: 401 'Invalid email or password.'", wrongTemp.status === 401 && wrongTemp.json.error === "Invalid email or password.");
    check("an unknown e-mail gets the identical answer", unknownChange.status === 401 && JSON.stringify(unknownChange.json) === JSON.stringify(wrongTemp.json));
    const crossAccount = await change(w2.email, w1.password, newPassword(), undefined, nextIp());
    check("one account's temporary password does not work on another account", crossAccount.status === 401);
    const plainChange = await change(plain.email, plain.password, newPassword(), undefined, nextIp());
    const plainRow = await dbUser(plain.id);
    check("an account with nothing to change gets the same 401 even with its right password (the route cannot be used to change a password without signing in)", plainChange.status === 401 && JSON.stringify(plainChange.json) === JSON.stringify(wrongTemp.json));
    check("and that password is untouched", await bcrypt.compare(plain.password, plainRow.passwordHash));

    // ---- 4. The whole journey for one student
    const ok = await mk("ok", { extra: { resetTokenHash: "zz-outstanding-reset", resetTokenExpiry: new Date(Date.now() + 3600000) } });
    await prisma.loginSession.create({ data: { userId: ok.id, token: `${PREFIX}held-${ts}`, ip: "198.51.100.250", device: "Desktop", browser: "Chrome", os: "Windows" } }); // someone else holding a session
    const okNew = newPassword();
    const okIp = nextIp();
    const done = await change(ok.email, ok.password, okNew, undefined, okIp);
    check("the change answers 200 with a session (token and user) like a login", done.status === 200 && !!(done.json && done.json.token) && done.json.user && done.json.user.id === ok.id, `status ${done.status} ${done.text.slice(0, 120)}`);
    check("the user comes back as a student with the flag cleared and no secrets", done.json.user.role === "STUDENT" && done.json.user.mustChangePassword === false && !("passwordHash" in done.json.user) && !done.text.includes(okNew) && !done.text.includes(ok.password));
    await settle();
    const after = await dbUser(ok.id);
    check("the new password is stored as a bcrypt hash, never in clear", after.passwordHash.startsWith("$2") && (await bcrypt.compare(okNew, after.passwordHash)) && after.passwordHash !== okNew);
    check("the temporary password no longer matches the stored hash", !(await bcrypt.compare(ok.password, after.passwordHash)));
    check("the must-change flag is cleared, the change is stamped and an outstanding reset link is dead", after.mustChangePassword === false && !!after.passwordChangedAt && after.resetTokenHash === null && after.resetTokenExpiry === null);
    check("the change is in the password history", (await prisma.passwordHistory.count({ where: { userId: ok.id } })) === 1);
    const held = await prisma.loginSession.findUnique({ where: { token: `${PREFIX}held-${ts}` } });
    check("a session someone else held was closed, and exactly one new session is open", held && held.isActive === false && (await activeSessions(ok.id)) === 1, `${await activeSessions(ok.id)} active`);
    const perms = await http("GET", "/auth/permissions", { token: done.json.token });
    check("the returned token works (the student is signed in)", perms.status === 200 && perms.json.role === "STUDENT", `status ${perms.status}`);
    const asStudent = await http("GET", "/dashboard/student", { token: done.json.token });
    check("and reaches the student dashboard API", asStudent.status === 200, `status ${asStudent.status}`);
    const relogin = await login(ok.email, okNew, nextIp());
    check("signing in again with the new password is an ordinary login (token, no change requested)", relogin.status === 200 && !!relogin.json.token && !relogin.json.passwordChangeRequired && relogin.json.user.mustChangePassword === false);
    const oldTemp = await login(ok.email, ok.password, nextIp());
    check("the old temporary password is refused", oldTemp.status === 401);
    const replay = await change(ok.email, ok.password, newPassword(), undefined, nextIp());
    check("replaying the change request with the temporary password is refused", replay.status === 401);
    const replaySame = await change(ok.email, ok.password, okNew, undefined, nextIp());
    check("even with the same new password again", replaySame.status === 401);
    check("and nothing moved", (await bcrypt.compare(okNew, (await dbUser(ok.id)).passwordHash)));
    const audit = await prisma.auditLog.findMany({ where: { adminId: ok.id }, select: { action: true, details: true, ipAddress: true } });
    const changed = audit.find((a) => a.action === "PASSWORD_CHANGED");
    check("the audit log has the password change (self-service, via the first-login step) and the sign-in", !!changed && changed.details.self === true && changed.details.via === "first_login_temporary_password" && audit.some((a) => a.action === "LOGIN"), JSON.stringify(audit.map((a) => a.action)));
    check("no password, clear or hashed, is in the audit log", !JSON.stringify(audit).includes(okNew) && !JSON.stringify(audit).includes(ok.password) && !JSON.stringify(audit).includes("$2"));
    const mails = JSON.stringify(await prisma.emailLog.findMany({ where: { studentId: ok.id } }));
    check("and none is in the e-mail log", !mails.includes(okNew) && !mails.includes(ok.password));

    // ---- 5. Two requests with the same temporary password at the same instant: exactly one wins
    const race = await mk("race");
    const rIp = nextIp();
    const [pa, pb] = [newPassword(), newPassword()];
    const results = await Promise.all([change(race.email, race.password, pa, undefined, rIp), change(race.email, race.password, pb, undefined, rIp)]);
    const statuses = results.map((r) => r.status).sort();
    check("two simultaneous changes: one succeeds (200) and one is refused (401)", statuses[0] === 200 && statuses[1] === 401, statuses.join("/"));
    const winnerIdx = results.findIndex((r) => r.status === 200);
    const raceRow = await dbUser(race.id);
    check("the stored password is the winner's, not the loser's", winnerIdx >= 0 && (await bcrypt.compare([pa, pb][winnerIdx], raceRow.passwordHash)) && !(await bcrypt.compare([pa, pb][1 - winnerIdx], raceRow.passwordHash)));
    check("and exactly one session is open", (await activeSessions(race.id)) === 1, `${await activeSessions(race.id)}`);

    // ---- 6. Deactivated accounts and institutes are refused, after the password is proved
    const gone = await mk("gone", { extra: { isActive: false } });
    const inDead = await mk("dead", { instituteId: D.id });
    const g1 = await login(gone.email, gone.password, nextIp());
    const g2 = await change(gone.email, gone.password, newPassword(), undefined, nextIp());
    const g3 = await change(inDead.email, inDead.password, newPassword(), undefined, nextIp());
    const g4 = await change(gone.email, "Wrong#1password", newPassword(), undefined, nextIp());
    check("a deactivated account gets 403 at sign-in and on the change, and its password is not changed", g1.status === 403 && g2.status === 403 && (await bcrypt.compare(gone.password, (await dbUser(gone.id)).passwordHash)));
    check("so does an account of a deactivated institute", g3.status === 403 && (await dbUser(inDead.id)).mustChangePassword === true);
    check("a wrong password on a deactivated account is still just 401 (the state is shown only to someone who knows the password)", g4.status === 401);

    // ---- 7. A password past the institute's expiry window takes the same road, with its own reason
    const stale = await mk("stale", { instituteId: E.id, flagged: false, extra: { passwordChangedAt: new Date(Date.now() - 3 * 86400000) } });
    const stOut = await login(stale.email, stale.password, nextIp());
    check("an expired password: 200 'passwordChangeRequired' with reason PASSWORD_EXPIRED and no token", stOut.status === 200 && stOut.json.passwordChangeRequired === true && stOut.json.reason === "PASSWORD_EXPIRED" && !stOut.json.token, stOut.text.slice(0, 120));
    await settle();
    check("the stored flag is set as before", (await dbUser(stale.id)).mustChangePassword === true);
    const stAgain = await login(stale.email, stale.password, nextIp());
    check("and the reason stays PASSWORD_EXPIRED once that flag is stored (the expiry is judged live)", stAgain.status === 200 && stAgain.json.reason === "PASSWORD_EXPIRED", stAgain.text.slice(0, 120));
    const stNew = newPassword();
    const stDone = await change(stale.email, stale.password, stNew, undefined, nextIp());
    check("and it can be replaced the same way", stDone.status === 200 && !!stDone.json.token);
    await settle();
    const stAudit = await prisma.auditLog.findFirst({ where: { adminId: stale.id, action: "PASSWORD_CHANGED" } });
    check("audited as an expired-password change", !!stAudit && stAudit.details.via === "expired_password");

    // ---- 8. The password changed but a session could not be opened: never reported as a failure
    const fault = await mk("fault");
    const faultNew = newPassword();
    const fakeReq = { ip: "198.51.100.200", headers: { "user-agent": "verify-first-login (Windows; Chrome/120)", "x-forwarded-for": "198.51.100.200" } };
    const realCreateSession = sessions.createSession;
    let half = null; let thrown = null;
    sessions.createSession = async () => { throw new Error("injected: session store unavailable"); };
    try { half = await authService.changeTemporaryPassword(fakeReq, { email: fault.email, temporaryPassword: fault.password, newPassword: faultNew, confirmPassword: faultNew }); } catch (err) { thrown = err; } finally { sessions.createSession = realCreateSession; }
    check("when the session cannot be opened the answer says the password WAS changed (no error thrown, no token)", !thrown && half && half.passwordChanged === true && half.signedIn === false && !half.token && /password was changed/i.test(half.message || ""), thrown ? thrown.message : JSON.stringify(half));
    await settle();
    const faultRow = await dbUser(fault.id);
    check("and it really was: new password stored, flag cleared", (await bcrypt.compare(faultNew, faultRow.passwordHash)) && faultRow.mustChangePassword === false);
    const faultLogin = await login(fault.email, faultNew, nextIp());
    check("so signing in with the new password works", faultLogin.status === 200 && !!faultLogin.json.token);

    // ---- 9. Brute force: only wrong credentials use the budget, and login and change share it
    const rl = await mk("rl");
    const rlIp = nextIp();
    for (let i = 1; i <= 5; i++) { await change(rl.email, "Wrong#1password", newPassword(), undefined, rlIp); await sleep(250); }
    const blocked = await change(rl.email, rl.password, newPassword(), undefined, rlIp);
    const blockedLogin = await login(rl.email, rl.password, rlIp);
    const elsewhere = await login(rl.email, rl.password, nextIp());
    check("five wrong temporary passwords lock the change step for that address (429), even for the right one", blocked.status === 429, `status ${blocked.status}`);
    check("the sign-in shares that budget, so a second endpoint does not double the guesses", blockedLogin.status === 429, `status ${blockedLogin.status}`);
    check("another address is not affected", elsewhere.status === 200 && elsewhere.json.passwordChangeRequired === true);
    const rl2 = await mk("rl2");
    const rl2Ip = nextIp();
    for (let i = 1; i <= 3; i++) { await login(rl2.email, "Wrong#1password", rl2Ip); await sleep(250); }
    for (let i = 1; i <= 2; i++) { await change(rl2.email, "Wrong#1password", newPassword(), undefined, rl2Ip); await sleep(250); }
    const blocked2 = await login(rl2.email, rl2.password, rl2Ip);
    check("three wrong sign-ins plus two wrong changes also fill the one budget", blocked2.status === 429, `status ${blocked2.status}`);

    // ---- 10. The administrator's credential workflow still leads here
    const adminA = await mk("admin", { flagged: false, role: "INSTITUTE_ADMIN" });
    const adminSession = await login(adminA.email, adminA.password, nextIp());
    const target = await mk("target", { flagged: false, extra: { rollNumber: `FLPC-${ts}` } });
    const reset = await http("POST", `/users/${target.id}/reset-password`, { token: adminSession.json && adminSession.json.token, body: {} });
    check("an administrator can still reset a student's password and gets the generated one", reset.status === 200 && typeof (reset.json && reset.json.defaultPassword) === "string", `status ${reset.status}`);
    if (reset.json && reset.json.defaultPassword) {
      secrets.push(reset.json.defaultPassword);
      const viaReset = await login(target.email, reset.json.defaultPassword, nextIp());
      check("signing in with it asks for a new password (no session)", viaReset.status === 200 && viaReset.json.passwordChangeRequired === true && !viaReset.json.token);
      const targetNew = newPassword();
      const viaChange = await change(target.email, reset.json.defaultPassword, targetNew, undefined, nextIp());
      check("and the student then chooses their own and is signed in", viaChange.status === 200 && !!viaChange.json.token);
      // A student cannot reach another institute's people with the session the change gave them.
      const other = await mk("other", { instituteId: B.id, flagged: false });
      const peek = await http("GET", `/users/${other.id}`, { token: viaChange.json.token });
      check("that session cannot read an account of another institute", peek.status === 403 || peek.status === 404, `status ${peek.status}`);
    }

    // ---- 11. Passwords never reach the API's log
    if (API_LOG && fs.existsSync(API_LOG)) {
      const log = fs.readFileSync(API_LOG, "utf8");
      const leaked = secrets.filter((s) => log.includes(s));
      check(`none of the ${secrets.length} passwords used in this run appears in the API log (${API_LOG})`, leaked.length === 0, leaked.length ? `${leaked.length} found` : "");
    } else {
      console.log("NOT RUN  the API log search (VERIFY_API_LOG is not set or the file does not exist)");
    }
  } finally {
    await cleanup().catch((err) => console.error("cleanup failed:", err.message));
  }
  console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
