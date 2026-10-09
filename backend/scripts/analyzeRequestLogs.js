// READ-ONLY analysis of the structured request logs (/app/logs/app-YYYY-MM-DD.log): slowest and most failing endpoints from real traffic.
//   node scripts/analyzeRequestLogs.js [--dir=/app/logs] [--min-count=20]
// Paths are normalised (ids and numbers become :id) so one endpoint is one row. Health checks are ignored.
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const dir = arg("dir", "/app/logs");
const minCount = Number(arg("min-count", 20));
const norm = (p) => p.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\/\d+(?=\/|$)/g, "/:n").replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/:token");

(async () => {
  const stats = new Map();
  const perDay = {};
  let total = 0;
  const files = fs.readdirSync(dir).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
  for (const f of files) {
    const day = f.slice(4, 14);
    perDay[day] = { requests: 0, s5xx: 0, s429: 0 };
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"msg":"request"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!o.path || o.path === "/api/health") continue;
      total++;
      perDay[day].requests++;
      if (o.status >= 500) perDay[day].s5xx++;
      if (o.status === 429) perDay[day].s429++;
      const key = `${o.method} ${norm(o.path)}`;
      let s = stats.get(key);
      if (!s) { s = { count: 0, ms: [], s5xx: 0, s4xx: 0, s401: 0, s403: 0, s404: 0, s429: 0 }; stats.set(key, s); }
      s.count++;
      if (s.ms.length < 3000) s.ms.push(o.durationMs); else s.ms[Math.floor(Math.random() * 3000)] = o.durationMs;
      if (o.status >= 500) s.s5xx++;
      else if (o.status >= 400) { s.s4xx++; if (o.status === 401) s.s401++; if (o.status === 403) s.s403++; if (o.status === 404) s.s404++; if (o.status === 429) s.s429++; }
    }
  }
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] : 0; };
  const rows = [...stats.entries()].map(([route, s]) => ({ route, count: s.count, p50: pct(s.ms, 50), p95: pct(s.ms, 95), max: Math.max(...s.ms), s5xx: s.s5xx, s4xx: s.s4xx, s401: s.s401, s403: s.s403, s404: s.s404, s429: s.s429 }));
  console.log(`requests analysed: ${total} over ${files.length} day(s)`);
  console.log("per day:", JSON.stringify(perDay));
  console.log("\n== slowest by p95 (count >= " + minCount + ")");
  console.table(rows.filter((r) => r.count >= minCount).sort((a, b) => b.p95 - a.p95).slice(0, 15));
  console.log("== most 5xx");
  console.table(rows.filter((r) => r.s5xx > 0).sort((a, b) => b.s5xx - a.s5xx).slice(0, 12));
  console.log("== most 404 (possible broken links or stale clients)");
  console.table(rows.filter((r) => r.s404 >= 5).sort((a, b) => b.s404 - a.s404).slice(0, 10));
  console.log("== 429 (rate limited)");
  console.table(rows.filter((r) => r.s429 > 0).sort((a, b) => b.s429 - a.s429).slice(0, 10));
  console.log("READ ONLY.");
})().catch((e) => { console.error(e); process.exit(1); });
