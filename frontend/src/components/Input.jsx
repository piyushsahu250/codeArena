// Shared text input, matching the `inputStyle` object duplicated across ~34 page files. `error`
// adds a red border + aria-invalid (pair with FormField's error message via the same field).
const baseStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };

export default function Input({ error, style, ...rest }) {
  return (
    <input
      style={{ ...baseStyle, ...(error ? { borderColor: "var(--rust)" } : null), ...style }}
      aria-invalid={!!error || undefined}
      {...rest}
    />
  );
}
