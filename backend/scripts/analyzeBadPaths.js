// READ-ONLY: requests whose URL contains "undefined" or "null" (a client that built a URL from a missing id), by endpoint and day.
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dir = "/app/logs";
(async () => {
  const byKey = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(x)).sort()) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"msg":"request"') || !/\/(undefined|null)(\/|$|\?)/.test(line)) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const key = `${o.method} ${o.path.replace(/[0-9a-f-]{36}/g, ":id").split("?")[0]} -> ${o.status}`;
      const e = byKey.get(key) || { n: 0, users: new Set(), days: new Set() };
      e.n++; if (o.userId) e.users.add(o.userId); e.days.add(f.slice(4, 14)); byKey.set(key, e);
    }
  }
  console.table([...byKey.entries()].map(([k, e]) => ({ request: k, count: e.n, users: e.users.size, days: [...e.days].join(" ") })).sort((a, b) => b.count - a.count));
  console.log("READ ONLY.");
})();
