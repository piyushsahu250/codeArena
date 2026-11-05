// Regression test for the code editor sitting on "Loading..." inside an examination. REPORTED 2026-11-05 (Mock, coding section, Problem 1): the editor area never appeared.
// Cause: @monaco-editor/react fetches the Monaco editor from a CDN unless utils/monacoSetup.js has pointed it at the copy bundled with the app. monacoSetup.js says it is imported from main.jsx; it is
// not (the editor code is loaded on demand), so a page only got the bundled copy if it imported monacoSetup itself. The exam coding problem did not, so on a school network that blocks or throttles
// the CDN the editor never loaded. It also used the raw editor, which drops typed letters on a page that re-renders on every keystroke (that is what StableCodeEditor is for).
// This fails if any file renders an editor without the bundled setup, now or after a future change. Source-level: no browser, no server.
// Run: node frontend/scripts/monacoLoaderRegression.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
  }
})(src);
const rel = (p) => path.relative(src, p).replace(/\\/g, "/");
const read = (p) => fs.readFileSync(p, "utf8");

const editorUsers = files.filter((f) => /from\s+["']@monaco-editor\/react["']/.test(read(f)) && rel(f) !== "utils/monacoSetup.js");
check("the editor is used in the places we expect (the list is not empty)", editorUsers.length >= 5, editorUsers.map(rel).join(", "));
for (const f of editorUsers) {
  const text = read(f);
  const setsUp = /import\s+(\{[^}]*\}\s+from\s+)?["'](\.\.?\/)+utils\/monacoSetup["']/.test(text);
  check(`${rel(f)} loads the bundled Monaco (imports utils/monacoSetup), so it never waits on a CDN`, setsUp);
}

const stable = read(path.join(src, "components", "StableCodeEditor.jsx"));
check("StableCodeEditor itself imports the setup, so everything built on it is covered", /import\s+["']\.\.\/utils\/monacoSetup["']/.test(stable));
const exam = read(path.join(src, "components", "exam", "ExamCodingProblem.jsx"));
check("the exam coding problem uses StableCodeEditor, not the raw editor (typed letters are never overwritten)", /<StableCodeEditor /.test(exam) && !/<Editor[ \n]/.test(exam) && !/from "@monaco-editor\/react"/.test(exam));
check("the exam editor tells StableCodeEditor which document it shows (question and language), so a language switch or reset reaches the editor", /contextKey=\{`\$\{item\.id\}\|\$\{language\}`\}/.test(exam));
check("the exam editor keeps the plain-text keyboard hints", /onMount=\{applyPlainTextInputHints\}/.test(exam));
const setup = read(path.join(src, "utils", "monacoSetup.js"));
check("the setup file configures the loader with the bundled monaco", /loader\.config\(\{ monaco \}\)/.test(setup));
check("the setup file no longer claims main.jsx imports it", !/from main\.jsx before the app renders/.test(setup));
const main = read(path.join(src, "main.jsx"));
check("main.jsx still does not import the editor (it is loaded on demand: the login page must not download Monaco)", !/monaco/i.test(main));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
