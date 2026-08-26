// Small square icon-only button (table row actions, close buttons, etc). Requires `label` — used
// as the accessible name (aria-label) since there's no visible text, and as the native `title`
// tooltip. Never render an icon-only control without one of these two ways to name it.
export default function IconButton({ icon: Icon, label, onClick, variant = "ghost", size = 32, disabled = false, style }) {
  const danger = variant === "danger";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: 8, border: variant === "ghost" ? "1px solid var(--line)" : "none",
        background: variant === "dark" ? "var(--slate-900)" : "transparent",
        color: danger ? "var(--rust)" : variant === "dark" ? "var(--chalk)" : "var(--ink)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        transition: "background 0.12s ease",
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? "var(--danger-bg)" : "rgba(28,27,24,0.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = variant === "dark" ? "var(--slate-900)" : "transparent"; }}
    >
      <Icon size={Math.round(size * 0.5)} />
    </button>
  );
}
