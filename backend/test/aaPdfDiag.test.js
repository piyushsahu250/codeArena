const test = require("node:test");
const path = require("path");
const { Worker } = require("worker_threads");
const PDFDocument = require("pdfkit");
const pdfParse = require("pdf-parse");
function pdfOf(lines) { return new Promise((res) => { const d = new PDFDocument({ autoFirstPage: false }); const c = []; d.on("data", (x) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); d.addPage(); let y = 72; for (const l of lines) { d.text(l, 72, y); y += 20; } d.end(); }); }
const runWorker = (buf, extra = {}) => new Promise((resolve) => { const w = new Worker(path.join(__dirname, "../src/utils/pdfTextWorker.js"), { workerData: { buffer: new Uint8Array(buf), maxPages: 15 }, ...extra }); w.once("message", (m) => { resolve(m.ok ? "ok" : "ERR " + m.error); w.terminate(); }); w.once("error", (e) => resolve("WERR " + e.message)); });
test("diag", async () => {
  const out = [];
  for (let round = 0; round < 4; round++) {
    const buf = await pdfOf(["Asha Patil", "Skills"]);
    const exact = Buffer.from(new Uint8Array(buf).buffer);
    let a, b;
    try { await pdfParse(exact); a = "ok"; } catch (e) { a = "ERR"; }
    b = await runWorker(buf);
    const c = await runWorker(buf, { env: {} });
    out.push(`#${round} off=${buf.byteOffset} exactOff=${exact.byteOffset} exactLen=${exact.length}/${buf.length} inThreadExact=${a} worker=${b} workerEnv={}=${c}`);
  }
  require("node:assert").fail("DIAG " + out.join(" ; "));
});
