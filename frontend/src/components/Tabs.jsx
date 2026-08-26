// Shared tabs, extracted from StudentProfile.jsx's pattern (styled buttons over local state) into
// a reusable component with the ARIA tab roles that pattern never had (role="tablist"/"tab",
// aria-selected, arrow-key navigation between tabs — none of which a plain button row gets for free).
export default function Tabs({ tabs, active, onChange, style }) {
  function onKeyDown(e, idx) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(idx + dir + tabs.length) % tabs.length];
    onChange(next.key);
    document.getElementById(`ca-tab-${next.key}`)?.focus();
  }

  return (
    <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap", ...style }}>
      {tabs.map((t, idx) => (
        <button
          key={t.key}
          id={`ca-tab-${t.key}`}
          role="tab"
          aria-selected={active === t.key}
          tabIndex={active === t.key ? 0 : -1}
          className={active === t.key ? "btn btn-dark" : "btn btn-ghost"}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => onKeyDown(e, idx)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
