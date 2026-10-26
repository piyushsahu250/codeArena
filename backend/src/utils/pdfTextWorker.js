// Worker thread that reads the text of an uploaded PDF (see pdfText.js). The PDF library is old and a student controls the file, so it never runs on the API's own thread:
// the parent can stop this thread at a deadline, cap its memory, and hands it an empty environment (no database URL, no signing secret in process.env).
const { parentPort, workerData } = require("worker_threads");
const pdfParse = require("pdf-parse");
const { renderPageInReadingOrder } = require("./pdfReadingOrder");

(async () => {
  try {
    // Hand the library a plain Uint8Array, never a Node Buffer: measured on the live image, pdf-parse's pdf.js fails with "bad XRef entry" on PDFs under about 4 KB when given a Buffer inside a worker thread (every size reads fine as a Uint8Array).
    const data = await pdfParse(workerData.buffer, { pagerender: renderPageInReadingOrder, max: workerData.maxPages });
    parentPort.postMessage({ ok: true, text: data.text || "", pages: data.numpages });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String((err && err.message) || err).slice(0, 300) });
  }
})();
