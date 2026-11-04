// Regression test for how an examination that cannot be built is shown. REPORTED 2026-11-04: a student pressed Practice on "Mock" and got "This examination is not ready yet. Please contact your
// administrator." The exam was platform-wide, and one of its two coding problems belonged to one institute only, so for every other institute it could not build a paper. The card gave no hint
// beforehand, the message gave no reason, and the administrator's list showed nothing wrong. Source-level, no browser, no server.
// Run: node frontend/scripts/examReadinessRegression.mjs
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const hub = read("pages/exam/ExamHub.jsx"), list = read("pages/exam/ExamAdminList.jsx"), editor = read("pages/exam/ExamEditor.jsx"), progress = read("utils/examProgress.js");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

// 1. The student's card says so before the click, and does not offer a button that can only fail.
check("the card reads the server's ready flag", /e\.ready === false/.test(hub));
check("the card shows why, in the page, before any click", /Not available yet\./.test(hub) && /e\.notReadyMessage/.test(hub) && /role="status"/.test(hub));
check("a new official start is disabled when the exam cannot be built", /disabled=\{cannotStart \|\| !e\.windowOpen/.test(hub));
check("a practice start is disabled when the exam cannot be built", /disabled=\{cannotStart \|\| busy === `\$\{e\.id\}:PRACTICE`\}/.test(hub));
check("the start button says what is wrong, not just 'Not open'", /cannotStart \? "Not available yet"/.test(hub));
check("an attempt already begun can still be continued (it keeps its paper)", /onClick=\{\(\) => navigate\(`\/exams\/attempt\/\$\{formal\.id\}`\)\}>Continue<\/button>/.test(hub) && !/Continue[^\n]*cannotStart|cannotStart[^\n]*Continue/.test(hub));
check("an older server that sends no flag leaves the card as it was (ready unless it says false)", !/e\.ready \?/.test(hub) && !/!e\.ready\b/.test(hub));

// 2. The message after a refused start says what it means and what to do.
check("the refusal message no longer stops at 'contact your administrator'", /EXAM_NOT_READY: "This examination cannot be started yet: its question set is not complete for your institute\. Please ask your administrator to finish setting it up\."/.test(progress));
check("the old vague wording is gone", !/This examination is not ready yet\. Please contact your administrator\./.test(progress));

// 3. The administrator's list flags a published exam that cannot be built, with the reason and a way to the fix.
check("the list reads the readiness the server computed", /e\.readiness && !e\.readiness\.ok/.test(list));
check("it says students cannot start it, lists the reasons and links to the editor", /Students cannot start this examination\./.test(list) && /e\.readiness\.messages\.map/.test(list) && /Open it to fix this/.test(list));
check("a healthy exam shows nothing extra", /e\.readiness && !e\.readiness\.ok &&/.test(list));

// 4. The editor: the check explains, and a problem owned by one institute is marked where it is picked.
check("the check lists the server's reasons", /check\.shortageMessages/.test(editor) && /<strong>Why:<\/strong>/.test(editor));
check("the reasons sit outside the shortage block (a JSX parent of its own)", !/\(check\.shortages \|\| \[\]\)\.length > 0 && \(\s*\n\s*\{\(check\.shortageMessages/.test(editor));
check("a problem owned by one institute is marked in the picker", /q\.sharedWithAll === false/.test(editor) && /\{q\.ownerName\} only/.test(editor));

// 5. Nothing private reaches a student: the student-facing code never reads reasons or owner names.
check("the student page never reads the administrator's reasons or owners", !/shortageMessages|ownerName|readiness\.messages/.test(hub));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
