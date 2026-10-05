const prisma = require("../src/prisma");
(async () => {
  const since = new Date(Date.now() - 14 * 86400000);
  const rows = await prisma.aiUsageLog.groupBy({ by: ["feature", "success", "errorType"], where: { createdAt: { gte: since } }, _count: true, _avg: { latencyMs: true } });
  const byFeature = {};
  for (const r of rows) {
    const f = (byFeature[r.feature] ||= { ok: 0, fail: 0, errors: {}, lat: [] });
    if (r.success) { f.ok += r._count; f.lat.push(r._avg.latencyMs || 0); } else { f.fail += r._count; f.errors[r.errorType || "?"] = (f.errors[r.errorType || "?"] || 0) + r._count; }
  }
  console.log("AI usage, last 14 days");
  for (const [k, v] of Object.entries(byFeature).sort((a, b) => (b[1].ok + b[1].fail) - (a[1].ok + a[1].fail))) {
    const total = v.ok + v.fail;
    console.log(`${k.padEnd(34)} total=${String(total).padStart(4)} fail=${((v.fail / total) * 100).toFixed(0).padStart(3)}%  avgLat=${v.lat.length ? Math.round(v.lat.reduce((a, b) => a + b, 0) / v.lat.length) : "-"}ms  errors=${JSON.stringify(v.errors)}`);
  }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  console.log("today so far:", await prisma.aiUsageLog.count({ where: { createdAt: { gte: today } } }), "(global daily limit", process.env.AI_DAILY_LIMIT_GLOBAL || 2000, ")");
  console.log("GEMINI key configured:", !!process.env.GEMINI_API_KEY);
  process.exit(0);
})();
