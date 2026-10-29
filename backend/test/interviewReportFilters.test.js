// Accuracy checks for the Interview Reports filters. Expected values are worked out by hand (India is UTC+5:30), not copied from the code's output.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FilterError, dateRange, scoreBounds, studentWhere, formatIst } = require("../src/utils/interviewReportFilters");

test("a date is a whole India calendar day: from 00:00 IST, and Date To includes the entire last day", () => {
  const r = dateRange("2026-10-29", "2026-10-29");
  assert.equal(r.gte.toISOString(), "2026-10-28T18:30:00.000Z"); // 00:00 IST on the 29th
  assert.equal(r.lt.toISOString(), "2026-10-29T18:30:00.000Z");  // 00:00 IST on the 30th, exclusive: 23:59:59.999 IST on the 29th is still inside
  // 02:00 IST on the 29th is 20:30 UTC on the 28th: it belongs to the 29th (the old UTC reading put it on the 28th)
  const t = new Date("2026-10-28T20:30:00Z");
  assert.ok(t >= r.gte && t < r.lt);
  // 01:00 IST on the 30th is 19:30 UTC on the 29th: it is NOT in the 29th (the old "23:59:59 UTC" end kept it)
  const next = new Date("2026-10-29T19:30:00Z");
  assert.ok(!(next >= r.gte && next < r.lt));
});

test("only one end is fine; none gives no filter; bad or reversed dates are refused with a reason", () => {
  assert.equal(dateRange("", ""), null);
  assert.equal(dateRange(undefined, undefined), null);
  assert.deepEqual(Object.keys(dateRange("2026-10-01", "")), ["gte"]);
  assert.deepEqual(Object.keys(dateRange("", "2026-10-31")), ["lt"]);
  assert.throws(() => dateRange("29/10/2026", ""), (e) => e instanceof FilterError && e.status === 400 && /Date From/.test(e.message));
  assert.throws(() => dateRange("", "2026-02-31"), /Date To/);
  assert.throws(() => dateRange("2026-10-30", "2026-10-29"), /cannot be after/);
});

test("score bounds are numbers from 0 to 100; zero is a real bound; nonsense is refused instead of failing the database call", () => {
  assert.equal(scoreBounds("", ""), null);
  assert.deepEqual(scoreBounds("0", "100"), { gte: 0, lte: 100 });
  assert.deepEqual(scoreBounds("40", ""), { gte: 40 });
  assert.deepEqual(scoreBounds(undefined, "55.5"), { lte: 55.5 });
  assert.throws(() => scoreBounds("abc", ""), /Min Score/);
  assert.throws(() => scoreBounds("", "101"), /Max Score/);
  assert.throws(() => scoreBounds("-1", ""), /Min Score/);
  assert.throws(() => scoreBounds("80", "20"), /cannot be above/);
});

test("with no filters the student condition is just the role, scoped to the institute when there is one", () => {
  assert.deepEqual(studentWhere({}), { role: "STUDENT" });
  assert.deepEqual(studentWhere({ instituteId: "inst-1" }), { role: "STUDENT", instituteId: "inst-1" });
  assert.deepEqual(studentWhere({ batchYear: "  ", department: "", search: " " }), { role: "STUDENT" });
});

test("batch and department match the student's own columns OR the academic group, by part of the text, ignoring case", () => {
  const w = studentWhere({ batchYear: "2025", department: "computer" });
  assert.equal(w.AND.length, 2);
  assert.deepEqual(w.AND[0].OR[0], { batchYear: { contains: "2025", mode: "insensitive" } });
  assert.deepEqual(w.AND[0].OR[1], { academicGroup: { is: { batch: { contains: "2025", mode: "insensitive" } } } });
  assert.deepEqual(w.AND[1].OR[0], { department: { contains: "computer", mode: "insensitive" } });
  assert.deepEqual(w.AND[1].OR[1], { academicGroup: { is: { department: { is: { name: { contains: "computer", mode: "insensitive" } } } } } });
});

test("search covers name, email, roll number, PRN and mobile, and sits beside the other conditions instead of replacing them", () => {
  const w = studentWhere({ search: "ganesh", batchYear: "2025", academicGroupId: "g1", classId: "c1" });
  assert.equal(w.academicGroupId, "g1");
  assert.equal(w.classId, "c1");
  const search = w.AND.find((c) => c.OR.some((x) => x.name));
  assert.deepEqual(search.OR.map((x) => Object.keys(x)[0]), ["name", "email", "rollNumber", "registrationNumber", "mobile"]);
  assert.ok(w.AND.some((c) => c.OR.some((x) => x.batchYear)), "the batch condition is still there next to the search");
});

test("times in the Excel file are India time in a fixed format", () => {
  assert.equal(formatIst("2026-10-29T18:35:00Z"), "2026-10-30 00:05");
  assert.equal(formatIst(new Date("2026-10-29T00:00:00Z")), "2026-10-29 05:30");
  assert.equal(formatIst(null), "");
  assert.equal(formatIst("not a date"), "");
});
