// Regression test for the screen between examination sections. REPORTED 2026-11-04: after finishing a section the student saw one plain line ("Next: Section C ... 2 problem(s), 30 marks")
// and a button, with no sense of where they stood or what the next section would ask. The wording and counts come from src/utils/sectionBreak.js; the page is checked at source level.
// Pure logic and source checks, no browser, no server.
// Run: node frontend/scripts/sectionBreakRegression.mjs
import fs from "node:fs";
import { unitWord, sectionProgress, positionOf, sectionFacts, sectionNotes, doneLine, headline } from "../src/utils/sectionBreak.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const S = (key, status, extra = {}) => ({ key, label: `Section ${"ABCD"["APTITUDE TECHNICAL CODING AI_INTERVIEW".split(" ").indexOf(key)]}`, status, questionCount: 5, maxMarks: 10, durationMin: 20, navigation: "FREE", requireAllAnswered: false, answered: 0, ...extra });
const mid = [S("APTITUDE", "COMPLETED", { answered: 5 }), S("TECHNICAL", "COMPLETED", { answered: 3 }), S("CODING", "LOCKED", { questionCount: 2, maxMarks: 30, durationMin: 30, maxSubmissionsPerProblem: 5 }), S("AI_INTERVIEW", "LOCKED")];

// 1. counts and position
check("progress counts finished sections", sectionProgress(mid).done === 2 && sectionProgress(mid).total === 4 && sectionProgress(mid).percent === 50);
check("progress of an empty or missing list is zero, not NaN", sectionProgress([]).percent === 0 && sectionProgress(undefined).total === 0);
check("the position is one-based", positionOf(mid, "CODING").n === 3 && positionOf(mid, "CODING").of === 4 && positionOf(mid, "NOPE") === null);
check("problems and questions are named correctly, singular and plural", unitWord("CODING", 1) === "problem" && unitWord("CODING", 2) === "problems" && unitWord("APTITUDE", 1) === "question" && unitWord("AI_INTERVIEW", 3) === "questions");

// 2. the facts and the rules, for the section that is about to open
const facts = Object.fromEntries(sectionFacts(mid[2]).map((f) => [f.label, f.value]));
check("a coding section shows problems, marks and its own time", facts.Problems === "2" && facts.Marks === "30" && facts.Time === "30 min");
check("a section with no timer says it shares the total instead of showing 'null min'", sectionFacts(S("TECHNICAL", "LOCKED", { durationMin: null })).find((f) => f.label === "Time").value === "Shared with the total");
check("forward-only navigation is stated as a fact and as a rule", sectionFacts(S("APTITUDE", "LOCKED", { navigation: "FORWARD_ONLY" })).some((f) => f.value === "Forward only") && sectionNotes(S("APTITUDE", "LOCKED", { navigation: "FORWARD_ONLY" })).some((n) => /only move forward/.test(n)));
check("free navigation says answers can change until the section is submitted", sectionNotes(mid[2]).some((n) => /change your answers until you submit/.test(n)));
check("the timer note says it starts on opening and cannot be paused", sectionNotes(mid[2])[0] === "You have 30 minutes for this section. Its own timer starts the moment you open it and cannot be paused.");
check("every section warns that a submitted section cannot be reopened", [0, 1, 2, 3].every((i) => sectionNotes(mid[i]).some((n) => /cannot be reopened/.test(n))));
check("'every question must be answered' appears only when the server requires it", !sectionNotes(mid[2]).some((n) => /must be answered/.test(n)) && sectionNotes(S("CODING", "LOCKED", { requireAllAnswered: true })).some((n) => /must be answered/.test(n)));
check("the submission limit is shown for coding only when the server sets one", sectionNotes(mid[2]).some((n) => /up to 5 times/.test(n)) && !sectionNotes(S("CODING", "LOCKED")).some((n) => /times/.test(n)));
check("the interview says type or speak unless it is typed-only, and mentions the camera only when required",
  sectionNotes(S("AI_INTERVIEW", "LOCKED", { interview: { answerInput: "TYPED_OR_SPEECH", cameraRequired: true } })).some((n) => /speak/.test(n)) &&
  !sectionNotes(S("AI_INTERVIEW", "LOCKED", { interview: { answerInput: "TYPED", cameraRequired: false } })).some((n) => /speak|camera/.test(n)) &&
  sectionNotes(S("AI_INTERVIEW", "LOCKED", { interview: { answerInput: "TYPED", cameraRequired: true } })).some((n) => /camera/.test(n)));
check("nothing is invented for a missing section", sectionFacts(null).length === 0 && sectionNotes(null).length === 0);

// 3. the finished-section line and the headline
check("a finished section shows what was answered, never more than there were", doneLine(S("APTITUDE", "COMPLETED", { answered: 3 })) === "3 of 5 answered" && doneLine(S("APTITUDE", "COMPLETED", { answered: 9 })) === "5 of 5 answered" && doneLine(S("APTITUDE", "COMPLETED", { answered: undefined })) === "0 of 5 answered");
check("the headline is 'Ready to begin' before any section, 'Section complete' between, and says so when all are done",
  headline(mid.map((s) => ({ ...s, status: "LOCKED" })), false) === "Ready to begin" && headline(mid, true) === "Section complete" && headline(mid.map((s) => ({ ...s, status: "COMPLETED" })), true) === "All sections are complete");

// 4. the page uses it, and keeps the safety behaviour
const page = read("pages/exam/ExamSession.jsx"), brk = read("components/exam/ExamSectionBreak.jsx"), css = read("pages/exam/exam.css");
check("the session page renders the new screen where the old one-line card was", /<ExamSectionBreak /.test(page) && !/Next: <strong>/.test(page) && !/<h2>All sections are complete<\/h2>/.test(page));
check("opening a section and submitting still go through the page's own handlers (server-checked)", /onOpen=\{openNext\}/.test(page) && /onSubmit=\{\(\) => setDialog\(\{ type: "submit" \}\)\}/.test(page));
check("the open button is disabled while it is opening, so it cannot be pressed twice", /disabled=\{busy\} onClick=\{\(\) => onOpen\(next\.key\)\}/.test(brk));
check("the progress list marks the section that is up next for assistive technology", /aria-current=\{state === "next" \|\| state === "open" \? "step" : undefined\}/.test(brk) && /role="progressbar"/.test(brk));
check("the stepper along the top marks the up-next section and shows a tick when done", /upNext/.test(page) && /st === "done" \? "✓"/.test(page));
check("the 'before you open it' rules can be folded away, and start folded on a phone so the button is on the first screen", /<details className="ex-notes" open=\{notesOpen\}/.test(brk) && /min-width: 641px/.test(brk));
check("the layout stacks on a phone with the section first and the progress after it (the open button stays near the top)", /@media \(max-width: 900px\) \{ \.ex-break \{ grid-template-columns: 1fr; \}/.test(css) && !/order: -1/.test(css));
check("on a phone the stepper along the top shrinks to four markers, each still named for assistive technology", /@media \(max-width: 640px\)[^@]*\.ex-step span, \.ex-step em \{ display: none; \}/.test(css) && /aria-label=\{`\$\{s\.label\}/.test(page));
check("motion is switched off for people who ask for reduced motion", /prefers-reduced-motion: reduce\) \{[^}]*\.ex-meter-fill/.test(css));
check("the student-facing screen never prints a raw 'null' or 'undefined'", !/null min|undefined min/.test(brk) && !/\$\{[^}]*\.durationMin\} min`\s*:\s*undefined/.test(brk));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
