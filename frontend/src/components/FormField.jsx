// Label + required-indicator + help text + field-level error, wrapping any input control. Matches
// the `labelStyle`/`inputStyle` visual convention already duplicated across ~34 page files (e.g.
// AdminDashboard.jsx, StudentProfile.jsx) so wrapping existing raw <input>s in this loses nothing.
export default function FormField({ label, htmlFor, required, help, error, children, style }) {
  return (
    <div style={style}>
      {label && (
        <label htmlFor={htmlFor} style={{ display: "block", fontSize: 13, fontWeight: 600, marginTop: 14, marginBottom: 6 }}>
          {label}
          {required && <span style={{ color: "var(--rust)" }} aria-hidden="true"> *</span>}
          {required && <span className="ca-sr-only"> required</span>}
        </label>
      )}
      {children}
      {help && !error && <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>{help}</p>}
      {error && <p role="alert" style={{ fontSize: 12, color: "var(--rust)", marginTop: 4 }}>{error}</p>}
    </div>
  );
}
