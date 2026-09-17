// Shared status badge. Reuses the existing `.badge` CSS class from theme.css (padding/radius/font)
// and the --success-bg/--warning-bg/--danger-bg/--info-bg tokens theme.css defines for exactly
// this purpose (dark-mode-safe soft-tinted surfaces), rather than inventing a new palette or
// hardcoding hex here. Replaces ad-hoc inline overrides like
//   <span className="badge" style={{ background: "var(--rust)", color: "#fff" }}>Inactive</span>
// scattered across AdminDashboard.jsx and others with one consistent, theme-aware component.
// success/warning/danger/info use dedicated --*-text tokens (theme.css), not --mint/--amber-dark/
// --rust directly -- at this component's actual size (12px/600 weight), those failed WCAG AA
// (4.5:1) against their own -bg token in light mode (full-platform accessibility audit,
// 2026-09-17: success 2.89:1, warning 2.71:1, danger 3.77:1, info 4.40:1). The --*-text tokens
// are darker in light mode and fall back to the original colors in dark mode, where they already
// contrast well against the much darker dark-mode tint backgrounds.
const TONE_STYLE = {
  default: { background: "var(--card-bg, #F1F0EC)", color: "var(--ink-dim)" },
  success: { background: "var(--success-bg)", color: "var(--success-text)" },
  warning: { background: "var(--warning-bg)", color: "var(--warning-text)" },
  danger: { background: "var(--danger-bg)", color: "var(--danger-text)" },
  info: { background: "var(--info-bg)", color: "var(--info-text)" },
};

export default function Badge({ tone = "default", children, style, mono = false }) {
  return (
    <span className={mono ? "mono badge" : "badge"} style={{ ...TONE_STYLE[tone] || TONE_STYLE.default, ...style }}>
      {children}
    </span>
  );
}
