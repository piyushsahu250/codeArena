// Shared empty-state, replacing 13+ locally-redefined `function EmptyState` copies across
// dashboard/list pages (StaffClerkManagement.jsx, AdminDashboard.jsx, StaffDashboard.jsx,
// StudentDashboard.jsx, ClerkDashboard.jsx, and others). Two shapes:
//   <EmptyState text="No completed tests yet." />                        — plain, in-place message
//   <EmptyState title="No tests yet" text="..." action={<Link .../>} />  — fuller card, with a CTA
export default function EmptyState({ text, title, icon: Icon, action, style }) {
  if (!title && !action) {
    // Plain inline text — matches every dashboard's previous minimal "nothing here" line exactly.
    return <p style={{ color: "var(--ink-dim)", fontSize: 13, textAlign: "center", padding: "12px 0", ...style }}>{text}</p>;
  }
  return (
    <div className="card" style={{ padding: 32, textAlign: "center", ...style }}>
      {Icon && <Icon size={28} style={{ color: "var(--ink-dim)", marginBottom: 10 }} />}
      {title && <p style={{ fontSize: 15, fontWeight: 600 }}>{title}</p>}
      {text && <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4 }}>{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
