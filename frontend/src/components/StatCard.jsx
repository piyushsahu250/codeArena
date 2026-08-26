// Shared stat-card, replacing the near-identical local `StatCard`/`DashboardCard`/`MiniStat`
// definitions previously copy-pasted into AdminDashboard.jsx, StaffDashboard.jsx, ClerkDashboard.jsx,
// and StudentDashboard.jsx. `size="compact"` covers the old MiniStat/MoreStat inline-in-a-row use
// case; the default size covers the card-grid use case (the large majority of call sites).
//
// onClick makes the card a real keyboard-operable button (role="button", tabIndex, Enter/Space) —
// StaffDashboard's original StatCard already did this; the others didn't, so clickable stat cards
// elsewhere previously had no keyboard affordance at all.
export default function StatCard({ icon: Icon, label, value, accent, onClick, size = "default" }) {
  const clickable = !!onClick;
  const content = size === "compact" ? (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {Icon && <Icon size={14} style={{ color: "var(--ink-dim)" }} />}
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: accent || "var(--ink)" }}>{value ?? "—"}</span>
      <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{label}</span>
    </div>
  ) : (
    <>
      {Icon && (
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 8, background: "var(--card-bg, #F7F7F5)" }}>
          <Icon size={17} color={accent || "var(--ink)"} />
        </div>
      )}
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: accent || "var(--ink)", marginTop: Icon ? 10 : 0 }}>{value ?? "—"}</div>
      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>{label}</div>
    </>
  );

  return (
    <div
      className={`card${clickable ? " card-clickable" : ""}`}
      style={{ padding: size === "compact" ? 0 : "14px 16px", cursor: clickable ? "pointer" : "default", border: size === "compact" ? "none" : undefined, background: size === "compact" ? "transparent" : undefined }}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      {content}
    </div>
  );
}
