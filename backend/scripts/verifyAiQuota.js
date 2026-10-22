// Live, database-backed check of the AI daily quota counting (services/ai/rateLimits.js): the per-user cap, the institute cap, and what counts toward them.
// REGRESSION (2026-10 audit): there was no per-user cap, and "invalid response" bookkeeping rows were counted as calls. Uses throwaway user and institute ids (AiUsageLog has no
// foreign keys) and deletes its rows afterwards. It never calls the AI provider.
const prisma = require("../src/prisma");
const { assertWithinDailyQuota, PER_USER_DAILY_LIMIT, PER_INSTITUTE_DAILY_LIMIT } = require("../src/services/ai/rateLimits");

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const outcome = async (args) => { try { await assertWithinDailyQuota(args); return "allowed"; } catch (e) { return e.quotaExceeded || `error: ${e.message}`; } };
const rows = (n, base) => Array.from({ length: n }, () => ({ feature: "verify_ai_quota", provider: "gemini", model: "test", success: true, latencyMs: 1, ...base }));
const PREFIX = "zz-aiq-";
const cleanup = () => prisma.aiUsageLog.deleteMany({ where: { OR: [{ userId: { startsWith: PREFIX } }, { instituteId: { startsWith: PREFIX } }] } });

(async () => {
  await cleanup();
  const ts = Date.now();
  const user = `${PREFIX}user-${ts}`, user2 = `${PREFIX}user2-${ts}`, user3 = `${PREFIX}user3-${ts}`, inst = `${PREFIX}inst-${ts}`, inst2 = `${PREFIX}inst2-${ts}`;
  try {
    check("a user with no usage today is allowed", (await outcome({ userId: user, instituteId: inst2 })) === "allowed");

    await prisma.aiUsageLog.createMany({ data: rows(PER_USER_DAILY_LIMIT - 1, { userId: user, instituteId: inst2 }) });
    check(`${PER_USER_DAILY_LIMIT - 1} calls today: still allowed (one below the per-user cap)`, (await outcome({ userId: user, instituteId: inst2 })) === "allowed");
    await prisma.aiUsageLog.create({ data: rows(1, { userId: user, instituteId: inst2 })[0] });
    const atCap = await outcome({ userId: user, instituteId: inst2 });
    check(`${PER_USER_DAILY_LIMIT} calls today: refused with a USER quota error`, atCap === "USER", atCap);
    check("another user at the same institute is unaffected by that user's cap", (await outcome({ userId: user2, instituteId: inst2 })) === "allowed");
    check("a call with no user id (the scheduled health check) is not subject to the per-user cap", (await outcome({ instituteId: inst2 })) === "allowed");

    // FAILED provider calls count (a failed call still used a slot), INVALID_RESPONSE bookkeeping rows do not.
    await prisma.aiUsageLog.createMany({ data: rows(PER_USER_DAILY_LIMIT - 1, { userId: user3, success: false, errorType: "RATE_LIMITED" }) });
    check("failed provider calls count toward the cap (one below: allowed)", (await outcome({ userId: user3 })) === "allowed");
    await prisma.aiUsageLog.createMany({ data: rows(60, { userId: user3, success: false, errorType: "INVALID_RESPONSE", latencyMs: 0 }) });
    check("60 INVALID_RESPONSE bookkeeping rows are not counted: still allowed", (await outcome({ userId: user3 })) === "allowed");
    await prisma.aiUsageLog.create({ data: rows(1, { userId: user3, success: false, errorType: "TIMEOUT" })[0] });
    check("one more real failed call reaches the cap", (await outcome({ userId: user3 })) === "USER");

    // institute budget
    await prisma.aiUsageLog.createMany({ data: rows(PER_INSTITUTE_DAILY_LIMIT, { instituteId: inst }) });
    const instOut = await outcome({ userId: `${PREFIX}fresh-${ts}`, instituteId: inst });
    check(`${PER_INSTITUTE_DAILY_LIMIT} calls for one institute today: a fresh user there is refused with an INSTITUTE quota error`, instOut === "INSTITUTE", instOut);
    check("an institute with no usage is not affected", (await outcome({ userId: `${PREFIX}fresh2-${ts}`, instituteId: `${PREFIX}inst3-${ts}` })) === "allowed");

    // rows from earlier days do not count
    const old = `${PREFIX}old-${ts}`;
    await prisma.aiUsageLog.createMany({ data: rows(PER_USER_DAILY_LIMIT + 10, { userId: old, createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) }) });
    check("calls from two days ago do not count against today", (await outcome({ userId: old })) === "allowed");
  } finally {
    await cleanup();
    await prisma.$disconnect().catch(() => {});
  }
  console.log(failures === 0 ? "\nAI QUOTA VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
