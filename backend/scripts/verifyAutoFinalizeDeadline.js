// Database-backed check of the auto-finalize scheduler against a closed test window: an attempt whose own deadline (startedAt + durationMin) has NOT passed
// must stay IN_PROGRESS even though the window ended; one whose own deadline has passed is closed AUTO_SUBMITTED. Disposable data only
// (@example.invalid users, a "ZZ-VERIFY" test), removed afterwards.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { runOnce } = require("../src/utils/testAttemptAutoFinalizeScheduler");

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const MIN = 60 * 1000;

async function cleanup() {
  const tests = await prisma.test.findMany({ where: { title: { startsWith: "ZZ-VERIFY auto-finalize" } }, select: { id: true } });
  const ids = tests.map((t) => t.id);
  if (ids.length) {
    await prisma.testAttempt.deleteMany({ where: { testId: { in: ids } } });
    await prisma.test.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-autofin-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { code: "ZZVAF" } });
}

async function main() {
  await cleanup();
  const institute = await prisma.institute.create({ data: { name: "ZZ-VERIFY auto-finalize institute", code: "ZZVAF" } });
  const mkUser = async (tag, role) => prisma.user.create({
    data: { name: `Verify AutoFin ${tag}`, email: `verify-autofin-${tag}-${Date.now()}@example.invalid`, passwordHash: await bcrypt.hash(crypto.randomBytes(18).toString("base64url"), 4), role, instituteId: institute.id, mustChangePassword: false },
  });
  const staff = await mkUser("staff", "INSTITUTE_ADMIN");
  const s1 = await mkUser("s1", "STUDENT"); const s2 = await mkUser("s2", "STUDENT"); const s3 = await mkUser("s3", "STUDENT");
  const now = Date.now();
  const mkTest = (suffix, durationMin) => prisma.test.create({
    data: { title: `ZZ-VERIFY auto-finalize ${suffix}`, durationMin, startTime: new Date(now - 300 * MIN), endTime: new Date(now - 5 * MIN), isPublished: true, createdById: staff.id, instituteId: institute.id },
  });
  const long = await mkTest("long", 120);
  const short = await mkTest("short", 10);
  const lateStarter = await prisma.testAttempt.create({ data: { testId: long.id, studentId: s1.id, status: "IN_PROGRESS", startedAt: new Date(now - 30 * MIN) } });
  const expired = await prisma.testAttempt.create({ data: { testId: long.id, studentId: s2.id, status: "IN_PROGRESS", startedAt: new Date(now - 200 * MIN) } });
  const shortFresh = await prisma.testAttempt.create({ data: { testId: short.id, studentId: s3.id, status: "IN_PROGRESS", startedAt: new Date(now - 2 * MIN) } });

  await runOnce();
  const status = async (a) => (await prisma.testAttempt.findUnique({ where: { id: a.id } })).status;
  check("window closed, own 120-minute clock has 90 minutes left: attempt is NOT submitted", (await status(lateStarter)) === "IN_PROGRESS");
  check("window closed, own 10-minute clock has 8 minutes left: attempt is NOT submitted", (await status(shortFresh)) === "IN_PROGRESS");
  check("window closed and own deadline long passed: attempt is closed AUTO_SUBMITTED", (await status(expired)) === "AUTO_SUBMITTED");
  await runOnce();
  check("a second sweep changes nothing further (idempotent)", (await status(lateStarter)) === "IN_PROGRESS" && (await status(expired)) === "AUTO_SUBMITTED");

  await cleanup();
  if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
  console.log("auto-finalize deadline verification: all passed");
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); }).finally(() => prisma.$disconnect());
