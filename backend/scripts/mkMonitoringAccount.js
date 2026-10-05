// One-off: create a long-lived (12h token) authenticated account purely so an external monitoring
// loop can poll GET /api/submissions/queue-status (any authenticated role works — no STUDENT-only
// gate on that route) during tomorrow's exam window. Not deleted by this script — the monitoring
// session cleans it up when done.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

async function main() {
  const institute = await prisma.institute.findFirst({ where: { isActive: true } });
  const email = `queue-monitor-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: "Queue Monitor", email, passwordHash, role: "STAFF", instituteId: institute?.id || null, mustChangePassword: false },
  });
  console.log(JSON.stringify({ id: user.id, email, password }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
