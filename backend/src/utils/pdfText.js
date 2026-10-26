// Reads the text of an uploaded PDF without letting the file hurt the API. REGRESSION (2026-10 audit): the resume upload parsed the PDF inside the request, on the API's only
// thread, with no limit on pages, time or memory, no check that the file was a PDF at all (the name ending in .pdf was enough), and no limit on how often one student could do it.
// One crafted or just very large file could stall every request of the API, or run it out of memory. Now:
//   * the file must start with the PDF signature (so a renamed file is refused before any library sees it);
//   * only the first MAX_PAGES pages are read (a resume is a few pages; the rest is ignored, not an error);
//   * the work runs in a worker thread with a memory cap and a deadline, and the thread is stopped when the deadline passes;
//   * at most MAX_CONCURRENT files are read at once, a short queue waits, and anything beyond that is told to try again in a minute.
// This bounds time and memory. It does not make a hostile PDF harmless: the worker is not a separate OS identity (the scanned-PDF fallback, resumeOcr.js, is: it runs as the
// judge's unprivileged user with no network).
const path = require("path");
const { Worker } = require("worker_threads");

const MAX_PAGES = 15;
const DEADLINE_MS = 20000;
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 8;
const MEMORY_MB = 384;
const SIGNATURE_WINDOW = 1024; // the PDF specification lets the header sit anywhere in the first 1024 bytes

const NOT_PDF = "This file is not a valid PDF. Please upload the PDF you saved from your resume tool.";
const TOO_SLOW = "This PDF took too long to read. Please export it again as a simple text-based PDF (not a scan or a very large design file).";
const TOO_BIG = "This PDF needs too much memory to read. Please export it again as a simple text-based PDF.";
const BUSY = "Many resumes are being read right now. Please try again in a minute.";

let active = 0;
const waiting = [];

function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, SIGNATURE_WINDOW).includes("%PDF-");
}

function acquire() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  if (waiting.length >= MAX_QUEUED) return Promise.reject(new Error(BUSY));
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); // the slot passes straight to the next waiter
  else active--;
}

function readInWorker(buffer, { maxPages, deadlineMs, memoryMb }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "pdfTextWorker.js"), {
      workerData: { buffer: new Uint8Array(buffer), maxPages },
      env: {}, // nothing from the API's environment is visible to the PDF library
      resourceLimits: { maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate().catch(() => {}); fn(value); };
    const timer = setTimeout(() => finish(reject, new Error(TOO_SLOW)), deadlineMs);
    worker.once("message", (m) => {
      if (m && m.ok) return finish(resolve, m.text);
      console.error("pdfText worker could not read the PDF:", m && m.error); // DEBUG-TEMP
      finish(reject, new Error("Couldn't read this PDF. It may be damaged or password-protected. DEBUG-TEMP " + (m && m.error)));
    });
    worker.once("error", (err) => finish(reject, new Error(err && err.code === "ERR_WORKER_OUT_OF_MEMORY" ? TOO_BIG : "Couldn't read this PDF. It may be damaged or password-protected.")));
    worker.once("exit", (code) => finish(reject, new Error(code === 0 ? "Couldn't read this PDF." : TOO_BIG)));
  });
}

// Resolves with the PDF's text. Rejects with an Error whose message is safe to show the student.
async function extractPdfText(buffer, options = {}) {
  if (!looksLikePdf(buffer)) throw new Error(NOT_PDF);
  await acquire();
  try {
    return await readInWorker(buffer, { maxPages: MAX_PAGES, deadlineMs: DEADLINE_MS, memoryMb: MEMORY_MB, ...options });
  } finally {
    release();
  }
}

module.exports = { extractPdfText, looksLikePdf, MAX_PAGES, DEADLINE_MS, MAX_CONCURRENT, MAX_QUEUED, MESSAGES: { NOT_PDF, TOO_SLOW, TOO_BIG, BUSY } };
