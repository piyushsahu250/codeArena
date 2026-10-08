import { Component, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api";
import "../../styles/adminConsole.css";

export function timeAgo(date) {
  if (!date) return "—";
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const fmt = (n) => (n === null || n === undefined ? null : Number(n).toLocaleString("en-IN"));
export const actionLabel = (a) => String(a || "").toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Fetch one dashboard payload with a request-id guard (so a slow older response can never overwrite
// a newer one when filters change), plus retry.
export function useDashboard(path, params) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const rid = useRef(0);
  const key = JSON.stringify(params || {});
  const load = useCallback(() => {
    const id = ++rid.current;
    setLoading(true); setError(false);
    api.get(path, { params: JSON.parse(key) })
      .then((r) => { if (id === rid.current) { setData(r.data); setLoading(false); } })
      .catch(() => { if (id === rid.current) { setError(true); setLoading(false); } });
  }, [path, key]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

export function Skel({ w = "100%", h = 14, style }) { return <div className="ad-skel" style={{ width: w, height: h, ...style }} aria-hidden="true" />; }

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.error("[admin panel]", e); }
  render() { return this.state.failed ? <ErrorLine onRetry={() => this.setState({ failed: false })} /> : this.props.children; }
}

export function ErrorLine({ onRetry, text = "This section couldn't load." }) {
  return <div className="ad-error" role="alert"><span>{text}</span>{onRetry && <button type="button" className="ad-btn ghost sm" onClick={onRetry}>Retry</button>}</div>;
}

export function Panel({ title, sub, to, linkLabel = "View all", actions, loading, error, onRetry, children, id }) {
  return (
    <section className="ad-panel" aria-labelledby={id ? `${id}-t` : undefined}>
      <div className="ad-panel-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="ad-h2" id={id ? `${id}-t` : undefined}>{title}</h2>
          {sub && <div className="ad-sub">{sub}</div>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{actions}{to && <Link to={to} className="ad-link">{linkLabel}</Link>}</div>
      </div>
      <Boundary>
        {loading ? <div style={{ display: "grid", gap: 10 }} aria-busy="true"><Skel w="80%" /><Skel w="60%" /><Skel w="70%" /></div>
          : error ? <ErrorLine onRetry={onRetry} /> : children}
      </Boundary>
    </section>
  );
}

export const Empty = ({ children }) => <div className="ad-empty">{children}</div>;

export function Kpi({ label, value, foot, to, delta }) {
  const na = value === null || value === undefined;
  const body = (
    <>
      <span className="ad-kpi-label">{label}</span>
      {na ? <span className="ad-kpi-value na">Data unavailable</span> : <span className="ad-kpi-value">{value}</span>}
      {(foot || delta) && !na && <span className="ad-kpi-foot">{foot}{delta && <> {delta}</>}</span>}
    </>
  );
  return to ? <Link to={to} className="ad-kpi">{body}</Link> : <div className="ad-kpi">{body}</div>;
}

export function Delta({ t }) {
  if (!t || t.changePercent === null || t.changePercent === undefined) return <span className="ad-delta na">Trend unavailable</span>;
  const up = t.changePercent >= 0;
  return <span className={`ad-delta ${up ? "up" : "down"}`}>{up ? "▲" : "▼"} {Math.abs(t.changePercent)}% vs previous period</span>;
}

const HEALTH = { HEALTHY: ["good", "Healthy"], NEEDS_ATTENTION: ["warn", "Needs attention"], CRITICAL: ["bad", "Critical"], INACTIVE: ["mute", "Inactive"], OK: ["good", "OK"], WARNING: ["warn", "Warning"], HIGH: ["bad", "High"], INFO: ["", "Info"], UNKNOWN: ["mute", "Unknown"] };
export function StatusBadge({ status }) {
  const [tone, label] = HEALTH[status] || ["mute", status];
  return <span className={`ad-badge ${tone}`}>{label}</span>;
}

export function RangePicker({ value, onChange }) {
  return (
    <div className="ad-seg" role="group" aria-label="Time range">
      {[[1, "Today"], [7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([d, l]) => (
        <button key={d} type="button" aria-pressed={value === d} onClick={() => onChange(d)}>{l}</button>
      ))}
    </div>
  );
}

export function PageHeader({ title, scope = [], right }) {
  return (
    <header className="ad-head">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        <div className="ad-scope">{scope.filter((s) => s && s.value).map((s) => <span key={s.label}>{s.label}: <b>{s.value}</b></span>)}</div>
      </div>
      {right}
    </header>
  );
}

export function PercentCell({ value }) {
  if (value === null || value === undefined) return <span className="ad-sub">—</span>;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 90 }}><span className="ad-num" style={{ width: 34, textAlign: "right" }}>{value}%</span><span className="ad-bar" style={{ flex: 1 }}><i style={{ width: `${Math.min(100, value)}%` }} /></span></span>;
}

// Plain data table with a horizontally-scrolling wrapper. columns: [{key, header, right?, render?(row)}]
export function DataTable({ columns, rows, rowKey, empty = "Nothing to show.", caption }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="ad-tablewrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="ad-table">
        {caption && <caption style={{ position: "absolute", left: -9999 }}>{caption}</caption>}
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.right ? "r" : ""}>{c.header}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={rowKey(r)}>{columns.map((c) => <td key={c.key} className={c.right ? "r ad-num" : ""}>{c.render ? c.render(r) : (r[c.key] ?? <span className="ad-sub">—</span>)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Daily series line/area chart (SVG, token-coloured) with a hidden accessible table.
export function SeriesChart({ points, keys, labels, height = 170 }) {
  if (!points?.length) return <Empty>Not enough data for this period.</Empty>;
  const W = 640, H = height, L = 36, R = 10, T = 10, B = 24;
  const max = Math.max(1, ...points.flatMap((p) => keys.map((k) => p[k] || 0)));
  const x = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const colors = ["var(--ad-series)", "var(--ad-series-2)"];
  const d = (k) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k] || 0).toFixed(1)}`).join(" ");
  const f = (s) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div className="ad-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels.join(" and ")} per day from ${f(points[0].day)} to ${f(points[points.length - 1].day)}`}>
        {[0, 0.5, 1].map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(max * g)} y2={y(max * g)} stroke="var(--line)" /><text x={L - 6} y={y(max * g) + 4} textAnchor="end">{Math.round(max * g)}</text></g>)}
        {keys.map((k, i) => <path key={k} d={d(k)} fill="none" stroke={colors[i]} strokeWidth="2.25" strokeLinejoin="round" />)}
        {keys.map((k, i) => <circle key={k} cx={x(points.length - 1)} cy={y(points[points.length - 1][k] || 0)} r="4" fill={colors[i]} stroke="var(--ad-surface)" strokeWidth="2" />)}
        <text x={L} y={H - 6}>{f(points[0].day)}</text><text x={W - R} y={H - 6} textAnchor="end">{f(points[points.length - 1].day)}</text>
      </svg>
      <div className="ad-sub" style={{ display: "flex", gap: 14, marginTop: 6 }}>{keys.map((k, i) => <span key={k}><span style={{ color: colors[i] }}>●</span> {labels[i]}</span>)}</div>
      <table style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}><caption>{labels.join(", ")} per day</caption><thead><tr><th>Day</th>{labels.map((l) => <th key={l}>{l}</th>)}</tr></thead><tbody>{points.map((p) => <tr key={p.day}><td>{p.day}</td>{keys.map((k) => <td key={k}>{p[k] || 0}</td>)}</tr>)}</tbody></table>
    </div>
  );
}

export function FullPageSkeleton() {
  return (
    <div className="ad-stack" aria-busy="true" aria-label="Loading dashboard">
      <Skel w="40%" h={30} />
      <div className="ad-kpis">{Array.from({ length: 8 }).map((_, i) => <Skel key={i} h={84} />)}</div>
      <Skel h={260} />
    </div>
  );
}
