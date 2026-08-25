// Institute-daily and platform-daily AI usage quotas — the per-student, per-minute limits already
// live as express-rate-limit middleware on each AI-calling route (draftGenLimiter, hintLimiter,
// etc. — that pattern is already established across the codebase and doesn't need to change).
// What's missing is a limit that spans routes and survives longer than a 60s window, backed by
// the AiUsageLog table (see prisma/schema.prisma) so it also works correctly if this ever runs as
// more than one instance. Checked once, cheaply, before every Gemini call inside aiService.js —
// callers never need to know this exists.
const prisma = require("../../prisma");

const PER_INSTITUTE_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_PER_INSTITUTE || 300);
const GLOBAL_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT_GLOBAL || 2000);

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Throws a clean, user-facing QuotaExceededError if either quota is already exhausted; otherwise
// resolves with nothing. Counts successful AND failed attempts alike (a failed Gemini call still
// consumed a slot against the free-tier's own daily limit), matching "don't allow one user to
// consume the entire quota" — a caller retrying a failing request still counts against the quota
// rather than getting free unlimited retries.
async function assertWithinDailyQuota({ instituteId }) {
  const since = startOfTodayUtc();
  const [instituteCount, globalCount] = await Promise.all([
    instituteId
      ? prisma.aiUsageLog.count({ where: { instituteId, createdAt: { gte: since } } })
      : Promise.resolve(0),
    prisma.aiUsageLog.count({ where: { createdAt: { gte: since } } }),
  ]);

  if (globalCount >= GLOBAL_DAILY_LIMIT) {
    const err = new Error("The platform's daily AI usage limit has been reached. Please try again tomorrow.");
    err.quotaExceeded = "GLOBAL";
    throw err;
  }
  if (instituteId && instituteCount >= PER_INSTITUTE_DAILY_LIMIT) {
    const err = new Error("Your institute's daily AI usage limit has been reached. Please try again tomorrow.");
    err.quotaExceeded = "INSTITUTE";
    throw err;
  }
}

module.exports = { assertWithinDailyQuota, PER_INSTITUTE_DAILY_LIMIT, GLOBAL_DAILY_LIMIT };
