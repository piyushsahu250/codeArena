// READ-ONLY: one route pattern (substring) broken down by day, with distinct users, from the structured request logs.
//   node scripts/analyzeRouteByDay.js "POST /api/module-coding/attempts" finalize
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const [method, ...needles] = process.argv[2].split(" ");
const extra = process.argv.slice(3);
const dir = "/app/logs";
(async () => {
  for (const f of fs.readdirSync(dir).filter((x) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(x)).sort()) {
    const rows = [];
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"msg":"request"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.method !== method || !needles.every((n) => o.path.includes(n)) || !extra.every((n) => o.path.includes(n))) continue;
      rows.push(o);
    }
    if (!rows.length) continue;
    const ms = rows.map((r) => r.durationMs).sort((a, b) => a - b);
    const users = new Set(rows.map((r) => r.userId).filter(Boolean));
    const by = {}; for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
    console.log(f.slice(4, 14), `n=${rows.length} users=${users.size} p50=${ms[Math.floor(ms.length / 2)]} p95=${ms[Math.floor(ms.length * 0.95)]} max=${ms[ms.length - 1]} status=${JSON.stringify(by)} paths=${[...new Set(rows.map((r) => r.path.replace(/[0-9a-f-]{36}/g, ":id")))].slice(0, 3).join(",")}`);
  }
})();
