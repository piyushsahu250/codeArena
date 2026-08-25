// One-off: a SMALL, safe concurrency smoke test (tens of requests, not thousands) — not a real
// load test at production scale (500-5000 concurrent users would risk degrading the live service
// on this resource-constrained instance and needs dedicated infra/a maintenance window instead,
// per the explicit decision made before running this). Measures P50/P95/max latency and error rate
// for a genuinely low-stakes endpoint (health check, no DB) and one real authenticated DB-backed
// read, both against the live production container.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function fire(n, fn) {
  const results = await Promise.allSettled(Array.from({ length: n }, () => {
    const started = Date.now();
    return fn().then((res) => ({ ok: res.ok, status: res.status, ms: Date.now() - started }));
  }));
  const timings = results.map((r) => (r.status === "fulfilled" ? r.value.ms : null)).filter((x) => x !== null).sort((a, b) => a - b);
  const errors = results.filter((r) => r.status === "rejected" || !r.value.ok).length;
  return {
    n, errors, errorRate: `${((errors / n) * 100).toFixed(1)}%`,
    p50: percentile(timings, 50), p95: percentile(timings, 95), max: timings[timings.length - 1], min: timings[0],
  };
}

async function main() {
  console.log("--- 30 concurrent GET /api/health (no DB, baseline) ---");
  console.log(await fire(30, () => fetch("http://127.0.0.1:4000/api/health")));

  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  const email = `verify-load-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: "Verify Load Temp", email, passwordHash, role: "STUDENT", instituteId: institute.id } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;

  try {
    console.log("\n--- 30 concurrent authenticated GET /api/interview/companies (real DB read) ---");
    console.log(await fire(30, () => fetch("http://127.0.0.1:4000/api/interview/companies", { headers: { Authorization: `Bearer ${token}` } })));

    console.log("\n--- 20 concurrent authenticated GET /api/resume/me (real DB read + decrypt path) ---");
    console.log(await fire(20, () => fetch("http://127.0.0.1:4000/api/resume/me", { headers: { Authorization: `Bearer ${token}` } })));
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
