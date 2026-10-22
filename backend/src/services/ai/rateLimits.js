// Per-user, institute-daily and platform-daily AI usage quotas — the per-student, per-minute limits already
// live as express-rate-limit middleware on each AI-calling route (draftGenLimiter, hintLimiter,
// etc. — that pattern is already established across the codebase and doesn't need to change).
// What's missing is a limit that spans routes and survives longer than a 60s window, backed by
// the AiUsageLog table (see prisma/schema.prisma) so it also works correctly if this ever runs as
// more than one instance. Checked once, cheaply, before every Gemini call inside aiService.js —
// callers never need to know this exists.
const prisma = require("../../prisma");

const PER_INSTITUTE_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_PER_INSTITUTE || 300);
const GLOBAL_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_GLOBAL || 2000);
// One account's share of the day. Without it a single user at the 5-per-minute route limit could use an institute's whole daily budget in about an hour (300 / 5), and a few
// accounts could exhaust the platform's, leaving everyone else without AI. Sized from the production record (2026-10-22): the busiest user-day since August was 34 calls,
// so 100 has never blocked anyone; AI_DAILY_LIMIT_PER_USER changes it. Calls with no user (the scheduled health check) are not subject to it.
const PER_USER_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_PER_USER || 100);

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Rows that count against a quota. An INVALID_RESPONSE row is bookkeeping aiService writes when a response that DID arrive fails our own validation: the provider call
// itself already has its own row, so counting both used a quota slot twice (and counted the retry, too). `errorType: null` is listed explicitly because a plain
// `not` filter on a nullable column would drop every successful row.
const countedSince = (since) => ({ createdAt: { gte: since }, OR: [{ errorType: null }, { errorType: { not: "INVALID_RESPONSE" } }] });

// The decision itself, with no database: given today's counts, returns null (allowed) or { quotaExceeded, message }.
function quotaVerdict({ userId, instituteId, userCount, instituteCount, globalCount }, limits = {}) {
  const global = limits.global ?? GLOBAL_DAILY_LIMIT;
  const institute = limits.institute ?? PER_INSTITUTE_DAILY_LIMIT;
  const user = limits.user ?? PER_USER_DAILY_LIMIT;
  if (globalCount >= global) return { quotaExceeded: "GLOBAL", message: "The platform's daily AI usage limit has been reached. Please try again tomorrow." };
  if (instituteId && instituteCount >= institute) return { quotaExceeded: "INSTITUTE", message: "Your institute's daily AI usage limit has been reached. Please try again tomorrow." };
  if (userId && userCount >= user) return { quotaExceeded: "USER", message: "You have reached your daily AI usage limit. Please try again tomorrow." };
  return null;
}

// Throws a clean, user-facing QuotaExceededError if any quota is already exhausted; otherwise
// resolves with nothing. Counts successful AND failed provider attempts alike (a failed Gemini
// call still consumed a slot against the free-tier's own daily limit), matching "don't allow
// one user to consume the entire quota" — a caller retrying a failing request still counts
// against the quota rather than getting free unlimited retries.
async function assertWithinDailyQuota({ instituteId, userId } = {}) {
  const where = countedSince(startOfTodayUtc());
  const [userCount, instituteCount, globalCount] = await Promise.all([
    userId ? prisma.aiUsageLog.count({ where: { ...where, userId } }) : Promise.resolve(0),
    instituteId ? prisma.aiUsageLog.count({ where: { ...where, instituteId } }) : Promise.resolve(0),
    prisma.aiUsageLog.count({ where }),
  ]);
  const verdict = quotaVerdict({ userId, instituteId, userCount, instituteCount, globalCount });
  if (verdict) {
    const err = new Error(verdict.message);
    err.quotaExceeded = verdict.quotaExceeded;
    throw err;
  }
}

module.exports = { assertWithinDailyQuota, quotaVerdict, PER_USER_DAILY_LIMIT, PER_INSTITUTE_DAILY_LIMIT, GLOBAL_DAILY_LIMIT };
