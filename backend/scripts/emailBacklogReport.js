// Read-only: how healthy is outbound email right now? (provider mode, last 3 days by status/type, oldest pending, recent failures.)
const prisma = require("../src/prisma");
(async () => {
  const mode = process.env.MAIL_PROVIDER === "ses" ? "ses" : process.env.APPS_SCRIPT_WEB_APP_URL ? "apps-script" : process.env.MAIL_HOST ? "smtp" : "none";
  const since = new Date(Date.now() - 3 * 864e5);
  const byStatus = await prisma.emailLog.groupBy({ by: ["status"], _count: true, where: { createdAt: { gte: since } } });
  const pendingTypes = await prisma.emailLog.groupBy({ by: ["emailType"], _count: true, where: { status: "PENDING" } });
  const oldest = await prisma.emailLog.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, emailType: true } });
  const fails = await prisma.emailLog.findMany({ where: { status: "FAILED", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 3, select: { errorMessage: true, createdAt: true } });
  const last = await prisma.emailLog.findFirst({ where: { status: "SENT" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
  console.log(JSON.stringify({ mode, byStatus, pendingTypes, oldestPending: oldest, recentFailures: fails.map((f) => ({ at: f.createdAt, error: String(f.errorMessage || "").slice(0, 120) })), lastSent: last?.sentAt, now: new Date() }, null, 1));
  process.exit(0);
})();
