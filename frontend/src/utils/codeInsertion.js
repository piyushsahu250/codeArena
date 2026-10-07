// Pure and DOM-free so it can be unit-tested (frontend/scripts/keyboardRegression.mjs). `changes` is Monaco's e.changes
// ([{ text, rangeLength }]). Normal typing inserts 1-2 characters per change and ordinary autocomplete a few dozen; a single
// change (or one burst) that drops hundreds of characters / many lines into the editor with no typing around it is the
// pattern that pasted answers and code-assistant extensions produce. It is a weak signal, so callers only log evidence.
export function classifyInsertion(changes, { charThreshold = 400, lineThreshold = 25 } = {}) {
  let chars = 0, lines = 0;
  for (const c of changes || []) {
    const t = String(c.text || "");
    chars += t.length;
    lines += (t.match(/\n/g) || []).length;
  }
  if (chars >= charThreshold || lines >= lineThreshold) return { suspicious: true, chars, lines };
  return { suspicious: false, chars, lines };
}
