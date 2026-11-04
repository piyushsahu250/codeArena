// Regression test for the coding problem inside an examination. REPORTED 2026-11-04 on "Best Time to Buy and Sell Stock" in the Mock examination:
//   1. choosing a language emptied the editor (the code became "") instead of loading that language's starter, and a placeholder starter ("// TODO") was used as if it were a scaffold;
//   2. running the empty editor reached the judge and came back as a "Compilation Error ... ask an admin to enable Function-based mode";
//   3. the statement showed "Constraints:", "Input Format:", "Output Format:" as stray paragraphs with big gaps, and the page repeated them in its own sections;
//   4. a long starter comment ran off the edge of the editor.
// Pure logic plus source checks: no browser, no server.
// Run: node frontend/scripts/examCodingRegression.mjs
import fs from "node:fs";
import { splitStatement } from "../src/utils/problemText.js";
import { isPlaceholder, starterFor, codeAfterLanguageChange } from "../src/utils/examStarter.js";
import { defaultStarter } from "../src/utils/codeEditorDefaults.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// ---- 3. the statement
const raw = "Find maximum profit from one transaction.\n\nConstraints:\n1<=n<=1e5\n\nInput Format:\nprices\n\nOutput Format:\nprofit";
const p = splitStatement(raw);
check("the sections typed into a description are lifted out", p.constraints === "1<=n<=1e5" && p.inputFormat === "prices" && p.outputFormat === "profit");
check("what is left is the statement itself, with no stray headings or big gaps", p.text === "Find maximum profit from one transaction.");
check("a description without such headings comes back exactly as it was", splitStatement("Print exactly:\n\nHello\nWorld").text === "Print exactly:\n\nHello\nWorld" && splitStatement("Print exactly:\n\nHello").constraints === null);
check("nothing but a null/undefined description does not throw", splitStatement(undefined).text === "" && splitStatement(null).text === "");
const multi = splitStatement("Sum the list.\n\nConstraints:\n1 <= n <= 100\n0 <= a[i] <= 1000\n\nExplanation text after.\n");
check("a section is the lines up to the first blank line; text after it is kept as statement", multi.constraints === "1 <= n <= 100\n0 <= a[i] <= 1000" && /Explanation text after\./.test(multi.text) && /Sum the list\./.test(multi.text));
check("a heading with its text on the same line is understood", splitStatement("X\n\nInput Format: two integers a and b").inputFormat === "two integers a and b");
check("headings are matched on a line of their own only, never inside a sentence", splitStatement("The Constraints: are tight but fine.").constraints === null);
check("Windows line endings are handled", splitStatement("A\r\n\r\nConstraints:\r\n1<=n\r\n").constraints === "1<=n");

// ---- 1. starter and language switching
check("a bare TODO is a placeholder, a real scaffold is not", isPlaceholder("// TODO") && isPlaceholder("# TODO: write your code\n") && isPlaceholder("") && isPlaceholder("  \n") && !isPlaceholder("# Print the three lines here\n") && !isPlaceholder("import java.util.*;\n// TODO\npublic class Main {}"));
const item = { starterCode: "// TODO", starterCodeByLanguage: null };
check("a problem whose only starter is a TODO starts from the language's scaffold", starterFor(item, "java", "java") === defaultStarter("java") && starterFor(item, "python", "java") === defaultStarter("python"));
check("an author's starter for a language is used", starterFor({ starterCodeByLanguage: { python: "x = 1\n" } }, "python", "java") === "x = 1\n");
check("the legacy single starter belongs to the first language only", starterFor({ starterCode: "int main(){}" }, "c", "c") === "int main(){}" && starterFor({ starterCode: "int main(){}" }, "python", "c") === defaultStarter("python"));
const sw = (code, from, to, it = item) => codeAfterLanguageChange({ code, from, to, item: it, firstLanguage: "java" });
check("switching language in an EMPTY editor loads the new language's starter (it used to leave nothing)", sw("", "java", "python").code === defaultStarter("python") && sw("", "java", "python").kept === false && sw(undefined, "java", "cpp").code === defaultStarter("cpp"));
check("switching language while still on the starter loads the new starter", sw(defaultStarter("java"), "java", "python").code === defaultStarter("python"));
check("code the student wrote is never thrown away by switching language", sw("print(1)\n", "python", "java").code === "print(1)\n" && sw("print(1)\n", "python", "java").kept === true);

// ---- 2 and 4. the page
const page = read("components/exam/ExamCodingProblem.jsx"), ps = read("components/ProblemStatement.jsx"), prog = read("utils/examProgress.js");
check("the language box no longer sets the code to an empty string", !/onChange=\{\(e\) => onChange\(\{ code: payload\?\.code \?\? ""/.test(page) && /onChange=\{\(e\) => changeLanguage\(e\.target\.value\)\}/.test(page));
check("Run is disabled while the editor is empty, and says why", /\|\| blank\} onClick=\{\(\) => call\("run"\)\}/.test(page) && /The editor is empty\./.test(page));
check("a blank run is stopped in the page before any request", /if \(blank\) \{ setError\("Write your solution in the editor first, then run it\."\); return; \}/.test(page));
check("there is a way back to the starter, including for an attempt that was already emptied", /Reset to starter/.test(page) && /function resetToStarter\(\)/.test(page));
check("a long starter line wraps instead of running off the editor", /wordWrap: "on"/.test(page));
check("the statement component lifts the sections out of the description", /splitStatement\(/.test(ps) && /raw\.inputFormat \|\| parts\.inputFormat/.test(ps) && /raw\.constraints \|\| parts\.constraints/.test(ps));
check("the student sees the server's EMPTY_CODE reason in plain words", /EMPTY_CODE: "Write your solution in the editor first, then run it\."/.test(prog));

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
