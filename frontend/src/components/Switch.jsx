// Toggle switch — genuinely new UI element (no switch/toggle exists anywhere in this codebase;
// boolean settings previously used a plain checkbox). Built on a real <input type="checkbox"> for
// free keyboard support (Tab/Space) and the platform's existing focus-visible outline
// (button/input/select/textarea already get one in theme.css; this extends the same treatment),
// with a custom-styled track/thumb layered visually on top via the sibling-selector CSS below.
export default function Switch({ label, checked, onChange, disabled, id }) {
  const autoId = id || `ca-switch-${label?.replace(/\s+/g, "-").toLowerCase() || Math.random().toString(36).slice(2)}`;
  return (
    <label htmlFor={autoId} className="ca-switch-row" style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1 }}>
      <span className="ca-switch">
        <input id={autoId} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
        <span className="ca-switch-track"><span className="ca-switch-thumb" /></span>
      </span>
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </label>
  );
}
