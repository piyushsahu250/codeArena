const { PrismaClient } = require("@prisma/client");

// Prisma's default pool size is derived from the number of CPUs Node sees via os.cpus() — on a
// throttled container (Render free tier: 0.1 CPU / 512MB) that call typically still reports the
// underlying host's full core count, not the small CPU quota actually granted, so the
// auto-detected pool can end up far larger than this container can realistically use. A bigger
// pool here doesn't make queries faster (Postgres work is still bottlenecked by the same 0.1 CPU),
// it just means more idle connections competing for Neon's connection limit and a larger, less
// predictable memory footprint on a 512MB box. connection_limit=5 is a conservative floor safe on
// any Postgres plan's connection limit, appended here (not hardcoded into DATABASE_URL itself) so
// it applies automatically without editing the secret in Render's dashboard, and is skipped
// entirely if the URL already specifies one.
function withConnectionLimit(url) {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=5`;
}

// Shared across all routes — a separate PrismaClient per file each opens its own
// connection pool, which multiplies connections to Neon for no benefit and makes
// hitting the free-tier connection limit (and the resulting P1001 errors) more likely.
// Only overrides the datasource URL when there's actually a DATABASE_URL to adjust — otherwise
// falls back to Prisma's own normal env("DATABASE_URL") resolution from schema.prisma, unchanged.
const adjustedUrl = withConnectionLimit(process.env.DATABASE_URL);
const prisma = new PrismaClient(adjustedUrl ? { datasources: { db: { url: adjustedUrl } } } : undefined);

module.exports = prisma;
