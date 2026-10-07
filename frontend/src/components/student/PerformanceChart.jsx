// Lazy-loaded (React.lazy from StudentDashboard). Hand-drawn SVG — no chart library, so it adds
// no dependency weight. Colours come from --sd-* tokens, so it works in both themes. A visually
// hidden table mirrors the data for screen readers.
export default function PerformanceChart({ points }) {
  const W = 560, H = 190, L = 34, R = 12, T = 12, B = 26;
  const pts = points.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const n = pts.length;
  const x = (i) => (n === 1 ? (L + (W - R)) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.percentage).toFixed(1)}`).join(" ");
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z` : "";
  const fmt = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const last = pts[n - 1];
  return (
    <div className="sd-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Test score trend over the last 30 days. Latest score ${last.percentage} percent.`}>
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--sd-chart-grid)" strokeWidth="1" strokeDasharray={g === 50 ? "3 4" : undefined} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end">{g}</text>
          </g>
        ))}
        {area && <path d={area} fill="var(--sd-chart-fill)" stroke="none" />}
        {n > 1 && <path d={line} fill="none" stroke="var(--sd-chart-line)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.percentage)} r={i === n - 1 ? 5 : 3} fill="var(--sd-chart-line)" stroke="var(--sd-surface)" strokeWidth="2">
            <title>{`${p.label}: ${p.percentage}% (${fmt(p.date)})`}</title>
          </circle>
        ))}
        <text x={x(0)} y={H - 6} textAnchor={n === 1 ? "middle" : "start"}>{fmt(pts[0].date)}</text>
        {n > 1 && <text x={x(n - 1)} y={H - 6} textAnchor="end">{fmt(last.date)}</text>}
      </svg>
      <table style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        <caption>Test scores, last 30 days</caption>
        <thead><tr><th>Test</th><th>Date</th><th>Score</th></tr></thead>
        <tbody>{pts.map((p, i) => <tr key={i}><td>{p.label}</td><td>{fmt(p.date)}</td><td>{p.percentage}%</td></tr>)}</tbody>
      </table>
    </div>
  );
}
