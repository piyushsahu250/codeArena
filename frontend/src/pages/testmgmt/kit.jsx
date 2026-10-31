import { useEffect, useRef, useState } from "react";

export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: "medium" }) : "—");

export function errMsg(err, fallback = "Something went wrong. Please try again.") {
  const d = err?.response?.data;
  const problems = Array.isArray(d?.problems) && d.problems.length ? ` ${d.problems.join("; ")}` : "";
  return (d?.error ? d.error + problems : null) || fallback;
}

// A debounced copy of a value, so typing in a search box does not send a request per keystroke.
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// Runs a loader and keeps only the answer to the NEWEST request, so a slow earlier answer can never overwrite a later one.
export function useLoader(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(load).then((data) => { if (mine === seq.current) setState({ data, error: null, loading: false }); })
      .catch((err) => { if (mine === seq.current) setState((s) => ({ data: s.data, error: errMsg(err, "Could not load this."), loading: false })); });
  };
  useEffect(run, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: run };
}

export function Pager({ page, totalPages, total, onPage }) {
  if (!totalPages || totalPages <= 1) return total != null ? <p className="tm-meta" style={{ textAlign: "center", marginTop: 12 }}>{total} {total === 1 ? "item" : "items"}</p> : null;
  return (
    <div className="tm-pager">
      <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
      <span className="tm-meta">Page {page} of {totalPages} · {total} items</span>
      <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

export function Notice({ kind = "ok", children, onClose }) {
  if (!children) return null;
  return <div className={`tm-notice ${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}{onClose && <button className="btn btn-ghost" style={{ marginLeft: 10, padding: "2px 8px", fontSize: 12 }} onClick={onClose}>Dismiss</button>}</div>;
}

// A small "⋯" menu that closes when you click elsewhere.
export function Menu({ label = "Actions", children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span className="tm-menu" ref={ref}>
      <button className="btn btn-ghost" style={{ padding: "4px 10px" }} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label} ▾</button>
      {open && <div className="tm-menu-list" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </span>
  );
}

export function LifecyclePills({ life }) {
  if (!life) return null;
  const win = { OPEN: ["Open now", "ok"], UPCOMING: ["Upcoming", "warn"], CLOSED: ["Window closed", "off"] }[life.window] || [];
  return (
    <>
      {life.archived && <span className="tm-pill off">Archived</span>}
      <span className={`tm-pill ${life.published ? "ok" : "warn"}`}>{life.published ? "Published" : "Draft"}</span>
      <span className={`tm-pill ${life.active ? "ok" : "bad"}`}>{life.active ? "Active" : "Inactive"}</span>
      {win[0] && <span className={`tm-pill ${win[1]}`}>{win[0]}</span>}
    </>
  );
}
