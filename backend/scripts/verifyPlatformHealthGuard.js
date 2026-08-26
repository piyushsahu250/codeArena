// One-off: the DB enforces exactly one SUPER_ADMIN account (a real unique constraint on User.role
// — confirmed live: attempting to create a second SUPER_ADMIN via mkTempBrowserVerifyUser.js failed
// with P2002 on the `role` field), so a temp SUPER_ADMIN account cannot be created for verification.
// This script instead confirms the negative case: a non-SUPER_ADMIN role is correctly blocked from
// GET /api/platform-health/latest and /api/platform-health (both routes are SUPER_ADMIN-only).
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");

const API_BASE = "http://127.0.0.1:4000/api";

async function main() {
  const institute = await prisma.institute.findFirst();
  const email = `verify-health-guard-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: "Verify Guard", email, passwordHash, role: "INSTITUTE_ADMIN", instituteId: institute.id } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const r1 = await fetch(`${API_BASE}/platform-health/latest`, { headers });
    console.log("INSTITUTE_ADMIN GET /platform-health/latest ->", r1.status, "(expect 403)");
    const r2 = await fetch(`${API_BASE}/platform-health`, { headers });
    console.log("INSTITUTE_ADMIN GET /platform-health ->", r2.status, "(expect 403)");
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
