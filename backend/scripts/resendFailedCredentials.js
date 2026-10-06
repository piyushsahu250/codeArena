// Re-issues credentials to Sanjivani students who were created recently, have NEVER logged in, and have no
// SUCCESSFUL credentials email (failed, still pending, or never attempted). Each gets a fresh unique random
// password via the platform's own bulk-regenerate-password + email path. Paced: small chunks with a pause
// between them, and the run STOPS at the first chunk that hits a Gmail limit so it never hammers a limited
// account. Passwords are never printed. Usage: node resendFailedCredentials.js [chunkSize=20] [pauseSec=60]
const crypto = require("crypto"), bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHUNK = Number(process.argv[2]) || 20, PAUSE_MS = (Number(process.argv[3]) || 60) * 1000;
(async () => {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const students = await prisma.user.findMany({ where: { role: "STUDENT", lastLoginAt: null, mustChangePassword: true, createdAt: { gte: since }, institute: { name: "Sanjivani University" } }, select: { id: true, department: true, batchYear: true } });
  const sent = await prisma.emailLog.findMany({ where: { studentId: { in: students.map((s) => s.id) }, emailType: { in: ["CREDENTIALS", "CREDENTIALS_RESEND"] }, status: "SENT", createdAt: { gte: since } }, select: { studentId: true } });
  const okSet = new Set(sent.map((s) => s.studentId));
  const pending = await prisma.emailLog.count({ where: { status: { in: ["PENDING", "RETRYING"] } } });
  const targets = students.filter((s) => !okSet.has(s.id));
  console.log(`unactivated recent students: ${students.length}; already have a successful credentials email: ${okSet.size}; to send: ${targets.length}; emails still pending in queue: ${pending}`);
  if (pending > 0) { console.log("ABORT: mail queue still has pending emails; wait for it to drain"); return; }
  if (targets.length === 0) return;

  const pw = crypto.randomBytes(18).toString("base64url");
  const actor = await prisma.user.create({ data: { name: "Claude (credentials resend on admin's request)", email: `resend-actor-${Date.now()}@example.invalid`, passwordHash: await bcrypt.hash(pw, 8), role: "ADMIN", mustChangePassword: false } });
  let totalSent = 0, totalFailed = 0;
  try {
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: actor.email, password: pw }) })).json();
    const H = { Authorization: `Bearer ${l.token}`, "Content-Type": "application/json" };
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      const r = await fetch(`${BASE}/users/bulk-regenerate-password`, { method: "POST", headers: H, body: JSON.stringify({ studentIds: chunk.map((c) => c.id), sendEmail: true }) });
      const b = await r.json();
      let s = { sent: 0, failed: 0, pending: 1 };
      for (let k = 0; k < 60 && b.batchId; k++) { await sleep(3000); s = await (await fetch(`${BASE}/admin/email-logs/batch/${b.batchId}/summary`, { headers: H })).json(); if (!s.pending) break; }
      totalSent += s.sent; totalFailed += s.failed;
      console.log(`chunk ${i / CHUNK + 1}: reset=${b.results?.length} sent=${s.sent} failed=${s.failed}`);
      if (s.failed > 0) {
        const bad = await prisma.emailLog.findMany({ where: { batchId: b.batchId, status: "FAILED" }, select: { errorMessage: true }, take: 1 });
        console.log("STOPPING: first failures in this chunk:", String(bad[0]?.errorMessage || "").slice(0, 160));
        break;
      }
      if (i + CHUNK < targets.length) await sleep(PAUSE_MS);
    }
  } finally {
    await prisma.loginSession.deleteMany({ where: { userId: actor.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: actor.id } }).catch(() => {});
  }
  console.log(`DONE. sent=${totalSent} failed=${totalFailed}`);
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
