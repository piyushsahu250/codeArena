// Verifies the module-coding auto-finalize sweep with one disposable student (removed at the end) and attempts on an existing assessment. The attempts have no
// questions, so they grade to 0 and cannot pass, issue a certificate or change anyone's module access.
//   node scripts/verifyModuleCodingSweep.js
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { sweepExpiredModuleCodingAttempts } = require("../src/utils/testAttemptAutoFinalizeScheduler");

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); if (!ok) failed++; };

(async () => {
  const test = await prisma.moduleCodingTest.findFirst({ select: { id: true, timeLimitMin: true } });
  if (!test) { console.log("SKIP  no module coding assessment exists on this database"); process.exit(0); }
  const limit = test.timeLimitMin || 45;
  const ts = Date.now();
  const user = await prisma.user.create({ data: { name: "ZZ Sweep Check", email: `zz-sweep-${ts}@example.invalid`, passwordHash: await bcrypt.hash(crypto.randomBytes(12).toString("hex"), 8), role: "STUDENT", mustChangePassword: false } });
  const mk = (minutesAgo, n) => prisma.moduleCodingAttempt.create({ data: { moduleCodingTestId: test.id, studentId: user.id, attemptNumber: n, status: "IN_PROGRESS", startedAt: new Date(Date.now() - minutesAgo * 60000) } });
  try {
    const justExpired = await mk(limit + 10, 1);           // expired 10 minutes ago: must be closed
    const stillOpen = await mk(Math.max(1, limit - 10), 2); // 10 minutes left: must be left alone
    const oldBacklog = await mk(limit * 1 + 100 * 60, 3);   // expired ~100 hours ago: historical backlog, must be left alone
    const r = await sweepExpiredModuleCodingAttempts({ studentId: user.id });
    const status = async (a) => (await prisma.moduleCodingAttempt.findUnique({ where: { id: a.id }, select: { status: true, passed: true } }));
    const s1 = await status(justExpired), s2 = await status(stillOpen), s3 = await status(oldBacklog);
    check("an attempt that expired 10 minutes ago is closed", s1.status !== "IN_PROGRESS", s1.status);
    check("a closed attempt with no work cannot pass", s1.passed === false);
    check("an attempt still inside its time limit is left alone", s2.status === "IN_PROGRESS");
    check("an attempt that expired about 100 hours ago is left alone (historical backlog needs review)", s3.status === "IN_PROGRESS");
    check("sweep reports what it closed", r.closed >= 1, JSON.stringify(r));
    const again = await sweepExpiredModuleCodingAttempts({ studentId: user.id });
    const s1b = await status(justExpired);
    check("running the sweep again changes nothing (idempotent)", s1b.status === s1.status, JSON.stringify(again));
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } }); // cascades the disposable attempts
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
