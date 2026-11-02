// Quality gate for the Python Zero to Hero course content.
//   node scripts/validatePythonContent.js          structure lint only (no Python needed)
//   node scripts/validatePythonContent.js --run    also executes every code example, task solution and
//                                                  assessment solution with python3 and compares output
// Exits non-zero on any problem. The seed script refuses to run if this fails.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { modules } = require("../content/python");
const { renderLesson } = require("../content/python/render");

const RUN = process.argv.includes("--run");
const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);
const BANNED = /coming soon|lorem ipsum|\btodo\b|\btbd\b|placeholder (text|content)|fixme/i;

// Programs run from a real file (not -c) so multiprocessing, which re-imports the main module, behaves as it does for students.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pycontent-"));
let runCounter = 0;
const py = (src, input = "") => {
  const file = path.join(workDir, `main${runCounter++}.py`);
  fs.writeFileSync(file, src);
  const r = spawnSync(process.env.PYTHON || "python3", ["-I", file], { input, encoding: "utf8", timeout: 20000 });
  return { out: (r.stdout || "").replace(/\r\n/g, "\n"), err: r.stderr || "", status: r.status };
};
process.on("exit", () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ } });
const norm = (s) => s.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");

const REQUIRED = ["title", "minutes", "learn", "why", "realWorld", "simple", "detail", "diagram", "example", "lineByLine", "dryRun", "realExample", "mistakes", "practices", "interview", "practiceQs", "revision", "quiz", "tasks"];
let lessonCount = 0, taskCount = 0, quizCount = 0, assessmentCount = 0, ran = 0;
const titles = new Set(), prompts = new Set();

function checkTask(where, t) {
  if (!t.title || !t.statement || t.statement.length < 20) bad(where, "task needs title and statement");
  const vis = t.testCases.filter((c) => !c.isHidden).length, hid = t.testCases.filter((c) => c.isHidden).length;
  if (vis < 2) bad(where, "needs at least 2 sample test cases");
  if (hid < 1) bad(where, "needs at least 1 hidden test case");
  if (prompts.has(t.title)) bad(where, `duplicate task title "${t.title}"`);
  prompts.add(t.title);
  if (!RUN) return;
  for (const [i, c] of t.testCases.entries()) {
    const r = py(t.solution, c.input);
    ran++;
    if (r.status !== 0 || norm(r.out) !== norm(c.expected)) bad(where, `reference solution fails case ${i + 1}: got ${JSON.stringify(r.out)} expected ${JSON.stringify(c.expected)} ${r.err.slice(-200)}`);
  }
  if (t.starter && t.starter.trim()) {
    const passes = t.testCases.every((c) => { const r = py(t.starter, c.input); return r.status === 0 && norm(r.out) === norm(c.expected); });
    if (passes) bad(where, "starter code already passes all tests");
  }
}

for (const m of modules) {
  const mod = m.module;
  if (!mod.title || !mod.chapters?.length) bad(mod.title || "module", "missing title or chapters");
  for (const ch of mod.chapters) {
    for (const L of ch.lessons) {
      const w = `${mod.title} / ${L.title}`;
      lessonCount++;
      for (const f of REQUIRED) if (L[f] == null || (Array.isArray(L[f]) && !L[f].length)) bad(w, `missing ${f}`);
      if (titles.has(L.title)) bad(w, "duplicate lesson title");
      titles.add(L.title);
      let html = "";
      try { html = renderLesson(L); } catch (e) { bad(w, `render failed: ${e.message}`); continue; }
      if (BANNED.test(html)) bad(w, `contains banned placeholder wording: ${html.match(BANNED)[0]}`);
      if (!/<svg[^>]*role="img"/.test(html) || !/<title[^>]*>[^<]+<\/title>/.test(html) || !/<desc[^>]*>[^<]+<\/desc>/.test(html)) bad(w, "diagram needs role=img, title and desc");
      if (html.length < 4000) bad(w, `lesson looks too thin (${html.length} chars)`);
      if (/<script|onerror=|onload=|javascript:/i.test(html)) bad(w, "unsafe markup");
      if ((L.quiz || []).length < 3) bad(w, "needs at least 3 quiz questions");
      for (const q of L.quiz || []) {
        quizCount++;
        if (prompts.has(q.prompt)) bad(w, `duplicate quiz prompt: ${q.prompt.slice(0, 40)}`);
        prompts.add(q.prompt);
        if (q.type === "FILL_BLANK") { if (typeof q.correctAnswer !== "string" || !q.correctAnswer) bad(w, "FILL_BLANK needs correctAnswer"); }
        else if (!Array.isArray(q.options) || q.options.length < 2 || !Number.isInteger(q.correctAnswer) || q.correctAnswer < 0 || q.correctAnswer >= q.options.length) bad(w, `bad options/answer: ${q.prompt.slice(0, 40)}`);
        if (!q.explanation) bad(w, "quiz question needs an explanation");
      }
      for (const t of L.tasks || []) { taskCount++; checkTask(w, t); }
      if (RUN) {
        for (const [name, ex] of [["example", L.example], ["realExample", L.realExample]]) {
          const r = py(ex.code, ex.stdin || "");
          ran++;
          if (ex.expectError) { if (r.status === 0 || !r.err.includes(ex.expectError)) bad(w, `${name} should fail with ${ex.expectError}`); }
          else if (r.status !== 0) bad(w, `${name} crashed: ${r.err.slice(-200)}`);
          if (norm(r.out) !== norm(ex.out)) bad(w, `${name} output mismatch.\n  declared: ${JSON.stringify(ex.out)}\n  actual:   ${JSON.stringify(r.out)}`);
        }
      }
    }
  }
  for (const t of mod.assessment?.questions || []) { assessmentCount++; checkTask(`${mod.title} / assessment`, t); }
  if ((mod.assessment?.questions || []).length < 3) bad(mod.title, "module assessment needs at least 3 questions");
}

console.log(`modules=${modules.length} lessons=${lessonCount} quiz=${quizCount} tasks=${taskCount} assessmentQs=${assessmentCount}${RUN ? ` pythonRuns=${ran}` : " (lint only)"}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):\n- ` + problems.join("\n- ")); process.exit(1); }
console.log("OK: content passed validation");
