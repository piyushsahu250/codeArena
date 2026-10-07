import { Component } from "react";
import { Link } from "react-router-dom";
import "../../styles/studentDashboard.css";

// Lightweight product-analytics hook. There is no analytics backend in this app, so events are
// published as a window CustomEvent ("ca:analytics") that any collector can subscribe to; nothing
// is sent over the network from here. Payloads carry no PII (names/emails are never passed).
export function track(event, props = {}) {
  try { window.dispatchEvent(new CustomEvent("ca:analytics", { detail: { event, ...props, at: Date.now() } })); } catch { /* ignore */ }
}

export function timeAgo(date) {
  if (!date) return "";
  const d = new Date(date).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Math.round((Date.now() - d) / 1000);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)} d ago`;
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function dueLabel(date) {
  if (!date) return "";
  const d = new Date(date);
  const hrs = (d.getTime() - Date.now()) / 3600000;
  const opts = { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  const when = d.toLocaleString("en-IN", opts);
  if (hrs <= 0) return `Closed ${when}`;
  if (hrs < 24) return `Due in ${Math.max(1, Math.round(hrs))} h · ${when}`;
  return `Due ${when}`;
}

export const isErr = (v) => !!v && typeof v === "object" && v.error === true;

export function Skel({ w = "100%", h = 14, style }) {
  return <div className="sd-skel" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

export function CardSkeleton({ rows = 3, h = 160 }) {
  return (
    <div className="sd-card" style={{ minHeight: h }} aria-busy="true" aria-label="Loading">
      <Skel w="40%" h={16} />
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {Array.from({ length: rows }).map((_, i) => <Skel key={i} w={`${90 - i * 12}%`} h={12} />)}
      </div>
    </div>
  );
}

class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error("[student dashboard section]", err); }
  render() {
    if (this.state.failed) return <SectionError onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

export function SectionError({ onRetry, text = "This section couldn't load." }) {
  return (
    <div className="sd-error" role="alert">
      <span>{text}</span>
      {onRetry && <button type="button" className="sd-btn ghost sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

// One card shell: title, optional "view all" link, per-section loading / error / retry, and a
// render-error boundary so a bug in one section can never blank the whole dashboard.
export function SectionCard({ title, icon: Icon, to, linkLabel = "View all", loading, error, onRetry, children, className = "", id }) {
  return (
    <section className={`sd-card ${className}`} aria-labelledby={id ? `${id}-t` : undefined}>
      <div className="sd-card-head">
        <h2 className="sd-title" id={id ? `${id}-t` : undefined} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {Icon && <Icon size={17} aria-hidden="true" />}{title}
        </h2>
        {to && <Link to={to} className="sd-link">{linkLabel}</Link>}
      </div>
      <Boundary>
        {loading ? (
          <div style={{ display: "grid", gap: 10 }} aria-busy="true"><Skel w="80%" /><Skel w="60%" /><Skel w="70%" /></div>
        ) : error ? <SectionError onRetry={onRetry} /> : children}
      </Boundary>
    </section>
  );
}

export function Empty({ children }) { return <div className="sd-empty">{children}</div>; }

export function Bar({ value, tone }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`sd-bar ${tone || ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}

export const toneFor = (pct) => (pct >= 70 ? "" : pct >= 40 ? "warn" : "bad");
