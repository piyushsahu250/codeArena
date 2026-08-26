// Shared status badge. Reuses the existing `.badge` CSS class from theme.css (padding/radius/font)
// and maps semantic tones onto the same soft-background color language theme.css already defines
// for badge-easy/medium/hard (mint=success, amber=warning, rust=danger), rather than inventing a
// new palette. Replaces ad-hoc inline overrides like
//   <span className="badge" style={{ background: "var(--rust)", color: "#fff" }}>Inactive</span>
// scattered across AdminDashboard.jsx and others with one consistent, theme-aware component.
const TONE_STYLE = {
  default: { background: "var(--card-bg, #F1F0EC)", color: "var(--ink-dim)" },
  success: { background: "#E7F3EB", color: "var(--mint)" },
  warning: { background: "#FCEFD9", color: "var(--amber-dark)" },
  danger: { background: "#F7E4E0", color: "var(--rust)" },
  info: { background: "#E5EDF6", color: "#3D6FA8" },
};

export default function Badge({ tone = "default", children, style }) {
  return (
    <span className="badge" style={{ ...TONE_STYLE[tone] || TONE_STYLE.default, ...style }}>
      {children}
    </span>
  );
}
