// Shared status badge. Reuses the existing `.badge` CSS class from theme.css (padding/radius/font)
// and the --success-bg/--warning-bg/--danger-bg/--info-bg tokens theme.css defines for exactly
// this purpose (dark-mode-safe soft-tinted surfaces), rather than inventing a new palette or
// hardcoding hex here. Replaces ad-hoc inline overrides like
//   <span className="badge" style={{ background: "var(--rust)", color: "#fff" }}>Inactive</span>
// scattered across AdminDashboard.jsx and others with one consistent, theme-aware component.
const TONE_STYLE = {
  default: { background: "var(--card-bg, #F1F0EC)", color: "var(--ink-dim)" },
  success: { background: "var(--success-bg)", color: "var(--mint)" },
  warning: { background: "var(--warning-bg)", color: "var(--amber-dark)" },
  danger: { background: "var(--danger-bg)", color: "var(--rust)" },
  info: { background: "var(--info-bg)", color: "#3D6FA8" },
};

export default function Badge({ tone = "default", children, style, mono = false }) {
  return (
    <span className={mono ? "mono badge" : "badge"} style={{ ...TONE_STYLE[tone] || TONE_STYLE.default, ...style }}>
      {children}
    </span>
  );
}
