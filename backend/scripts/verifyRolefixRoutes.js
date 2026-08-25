// One-off verification for the staffClerk.js / institutes.js / interview.js etc. role-gate fixes.
// Creates a temp INSTITUTE_ADMIN scoped to Testing Institute, hits a sample of the newly-extended
// routes with a real session, confirms 200 instead of the previous 403, then cleans up by exact
// jti + userId (brand-new user, no pre-existing sessions to disturb).
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  if (!institute) throw new Error("Testing Institute not found");

  const email = `verify-rolefix-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({
    data: { name: "Verify Rolefix Temp", email, passwordHash, role: "INSTITUTE_ADMIN", instituteId: institute.id },
  });

  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const checks = [
      ["GET", "/api/institutes"],
      ["GET", "/api/staff-clerk/overview"],
      ["GET", "/api/staff-clerk"],
      ["GET", "/api/companies"],
      ["GET", "/api/interview/admin/questions"],
      ["GET", "/api/resume/admin/stats"],
      ["GET", "/api/placement/analytics/registration"],
    ];
    for (const [method, path] of checks) {
      const res = await fetch(`http://127.0.0.1:4000${path}`, { method, headers });
      console.log(method, path, "->", res.status);
    }
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
