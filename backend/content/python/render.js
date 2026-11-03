// Renders one structured lesson spec into the sanitized-HTML `Lesson.content` the student lesson page
// already shows (LessonView runs it through DOMPurify; inline <svg>, <details>, <table> survive).
// Every lesson goes through this one template so all lessons carry the same 20-part structure.
"use strict";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (items, tag = "ul") => `<${tag}>${items.map((i) => `<li>${i}</li>`).join("")}</${tag}>`;
const code = (src, lang = "python") => `<pre style="background:#16181c;color:#d8dee9;padding:12px 14px;border-radius:8px;overflow:auto;font-size:.92em;line-height:1.5"><code class="language-${lang}">${esc(src.replace(/\n$/, ""))}</code></pre>`;
const stdinBlock = (s) => s == null ? "" : `<p style="margin:.4rem 0 .2rem"><strong>Input typed by the user</strong></p><pre style="background:rgba(56,139,253,.13);color:inherit;padding:10px 14px;border-radius:8px;overflow:auto;font-size:.92em"><code>${esc(String(s))}</code></pre>`;
const output = (out) => `<p style="margin:.4rem 0 .2rem"><strong>Output</strong></p><pre style="background:rgba(46,160,67,.13);color:inherit;padding:10px 14px;border-radius:8px;overflow:auto;font-size:.92em"><code>${esc(out.replace(/\n$/, ""))}</code></pre>`;
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
  // Layout gate: every box must sit inside the canvas, and no arrow may run through a box it does not start or end at.
  for (const n of nodes) {
    const w = n.w || 150, h = n.h || 54;
    if (n.x - w / 2 < 0 || n.y - h / 2 < 0 || n.x + w / 2 > W || n.y + h / 2 > H) throw new Error(`diagram "${title}": box "${n.t}" is outside the ${W}x${H} canvas`);
  }
  for (const e of edges) {
    const a = byId[e.from], b = byId[e.to];
    for (const n of nodes) {
      if (n === a || n === b) continue;
      const w = (n.w || 150) / 2 - 3, h = (n.h || 54) / 2 - 3;
      for (let t = 0.05; t < 0.96; t += 0.05) {
        const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        if (Math.abs(px - n.x) < w && Math.abs(py - n.y) < h) throw new Error(`diagram "${title}": arrow ${e.from}->${e.to} runs through box "${n.t}"`);
      }
    }
  }
  for (const n of nodes) inner += node(n.k || "proc", n.t, n.x, n.y, n.w || 150, n.h || 54);
  return svgWrap(W, H, title, desc, inner);
}

// ---- The standard 20-part lesson ----
// Interview question-and-answer lesson (Module 22): each question shows a program first; the answer, explanation,
// common misconceptions and a follow-up sit behind a details element so students can try before looking.
function renderQa(L) {
  const p = [`<div class="py-lesson">`];
  p.push(h(2, "What will you learn?") + list(L.learn));
  p.push(h(2, "Why is this topic asked in interviews?") + `<p>${L.why}</p>`);
  p.push(h(2, "How to use this lesson") + `<p>${L.howTo || "Read each program, decide what it prints (or which error it raises) before opening the answer, then read the explanation, the common misconceptions and the follow-up question. The same questions appear as a quiz below, so you can test yourself again later."}</p>`);
  L.items.forEach((it, i) => {
    p.push(h(3, `Q${i + 1}. ${esc(it.q)} <small style="opacity:.7">(${it.levelName})</small>`) + code(it.code));
    p.push(`<details style="margin:.3rem 0 1.2rem"><summary><strong>Show the answer</strong></summary>` +
      (it.err ? `<p>The program raises <code>${esc(it.err)}</code>.</p>` : output(it.out)) +
      `<p><strong>Why:</strong> ${esc(it.why)}</p><p><strong>Common misconceptions:</strong> ${esc(it.miscon)}</p>` +
      `<p><strong>Follow-up:</strong> ${esc(it.follow[0])}<br><em>Answer:</em> ${esc(it.follow[1])}</p></details>`);
  });
  p.push(h(2, "Quick revision") + list(L.revision));
  p.push(`<p style="margin-top:1.4rem"><em>Next: answer the quiz (the same programs, multiple choice) and solve the coding task in the practice section.</em></p></div>`);
  return p.join("\n");
}

// Placement practice set (Module 23): mixed multiple-choice, output-prediction, find-the-error and code-completion questions.
// Answers sit inside a details element, so a student can attempt each question before looking.
function renderSet(L) {
  const p = [`<div class="py-lesson">`];
  p.push(h(2, "What will you learn?") + list(L.learn));
  p.push(h(2, "Why does this matter for placements?") + `<p>${L.why}</p>`);
  p.push(h(2, "How to use this practice set") + `<p>${L.howTo || "Try each question before opening the answer. For timed practice, give yourself about one minute per question and mark the ones you missed. The same questions appear as a quiz below, which records your score."}</p>`);
  L.set.forEach((it, i) => {
    const head = (title) => h(3, `Q${i + 1}. ${title} <small style="opacity:.7">(${it.levelName})</small>`);
    if (it.kind === "OUT") {
      p.push(head(esc(it.q)) + code(it.code));
      p.push(`<details style="margin:.3rem 0 1.2rem"><summary><strong>Show the answer</strong></summary>` + (it.err ? `<p>The program raises <code>${esc(it.err)}</code>.</p>` : output(it.out)) +
        `<p><strong>Why:</strong> ${esc(it.why)}</p><p><strong>Common misconceptions:</strong> ${esc(it.miscon)}</p><p><strong>Follow-up:</strong> ${esc(it.follow[0])}<br><em>Answer:</em> ${esc(it.follow[1])}</p></details>`);
    } else if (it.kind === "MCQ") {
      p.push(head(esc(it.prompt)) + `<ol type="A">${it.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ol>`);
      p.push(`<details style="margin:.3rem 0 1.2rem"><summary><strong>Show the answer</strong></summary><p><strong>Answer:</strong> ${"ABCD"[it.answer]}. ${esc(it.options[it.answer])}</p><p>${esc(it.why)}</p></details>`);
    } else if (it.kind === "FILL") {
      p.push(head(esc(it.prompt)) + code(it.template));
      p.push(`<details style="margin:.3rem 0 1.2rem"><summary><strong>Show the answer</strong></summary><p><strong>Fill in:</strong> <code>${esc(it.answer)}</code></p>${output(it.out)}<p>${esc(it.why)}</p></details>`);
    } else {
      const shows = it.symptom.startsWith("!") ? `it raises <code>${esc(it.symptom.slice(1))}</code>` : "it prints:";
      p.push(head("Find the error") + `<p>The program should ${esc(it.intent)}, but when run ${shows}</p>` + (it.symptom.startsWith("!") ? "" : output(it.symptom)) + code(it.code) +
        `<ol type="A">${it.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ol>`);
      p.push(`<details style="margin:.3rem 0 1.2rem"><summary><strong>Show the answer</strong></summary><p><strong>Answer:</strong> ${"ABCD"[it.answer]}. ${esc(it.options[it.answer])}</p><p>${esc(it.why)}</p><p><strong>Fixed program:</strong></p>${code(it.fixed)}${output(it.fixedOut)}</details>`);
    }
  });
  p.push(h(2, "Quick revision") + list(L.revision));
  p.push(`<p style="margin-top:1.4rem"><em>Next: answer the quiz below (the same questions, graded) and finish the coding task in the practice section.</em></p></div>`);
  return p.join("\n");
}

// ---- Real-world projects (Phase 6): the 19-part project guide ----
// A flowchart as a snake of boxes: left to right on the top row, right to left on the bottom row, with an optional return arrow
// from the last box up to the first (a program that repeats until the user quits). Every arrow joins neighbouring boxes.
function flow(title, desc, labels, { loop = false } = {}) {
  const n = labels.length, cols = Math.ceil(n / 2), W = cols * 190 + 40, H = n > 1 ? 210 : 110, bw = 160, bh = 56;
  const colX = (c) => 20 + 95 + c * 190;
  const nodes = labels.map((t, i) => {
    const top = i < cols;
    const c = top ? i : cols - 1 - (i - cols);
    return { id: `n${i}`, k: i === 0 ? "term" : /\?$/.test(t) ? "dec" : "proc", t, x: colX(c), y: top ? 60 : 160, w: bw, h: bh };
  });
  const edges = nodes.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
  if (loop && n > 2) edges.push({ from: `n${n - 1}`, to: "n0", label: "repeat" });
  return graph(title, desc, W, H, nodes, edges);
}

const projectReadme = (P) => [
  `# ${P.title}`, "", P.problem, "",
  "## Features", ...P.requirements.map((r) => `- ${r}`), "",
  "## Requirements", `- Python 3.11 or newer${P.packages && P.packages.length ? "\n- Packages: " + P.packages.join(", ") : " (standard library only)"}`, "",
  "## How to run", "```bash", `python ${P.run}${P.args ? " " + P.args : ""}`, "```", "",
  "## Example", "```text", String(P.sample.out).replace(/\n$/, ""), "```", "",
  "## Tests", "```bash", `python -m unittest ${P.test.replace(/\.py$/, "")} -v`, "```", "",
  "## Project layout", "```text", ...(P.layout || Object.keys(P.files)), "README.md", "```", "",
  "## What I learned", "(Write three sentences about what was hard and how you solved it.)", "",
].join("\n");

function renderProject(P) {
  const p = [`<div class="py-lesson">`];
  const numbered = (n, t) => h(2, `${n}. ${t}`);
  const filesHtml = () => Object.entries(P.files).map(([name, src]) => `<p style="margin:.8rem 0 .2rem"><strong><code>${esc(name)}</code></strong></p>` + code(src)).join("");
  p.push(`<p><em>${P.kind === "MAJOR" ? "Major project" : "Mini project"} &middot; about ${P.minutes} minutes &middot; ${P.difficulty.toLowerCase()}${P.scratch ? " &middot; <strong>build from scratch: no step-by-step solution is published</strong>" : ""}</em></p>`);
  p.push(numbered(1, "Problem statement") + `<p>${esc(P.problem)}</p>`);
  p.push(numbered(2, "Real-world scenario") + `<p>${esc(P.scenario)}</p>`);
  p.push(numbered(3, "Learning objectives") + list(P.objectives.map(esc)));
  p.push(numbered(4, "Prerequisites") + list(P.prerequisites.map(esc)));
  p.push(numbered(5, "Requirements") + list(P.requirements.map(esc)));
  p.push(numbered(6, "System architecture") + P.architecture);
  p.push(numbered(7, "Flowchart") + P.flowchart);
  p.push(numbered(8, "Database schema") + (P.schema
    ? P.schema.map((t) => `<p><strong>Table <code>${esc(t.table)}</code></strong></p>` + table(["Column", "Type", "Notes"], t.columns.map((c) => c.map(esc)))).join("")
    : `<p>This project does not use a database.</p>`));
  if (P.scratch) {
    p.push(numbered(9, "Step-by-step implementation") + `<p>This is a <strong>build-from-scratch</strong> project, so no step-by-step solution is published. Work through the milestones in the Project tasks section: each one is checked by the platform, and the hints open up gradually. Plan first: sketch the data you need, the commands the program accepts and the order in which you will build them.</p>` + `<ol>${P.milestones.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>`);
    p.push(numbered(10, "Complete source code") + `<p>Not published for this project, so that you practise solving it independently. A reference solution exists and is used to check the acceptance tests; your instructor may share it after the deadline.</p>`);
  } else {
    p.push(numbered(9, "Step-by-step implementation") + `<ol>${P.steps.map(([t, x]) => `<li><strong>${esc(t)}</strong> ${esc(x)}</li>`).join("")}</ol>`);
    p.push(numbered(10, "Complete source code") + `<p>Type the code yourself, run it, and read it line by line. Every file below has been executed and tested.</p>` + filesHtml());
  }
  p.push(numbered(11, "Explanation of the important components") + table(["Component", "What it does and why"], P.explain.map(([a, b]) => [`<code>${esc(a)}</code>`, esc(b)])));
  p.push(numbered(12, "Sample input and output") + `<p>Run: <code>python ${esc(P.run)}${P.args ? " " + esc(P.args) : ""}</code></p>` + stdinBlock(P.stdin) + output(P.sample.out));
  p.push(numbered(13, "Testing instructions") + list(P.testing.map(esc)) + (P.scratch ? `<p>Write your own tests in <code>${esc(P.test)}</code> as you build; the platform's acceptance tests check the same behaviour.</p>` : `<p>The test file <code>${esc(P.test)}</code>, run with <code>python -m unittest ${esc(P.test.replace(/\.py$/, ""))} -v</code>:</p>` + code(P.files[P.test])));
  p.push(numbered(14, "Common bugs and debugging") + table(["Symptom", "Likely cause and fix"], P.bugs.map((b) => b.map(esc))));
  p.push(numbered(15, "Extension challenges") + list(P.extensions.map(esc)));
  p.push(numbered(16, "GitHub repository preparation") + `<ol><li>Create a new empty repository named <code>${esc(P.id)}</code> on GitHub (no generated files), then <code>git init</code> in your project folder.</li><li>Add a <code>.gitignore</code> containing <code>__pycache__/</code>, <code>.venv/</code>, <code>*.db</code>, <code>.env</code>.</li><li>Layout: ${(P.layout || Object.keys(P.files)).map((f) => `<code>${esc(f)}</code>`).join(", ")}${P.packages && P.packages.length ? ", <code>requirements.txt</code>" : ""}, <code>README.md</code>.</li><li>Commit in small steps with clear messages (for example <code>feat: add expense totals</code>, <code>test: cover empty input</code>).</li><li><code>git remote add origin &lt;your repository URL&gt;</code>, <code>git push -u origin main</code>, then check that the README shows correctly on GitHub.</li><li>Never commit passwords, tokens or personal data. Add a licence only if you understand it.</li></ol>`);
  p.push(numbered(17, "README creation") + `<p>Use this README as a starting point and replace the last section with your own words:</p>` + code(projectReadme(P), "markdown"));
  p.push(numbered(18, "Interview questions based on the project") + list(P.interview.map(esc), "ol"));
  p.push(numbered(19, "Project evaluation rubric") + table(["Criterion", "Points", "What is expected"], [...P.rubric.map(([a, pts, d]) => [esc(a), String(pts), esc(d)]), ["<strong>Total</strong>", `<strong>${P.rubric.reduce((s, r) => s + r[1], 0)}</strong>`, ""]]));
  p.push(`<p style="margin-top:1.4rem"><em>Next: open the Project tasks for this project, complete them in order, and submit your repository link to your instructor.</em></p></div>`);
  return p.join("\n");
}

// The final test of a module: the rules and what it covers. The questions are the lesson's own practice questions, which the platform grades together.
function renderModuleTest(L) {
  const p = [`<div class="py-lesson">`];
  p.push(h(2, "About this test") + `<p>This test checks what you learned in the whole module. It has ${L.quiz.length} questions, all multiple choice. You need <strong>70%</strong> to pass, which is <strong>${Math.ceil(L.quiz.length * 0.7)} correct answers</strong>. You can retake it as many times as you need; after every try you see which answers were right and why.</p>`);
  p.push(h(2, "Why it matters") + `<p>Passing this test is what completes the module and unlocks the next one. Finishing every module, including this test, is what earns the course certificate.</p>`);
  p.push(h(2, "What it covers") + list(L.covers.map(esc)));
  p.push(h(2, "Before you start") + list(["Skim the quick revision of any lesson you feel unsure about.", "Read each question completely; the answer options are in a different order for every student.", "If a question shows a program, work out its output on paper before you choose."]));
  p.push(`<p style="margin-top:1.4rem"><em>Scroll down to the questions. Answer all of them, then press Submit Test.</em></p></div>`);
  return p.join("\n");
}

function renderLesson(L) {
  if (L.moduleTest) return renderModuleTest(L);
  if (L.project) return renderProject(L.project);
  if (L.items) return renderQa(L);
  if (L.set) return renderSet(L);
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

module.exports = { esc, list, code, output, h, table, terminal, chain, graph, svgWrap, flow, projectReadme, renderLesson };
