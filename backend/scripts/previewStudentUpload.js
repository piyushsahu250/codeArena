// Dry-run a student upload file through the live /users/bulk-upload/preview endpoint (creates nothing).
const fs = require("fs"), crypto = require("crypto"), bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
(async () => {
  const file = process.argv[2];
  const pw = crypto.randomBytes(18).toString("base64url");
  const email = `verify-preview-${Date.now()}@example.invalid`;
  const u = await prisma.user.create({ data: { name: "Verify Preview", email, passwordHash: await bcrypt.hash(pw, 6), role: "ADMIN", mustChangePassword: false } });
  try {
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) })).json();
    const fd = new FormData(); fd.append("file", new Blob([fs.readFileSync(file)]), "upload.xlsx");
    const r = await fetch(`${BASE}/users/bulk-upload/preview`, { method: "POST", headers: { Authorization: `Bearer ${l.token}` }, body: fd });
    const b = await r.json();
    console.log("HTTP", r.status, JSON.stringify({ total: b.totalRows, valid: b.validCount, invalid: b.invalidCount, duplicate: b.duplicateCount, error: b.error }));
    const bad = (b.rows || []).filter((x) => x.status !== "valid");
    console.log("non-valid rows:", JSON.stringify(bad.map((x) => ({ row: x.row, name: x.name, status: x.status, reason: x.reason })).slice(0, 20)));
    const sample = (b.rows || []).slice(0, 3).map((x) => ({ name: x.name, prn: x.registrationNumber, roll: x.rollNumberPreview, batch: x.batchYear, dept: x.department, section: x.section, program: x.program, gender: x.gender }));
    console.log("sample:", JSON.stringify(sample));
    const rolls = (b.rows || []).map((x) => x.rollNumberPreview);
    console.log("distinct roll previews:", new Set(rolls).size, "of", rolls.length);
  } finally {
    await prisma.loginSession.deleteMany({ where: { userId: u.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }
  process.exit(0);
})();
