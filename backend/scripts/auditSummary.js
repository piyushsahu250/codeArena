// Reads `npm audit --json` on stdin and publishes ONE compact GitHub Actions warning annotation that lists every advisory (severity, package, direct or transitive,
// the advisory titles, and whether a fix exists). Report only: it never fails a build. Why: the raw log of a run needs a GitHub sign-in, an annotation does not,
// so the result is readable from the public check-runs API and from the run summary.
//   npm audit --omit=dev --json | node scripts/auditSummary.js <label>
const label = process.argv[2] || "dependencies";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  const encode = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  let report;
  try { report = JSON.parse(input); } catch { console.log(`::warning title=npm audit (${label}) unreadable::npm audit did not return JSON (${input.slice(0, 120).replace(/\s+/g, " ")})`); return; }
  if (report.error) { console.log(`::warning title=npm audit (${label}) failed::${encode(String(report.error.summary || report.error.code || "unknown error"))}`); return; }
  const counts = (report.metadata && report.metadata.vulnerabilities) || {};
  const order = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  const rows = Object.entries(report.vulnerabilities || {}).map(([name, v]) => {
    const advisories = (v.via || []).filter((x) => typeof x === "object").map((x) => `${x.title}${x.url ? " [" + String(x.url).split("/").pop() + "]" : ""}`);
    const viaPackages = (v.via || []).filter((x) => typeof x === "string");
    const fix = v.fixAvailable && typeof v.fixAvailable === "object" ? `fix: ${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? " (major)" : ""}` : v.fixAvailable ? "fix available" : "no fix";
    return { sev: v.severity, line: `${String(v.severity).toUpperCase()} ${name} ${v.range || ""} (${v.isDirect ? "direct" : "transitive"}; ${fix}) ${advisories.length ? "- " + advisories.join("; ") : viaPackages.length ? "- via " + viaPackages.join(", ") : ""}`.slice(0, 420) };
  }).sort((a, b) => (order[a.sev] ?? 9) - (order[b.sev] ?? 9));
  const head = `critical ${counts.critical || 0}, high ${counts.high || 0}, moderate ${counts.moderate || 0}, low ${counts.low || 0}`;
  console.log(`::warning title=npm audit (${label}): ${head}::${encode(rows.map((r) => r.line).join("\n").slice(0, 60000) || "no advisories")}`);
});
