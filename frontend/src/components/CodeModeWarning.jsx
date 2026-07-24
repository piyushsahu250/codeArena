import { detectCodeShapeMismatch } from "../utils/codeShapeMismatch";

// Shared across every coding surface — a live, pre-submit heads-up when the code shape looks
// wrong for the question's mode, so a student finds out before spending a Submit attempt on it
// instead of after. Renders nothing when there's nothing to warn about.
export default function CodeModeWarning({ evaluationType, language, code }) {
  const warning = detectCodeShapeMismatch(evaluationType, language, code);
  if (!warning) return null;
  return (
    <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#FFF6E5", border: "1px solid #F0D9A0", color: "#8A6116", fontSize: 12.5 }}>
      ⚠ {warning}
    </div>
  );
}
