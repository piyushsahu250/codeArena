import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { downloadExport, Empty } from "../../components/admin/adKit";
import "../../styles/staffAnalytics.css";

// ---------- dates (the platform reports in Asia/Kolkata) ----------
export const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export function shiftDays(ymd, delta) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
export const presetRange = (days) => { const to = todayIst(); return { from: shiftDays(to, -(days - 1)), to }; };
export const fmtDate = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
export const num = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-IN"));

export const STATUS_TEXT = {
  ACTIVE: ["good", "Active"],
  NO_ACTIVITY_RECORDED: ["warn", "No activity recorded"],
  TELEMETRY_UNAVAILABLE: ["mute", "Not tracked for this role"],
};
export function StatusBadge({ status }) {
  const [tone, text] = STATUS_TEXT[status] || ["mute", status];
  return <span className={`ad-badge ${tone}`}>{text}</span>;
}

// A category cell: a real number, or an explicit reason there is no number. Zero is only ever a recorded zero.
export function CategoryCell({ cell, compact }) {
  if (!cell) return <span className="sa-muted">—</span>;
  if (cell.status === "NOT_APPLICABLE") return <span className="sa-na" title="This kind of work does not apply to this role">N/A</span>;
  if (cell.status === "NOT_TRACKED") return <span className="sa-muted" title="The platform has never recorded this activity, so no number can be shown">Not tracked</span>;
  if (cell.status === "PARTIAL") {
    const since = cell.trackedSince ? new Date(cell.trackedSince).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
    return <span title={`Recording began on ${since}, part-way through this period, so the count may be incomplete`}>{num(cell.count)}<span className="sa-partial" aria-label={`partial, tracked since ${since}`}>{compact ? "*" : " (partial)"}</span></span>;
  }
  return <span>{num(cell.count)}</span>;
}

export function Change({ value }) {
  if (value === null || value === undefined) return <span className="sa-muted" title="No activity in the previous period to compare with">—</span>;
  const up = value > 0, flat = value === 0;
  return <span className={flat ? "sa-muted" : up ? "sa-up" : "sa-down"} title="Change versus the previous period of the same length">{flat ? "0%" : `${up ? "▲" : "▼"} ${Math.abs(value)}%`}</span>;
}

// ---------- exports ----------
export function ExportMenu({ path, params, label = "Export", baseName = "staff-analytics" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  async function go(format) {
    setBusy(format); setMsg(""); setOpen(false);
    try { const ok = await downloadExport(path, { ...params, format }, `${baseName}.${format}`); setMsg(ok ? "" : "Nothing to export for these filters."); }
    catch (e) { setMsg(e?.response?.status === 429 ? "Too many exports. Try again in a minute." : "Export failed."); }
    finally { setBusy(""); }
  }
  return (
    <span className="sa-export" ref={ref}>
      <button type="button" className="ad-btn ghost sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!!busy}>
        <Download size={14} aria-hidden="true" /> {busy ? "Preparing…" : label}
      </button>
      {open && (
        <div className="sa-menu" role="menu">
          {[["csv", "CSV (spreadsheet)"], ["xlsx", "Excel (.xlsx)"], ["pdf", "PDF report"]].map(([f, t]) => (
            <button key={f} type="button" role="menuitem" className="sa-menuitem" onClick={() => go(f)}>{t}</button>
          ))}
        </div>
      )}
      {msg && <span className="ad-sub" role="status"> {msg}</span>}
    </span>
  );
}

// ---------- filters ----------
export function DateFilters({ range, onChange }) {
  const [custom, setCustom] = useState(false);
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  const preset = [7, 30, 90].find((d) => d === days && range.to === todayIst());
  return (
    <div className="sa-dates">
      <div className="ad-seg" role="group" aria-label="Period">
        {[[7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([d, l]) => (
          <button key={d} type="button" aria-pressed={!custom && preset === d} onClick={() => { setCustom(false); onChange(presetRange(d)); }}>{l}</button>
        ))}
        <button type="button" aria-pressed={custom || !preset} onClick={() => setCustom(true)}>Custom</button>
      </div>
      {(custom || !preset) && (
        <div className="sa-daterange">
          <label className="sa-field"><span>From</span><input className="ad-input" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })} /></label>
          <label className="sa-field"><span>To</span><input className="ad-input" type="date" value={range.to} min={range.from} max={todayIst()} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })} /></label>
        </div>
      )}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="ad-sub" style={{ margin: "8px 0 0" }}>{total} {total === 1 ? "result" : "results"}</p> : null;
  return (
    <nav className="sa-pager" aria-label="Pagination">
      <button type="button" className="ad-btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="ad-sub" aria-live="polite">Page {page} of {pages} · {total} results</span>
      <button type="button" className="ad-btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

// ---------- definitions ----------
export function Definitions({ meta }) {
  if (!meta) return null;
  const d = meta.definitions;
  return (
    <details className="sa-defs">
      <summary>How these numbers are calculated</summary>
      <ul className="ad-sub sa-principles">{d.principles.map((p) => <li key={p}>{p}</li>)}</ul>
      <h3 className="ad-h3">Activity categories</h3>
      <div className="ad-tablewrap" tabIndex={0} role="region" aria-label="Activity categories and the audit actions they count">
        <table className="ad-table">
          <thead><tr><th scope="col">Category</th><th scope="col">Applies to</th><th scope="col">Counts these audit actions</th><th scope="col">Recorded since</th></tr></thead>
          <tbody>
            {d.categories.map((c) => {
              const t = meta.telemetry.find((x) => x.key === c.key);
              return (
                <tr key={c.key}><td><b>{c.label}</b></td><td>{c.roles.join(", ")}</td><td className="sa-actions">{c.actions.join(", ")}</td><td>{t && t.tracked ? fmtDateTime(t.trackedSince) : <span className="sa-muted">Never recorded</span>}</td></tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 className="ad-h3">Ratios (shown only with at least {d.minimumSample} events)</h3>
      <ul className="ad-list">{d.ratios.map((r) => <li key={r.key} className="ad-row" style={{ display: "block" }}><b>{r.label}</b><div className="ad-sub"><code>{r.formula}</code></div><div className="ad-sub">{r.meaning}</div></li>)}</ul>
      <h3 className="ad-h3">Workload</h3>
      <ul className="ad-list">{d.workload.map((w) => <li key={w.key} className="ad-row" style={{ display: "block" }}><b>{w.label}</b><div className="ad-sub">{w.formula}</div></li>)}</ul>
      <h3 className="ad-h3">Portfolio (records people created; never added to activity counts)</h3>
      <ul className="ad-list">{d.portfolio.map((w) => <li key={w.key} className="ad-row" style={{ display: "block" }}><b>{w.label}</b><div className="ad-sub">{w.formula}</div></li>)}</ul>
      <p className="ad-sub">Times are Asia/Kolkata. Latest recorded event: {meta.latestRecordedEventAt ? fmtDateTime(meta.latestRecordedEventAt) : "none yet"}.</p>
    </details>
  );
}

export function NoData({ children }) { return <Empty>{children}</Empty>; }
