// OCR fallback for scanned/image-only PDFs. Native text extraction (pdf-parse, see
// resumeParser.js) is ALWAYS tried first and is what every normal (text-based) resume upload
// uses — this file is only ever invoked when that native pass comes back empty, per the spec's
// "use native extraction first, OCR only when necessary, OCR must never silently replace
// high-quality native extraction" requirement. pdfjs-dist/@napi-rs/canvas/tesseract.js are
// required lazily inside the functions below so the normal (fast) upload path never pays the
// cost of loading them.
//
// pdfjs-dist is pinned to 3.11.174 in package.json specifically because v4+ dropped CommonJS
// support entirely (ESM-only, `require()` throws ERR_REQUIRE_ESM) — this file uses
// `pdfjs-dist/legacy/build/pdf.js`, the Node-targeted CJS build that was still shipped at 3.x.
const path = require("path");
const os = require("os");
const fs = require("fs");

// Bounds on a small, shared, resource-constrained host: OCR is CPU/memory-heavy compared to
// native text extraction, and a resume is essentially never legitimately longer than a few pages
// — capping page count and wall-clock time keeps one unusual upload from starving every other
// request on the same host.
const MAX_OCR_PAGES = 3;
const OCR_TIMEOUT_MS = 45000;
const RENDER_SCALE = 2; // upscale rendering — meaningfully improves OCR accuracy on small resume fonts

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// pdfjs-dist's own bundled Node canvas factory assumes the `canvas` (node-canvas/cairo) package's
// semantics — specifically, it "recycles" a canvas by mutating `.width`/`.height` in place on
// cleanup (`reset`/`destroy`). @napi-rs/canvas's canvas object throws a native error
// ("Failed to unwrap exclusive reference of `CanvasElement` type from napi value") if `.width` is
// reassigned after its context has already been used — confirmed live: rendering itself succeeds,
// then `doc.destroy()`'s internal cleanup path crashes on exactly that line. Supplying this factory
// explicitly avoids the in-place mutation entirely by creating a fresh canvas instead, which is a
// non-issue here since every OCR call is short-lived and one-shot (no canvas pooling needed).
class ApiRsCanvasFactory {
  constructor(createCanvas) {
    this.createCanvas = createCanvas;
  }
  create(width, height) {
    const canvas = this.createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(canvasAndContext, width, height) {
    const canvas = this.createCanvas(width, height);
    canvasAndContext.canvas = canvas;
    canvasAndContext.context = canvas.getContext("2d");
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function renderPdfPagesToPngBuffers(pdfBuffer, maxPages) {
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  const { createCanvas } = require("@napi-rs/canvas");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    disableWorker: true, // no browser Worker in Node — the legacy build runs rendering inline
    useSystemFonts: true,
    canvasFactory: new ApiRsCanvasFactory(createCanvas),
  });
  const doc = await loadingTask.promise;
  try {
    const pageCount = Math.min(doc.numPages, maxPages);
    const buffers = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      buffers.push(canvas.toBuffer("image/png"));
    }
    return { buffers, totalPages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

// One shared worker, lazily created on first real use and reused for the process lifetime —
// starting a Tesseract worker (loading the WASM core + trained language data) is the expensive
// part; reusing it means only the first scanned-resume upload after a deploy pays that cost.
// cachePath keeps the downloaded eng.traineddata around across requests (not across a redeploy,
// since that starts a fresh container) instead of re-fetching it every time.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    const { createWorker } = require("tesseract.js");
    const cacheDir = path.join(os.tmpdir(), "codearena-tesseract-cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    workerPromise = createWorker("eng", 1, { cachePath: cacheDir }).catch((err) => {
      workerPromise = null; // don't cache a failed init — let the next attempt retry cleanly
      throw err;
    });
  }
  return workerPromise;
}

// Returns { text, confidence (0-100, Tesseract's own mean confidence across recognized pages),
// pagesProcessed, totalPages }. Throws with a message safe to show the user directly on failure
// (timeout, corrupt PDF, OCR engine failure) — resumeParser.js decides how to surface it.
async function ocrPdfBuffer(pdfBuffer) {
  const { buffers, totalPages } = await withTimeout(
    renderPdfPagesToPngBuffers(pdfBuffer, MAX_OCR_PAGES),
    OCR_TIMEOUT_MS,
    "PDF page rendering for OCR"
  );
  if (buffers.length === 0) throw new Error("No pages could be rendered from this PDF for OCR.");

  const worker = await withTimeout(getWorker(), OCR_TIMEOUT_MS, "OCR engine startup");
  let combinedText = "";
  let confidenceSum = 0;
  for (const png of buffers) {
    const { data } = await withTimeout(worker.recognize(png), OCR_TIMEOUT_MS, "OCR recognition");
    combinedText += `\n${data.text || ""}`;
    confidenceSum += typeof data.confidence === "number" ? data.confidence : 0;
  }
  return {
    text: combinedText.trim(),
    confidence: Math.round(confidenceSum / buffers.length),
    pagesProcessed: buffers.length,
    totalPages,
  };
}

module.exports = { ocrPdfBuffer, MAX_OCR_PAGES };
