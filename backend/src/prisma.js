const { PrismaClient } = require("@prisma/client");

// Prisma's default pool size is derived from the number of CPUs Node sees via os.cpus() — on a
// throttled container (Render free tier: 0.1 CPU / 512MB) that call typically still reports the
// underlying host's full core count, not the small CPU quota actually granted, so the
// auto-detected pool can end up far larger than this container can realistically use. A bigger
// pool here doesn't make queries faster (Postgres work is still bottlenecked by the same 0.1 CPU),
// it just means more idle connections competing for Neon's connection limit and a larger, less
// predictable memory footprint on a 512MB box.
//
// connection_limit was originally set to 5, but that turned out too tight for real traffic: an
// entire class/batch logging in within the same minute (POST /auth/login fires 2-4 queries
// concurrently per request — see auth.js) saturated the pool and Prisma's default 10s
// pool_timeout expired before a connection freed up, surfacing to students as "Transaction API
// error: unable to start a transaction in the given time" and a login page that never loads.
// connection_limit=10 gives meaningfully more concurrent headroom while staying well under any
// Postgres free-tier's connection cap; pool_timeout=20 also gives queued requests more time to
// get a connection during a burst instead of failing outright the moment 10 are briefly busy.
// Both are appended here (not hardcoded into DATABASE_URL itself) so they apply automatically
// without editing the secret in Render's dashboard, and are skipped if the URL already specifies
// them.
function withConnectionLimit(url) {
  if (!url) return url;
  const params = [];
  if (!/[?&]connection_limit=/.test(url)) params.push("connection_limit=10");
  if (!/[?&]pool_timeout=/.test(url)) params.push("pool_timeout=20");
  if (params.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${params.join("&")}`;
}

// Shared across all routes — a separate PrismaClient per file each opens its own
// connection pool, which multiplies connections to Neon for no benefit and makes
// hitting the free-tier connection limit (and the resulting P1001 errors) more likely.
// Only overrides the datasource URL when there's actually a DATABASE_URL to adjust — otherwise
// falls back to Prisma's own normal env("DATABASE_URL") resolution from schema.prisma, unchanged.
const adjustedUrl = withConnectionLimit(process.env.DATABASE_URL);
const prisma = new PrismaClient(adjustedUrl ? { datasources: { db: { url: adjustedUrl } } } : undefined);

module.exports = prisma;
