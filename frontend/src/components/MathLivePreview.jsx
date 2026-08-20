import MathText from "./MathText";

// Small "how this will actually render" strip for question-authoring forms — only appears once
// the staff member has typed a $ delimiter, so it stays out of the way for the vast majority of
// plain-text questions. Pairs with the one-line syntax hint (MathSyntaxHint below) so staff don't
// need to already know LaTeX; they can type, glance at the preview, and adjust.
export function MathLivePreview({ text }) {
  if (!text || !text.includes("$")) return null;
  return (
    <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 6, border: "1px dashed var(--line)", background: "var(--card-bg, #F7F7F5)", fontSize: 13 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-dim)", marginRight: 8 }}>PREVIEW</span>
      <MathText text={text} />
    </div>
  );
}

export function MathSyntaxHint() {
  return (
    <p style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
      Math equations: wrap inline math in single dollar signs, e.g. <code>$x^2 + y^2 = z^2$</code>, or use
      double dollar signs for a standalone equation, e.g. <code>$$\int_0^1 x^2\,dx$$</code>. Plain text without
      dollar signs is unaffected.
    </p>
  );
}
