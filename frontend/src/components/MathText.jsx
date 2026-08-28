import { Fragment, useMemo } from "react";
import katex from "katex";
import DOMPurify from "dompurify";

// Renders plain text that may contain LaTeX math delimited by $$...$$ (block/display) or
// $...$ (inline) — the same convention staff already recognize from Markdown-based tools, so
// there's nothing new to learn beyond "wrap the equation in dollar signs." Plain text with no
// delimiters renders byte-for-byte identical to before (this is a drop-in replacement for
// `{text}` inside an existing element — it does not add its own wrapping/whitespace styling, so
// callers keep whatever `white-space: pre-wrap` container they already had).
//
// Never throws: a malformed equation (unbalanced braces, unknown command) falls back to showing
// the raw source text with its delimiters, via KaTeX's own throwOnError: false — a bad equation
// degrades to visible text, it never blanks the question or crashes the page.

const BLOCK_RE = /\$\$([\s\S]+?)\$\$/g;
const INLINE_RE = /\$(?!\s)([^$\n]+?)(?<!\s)\$/g;

function renderKatex(source, displayMode) {
  try {
    const html = katex.renderToString(source, {
      throwOnError: false,
      displayMode,
      strict: "ignore",
    });
    return DOMPurify.sanitize(html, { ADD_TAGS: ["semantics", "annotation", "mspace"], ADD_ATTR: ["mathvariant"] });
  } catch {
    return null;
  }
}

// Splits `text` into an array of { type: "text" | "math", value, displayMode? } segments —
// block delimiters are matched first so `$$x$$` is never mis-split as inline `$` pairs first.
function splitSegments(text) {
  const segments = [];
  let cursor = 0;
  const blockMatches = [...text.matchAll(BLOCK_RE)];

  function splitInline(chunk, baseOffset) {
    let last = 0;
    for (const m of chunk.matchAll(INLINE_RE)) {
      if (m.index > last) segments.push({ type: "text", value: chunk.slice(last, m.index) });
      segments.push({ type: "math", value: m[1], displayMode: false, key: `${baseOffset + m.index}` });
      last = m.index + m[0].length;
    }
    if (last < chunk.length) segments.push({ type: "text", value: chunk.slice(last) });
  }

  for (const m of blockMatches) {
    if (m.index > cursor) splitInline(text.slice(cursor, m.index), cursor);
    segments.push({ type: "math", value: m[1], displayMode: true, key: `${m.index}` });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) splitInline(text.slice(cursor), cursor);

  return segments;
}

export default function MathText({ text }) {
  const segments = useMemo(() => {
    if (!text || typeof text !== "string" || !text.includes("$")) return null; // fast path — no math, no parsing cost
    return splitSegments(text);
  }, [text]);

  if (!text) return null;
  if (!segments) return text; // identical to the old `{text}` behavior for non-math content

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <Fragment key={i}>{seg.value}</Fragment>;
        const html = renderKatex(seg.value, seg.displayMode);
        if (html === null) {
          // Bad equation source — show it as visible plain text (with its delimiters) rather
          // than silently dropping it, so staff notice and fix the syntax.
          const raw = seg.displayMode ? `$$${seg.value}$$` : `$${seg.value}$`;
          return <Fragment key={i}>{raw}</Fragment>;
        }
        // Block-mode equations (matrices, wide fraction chains, long derivations) can render wider
        // than a narrow phone screen -- KaTeX has no built-in reflow for that, so without this the
        // overflow either gets silently clipped or forces the whole page to scroll sideways. Inline
        // math never needs this (it's just a span inside running text, no wider than one symbol/
        // fraction at a time) so the wrapper is display-mode only.
        if (seg.displayMode) {
          return <span key={i} style={{ display: "block", overflowX: "auto", maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </>
  );
}
