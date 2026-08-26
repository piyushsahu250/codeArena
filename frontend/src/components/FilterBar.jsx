// Layout wrapper for a row of filter controls (Select/Input/DatePicker), matching the
// `<div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>` shape repeated across every
// report/list page's filter row (StaffDashboard.jsx, ClerkDashboard.jsx, etc). Purely layout —
// each filter control is still whatever the page needs (Select, Input, DatePicker...).
export default function FilterBar({ children, style }) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", ...style }}>
      {children}
    </div>
  );
}
