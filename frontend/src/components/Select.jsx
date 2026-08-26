// Shared <select> — same visual language as Input, since raw `<select style={inputStyle}>` was the
// existing (undocumented) convention across ~39 files; this just gives it one owner.
const baseStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, background: "var(--card-bg, #fff)", color: "var(--ink)" };

export default function Select({ error, style, children, ...rest }) {
  return (
    <select
      style={{ ...baseStyle, ...(error ? { borderColor: "var(--rust)" } : null), ...style }}
      aria-invalid={!!error || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}
