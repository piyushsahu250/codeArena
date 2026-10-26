// Reading-order text renderer for pdf-parse. Runs inside the PDF worker thread (pdfTextWorker.js), never in the API request path.

// pdf-parse's default text renderer trusts the order pdf.js hands back text items in, which is
// the PDF content stream's internal declaration order — NOT necessarily top-to-bottom reading
// order. Many resume templates (Canva exports especially) position a date or company name as an
// absolutely-positioned "floating" text box rather than inline flowing text; the underlying PDF
// can declare that floating box's text anywhere in the stream regardless of where it's drawn on
// the page. Concretely: a "Work Experience" heading was found appearing in the extracted text
// AFTER the job entries it's supposed to introduce (right before "Projects" instead), which
// silently merged an entire Work Experience section into whatever section preceded it. This
// reconstructs each page's text by actual (x, y) glyph position instead — group text items into
// visual lines by Y-coordinate proximity, sort those lines top-to-bottom, and sort items within
// each line left-to-right — so extraction order matches what a human actually sees on the page.
// This does not attempt real multi-column layout detection (a genuinely hard, separate problem —
// see the file-level comment above); it fixes the specific "elements declared out of visual order
// within an otherwise single reading column" case, which is what broke on the reported test file.
const MAX_ITEMS_PER_PAGE = 20000;

function renderPageInReadingOrder(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((textContent) => {
    const LINE_TOLERANCE = 2; // points — items within this Y delta are treated as the same visual line
    const lineGroups = [];
    // A page with an absurd number of text items (a crafted file) is cut off here; a real resume page has a few hundred.
    const items = textContent.items.length > MAX_ITEMS_PER_PAGE ? textContent.items.slice(0, MAX_ITEMS_PER_PAGE) : textContent.items;
    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;
      const y = item.transform[5];
      const x = item.transform[4];
      let group = lineGroups.find((g) => Math.abs(g.y - y) <= LINE_TOLERANCE);
      if (!group) { group = { y, items: [] }; lineGroups.push(group); }
      group.items.push({ str: item.str, x, endX: x + (item.width || item.str.length * 4) });
    }
    lineGroups.sort((a, b) => b.y - a.y); // PDF y-axis grows upward, so the top of the page has the largest y

    // Most consecutive lines sit one normal line-height apart; a visibly larger gap is the extra
    // spacing a template puts before a new entry/section — the paragraph-break signal splitBlocks()
    // (and, one level up, splitEntries()) relies on to tell "new project/job" apart from "wrapped
    // continuation of the same bullet". Joining every line with a single "\n" and nothing else
    // erases that signal entirely, forcing every resume through the much less reliable structural
    // fallback and causing entries to be mis-split even when the source PDF had normal spacing.
    const gaps = [];
    for (let i = 1; i < lineGroups.length; i++) gaps.push(lineGroups[i - 1].y - lineGroups[i].y);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const typicalGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 12;
    const gapThreshold = Math.max(typicalGap * 1.5, typicalGap + 4);

    const lines = [];
    lineGroups.forEach((group, i) => {
      if (i > 0 && lineGroups[i - 1].y - group.y > gapThreshold) lines.push("");
      group.items.sort((a, b) => a.x - b.x);
      let text = "";
      let lastEndX = null;
      for (const it of group.items) {
        if (lastEndX !== null && it.x - lastEndX > 1) text += " ";
        text += it.str;
        lastEndX = it.endX;
      }
      lines.push(text);
    });
    return lines.join("\n");
  });
}

module.exports = { renderPageInReadingOrder };
