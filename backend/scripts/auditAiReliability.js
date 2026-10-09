// READ-ONLY: how reliable are the AI calls, by feature and by day (from AiUsageLog). Shows success rate, error types and latency so a failing feature stands out.
//   node scripts/auditAiReliability.js [--days=14]
const prisma = require("../src/prisma");
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=")[1] : d; };
(async () => {
  const days = Number(arg("days", 14));
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.aiUsageLog.findMany({ where: { createdAt: { gte: since } }, select: { feature: true, success: true, errorType: true, latencyMs: true, createdAt: true } });
  console.log(`AI calls in the last ${days} days: ${rows.length}`);
  const byFeature = {};
  for (const r of rows) {
    const f = (byFeature[r.feature] ||= { calls: 0, ok: 0, errors: {}, ms: [] });
    f.calls++; if (r.success) f.ok++; else f.errors[r.errorType || "UNKNOWN"] = (f.errors[r.errorType || "UNKNOWN"] || 0) + 1;
    if (r.success) f.ms.push(r.latencyMs);
  }
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : null; };
  console.table(Object.entries(byFeature).map(([feature, f]) => ({ feature, calls: f.calls, successPct: Math.round(f.ok / f.calls * 100), p50ms: pct(f.ms, 50), p95ms: pct(f.ms, 95), errors: JSON.stringify(f.errors) })).sort((a, b) => b.calls - a.calls));
  const byDay = {};
  for (const r of rows) { const d = r.createdAt.toISOString().slice(0, 10); const x = (byDay[d] ||= { calls: 0, failed: 0, quota: 0 }); x.calls++; if (!r.success) { x.failed++; if (/QUOTA|RATE/.test(r.errorType || "")) x.quota++; } }
  console.table(Object.entries(byDay).sort().map(([day, x]) => ({ day, calls: x.calls, failed: x.failed, quotaOrRateLimit: x.quota })));
  console.log("READ ONLY.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
