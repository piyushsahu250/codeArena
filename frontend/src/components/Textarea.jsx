const baseStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontFamily: "var(--font-body)", resize: "vertical" };

export default function Textarea({ error, style, rows = 4, ...rest }) {
  return (
    <textarea
      rows={rows}
      style={{ ...baseStyle, ...(error ? { borderColor: "var(--rust)" } : null), ...style }}
      aria-invalid={!!error || undefined}
      {...rest}
    />
  );
}
