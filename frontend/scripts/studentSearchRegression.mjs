// Regression test for the test-results leaderboard search (it used to match only the roll number). Pure function, no DOM.
// Run: node frontend/scripts/studentSearchRegression.mjs   (cases mirror backend/test/testsResultsDomain.test.js)
import { matchesStudentQuery } from "../src/utils/studentSearch.js";

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };

const S = { name: "Piyush Sahu", rollNumber: "CS-2024-017", registrationNumber: "PRN24000123", email: "piyush.sahu@college.test" };
const CASES = [
  ["", true, "empty query shows everyone"], ["   ", true, "a blank query shows everyone"], ["Piyush Sahu", true, "full name"], ["piyush", true, "first name, partial"],
  ["SAHU", true, "case-insensitive"], ["  piyush   sahu  ", true, "leading, trailing and repeated spaces"], ["sahu piyush", true, "words in any order"],
  ["yush sa", true, "a partial word in the middle"], ["cs-2024-017", true, "roll number"], ["2024-017", true, "partial roll number"],
  ["prn24000123", true, "PRN / registration number"], ["000123", true, "partial PRN"], ["piyush.sahu@college", true, "e-mail"],
  ["piyush cs-2024", true, "name word plus roll number word"], ["rahul", false, "a different name matches nobody"], ["piyush rahul", false, "every word must match"],
  [".*", false, "regex characters are plain text"], ["(", false, "an unbalanced bracket is plain text and does not throw"], ["%", false, "a SQL wildcard is plain text"],
];
for (const [q, expected, label] of CASES) check(label, matchesStudentQuery(S, q) === expected);
check("missing fields never throw", matchesStudentQuery({ name: null, rollNumber: null }, "x") === false);
check("undefined query shows everyone", matchesStudentQuery(S, undefined) === true);
// the typed query narrows a list and never reorders it
const rows = [{ name: "Asha Rao" }, { name: "Bo Lin" }, { name: "Bobby Tan" }];
check("filtering keeps the original order", rows.filter((r) => matchesStudentQuery(r, "bo")).map((r) => r.name).join() === "Bo Lin,Bobby Tan");

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("student search regression: all passed");
