const test = require("node:test");
const path = require("path");
const { Worker } = require("worker_threads");
const PDFDocument = require("pdfkit");
const { generateResumePdf } = require("../src/utils/resumePdf");
const { Writable } = require("stream");
const runWorker = (buf) => new Promise((resolve) => { const w = new Worker(path.join(__dirname, "../src/utils/pdfTextWorker.js"), { workerData: { buffer: new Uint8Array(buf), maxPages: 15 } }); w.once("message", (m) => { resolve(m.ok ? "ok" : "ERR " + m.error); w.terminate(); }); w.once("error", (e) => resolve("WERR " + e.message)); });
const kit = (pages, linesPerPage, size) => new Promise((res) => { const d = new PDFDocument({ autoFirstPage: false }); const c = []; d.on("data", (x) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); for (let p = 0; p < pages; p++) { d.addPage(); d.fontSize(size); let y = 72; for (let i = 0; i < linesPerPage; i++) { d.text(`Page ${p + 1} line ${i + 1} sample resume text here`, 72, y); y += size + 4; } } d.end(); });
const resumeBuf = () => new Promise((res) => { const c = []; const w = new Writable({ write(ch, e, cb) { c.push(ch); cb(); } }); w.on("finish", () => res(Buffer.concat(c))); w.setHeader = () => {}; generateResumePdf({ fullName: "Aarav Sharma", email: "a@example.com", mobile: "9876543210", summary: "Student.", education: [], skills: [{ category: "Languages", items: ["JavaScript"] }], projects: [], experience: [], certifications: [], achievements: [], languages: [], template: "minimal" }, w); });
test("diag", async () => {
  const out = [];
  const cases = { resumeGen: await resumeBuf(), p1l2: await kit(1, 2, 12), p1l30: await kit(1, 30, 10), p3l30: await kit(3, 30, 10), p20l30: await kit(20, 30, 10) };
  for (const [k, b] of Object.entries(cases)) { out.push(`${k} len=${b.length} -> ${await runWorker(b)} / again ${await runWorker(b)}`); }
  require("node:assert").fail("DIAG " + out.join(" ; "));
});
