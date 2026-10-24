// Regression for the live bug (2026-10-24): AI question generation for a CODING question answered "AI service is temporarily unavailable" although the model replied and
// the key quota was fine. The reply had raw newlines inside JSON string values ("Bad control character in string literal"), so both attempts failed to parse.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseModelJson, escapeControlCharsInStrings } = require("../src/utils/aiJson");

const BS = String.fromCharCode(92); // a single backslash, built explicitly so no source-level escaping is involved
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const CTRL1 = String.fromCharCode(1);

test("valid JSON parses exactly as before", () => {
  assert.deepEqual(parseModelJson('{"a":1,"b":["x","y"],"c":{"d":null}}'), { a: 1, b: ["x", "y"], c: { d: null } });
  assert.deepEqual(parseModelJson('{"s":"line1' + BS + "nline2" + '"}'), { s: "line1" + NL + "line2" });
});

test("raw newlines, tabs and carriage returns inside string values are repaired and kept", () => {
  const prompt = "Read two ints." + NL + "Print their sum." + NL + TAB + "Indent";
  const text = '{"questions":[{"title":"Sum","prompt":"' + prompt + '","testCases":[{"input":"1' + NL + '2","expected":"3","isHidden":false}]}]}';
  assert.throws(() => JSON.parse(text), SyntaxError, "this is the shape the model returned: strict parsing rejects it");
  const out = parseModelJson(text);
  assert.equal(out.questions[0].prompt, prompt);
  assert.equal(out.questions[0].testCases[0].input, "1" + NL + "2");
  assert.equal(parseModelJson('{"s":"a' + CR + NL + 'b"}').s, "a" + CR + NL + "b");
});

test("other control characters are escaped as unicode escapes and kept", () => {
  assert.equal(parseModelJson('{"s":"a' + CTRL1 + 'b"}').s, "a" + CTRL1 + "b");
});

test("whitespace between tokens and already-escaped sequences are not touched", () => {
  const escapedQuoteAndBackslash = '{' + NL + '  "a": "x' + BS + '"y' + BS + BS + '",' + NL + '  "b": 2' + NL + '}';
  assert.equal(escapeControlCharsInStrings(escapedQuoteAndBackslash), escapedQuoteAndBackslash);
  assert.deepEqual(parseModelJson(escapedQuoteAndBackslash), { a: 'x"y' + BS, b: 2 });
});

test("a code fence around the answer is removed", () => {
  const fence = "`".repeat(3);
  assert.deepEqual(parseModelJson(fence + "json" + NL + '{"a":1}' + NL + fence), { a: 1 });
  assert.deepEqual(parseModelJson(String.fromCharCode(0xfeff) + '{"a":1}'), { a: 1 });
});

test("text that is still not JSON after the repair throws a SyntaxError", () => {
  assert.throws(() => parseModelJson('{"a": "unterminated'), SyntaxError);
  assert.throws(() => parseModelJson("not json at all"), SyntaxError);
  assert.throws(() => parseModelJson(""), SyntaxError);
});
