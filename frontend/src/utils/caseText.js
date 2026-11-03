// How a test case's input and output are shown to a student. Pure, so scripts/caseTextRegression.mjs can test it without a browser.
//
// REPORTED 2026-11-03: a program that takes no input showed an empty "Input:" line, which reads like a missing sample, and a badge telling the student to "read input".

export const NO_INPUT = "(no input)";
export const NO_OUTPUT = "(no output)";

const isBlank = (v) => v == null || String(v).trim() === "";

// The input to display. A blank input is named, never shown as an empty line; any real input is returned exactly as stored (line breaks and spacing kept).
export function inputText(value) {
  return isBlank(value) ? NO_INPUT : String(value);
}

// Same for an expected or actual output.
export function outputText(value) {
  return isBlank(value) ? NO_OUTPUT : String(value);
}

// True when at least one of the shown cases gives the program some input. With no cases at all we do not know, so the answer is true (the original wording stays).
export function takesInput(testCases) {
  const cases = Array.isArray(testCases) ? testCases : [];
  if (cases.length === 0) return true;
  return cases.some((c) => !isBlank(c && c.input));
}

// The badge on a full-program question: it must not tell the student to read input when the program has none.
export function fullProgramLabel(testCases) {
  return takesInput(testCases) ? "Full program — read input, print output yourself" : "Full program — no input, print the output yourself";
}
