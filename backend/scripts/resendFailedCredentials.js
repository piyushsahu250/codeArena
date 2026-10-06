// Re-issues credentials ONLY to students whose account-creation credentials email FAILED and who have
// never logged in (so they cannot be using the original password). Uses the platform's own
// bulk-regenerate-password + email path (unique random password per student). Passwords are never printed.
const crypto = require("crypto"), bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const failed = await prisma.emailLog.findMany({ where: { emailType: "CREDENTIALS", status: "FAILED", createdAt: { gte: since }, studentId: { not: null } }, select: { studentId: true } });
  const ids = [...new Set(failed.map((f) => f.studentId))];
  const students = await prisma.user.findMany({ where: { id: { in: ids }, role: "STUDENT", lastLoginAt: null, mustChangePassword: true, institute: { name: "Sanjivani University" } }, select: { id: true, email: true } });
  console.log(`failed-credential students in last 24h: ${ids.length}; eligible (never logged in, Sanjivani): ${students.length}`);
  if (students.length === 0) return;
  // Skip anyone who has since received a successful credentials email (so nobody is reset twice).
  const ok = await prisma.emailLog.findMany({ where: { studentId: { in: students.map((s) => s.id) }, emailType: { in: ["CREDENTIALS", "CREDENTIALS_RESEND"] }, status: "SENT", createdAt: { gte: since } }, select: { studentId: true } });
  const okSet = new Set(ok.map((o) => o.studentId));
  const targets = students.filter((s) => !okSet.has(s.id));
  console.log("to resend:", targets.length, "(already received a successful email since:", okSet.size + ")");
  if (targets.length === 0) return;

  const pw = crypto.randomBytes(18).toString("base64url");
  const actor = await prisma.user.create({ data: { name: "Claude (credentials resend on admin's request)", email: `resend-actor-${Date.now()}@example.invalid`, passwordHash: await bcrypt.hash(pw, 8), role: "ADMIN", mustChangePassword: false } });
  try {
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: actor.email, password: pw }) })).json();
    const H = { Authorization: `Bearer ${l.token}`, "Content-Type": "application/json" };
    const r = await fetch(`${BASE}/users/bulk-regenerate-password`, { method: "POST", headers: H, body: JSON.stringify({ studentIds: targets.map((t) => t.id), sendEmail: true }) });
    const b = await r.json();
    console.log("RESEND HTTP", r.status, JSON.stringify({ reset: b.results?.length, failedIds: b.failedIds?.length, emailsQueued: b.emailsQueued }));
    if (b.batchId) {
      let s;
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        s = await (await fetch(`${BASE}/admin/email-logs/batch/${b.batchId}/summary`, { headers: H })).json();
        if (!s.pending) break;
      }
      console.log("EMAIL BATCH", JSON.stringify(s));
      const bad = await prisma.emailLog.findMany({ where: { batchId: b.batchId, status: "FAILED" }, select: { recipientEmail: true, errorMessage: true }, take: 5 });
      if (bad.length) console.log("STILL FAILED sample:", JSON.stringify(bad).slice(0, 600));
    }
  } finally {
    await prisma.loginSession.deleteMany({ where: { userId: actor.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: actor.id } }).catch(() => {});
  }
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
