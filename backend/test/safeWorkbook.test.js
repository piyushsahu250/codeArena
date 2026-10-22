// The shared, bounded spreadsheet reader behind every upload (utils/safeWorkbook.js). REGRESSION (2026-10 audit): eight upload endpoints called XLSX.read with no limits. An
// .xlsx is a ZIP of XML, so an upload under the 5 MB multer limit could describe gigabytes of cells, which the library inflates into memory inside the API process.
const test = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const XLSX = require("xlsx");
const { readWorkbook, WorkbookTooLargeError, MAX_PART_BYTES } = require("../src/utils/safeWorkbook");

const T = { timeout: 60000 };
const xlsxOf = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "S"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); };
const rowsOf = (n) => [["Name", "Email"], ...Array.from({ length: n - 1 }, (_, i) => [`Student ${i}`, `s${i}@example.invalid`])]; // n rows including the header
function lieAboutSize(buf, fakeSize) { // rewrites the declared uncompressed size in every local and central ZIP header, as a bomb does
  const b = Buffer.from(buf);
  for (let i = 0; i + 30 < b.length; i++) {
    if (b.readUInt32LE(i) === 0x04034b50) b.writeUInt32LE(fakeSize, i + 22);
    if (b.readUInt32LE(i) === 0x02014b50) b.writeUInt32LE(fakeSize, i + 24);
  }
  return b;
}

test("an ordinary workbook reads exactly as before", T, () => {
  const wb = readWorkbook(xlsxOf(rowsOf(4)));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].Name, "Student 0");
});

test("a CSV file reads, and is also subject to the row cap", T, () => {
  const csv = Buffer.from("Name,Email\nA,a@example.invalid\nB,b@example.invalid\n");
  assert.equal(XLSX.utils.sheet_to_json(readWorkbook(csv).Sheets.Sheet1).length, 2);
  const big = Buffer.from("Name,Email\n" + Array.from({ length: 150 }, (_, i) => `N${i},n${i}@example.invalid`).join("\n"));
  assert.throws(() => readWorkbook(big, { maxRows: 100 }), WorkbookTooLargeError);
});

test("the row cap rejects a sheet over the limit and accepts one at the limit", T, () => {
  assert.doesNotThrow(() => readWorkbook(xlsxOf(rowsOf(100)), { maxRows: 100 }));
  assert.throws(() => readWorkbook(xlsxOf(rowsOf(120)), { maxRows: 100 }), (e) => e instanceof WorkbookTooLargeError && /more than 100 rows/.test(e.message));
});

test("a part that inflates past the ceiling is refused before the library parses it", T, () => {
  const z = new AdmZip();
  z.addFile("[Content_Types].xml", Buffer.from("<Types/>"));
  z.addFile("xl/worksheets/sheet1.xml", Buffer.alloc(MAX_PART_BYTES + 1024 * 1024, 0x20)); // ~65 MB of spaces compresses to well under 100 KB
  const started = Date.now();
  assert.throws(() => readWorkbook(z.toBuffer()), (e) => e instanceof WorkbookTooLargeError && /too large/.test(e.message));
  assert.ok(Date.now() - started < 20000, "refused promptly");
});

test("a bomb whose headers UNDERSTATE the size is refused too", T, () => {
  const z = new AdmZip();
  z.addFile("xl/worksheets/sheet1.xml", Buffer.alloc(MAX_PART_BYTES + 1024 * 1024, 0x20));
  const lying = lieAboutSize(z.toBuffer(), 100);
  const before = process.memoryUsage().rss;
  assert.throws(() => readWorkbook(lying), WorkbookTooLargeError); // either "too large once unpacked" or "could not read": never parsed
  assert.ok((process.memoryUsage().rss - before) / (1024 * 1024) < 200, "the inflate stopped at the ceiling");
});

test("the total across parts is capped as well", T, () => {
  const z = new AdmZip();
  const part = Buffer.alloc(60 * 1024 * 1024, 0x20);
  for (let i = 0; i < 4; i++) z.addFile(`xl/worksheets/sheet${i}.xml`, part); // each under the per-part ceiling, 240 MB together
  assert.throws(() => readWorkbook(z.toBuffer()), (e) => e instanceof WorkbookTooLargeError && /too large/.test(e.message));
});

test("a file that is not a spreadsheet is still reported by the library, not swallowed", T, () => {
  const z = new AdmZip(); z.addFile("readme.txt", Buffer.from("hello"));
  assert.doesNotThrow(() => { try { readWorkbook(z.toBuffer()); } catch (e) { assert.ok(!(e instanceof WorkbookTooLargeError)); } });
  assert.throws(() => readWorkbook("not a buffer"), /file buffer is required/);
});
