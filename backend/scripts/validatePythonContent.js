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
// --only=16 checks just "Module 16" (handy while authoring; CI always checks everything)
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlyValue = onlyArg ? onlyArg.slice(7) : "";
const selected = onlyArg ? modules.filter((m) => (/^\d+$/.test(onlyValue) ? m.module.title.includes(`Module ${onlyValue}:`) : m.module.title.includes(onlyValue))) : modules;
const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);
const COMPANY = /\b(google|amazon|microsoft|facebook|meta platforms|apple inc|netflix|infosys|tcs|wipro|accenture|cognizant|flipkart|uber|adobe|oracle|ibm|capgemini|zoho|paytm|swiggy|zomato|goldman|walmart)\b/i;
const BANNED = /coming soon|lorem ipsum|\btodo\b|\btbd\b|placeholder (text|content)|fixme/i;

// Programs run from a real file (not -c) so multiprocessing, which re-imports the main module, behaves as it does for students.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pycontent-"));
let runCounter = 0;
// The examples must behave the same on every machine, so the CI/app settings of this process (database URL, secrets, ports...)
// are not handed to them: an example that reads os.environ.get("DATABASE_URL", "sqlite:///dev.db") must see the default.
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATABASE_URL|DIRECT_DATABASE_URL|JWT_SECRET|SECRET_KEY|PORT|NODE_ENV|DEBUG|LOG_LEVEL|REQUIRE_INTEGRATION|CI|APP_.*)$/.test(k)));
const py = (src, input = "") => {
  const file = path.join(workDir, `main${runCounter++}.py`);
  fs.writeFileSync(file, src);
  const r = spawnSync(process.env.PYTHON || "python3", ["-I", file], { input, encoding: "utf8", timeout: 20000, env: CLEAN_ENV });
  return { out: (r.stdout || "").replace(/\r\n/g, "\n"), err: r.stderr || "", status: r.status };
};
process.on("exit", () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ } });
const norm = (s) => s.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");

const REQUIRED = ["title", "minutes", "learn", "why", "realWorld", "simple", "detail", "diagram", "example", "lineByLine", "dryRun", "realExample", "mistakes", "practices", "interview", "practiceQs", "revision", "quiz", "tasks"];
let problemCount = 0; const byDifficulty = {};
let lessonCount = 0, taskCount = 0, quizCount = 0, assessmentCount = 0, ran = 0;
const titles = new Set(), prompts = new Set();

function checkTask(where, t) {
  if (!t.title || !t.statement || t.statement.length < 20) bad(where, "task needs title and statement");
  const vis = t.testCases.filter((c) => !c.isHidden).length, hid = t.testCases.filter((c) => c.isHidden).length;
  if (vis < 2) bad(where, "needs at least 2 sample test cases");
  if (hid < 1) bad(where, "needs at least 1 hidden test case");
  if (t.meta) {
    const m = t.meta;
    if (!["EASY", "MEDIUM", "HARD"].includes(m.difficulty)) bad(where, `${t.title}: bad difficulty`);
    if (!Array.isArray(m.tags) || m.tags.length < 3) bad(where, `${t.title}: needs at least 3 tags (topic tags plus the style tag)`);
    if (!/^O\(/.test(m.timeComplexity || "") || !/^O\(/.test(m.spaceComplexity || "")) bad(where, `${t.title}: needs time and space complexity written as O(...)`);
    if (!m.goal || m.goal.length < 20) bad(where, `${t.title}: needs a learning objective`);
    if (!m.inputFormat || !m.outputFormat) bad(where, `${t.title}: needs input and output formats`);
    if (!m.hints || !m.hints.length) bad(where, `${t.title}: needs a hint`);
    if (COMPANY.test([...m.tags, m.goal, ...(m.hints || [])].join(" "))) bad(where, `${t.title}: names a company; tag problems by assessment style only`);
    problemCount++; byDifficulty[m.difficulty] = (byDifficulty[m.difficulty] || 0) + 1;
  }
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

// Interview question (Module 22): structure always, and with --run the program is executed and its output (or exception) must match.
const QA_REQUIRED = ["title", "minutes", "learn", "why", "items", "revision", "quiz", "tasks"];
let qaCount = 0, mockCount = 0, mockQuestionCount = 0;
function checkQuestion(where, it) {
  qaCount++;
  if (!it.q || !it.code || !it.why || !it.miscon || !Array.isArray(it.follow) || it.follow.length !== 2 || !it.follow[0] || !it.follow[1]) bad(where, "needs question, code, explanation, misconceptions and a follow-up (question and answer)");
  if (!Array.isArray(it.wrong) || it.wrong.length !== 3 || new Set([...it.wrong, it.answerText]).size !== 4) bad(where, "needs exactly three wrong answers, all different from the right one and from each other");
  if (it.out == null && !it.err) bad(where, "needs an expected output or an expected exception");
  if (!RUN) return;
  const r = py(it.code);
  ran++;
  if (it.err) { if (r.status === 0 || !r.err.includes(it.err)) bad(where, `should raise ${it.err}, got status ${r.status}: ${r.err.slice(-160)}`); return; }
  if (r.status !== 0) bad(where, `crashed: ${r.err.slice(-200)}`);
  else if (norm(r.out) !== norm(it.out)) bad(where, `output mismatch. declared ${JSON.stringify(it.out)} actual ${JSON.stringify(r.out)}`);
}

// Real-world projects (Phase 6): the 19-part guide is checked for completeness, the rubric must add up to 100, and with --run the
// project's files are written to a folder, the sample run must print the stated output and the unit tests must pass.
// A build-from-scratch project publishes no source: its hidden reference solution is what gets executed.
const PROJECT_REQUIRED = ["title", "minutes", "project"];
let projectCount = 0, miniCount = 0, majorCount = 0, scratchCount = 0;
const runIn = (dir, args, input = "") => {
  const r = spawnSync(process.env.PYTHON || "python3", ["-E", "-s", ...args], { cwd: dir, input, encoding: "utf8", timeout: 90000, env: CLEAN_ENV });
  return { out: (r.stdout || "").replace(/\r\n/g, "\n"), err: r.stderr || "", status: r.status };
};
function checkProject(where, P) {
  projectCount++;
  if (P.kind === "MAJOR") majorCount++; else miniCount++;
  if (P.scratch) scratchCount++;
  const need = ["id", "title", "problem", "scenario", "architecture", "flowchart", "run", "test", "stdin", "sample"];
  for (const f of need) if (P[f] == null || (P[f] === "" && f !== "stdin")) bad(where, `project missing ${f}`);
  for (const [f, min] of [["objectives", 3], ["prerequisites", 2], ["requirements", 4], ["explain", 3], ["testing", 2], ["bugs", 3], ["extensions", 3], ["interview", 5], ["rubric", 5], ["tasks", 2]]) {
    if (!Array.isArray(P[f]) || P[f].length < min) bad(where, `project needs at least ${min} ${f}`);
  }
  if (!P.scratch && (!Array.isArray(P.steps) || P.steps.length < 4)) bad(where, "project needs at least 4 implementation steps");
  if (P.scratch && (!Array.isArray(P.milestones) || P.milestones.length < 4)) bad(where, "a from-scratch project needs at least 4 milestones");
  if (P.scratch && P.files) bad(where, "a from-scratch project must not publish source files (use reference)");
  if (!P.scratch && (!P.files || !P.files[P.run] || !P.files[P.test])) bad(where, "project files must include the run file and the test file");
  if (P.scratch && (!P.reference || !P.reference[P.run])) bad(where, "a from-scratch project needs a hidden reference containing the run file");
  if (!/<svg[^>]*role="img"/.test(P.architecture) || !/<svg[^>]*role="img"/.test(P.flowchart)) bad(where, "architecture and flowchart need accessible diagrams");
  if (Array.isArray(P.rubric) && P.rubric.reduce((s, r) => s + r[1], 0) !== 100) bad(where, `rubric must add up to 100, not ${P.rubric.reduce((s, r) => s + r[1], 0)}`);
  if (Array.isArray(P.tasks)) {
    for (const t of P.tasks) {
      if (t.testCases) checkTask(where, t);
      else if (!t.title || !t.instructions || t.instructions.length < 20) bad(where, "a manual task needs a title and instructions");
    }
    if (!P.tasks.some((t) => t.testCases)) bad(where, "a project needs at least one auto-judged task");
  }
  if (!RUN) return;
  const files = P.scratch ? P.reference : P.files;
  const dir = fs.mkdtempSync(path.join(workDir, "proj-"));
  for (const [name, src] of Object.entries(files || {})) fs.writeFileSync(path.join(dir, name), src);
  const sample = runIn(dir, [P.run, ...(P.args ? P.args.split(" ") : [])], P.stdin);
  ran++;
  if (sample.status !== 0) bad(where, `sample run crashed: ${sample.err.slice(-300)}`);
  else if (norm(sample.out) !== norm(P.sample.out)) bad(where, `sample output mismatch.\n  declared: ${JSON.stringify(P.sample.out)}\n  actual:   ${JSON.stringify(sample.out)}`);
  const unit = runIn(dir, ["-m", "unittest", P.test.replace(/\.py$/, "")]);
  ran++;
  if (unit.status !== 0 || !/\nOK\b/.test("\n" + unit.err)) bad(where, `unit tests failed: ${unit.err.slice(-500)}`);
}

// Placement practice sets (Module 23): MCQ (structure), FILL (the answer is put into the blank and the program run),
// DEBUG (the buggy program shows its symptom, the fixed program gives the stated output), OUT (as in checkQuestion).
const SET_REQUIRED = ["title", "minutes", "learn", "why", "set", "revision", "quiz", "tasks"];
let setCount = 0;
function runExpect(where, label, src, expected) {
  const r = py(src);
  ran++;
  if (expected.startsWith("!")) { if (r.status === 0 || !r.err.includes(expected.slice(1))) bad(where, `${label} should raise ${expected.slice(1)}, got status ${r.status}: ${r.err.slice(-160)}`); return; }
  if (r.status !== 0) bad(where, `${label} crashed: ${r.err.slice(-200)}`);
  else if (norm(r.out) !== norm(expected)) bad(where, `${label} output mismatch. declared ${JSON.stringify(expected)} actual ${JSON.stringify(r.out)}`);
}
function checkSetItem(where, it) {
  setCount++;
  if (it.kind === "OUT") { checkQuestion(where, it); return; }
  if (!it.why) bad(where, "needs an explanation");
  if (it.kind === "MCQ" || it.kind === "DEBUG") {
    if (!Array.isArray(it.options) || it.options.length !== 4 || new Set(it.options).size !== 4 || !Number.isInteger(it.answer) || it.answer < 0 || it.answer > 3) bad(where, "needs four different options and a valid answer index");
  }
  if (it.kind === "FILL") {
    if (!it.template.includes("___")) bad(where, "template needs a ___ blank");
    if (!it.answer || /\s/.test(it.answer)) bad(where, "answer must be one token without spaces (FILL_BLANK is compared as text)");
    if (RUN) runExpect(where, "completed program", it.template.split("___").join(it.answer), it.out);
  }
  if (it.kind === "DEBUG" && RUN) {
    runExpect(where, "buggy program", it.code, it.symptom);
    runExpect(where, "fixed program", it.fixed, it.fixedOut);
  }
}

for (const m of selected) {
  const mod = m.module;
  if (!mod.title || !mod.chapters?.length) bad(mod.title || "module", "missing title or chapters");
  for (const ch of mod.chapters) {
    for (const L of ch.lessons) {
      const w = `${mod.title} / ${L.title}`;
      lessonCount++;
      for (const f of L.project ? PROJECT_REQUIRED : L.items ? QA_REQUIRED : L.set ? SET_REQUIRED : REQUIRED) if (L[f] == null || (Array.isArray(L[f]) && !L[f].length)) bad(w, `missing ${f}`);
      if (titles.has(L.title)) bad(w, "duplicate lesson title");
      titles.add(L.title);
      let html = "";
      try { html = renderLesson(L); } catch (e) { bad(w, `render failed: ${e.message}`); continue; }
      if (BANNED.test(html)) bad(w, `contains banned placeholder wording: ${html.match(BANNED)[0]}`);
      if (!L.items && !L.set && !L.project && (!/<svg[^>]*role="img"/.test(html) || !/<title[^>]*>[^<]+<\/title>/.test(html) || !/<desc[^>]*>[^<]+<\/desc>/.test(html))) bad(w, "diagram needs role=img, title and desc");
      for (const [n, it] of (L.items || []).entries()) checkQuestion(`${w} / Q${n + 1}`, it);
      for (const [n, it] of (L.set || []).entries()) checkSetItem(`${w} / Q${n + 1}`, it);
      if (html.length < 4000) bad(w, `lesson looks too thin (${html.length} chars)`);
      if (/<script|onerror=|onload=|javascript:/i.test(html)) bad(w, "unsafe markup");
      if (!L.project && (L.quiz || []).length < 3) bad(w, "needs at least 3 quiz questions");
      if (L.project) checkProject(w, L.project);
      for (const q of L.quiz || []) {
        quizCount++;
        if (prompts.has(q.prompt)) bad(w, `duplicate quiz prompt: ${q.prompt.slice(0, 40)}`);
        prompts.add(q.prompt);
        if (q.type === "FILL_BLANK") { if (typeof q.correctAnswer !== "string" || !q.correctAnswer) bad(w, "FILL_BLANK needs correctAnswer"); }
        else if (!Array.isArray(q.options) || q.options.length < 2 || !Number.isInteger(q.correctAnswer) || q.correctAnswer < 0 || q.correctAnswer >= q.options.length) bad(w, `bad options/answer: ${q.prompt.slice(0, 40)}`);
        if (!q.explanation) bad(w, "quiz question needs an explanation");
      }
      for (const t of L.tasks || []) { taskCount++; checkTask(w, t); }
      if (RUN && !L.items && !L.set && !L.project) {
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
  for (const mock of mod.mocks || []) {
    mockCount++;
    if (!mock.title || !mock.timeLimitMin || mock.timeLimitMin < 20) bad(mod.title, `mock "${mock.title}" needs a time limit of at least 20 minutes`);
    if ((mock.questions || []).length < 2) bad(mod.title, `mock "${mock.title}" needs at least 2 questions`);
    if (COMPANY.test(`${mock.title} ${mock.description}`)) bad(mod.title, `mock "${mock.title}" names a company; label mocks by assessment style only`);
    for (const t of mock.questions || []) { mockQuestionCount++; checkTask(`${mod.title} / mock ${mock.title}`, t); }
  }
  if (mod.minQuestions && qaCount < mod.minQuestions) bad(mod.title, `needs at least ${mod.minQuestions} interview questions, has ${qaCount}`);
  if (mod.minMini && miniCount < mod.minMini) bad(mod.title, `needs at least ${mod.minMini} mini projects, has ${miniCount}`);
  if (mod.minMajor && majorCount < mod.minMajor) bad(mod.title, `needs at least ${mod.minMajor} major projects, has ${majorCount}`);
  if (mod.minScratch && scratchCount < mod.minScratch) bad(mod.title, `needs at least ${mod.minScratch} build-from-scratch projects, has ${scratchCount}`);
  if (mod.minProblems && problemCount < mod.minProblems) bad(mod.title, `needs at least ${mod.minProblems} tagged problems, has ${problemCount}`);
  if (mod.assessment !== null && (mod.assessment?.questions || []).length < 3) bad(mod.title, "module assessment needs at least 3 questions");
}

if (problemCount) console.log(`bank problems=${problemCount} ${JSON.stringify(byDifficulty)}`);
if (qaCount) console.log(`interview questions=${qaCount}`);
if (setCount) console.log(`practice-set questions=${setCount}`);
if (projectCount) console.log(`projects=${projectCount} mini=${miniCount} major=${majorCount} fromScratch=${scratchCount}`);
if (mockCount) console.log(`timed mocks=${mockCount} mockQuestions=${mockQuestionCount}`);
console.log(`modules=${selected.length} lessons=${lessonCount} quiz=${quizCount} tasks=${taskCount} assessmentQs=${assessmentCount}${RUN ? ` pythonRuns=${ran}` : " (lint only)"}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):\n- ` + problems.join("\n- ")); process.exit(1); }
console.log("OK: content passed validation");
