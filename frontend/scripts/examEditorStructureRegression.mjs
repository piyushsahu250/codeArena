// Regression test for the section-exam editor (src/pages/exam/ExamEditor.jsx). REPORTED 2026-11-03: the "New section exam" page put eleven unrelated settings in one narrow grid, so
// dates lost their AM/PM and selects were cut off; labels were not tied to their fields; the audience was a raw multi-select. The page is now a set of numbered cards with labelled fields.
// This checks the structure and, above all, that no setting was lost in the reshuffle. Source-level, no browser, no server.
// Run: node frontend/scripts/examEditorStructureRegression.mjs
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/pages/exam/ExamEditor.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/pages/exam/exam.css", import.meta.url), "utf8");
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

// 1. Every setting the old page had is still editable, and still saved.
const settings = [
  ["title", /value=\{bp\.title\}/], ["description", /value=\{description\}/], ["mode", /value=\{bp\.mode\}/], ["practice attempts", /bp\.practiceEnabled/],
  ["opens", /toLocal\(bp\.startAt\)/], ["closes", /toLocal\(bp\.endAt\)/], ["duration", /value=\{bp\.durationMin\}/], ["grace", /value=\{bp\.graceSec\}/],
  ["passing marks", /value=\{bp\.passingMarks \?\? ""\}/], ["timers", /value=\{bp\.timingPolicy\}/], ["result visibility", /value=\{bp\.resultVisibility\}/], ["audience", /setGroupIds/],
];
for (const [name, re] of settings) check(`the ${name} setting is still on the page`, re.test(src));
check("the four sections are all still rendered", /SECTION_META\.map/.test(src) && ["APTITUDE", "TECHNICAL", "CODING", "AI_INTERVIEW"].every((k) => src.includes(`"${k}"`)));
check("proctoring settings are still on the page", /setProc\(/.test(src) && /Proctoring \(official attempts\)/.test(src));
check("save, check and publish still call the same handlers", /onClick=\{save\}/.test(src) && /onClick=\{validate\}/.test(src) && /onClick=\{publish\}/.test(src));
check("the saved blueprint is unchanged: payload() still sends the same fields", /return \{ \.\.\.bp, sections, totalMarks, durationMin: Number\(bp\.durationMin\), graceSec: Number\(bp\.graceSec\) \|\| 0, passingMarks:/.test(src) && /academicGroupIds: groupIds/.test(src));
check("the server's field errors still show beside their fields", ["title", "startAt", "endAt", "durationMin", "passingMarks", "timingPolicy", "proctoring"].every((p) => src.includes(`<Err prefix="${p}" />`)));

// 2. The structure: numbered cards in a sensible order
const headings = ["Basics", "Schedule", "Attempt rules and results", "Who can take it"].map((h) => src.indexOf(h));
check("the four general cards exist, in the order Basics, Schedule, Rules, Audience", headings.every((i) => i > 0) && headings.every((v, i) => i === 0 || v > headings[i - 1]));
check("a summary of marks, minutes, questions and pass mark sits at the top", /className="ex-glance"/.test(src) && ["total marks", "minutes", "marks to pass"].every((t) => src.includes(t)));
check("each section shows its marks and question count", /className="ex-chip">\{Number\(s\.maxMarks\) \|\| 0\} marks/.test(src));
check("the old single 'General' card is gone", !/<h3>General<\/h3>/.test(src));

// 3. Fields: every label is tied to its input, dates are spelled out, the audience is a checklist
const fieldIds = [...src.matchAll(/<Field id="([^"]+)"/g)].map((m) => m[1]);
check("there are labelled fields", fieldIds.length >= 10, `${fieldIds.length}`);
check("every Field id has an input with that id", fieldIds.every((id) => new RegExp(`<(input|select|textarea)[^>]*id="${id}"`).test(src)), fieldIds.filter((id) => !new RegExp(`<(input|select|textarea)[^>]*id="${id}"`).test(src)).join(","));
check("field ids are unique", new Set(fieldIds).size === fieldIds.length);
check("dates are spelled out under the date fields (no AM/PM guessing)", (src.match(/\{whenText\(bp\.(startAt|endAt)\)\}/g) || []).length === 2);
check("the audience is a checklist, not a raw multi-select", !/<select multiple/.test(src) && /className="ex-aud"/.test(src) && /Every student of the institute/.test(src));
check("the title is marked required", /<Field id="ex-title" label="Title" required/.test(src));

// 4. Nothing broken by the edit itself
check("no leftover replacement markers ($1, $2, $3) in the source", !/(^|[^\w$])\$[123](?!\d)/m.test(src.replace(/`[^`]*\$\{[^}]*\}[^`]*`/g, "")));
check("exactly one totalMarks and one save button", (src.match(/const totalMarks = useMemo/g) || []).length === 1 && (src.match(/onClick=\{save\}/g) || []).length === 1);

// 5. Styles that keep values from being cut off
check("the form grids are wide enough for a date or a select", /\.ex-grid-2 \{[^}]*minmax\(260px/.test(css) && /\.ex-two \{[^}]*minmax\(210px/.test(css) && /\.ex-two\.ex-settings \{[^}]*minmax\(250px/.test(css) && /\.ex-wide-cols \{[^}]*minmax\(370px/.test(css));
check("the action bar is a sticky bar of its own", /\.ex-actions \{[^}]*position: sticky/.test(css));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
