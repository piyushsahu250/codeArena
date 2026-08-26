// Native checkbox + label, wrapped so it's always keyboard/screen-reader correct (a real <label>
// association, not just adjacent text) — several pages pair a bare <input type="checkbox"> with
// unassociated text, which native browser behavior toggles by direct click only, not by label click.
export default function Checkbox({ label, id, checked, onChange, disabled, style }) {
  const autoId = id || `ca-checkbox-${label?.replace(/\s+/g, "-").toLowerCase() || Math.random().toString(36).slice(2)}`;
  return (
    <label htmlFor={autoId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, ...style }}>
      <input id={autoId} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}
