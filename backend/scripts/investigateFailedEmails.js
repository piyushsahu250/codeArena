// One-off, read-only: the daily health check flagged 14 failed emails in the last 24h. Surfaces
// the actual error messages/types so the real cause (bad SMTP creds, rate limit, invalid
// recipient address, transient network error, etc.) can be identified instead of guessed.
const prisma = require("../src/prisma");

async function main() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failed = await prisma.emailLog.findMany({
    where: { status: "FAILED", createdAt: { gte: since } },
    select: { recipientEmail: true, emailType: true, errorMessage: true, retryCount: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`${failed.length} failed email(s) in the last 24h.\n`);

  const byErrorMessage = new Map();
  for (const f of failed) {
    const key = f.errorMessage || "(no error message recorded)";
    if (!byErrorMessage.has(key)) byErrorMessage.set(key, []);
    byErrorMessage.get(key).push(f);
  }

  for (const [msg, rows] of byErrorMessage) {
    console.log(`x${rows.length}: ${msg}`);
    console.log(`   types: ${[...new Set(rows.map((r) => r.emailType))].join(", ")}`);
    console.log(`   sample recipients: ${rows.slice(0, 3).map((r) => r.recipientEmail).join(", ")}`);
    console.log(`   time range: ${rows[rows.length - 1].createdAt.toISOString()} .. ${rows[0].createdAt.toISOString()}`);
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
