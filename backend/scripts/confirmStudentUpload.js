// Uploads a student file through the live bulk-upload endpoints (preview -> confirm) and emails each
// student their one-time credentials via the platform's normal pipeline. Gates: mail transport must be
// configured, and preview must show every row valid -- otherwise NOTHING is created. Passwords are never
// printed or written anywhere by this script (they exist only in the credentials emails).
const fs = require("fs"), crypto = require("crypto"), bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const file = process.argv[2];
  const pw = crypto.randomBytes(18).toString("base64url");
  const email = `bulk-upload-actor-${Date.now()}@example.invalid`;
  const actor = await prisma.user.create({ data: { name: "Claude (bulk upload run on admin's request)", email, passwordHash: await bcrypt.hash(pw, 8), role: "ADMIN", mustChangePassword: false } });
  try {
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).json();
    const H = { Authorization: `Bearer ${l.token}` };
    const st = await (await fetch(`${BASE}/admin/email-logs/status`, { headers: H })).json();
    console.log("MAIL STATUS", JSON.stringify({ connected: st.connected, sender: st.senderEmail, lastSuccessfulAt: st.lastSuccessfulAt, failed: st.failedCount, queued: st.queuedCount }));
    if (!st.connected) { console.log("ABORT: mail transport not configured; nothing created"); return; }

    const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync(file)]), "upload.xlsx");
    const pr = await (await fetch(`${BASE}/users/bulk-upload/preview`, { method: "POST", headers: H, body: fd })).json();
    console.log("PREVIEW", JSON.stringify({ total: pr.totalRows, valid: pr.validCount, invalid: pr.invalidCount, duplicate: pr.duplicateCount }));
    if (pr.validCount !== pr.totalRows || pr.invalidCount || pr.duplicateCount) { console.log("ABORT: not every row is valid; nothing created"); return; }

    const cr = await fetch(`${BASE}/users/bulk-upload/confirm`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ rows: pr.rows, sendCredentials: true }) });
    const res = await cr.json();
    console.log("CONFIRM HTTP", cr.status, JSON.stringify({ total: res.total, created: res.createdCount, duplicates: res.duplicateCount, errors: res.errorCount, emailsQueued: res.emailsQueued }));
    if (res.errorCount) console.log("ERRORS:", JSON.stringify(res.errors.slice(0, 10)));

    if (res.batchId) {
      let s;
      for (let i = 0; i < 40; i++) {
        await sleep(5000);
        s = await (await fetch(`${BASE}/admin/email-logs/batch/${res.batchId}/summary`, { headers: H })).json();
        if (!s.pending) break;
      }
      console.log("EMAIL BATCH", JSON.stringify(s));
      const failed = await prisma.emailLog.findMany({ where: { batchId: res.batchId, status: "FAILED" }, select: { recipientEmail: true, errorMessage: true }, take: 15 }).catch(() => []);
      if (failed.length) console.log("FAILED EMAILS:", JSON.stringify(failed));
    }
    const groups = await prisma.academicGroup.findMany({ where: { institute: { name: "Sanjivani University" }, department: { name: "Artificial Intelligence and Machine Learning" }, batch: { in: ["2025-2028", "2024-2028"] } }, include: { _count: { select: { users: true } }, department: true } });
    console.log("GROUPS", JSON.stringify(groups.map((g) => ({ batch: g.batch, section: g.section, dept: g.department.name, students: g._count.users }))));
    const total = await prisma.user.count({ where: { registrationNumber: { in: pr.rows.map((r) => r.registrationNumber) }, role: "STUDENT", mustChangePassword: true, isActive: true } });
    console.log("students now in DB (active, must change password on first login):", total);
  } finally {
    await prisma.loginSession.deleteMany({ where: { userId: actor.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: actor.id } }).catch(() => {});
  }
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
