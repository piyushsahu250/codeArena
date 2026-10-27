// Every place that saves a function question must pass its test cases to resolveCodingFields, which refuses cases the judge's driver cannot read (see functionCaseFormat.test.js and the
// 2026-10-26 Coding Test). A new authoring path that forgets the argument would silently bring the bug back, so this reads the source: each call must mention testCases, apart from the
// one read-only caller that only needs starter code for an existing question.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const EXEMPT = new Set(["routes/moduleCoding.js"]); // builds the starter code of an already-saved question; saves nothing
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));
}

test("every call to resolveCodingFields that saves a question passes the test cases", () => {
  const seen = [];
  for (const f of files(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    if (rel === "utils/functionHarness.js" || EXEMPT.has(rel)) continue;
    const text = fs.readFileSync(f, "utf8");
    let from = 0;
    for (;;) {
      const at = text.indexOf("resolveCodingFields(", from);
      if (at === -1) break;
      from = at + 1;
      const lineStart = text.lastIndexOf("\n", at) + 1;
      if (/^\s*(\/\/|\*)/.test(text.slice(lineStart, at))) continue; // a comment that names the function
      if (/require\(|function resolveCodingFields/.test(text.slice(lineStart, text.indexOf("\n", at)))) continue;
      const call = text.slice(at, text.indexOf("});", at) + 3);
      seen.push(rel);
      assert.ok(/testCases/.test(call), `${rel}: resolveCodingFields( ... ) must pass testCases (near: ${call.slice(0, 80).replace(/\s+/g, " ")})`);
    }
  }
  assert.ok(seen.length >= 7, `expected at least 7 authoring call sites, found ${seen.length}: ${seen.join(", ")}`);
});
