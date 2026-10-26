const test = require("node:test");
const assert = require("node:assert/strict");
const PDFDocument = require("pdfkit");
const pdfParse = require("pdf-parse");
function pdfOf(lines, opts = {}) { return new Promise((res) => { const d = new PDFDocument({ autoFirstPage: false, ...opts }); const c = []; d.on("data", (x) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); d.addPage(); let y = 72; for (const l of lines) { d.text(l, 72, y); y += 20; } d.end(); }); }
test("diag", async () => {
  const out = [];
  const big = Array.from({ length: 60 }, (_, i) => `Line number ${i} with some padding text to make the file longer`);
  for (const [name, lines, opts] of [["small", ["Asha Patil", "Skills"], {}], ["big", big, {}], ["small-nocompress", ["Asha Patil", "Skills"], { compress: false }]]) {
    for (let round = 0; round < 3; round++) {
      const buf = await pdfOf(lines, opts);
      let r1, r2;
      try { await pdfParse(buf); r1 = "ok"; } catch (e) { r1 = "ERR"; }
      try { await pdfParse(buf); r2 = "ok"; } catch (e) { r2 = "ERR"; }
      out.push(`${name}#${round} len=${buf.length} off=${buf.byteOffset} first=${r1} second=${r2}`);
    }
  }
  assert.fail("DIAG " + out.join(" ; "));
});
