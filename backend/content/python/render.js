// Renders one structured lesson spec into the sanitized-HTML `Lesson.content` the student lesson page
// already shows (LessonView runs it through DOMPurify; inline <svg>, <details>, <table> survive).
// Every lesson goes through this one template so all lessons carry the same 20-part structure.
"use strict";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (items, tag = "ul") => `<${tag}>${items.map((i) => `<li>${i}</li>`).join("")}</${tag}>`;
const code = (src, lang = "python") => `<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px;overflow:auto;font-size:.92em;line-height:1.5"><code class="language-${lang}">${esc(src.replace(/\n$/, ""))}</code></pre>`;
const stdinBlock = (s) => s == null ? "" : `<p style="margin:.4rem 0 .2rem"><strong>Input typed by the user</strong></p><pre style="background:rgba(56,139,253,.13);padding:10px 14px;border-radius:8px;overflow:auto;font-size:.92em"><code>${esc(String(s))}</code></pre>`;
const output = (out) => `<p style="margin:.4rem 0 .2rem"><strong>Output</strong></p><pre style="background:rgba(46,160,67,.13);padding:10px 14px;border-radius:8px;overflow:auto;font-size:.92em"><code>${esc(out.replace(/\n$/, ""))}</code></pre>`;
// A terminal window illustration: title bar plus the commands (lines starting with "$ " or "> " are what you type).
const terminal = (title, text) =>
  `<figure style="margin:1rem 0"><div style="border-radius:8px;overflow:hidden;border:1px solid rgba(127,127,127,.5)"><div style="background:#3b3f45;color:#eee;padding:5px 12px;font-size:.8em">${esc(title)}</div>` +
  `<pre style="margin:0;background:#16181c;color:#d8dee9;padding:12px 14px;overflow:auto;font-size:.9em;line-height:1.5"><code>${esc(text.replace(/\n$/, ""))}</code></pre></div></figure>`;
const h = (n, t) => `<h${n} style="margin:1.4rem 0 .5rem">${t}</h${n}>`;
const table = (headers, rows) =>
  `<div style="overflow-x:auto"><table style="border-collapse:collapse;min-width:60%">` +
  `<thead><tr>${headers.map((c) => `<th style="border:1px solid rgba(127,127,127,.5);padding:6px 10px;text-align:left">${c}</th>`).join("")}</tr></thead>` +
  `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="border:1px solid rgba(127,127,127,.5);padding:6px 10px;vertical-align:top">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

// ---- Diagram helpers: accessible inline SVG that follows the page text colour (light and dark) ----
const svgWrap = (w, h2, title, desc, inner) =>
  `<figure style="margin:1rem 0;text-align:center;overflow-x:auto"><svg viewBox="0 0 ${w} ${h2}" role="img" aria-labelledby="t d" style="width:100%;min-width:${Math.min(w, 520)}px;max-width:${w}px;height:auto" xmlns="http://www.w3.org/2000/svg">` +
  `<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>` +
  `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>` +
  `${inner}</svg><figcaption style="font-size:.85em;opacity:.8">${esc(title)}</figcaption></figure>`;

const lines = (label, x, y, size = 14, anchor = "middle") => {
  const parts = String(label).split("\n");
  const y0 = y - ((parts.length - 1) * (size + 3)) / 2 + size / 3;
  return `<text x="${x}" y="${y0}" text-anchor="${anchor}" font-size="${size}" fill="currentColor" font-family="system-ui,sans-serif">` +
    parts.map((p, i) => `<tspan x="${x}" dy="${i ? size + 3 : 0}">${esc(p)}</tspan>`).join("") + `</text>`;
};

// kind: term (rounded), proc (rectangle), io (parallelogram), dec (diamond)
const node = (kind, label, cx, cy, w, hgt) => {
  const x = cx - w / 2, y = cy - hgt / 2, st = `fill="rgba(127,127,127,.10)" stroke="currentColor" stroke-width="1.6"`;
  let s;
  if (kind === "term") s = `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${hgt / 2}" ${st}/>`;
  else if (kind === "io") s = `<polygon points="${x + 14},${y} ${x + w},${y} ${x + w - 14},${y + hgt} ${x},${y + hgt}" ${st}/>`;
  else if (kind === "dec") s = `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + hgt} ${x},${cy}" ${st}/>`;
  else s = `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="4" ${st}/>`;
  return s + lines(label, cx, cy);
};

// Straight left-to-right or top-to-bottom chain of boxes joined by arrows.
function chain(title, desc, items, { vertical = false, w = 150, hgt = 54, gap = 36 } = {}) {
  const n = items.length;
  const W = vertical ? w + 40 : n * w + (n - 1) * gap + 40;
  const H = vertical ? n * hgt + (n - 1) * gap + 40 : hgt + 40;
  let inner = "";
  items.forEach((it, i) => {
    const kind = typeof it === "string" ? "proc" : it.k, label = typeof it === "string" ? it : it.t;
    const cx = vertical ? W / 2 : 20 + w / 2 + i * (w + gap), cy = vertical ? 20 + hgt / 2 + i * (hgt + gap) : H / 2;
    inner += node(kind, label, cx, cy, w, hgt);
    if (i < n - 1) {
      inner += vertical
        ? `<line x1="${cx}" y1="${cy + hgt / 2}" x2="${cx}" y2="${cy + hgt / 2 + gap}" stroke="currentColor" stroke-width="1.6" marker-end="url(#ah)"/>`
        : `<line x1="${cx + w / 2}" y1="${cy}" x2="${cx + w / 2 + gap}" y2="${cy}" stroke="currentColor" stroke-width="1.6" marker-end="url(#ah)"/>`;
    }
  });
  return svgWrap(W, H, title, desc, inner);
}

// Boxes laid out freely: nodes [{id,k,t,x,y,w,h}], edges [{from,to,label?}] (straight lines between box edges).
function graph(title, desc, W, H, nodes, edges) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  let inner = "";
  for (const e of edges) {
    const a = byId[e.from], b = byId[e.to];
    const pt = (n, o) => {
      const dx = o.x - n.x, dy = o.y - n.y;
      if (Math.abs(dy) * (n.w || 150) >= Math.abs(dx) * (n.h || 54)) return { x: n.x, y: n.y + Math.sign(dy) * (n.h || 54) / 2 };
      return { x: n.x + Math.sign(dx) * (n.w || 150) / 2, y: n.y };
    };
    const p1 = pt(a, b), p2 = pt(b, a);
    inner += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="currentColor" stroke-width="1.6" marker-end="url(#ah)"/>`;
    if (e.label) {
      const horizontal = Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y); // keep the label clear of the arrow: above a horizontal line, beside a vertical one
      inner += horizontal ? lines(e.label, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 10, 12, "middle") : lines(e.label, (p1.x + p2.x) / 2 + (e.dx || 12), (p1.y + p2.y) / 2, 12, "start");
    }
  }
  for (const n of nodes) inner += node(n.k || "proc", n.t, n.x, n.y, n.w || 150, n.h || 54);
  return svgWrap(W, H, title, desc, inner);
}

// ---- The standard 20-part lesson ----
function renderLesson(L) {
  const p = [];
  p.push(`<div class="py-lesson">`);
  p.push(h(2, "What will you learn?") + list(L.learn));
  p.push(h(2, "Why is this concept important?") + `<p>${L.why}</p>`);
  p.push(h(2, "Real-world application") + `<p>${L.realWorld}</p>`);
  p.push(h(2, "Simple explanation") + `<p>${L.simple}</p>`);
  p.push(h(2, "Detailed explanation") + L.detail);
  if (L.syntax) p.push(h(2, "Syntax") + code(L.syntax.code, L.syntax.lang || "python") + (L.syntax.note ? `<p>${L.syntax.note}</p>` : ""));
  p.push(h(2, "Diagram") + L.diagram);
  p.push(h(2, "Basic example") + code(L.example.code) + stdinBlock(L.example.stdin) + output(L.example.out));
  p.push(h(3, "Line-by-line explanation") + `<ol>${L.lineByLine.map(([l, t]) => `<li><code>${esc(l)}</code> &mdash; ${t}</li>`).join("")}</ol>`);
  if (L.dryRun) p.push(h(3, "Dry run") + (L.dryRun.intro ? `<p>${L.dryRun.intro}</p>` : "") + table(L.dryRun.headers, L.dryRun.rows));
  p.push(h(2, "Real-world example") + (L.realExample.intro ? `<p>${L.realExample.intro}</p>` : "") + code(L.realExample.code) + stdinBlock(L.realExample.stdin) + output(L.realExample.out));
  p.push(h(2, "Common mistakes") + list(L.mistakes));
  p.push(h(2, "Best practices") + list(L.practices));
  p.push(h(2, "Interview perspective") + list(L.interview));
  p.push(h(2, "Practice questions") + list(L.practiceQs, "ol"));
  p.push(h(2, "Quick revision") + list(L.revision));
  if (L.hinglish) p.push(`<details style="margin-top:1rem"><summary><strong>Hinglish mein samjhein (optional)</strong></summary><p>${L.hinglish}</p></details>`);
  p.push(`<p style="margin-top:1.4rem"><em>Next: answer the topic quiz and finish the hands-on coding task in the practice section of this lesson.</em></p>`);
  p.push(`</div>`);
  return p.join("\n");
}

module.exports = { esc, list, code, output, h, table, terminal, chain, graph, svgWrap, renderLesson };
