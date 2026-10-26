const test = require("node:test");
const assert = require("node:assert/strict");
const PDFDocument = require("pdfkit");
const pdfParse = require("pdf-parse");
const { renderPageInReadingOrder } = require("../src/utils/pdfReadingOrder");
function pdfOf(lines) { return new Promise((res) => { const d = new PDFDocument({ autoFirstPage: false }); const c = []; d.on("data", (x) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); d.addPage(); let y = 72; for (const l of lines) { d.text(l, 72, y); y += 20; } d.end(); }); }
test("diag", async () => {
  const buf = await pdfOf(["Asha Patil", "Skills"]);
  const out = [`len=${buf.length} off=${buf.byteOffset} head=${JSON.stringify(buf.subarray(0, 8).toString())}`];
  const tries = {
    plain: () => pdfParse(buf),
    reading: () => pdfParse(buf, { pagerender: renderPageInReadingOrder }),
    readingMax: () => pdfParse(buf, { pagerender: renderPageInReadingOrder, max: 15 }),
    copyU8: () => pdfParse(Buffer.from(new Uint8Array(buf))),
    maxOnly: () => pdfParse(buf, { max: 15 }),
  };
  for (const [k, f] of Object.entries(tries)) { try { const r = await f(); out.push(`${k}: ok ${JSON.stringify(r.text.slice(0, 30))}`); } catch (e) { out.push(`${k}: ERR ${e.message}`); } }
  assert.fail(out.join(" | "));
});
