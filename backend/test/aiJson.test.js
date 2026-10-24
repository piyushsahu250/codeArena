// Regression for the live bug (2026-10-24): AI question generation for a CODING question answered "AI service is temporarily unavailable" although the model replied and
// the key quota was fine. The reply had raw newlines inside JSON string values ("Bad control character in string literal"), so both attempts failed to parse.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseModelJson, escapeControlCharsInStrings } = require("../src/utils/aiJson");

test("valid JSON parses exactly as before", () => {
  assert.deepEqual(parseModelJson('{"a":1,"b":["x","y"],"c":{"d":null}}'), { a: 1, b: ["x", "y"], c: { d: null } });
  assert.deepEqual(parseModelJson('{"s":"line1\nline2"}'), { s: "line1\nline2" });
});

test("raw newlines, tabs and carriage returns inside string values are repaired and kept", () => {
  const text = '{"questions":[{"title":"Sum","prompt":"Read two ints.\nPrint their sum.\n\tIndent","testCases":[{"input":"1\n2","expected":"3","isHidden":false}]}]}';
  assert.throws(() => JSON.parse(text), /control character/i, "this is the shape the model returned");
  const out = parseModelJson(text);
  assert.equal(out.questions[0].prompt, "Read two ints.\nPrint their sum.\n\tIndent");
  assert.equal(out.questions[0].testCases[0].input, "1\n2");
  assert.equal(parseModelJson('{"s":"a\r\nb"}').s, "a\r\nb");
});

test("other control characters are escaped as \u00XX", () => {
  assert.equal(parseModelJson('{"s":"a\u0001b"}').s, "a\u0001b");
});

test("whitespace between tokens and already-escaped sequences are not touched", () => {
  assert.equal(escapeControlCharsInStrings('{\n  "a": "x\\"y\\\\",\n  "b": 2\n}'), '{\n  "a": "x\\"y\\\\",\n  "b": 2\n}');
  assert.deepEqual(parseModelJson('{\n  "a": "x\\"y",\n  "b": 2\n}'), { a: 'x"y', b: 2 });
});

test("a code fence around the answer is removed", () => {
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson("\uFEFF" + '{"a":1}'), { a: 1 });
});

test("text that is still not JSON after the repair throws the original parse error", () => {
  assert.throws(() => parseModelJson('{"a": "unterminated'), SyntaxError);
  assert.throws(() => parseModelJson("not json at all"), SyntaxError);
  assert.throws(() => parseModelJson(""), SyntaxError);
});
