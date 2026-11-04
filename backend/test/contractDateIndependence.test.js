// REGRESSION (2026-11-04): verifyUsersContract recorded the literal month "2026-10" in test/snapshots/users-contract.json. Its fixture is dated "now minus 2.9 days", so the check passed only while
// that day fell in October, and from the 4th of November it failed for EVERY commit on every branch, blocking all merges, for no reason connected to any change. A contract snapshot must never hold a
// value that moves with the calendar. These tests pin that down for every snapshot and for the normaliser that produces them.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const snapDir = path.join(__dirname, "snapshots");

test("no contract snapshot contains a calendar value (a year-month or a date)", () => {
  const offenders = [];
  for (const f of fs.readdirSync(snapDir).filter((n) => n.endsWith(".json"))) {
    const text = fs.readFileSync(path.join(snapDir, f), "utf8");
    for (const m of text.matchAll(/"(20\d{2}-\d{2}(?:-\d{2})?)"/g)) offenders.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(offenders, [], "a recorded response must not depend on today's date");
});

// The normaliser is a function inside the script (which needs a running API), so it is taken out of the source and run on its own.
function loadNorm() {
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "verifyUsersContract.js"), "utf8");
  const start = src.indexOf("const UUID"), end = src.indexOf("// Structure only");
  assert.ok(start > 0 && end > start, "the normaliser is where this test expects it");
  return new Function(`${src.slice(start, end)}; return norm;`)();
}

test("the normaliser masks a month bucket whatever month it is", () => {
  const norm = loadNorm();
  for (const month of ["2026-10", "2026-11", "2026-12", "2027-01", "2099-06"]) {
    assert.deepEqual(norm({ monthly: [{ averagePercentage: 0, month, testsCount: 1 }] }), { monthly: [{ averagePercentage: 0, month: "<month>", testsCount: 1 }] }, month);
  }
});

test("it masks only a field called month, and only when it is a year-month", () => {
  const norm = loadNorm();
  assert.equal(norm({ name: "2026-11" }).name, "2026-11", "other fields are left as they are");
  assert.equal(norm({ month: "October" }).month, "October", "a month that is not YYYY-MM is left as it is");
  assert.equal(norm({ month: 10 }).month, 10);
  assert.equal(norm({ month: null }).month, null);
});

test("it still masks the other things it always did", () => {
  const norm = loadNorm();
  assert.equal(norm("2026-11-04T01:02:03.000Z"), "<time>");
  assert.equal(norm("id 123e4567-e89b-12d3-a456-426614174000"), "id <id>");
  assert.equal(norm("t 1793760000000"), "t <ts>");
  assert.equal(norm({ token: "secret" }).token, "<token>");
});

test("the recorded users snapshot says <month> where the month is", () => {
  const snap = fs.readFileSync(path.join(snapDir, "users-contract.json"), "utf8");
  assert.equal((snap.match(/"month": "<month>"/g) || []).length, 4);
});
