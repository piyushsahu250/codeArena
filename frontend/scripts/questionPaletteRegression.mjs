// Regression test for the colours of the question boxes in every test screen. REPORTED 2026-11-05: a question moved past without an answer looked untouched, so a student could not see what they had
// skipped. Rule: green = answered, yellow = visited, left, not answered (skipped), plain = not visited. The rule lives in src/utils/questionPalette.js; each screen is checked to use it.
// Pure logic and source checks, no browser, no server.
// Run: node frontend/scripts/questionPaletteRegression.mjs
import fs from "node:fs";
import { paletteStatus, paletteLabel, countSkipped, loadVisited, saveVisited, STATUS } from "../src/utils/questionPalette.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// ---- the rule
check("answered is green", paletteStatus({ answered: true, visited: true }) === STATUS.ANSWERED && paletteStatus({ answered: true }) === STATUS.ANSWERED);
check("visited, left and not answered is yellow (skipped)", paletteStatus({ visited: true }) === STATUS.SKIPPED);
check("never visited is plain", paletteStatus({}) === STATUS.UNSEEN && paletteStatus() === STATUS.UNSEEN);
check("the question that is open right now is not yellow just for being open", paletteStatus({ visited: true, current: true }) === STATUS.UNSEEN);
check("the open question shows green as soon as it is answered", paletteStatus({ visited: true, current: true, answered: true }) === STATUS.ANSWERED);
check("marked for review and a failed coding submission keep their own colours, ahead of skipped and answered", paletteStatus({ marked: true, answered: true, visited: true }) === STATUS.REVIEW && paletteStatus({ wrong: true, answered: true }) === STATUS.WRONG && paletteStatus({ marked: true, wrong: true }) === STATUS.REVIEW);
check("answering a skipped question turns it from yellow to green", paletteStatus({ visited: true }) === STATUS.SKIPPED && paletteStatus({ visited: true, answered: true }) === STATUS.ANSWERED);

// ---- words for a screen reader (colour is never the only signal)
check("every status has words, and the open question says so", paletteLabel(0, "answered") === "Question 1, answered" && paletteLabel(2, "skipped") === "Question 3, skipped, not answered" && paletteLabel(4, "unseen", { current: true }) === "Question 5, not visited, current question" && paletteLabel(1, "review").includes("marked for review") && /failed/.test(paletteLabel(1, "wrong")));
check("an unknown status falls back to not visited, never 'undefined'", !/undefined/.test(paletteLabel(0, "nonsense")) && /not visited/.test(paletteLabel(0, "nonsense")));

// ---- counting and remembering
const items = [{ a: true, v: true }, { a: false, v: true }, { a: false, v: false }, { a: false, v: true }];
check("skipped means visited, not answered, and not the open one", countSkipped(items, { isAnswered: (x) => x.a, isVisited: (x) => x.v, currentIndex: 3 }) === 1 && countSkipped(items, { isAnswered: (x) => x.a, isVisited: (x) => x.v, currentIndex: 0 }) === 2);
const mem = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
saveVisited("k", { q1: true, q2: true }, mem);
check("the visited set survives a reload (it is kept for the attempt)", JSON.stringify(loadVisited("k", mem)) === JSON.stringify({ q1: true, q2: true }));
check("a missing, corrupt or non-object value gives an empty set, never an error", Object.keys(loadVisited("none", mem)).length === 0 && Object.keys(loadVisited("bad", { getItem: () => "{not json" })).length === 0 && Object.keys(loadVisited("arr", { getItem: () => "[1,2]" })).length === 0);
check("storage that refuses writes or reads does not break the page", (() => { try { saveVisited("k", { a: 1 }, { setItem() { throw new Error("denied"); } }); return Object.keys(loadVisited("k", { getItem() { throw new Error("denied"); } })).length === 0; } catch { return false; } })());

// ---- every screen uses the rule
const exam = read("pages/exam/ExamSession.jsx"), test = read("pages/TestTaking.jsx"), ready = read("pages/ReadinessAssessment.jsx"), mod = read("pages/ModuleCodingAssessment.jsx");
const css = read("pages/exam/exam.css"), theme = read("theme.css");
check("section exam: the palette box takes its colour from the shared rule, with the visited set remembered for the attempt", /paletteStatus\(\{ answered: !!countAnswered\(current\.key, \[it\], drafts\), visited: !!seen\[it\.id\], current: i === index \}\)/.test(exam) && /loadVisited\(seenKey\)/.test(exam) && /saveVisited\(seenKey, next\)/.test(exam));
check("section exam: a legend names green, yellow and plain", /ex-dot answered/.test(exam) && /ex-dot skipped/.test(exam) && /Skipped/.test(exam) && /Not visited/.test(exam));
check("section exam: yellow and green styles exist", /\.ex-pal\.skipped \{/.test(css) && /\.ex-pal\.answered \{[^}]*border-color/.test(css));
check("main test page: the palette cell takes its colour from the shared rule, including for the open question", /paletteStatus\(\{ answered: isCoding \? \(!!verdict \|\| written\) : answered, visited: !!visited\[q\.id\], current: idx === activeIdx, marked, wrong: !!wrong \}\)/.test(test) && /if \(status !== "unseen"\) classes\.push\(status\)/.test(test));
check("main test page: opening a coding problem is not an answer for the colour (a verdict or changed starter is)", /const written = isCoding && /.test(test) && /a\.code\.trim\(\) !== String\(starter\)\.trim\(\)/.test(test));
check("main test page: legend and styles", /Skipped<\/span>/.test(test) && /\.exam-palette-cell\.skipped \{/.test(theme));
check("main test page: the open question's ring is declared after the status colours so it is never painted over", theme.indexOf(".exam-palette-cell.current {") > theme.indexOf(".exam-palette-cell.wrong {"));
check("readiness assessment: the number row uses the rule, yellow for skipped, and has a legend", /paletteStatus\(\{ answered: a\.skipped === false, visited: !!visitedIds\[q\.id\], current: i === activeIdx \}\)/.test(ready) && /"#FACC15"/.test(ready) && /Skipped<\/span>/.test(ready));
check("readiness assessment: the open question is no longer painted the same green as an answered one", !/i === activeIdx \? "var\(--mint\)"/.test(ready));
check("module assessment: a question you have been to and not solved is yellow, a passing one green, a failing one red", /visitedMap\[question\.id\]\) return \{ color: "var\(--amber\)"/.test(mod) && /ACCEPTED" \? \{ color: "var\(--mint\)"/.test(mod));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
