// Small inline spinner — distinct from LoadingScreen.jsx (a full-page loader). Use for "this one
// section/button is working," not "the whole page hasn't loaded yet."
import { Loader2 } from "lucide-react";

export default function LoadingSpinner({ size = 16, label = "Loading", inline = false, style }) {
  return (
    <span role="status" aria-label={label} style={{ display: inline ? "inline-flex" : "flex", alignItems: "center", justifyContent: inline ? undefined : "center", padding: inline ? 0 : 24, ...style }}>
      <Loader2 size={size} className="ca-spin" style={{ color: "var(--ink-dim)" }} />
      <span className="ca-sr-only">{label}</span>
    </span>
  );
}
