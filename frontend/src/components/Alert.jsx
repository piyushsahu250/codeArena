import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

// Inline banner alert, reusing the same --success-bg/--warning-bg/--danger-bg/--info-bg tokens
// Badge.jsx uses — the dark-mode-safe surface colors this platform standardized on this session.
// Distinct from EmptyState (which is for "no data") and ErrorState (which is for "failed to load,
// with a retry"): Alert is for a one-off inline message ("feedback from your institute", "profile
// incomplete") that isn't tied to a data-fetch lifecycle.
const TONE = {
  success: { bg: "var(--success-bg)", color: "var(--mint)", Icon: CheckCircle2 },
  warning: { bg: "var(--warning-bg)", color: "var(--amber-dark)", Icon: AlertTriangle },
  danger: { bg: "var(--danger-bg)", color: "var(--rust)", Icon: XCircle },
  info: { bg: "var(--info-bg)", color: "#3D6FA8", Icon: Info },
};

export default function Alert({ tone = "info", title, children, style }) {
  const t = TONE[tone] || TONE.info;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className="card" style={{ padding: 16, background: t.bg, display: "flex", gap: 10, ...style }}>
      <t.Icon size={18} style={{ color: t.color, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
      <div>
        {title && <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>}
        {children && <div style={{ fontSize: 13, marginTop: title ? 2 : 0 }}>{children}</div>}
      </div>
    </div>
  );
}
