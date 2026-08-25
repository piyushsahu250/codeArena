// One-off verification script for the /admin/stats institute-scoping fix.
// Creates a temp INSTITUTE_ADMIN user scoped to "Testing Institute", issues a real session via
// the same createSession() a real login uses, hits GET /api/admin/stats over loopback, prints the
// result, then deletes ONLY the exact session row it created (by jti) and the temp user.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  if (!institute) throw new Error("Testing Institute not found");

  const email = `verify-stats-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({
    data: {
      name: "Verify Stats Temp",
      email,
      passwordHash,
      role: "INSTITUTE_ADMIN",
      instituteId: institute.id,
    },
  });

  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;

  try {
    const res = await fetch("http://127.0.0.1:4000/api/admin/stats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    console.log("STATUS", res.status);
    console.log("BODY", JSON.stringify(body, null, 2));

    const platformCounts = await prisma.$transaction([
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.user.count({ where: { role: "STUDENT", instituteId: institute.id } }),
    ]);
    console.log("PLATFORM_TOTAL_STUDENTS", platformCounts[0]);
    console.log("TESTING_INSTITUTE_STUDENTS", platformCounts[1]);
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
