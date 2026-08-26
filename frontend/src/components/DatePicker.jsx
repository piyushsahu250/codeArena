// Thin wrapper over the platform's existing raw <input type="date"> convention (11 files use this
// directly) — same native browser date picker (keyboard-accessible by default), just styled
// consistently with Input.jsx and given a min/max-aware error state.
const baseStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14 };

export default function DatePicker({ error, style, ...rest }) {
  return (
    <input
      type="date"
      style={{ ...baseStyle, ...(error ? { borderColor: "var(--rust)" } : null), ...style }}
      aria-invalid={!!error || undefined}
      {...rest}
    />
  );
}
