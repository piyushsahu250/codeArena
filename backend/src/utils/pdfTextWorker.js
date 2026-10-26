// Worker thread that reads the text of an uploaded PDF (see pdfText.js). The PDF library is old and a student controls the file, so it never runs on the API's own thread:
// the parent can stop this thread at a deadline, cap its memory, and hands it an empty environment (no database URL, no signing secret in process.env).
const { parentPort, workerData } = require("worker_threads");
const pdfParse = require("pdf-parse");
const { renderPageInReadingOrder } = require("./pdfReadingOrder");

(async () => {
  try {
    // Wrap the received bytes without copying through Buffer's shared pool: the old pdf.js reads the underlying ArrayBuffer from offset 0, so a pooled (offset) Buffer reads garbage ("bad XRef entry").
    const bytes = workerData.buffer;
    const data = await pdfParse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { pagerender: renderPageInReadingOrder, max: workerData.maxPages });
    parentPort.postMessage({ ok: true, text: data.text || "", pages: data.numpages });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String((err && err.message) || err).slice(0, 300) });
  }
})();
