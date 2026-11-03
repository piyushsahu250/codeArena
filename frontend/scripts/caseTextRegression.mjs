// Regression test for src/utils/caseText.js: a test case's input and output are always visible to the student, and a blank one is named instead of shown as an empty line.
// REPORTED 2026-11-03: a program with no input showed an empty "Input:" and a badge saying "read input". Pure logic, no browser, no server.
// Run: node frontend/scripts/caseTextRegression.mjs
import fs from "node:fs";
import { inputText, outputText, takesInput, fullProgramLabel, NO_INPUT, NO_OUTPUT } from "../src/utils/caseText.js";

let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };

// A blank input is named, in every blank form
check("an empty input is shown as (no input)", inputText("") === NO_INPUT);
check("null, undefined and whitespace-only inputs are shown as (no input)", [null, undefined, "  ", "\n", "\n\n", "\t"].every((v) => inputText(v) === NO_INPUT));
check("an empty output is shown as (no output)", outputText("") === NO_OUTPUT && outputText(null) === NO_OUTPUT && outputText("\n") === NO_OUTPUT);

// A real input is shown exactly as stored: the value, the line breaks, the spaces
check("a one-line input is unchanged", inputText("5") === "5");
check("a multi-line input keeps its line breaks", inputText("3\n2\n3\n4") === "3\n2\n3\n4");
check("spaces and tabs inside an input are kept", inputText("1  2\t3") === "1  2\t3");
check("a leading or trailing space is not trimmed away", inputText(" 7 ") === " 7 ");
check("the number 0 is an input, not a blank", inputText(0) === "0");
check("the string 0 is an input", inputText("0") === "0");
check("an output of 0 is shown", outputText("0") === "0");
check("Unicode input is unchanged", inputText("नमस्ते") === "नमस्ते");

// Whether the program takes input at all
check("a case with input means the program takes input", takesInput([{ input: "4", expected: "8" }]) === true);
check("all-blank cases mean it does not", takesInput([{ input: "", expected: "x" }, { input: "  ", expected: "x" }]) === false);
check("one case with input is enough", takesInput([{ input: "", expected: "x" }, { input: "5", expected: "y" }]) === true);
check("with no cases the original wording stays", takesInput([]) === true && takesInput(undefined) === true && takesInput(null) === true);
check("the badge no longer tells the student to read input for a no-input program", fullProgramLabel([{ input: "", expected: "Wake up" }]) === "Full program — no input, print the output yourself");
check("the badge is unchanged for a program that reads input", fullProgramLabel([{ input: "5", expected: "10" }]) === "Full program — read input, print output yourself");

// The components really use it
{
  const ps = fs.readFileSync(new URL("../src/components/ProblemStatement.jsx", import.meta.url), "utf8");
  const rb = fs.readFileSync(new URL("../src/components/CodeResultBlock.jsx", import.meta.url), "utf8");
  check("ProblemStatement shows the input through inputText", /\{inputText\(tc\.input\)\}/.test(ps));
  check("ProblemStatement shows the expected output through outputText", /\{outputText\(tc\.expected\)\}/.test(ps));
  check("ProblemStatement's badge comes from fullProgramLabel", /\{fullProgramLabel\(testCases\)\}/.test(ps) && !/Full program — read input, print output yourself\s*\n\s*<\/span>/.test(ps));
  check("Run results show the input through inputText, with its line breaks", /input: <span style=\{\{ whiteSpace: "pre-wrap" \}\}>\{inputText\(d\.input\)\}<\/span>/.test(rb));
  check("Run results show expected and actual output through outputText", (rb.match(/outputText\(d\.(expected|actual)\)/g) || []).length === 3);
  check("no raw {d.input} is left in the run results", !/\{d\.input\}/.test(rb));
}

console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
