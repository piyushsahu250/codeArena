// Live check: the "must change password" flag and the forgot-password flow. REQUESTING a reset (POST /auth/forgot-password) must never clear the flag; COMPLETING one
// (POST /auth/reset-password with the e-mailed token) clears it, because the person has then chosen their own password and the server has confirmed it. REGRESSION: a completed
// reset left the flag set, so a student who had just chosen their own password through the link was asked to choose another at their next sign-in.
// A flagged account that has only asked for a link is still held to the first-login step at sign-in (no session, "passwordChangeRequired").
// Throwaway institute and accounts (prefix verify-rcf-); cleans up after itself. Needs the API on localhost:4000 (or VERIFY_BASE).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { generateTempPassword } = require("../src/utils/password");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
const PREFIX = "verify-rcf-";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ipSeq = 0;
const nextIp = () => `198.51.101.${++ipSeq}`;
async function post(path, body, ip = nextIp()) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body) });
  const text = await res.text().catch(() => "");
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX, endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { studentId: { in: ids } }] } });
  await prisma.emailLog.deleteMany({ where: { OR: [{ studentId: { in: ids } }, { recipientEmail: { startsWith: PREFIX } }] } });
  await prisma.rateLimitHit.deleteMany({ where: { OR: [{ key: { contains: PREFIX } }, { key: { contains: "198.51.101." } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ Verify RCF " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  try {
    const inst = await prisma.institute.create({ data: { name: `ZZ Verify RCF ${ts}` } });
    const mk = async (key, flagged) => {
      const password = generateTempPassword();
      const u = await prisma.user.create({ data: { name: `ZZ RCF ${key}`, email: `${PREFIX}${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT", instituteId: inst.id, mustChangePassword: flagged } });
      return { id: u.id, email: u.email, password };
    };
    const row = (id) => prisma.user.findUnique({ where: { id }, select: { mustChangePassword: true, passwordHash: true, resetTokenHash: true } });

    // ---- a flagged account asks for a link: nothing about its state changes
    const flagged = await mk("flagged", true);
    const asked = await post("/auth/forgot-password", { email: flagged.email });
    await sleep(900);
    const afterAsk = await row(flagged.id);
    check("asking for a reset link answers 200 as for any address", asked.status === 200, `status ${asked.status}`);
    check("a link was issued, and the must-change flag is STILL set", !!afterAsk.resetTokenHash && afterAsk.mustChangePassword === true);
    check("the temporary password still works, and still asks for a new password (no session)", await (async () => { const r = await post("/auth/login", { email: flagged.email, password: flagged.password }); return r.status === 200 && r.json.passwordChangeRequired === true && !r.json.token; })());

    // ---- completing the reset clears the flag, in the same step as the new password
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({ where: { id: flagged.id }, data: { resetTokenHash: sha(token), resetTokenExpiry: new Date(Date.now() + 3600000) } }); // the e-mailed token itself is not readable from here
    const newPw = `Rr7#${crypto.randomBytes(8).toString("base64url")}`;
    const done = await post("/auth/reset-password", { token, newPassword: newPw });
    check("completing the reset answers 200", done.status === 200, `status ${done.status} ${done.text.slice(0, 100)}`);
    const afterDone = await row(flagged.id);
    check("the flag is cleared and the new password is stored", afterDone.mustChangePassword === false && (await bcrypt.compare(newPw, afterDone.passwordHash)));
    const signedIn = await post("/auth/login", { email: flagged.email, password: newPw });
    check("the next sign-in is an ordinary one: a session, and no request for another password", signedIn.status === 200 && !!signedIn.json.token && !signedIn.json.passwordChangeRequired && signedIn.json.user.mustChangePassword === false, `status ${signedIn.status} ${signedIn.text.slice(0, 100)}`);
    const old = await post("/auth/login", { email: flagged.email, password: flagged.password });
    check("the old temporary password no longer works", old.status === 401);

    // ---- a refused reset changes nothing
    const other = await mk("other", true);
    const bad = await post("/auth/reset-password", { token: "not-a-real-token", newPassword: newPw });
    const weak = await (async () => { const t = crypto.randomBytes(32).toString("hex"); await prisma.user.update({ where: { id: other.id }, data: { resetTokenHash: sha(t), resetTokenExpiry: new Date(Date.now() + 3600000) } }); return post("/auth/reset-password", { token: t, newPassword: "weak" }); })();
    const afterBad = await row(other.id);
    check("an invalid token and a weak password are refused (400)", bad.status === 400 && weak.status === 400, `${bad.status}/${weak.status}`);
    check("and the flag stays set, the password unchanged", afterBad.mustChangePassword === true && (await bcrypt.compare(other.password, afterBad.passwordHash)));

    // ---- an account that was never flagged is unaffected
    const plain = await mk("plain", false);
    const t2 = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({ where: { id: plain.id }, data: { resetTokenHash: sha(t2), resetTokenExpiry: new Date(Date.now() + 3600000) } });
    const pw2 = `Rr8#${crypto.randomBytes(8).toString("base64url")}`;
    const r2 = await post("/auth/reset-password", { token: t2, newPassword: pw2 });
    check("an ordinary account's reset still works and leaves the flag clear", r2.status === 200 && (await row(plain.id)).mustChangePassword === false);
  } finally {
    await cleanup().catch((err) => console.error("cleanup failed:", err.message));
  }
  console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
