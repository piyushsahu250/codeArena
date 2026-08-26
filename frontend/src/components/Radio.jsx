export default function Radio({ label, name, value, checked, onChange, disabled, style }) {
  const autoId = `ca-radio-${name}-${value}`;
  return (
    <label htmlFor={autoId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, ...style }}>
      <input id={autoId} type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}
