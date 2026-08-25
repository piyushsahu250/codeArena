// Follow-up: smallLoadTest.js found 20 concurrent GET /resume/me requests (same user) failing 85%
// of the time. Capture actual status codes + response bodies to find the real cause instead of
// guessing.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  const email = `verify-diag-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: "Diag Load Temp", email, passwordHash, role: "STUDENT", instituteId: institute.id } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;

  try {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => fetch("http://127.0.0.1:4000/api/resume/me", { headers: { Authorization: `Bearer ${token}` } }))
    );
    const statusCounts = {};
    const sampleBodies = {};
    for (const r of results) {
      if (r.status === "rejected") {
        statusCounts["NETWORK_ERROR"] = (statusCounts["NETWORK_ERROR"] || 0) + 1;
        sampleBodies["NETWORK_ERROR"] = r.reason?.message;
        continue;
      }
      const status = r.value.status;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      if (!sampleBodies[status]) {
        try { sampleBodies[status] = await r.value.clone().json(); } catch { sampleBodies[status] = await r.value.clone().text(); }
      }
    }
    console.log("STATUS COUNTS:", JSON.stringify(statusCounts));
    console.log("SAMPLE BODIES:", JSON.stringify(sampleBodies, null, 2));
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
