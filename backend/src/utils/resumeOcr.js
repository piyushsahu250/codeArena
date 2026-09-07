// OCR fallback for scanned/image-only PDFs. Native text extraction (pdf-parse, see
// resumeParser.js) is ALWAYS tried first and is what every normal (text-based) resume upload
// uses — this file is only ever invoked when that native pass comes back empty, per the spec's
// "use native extraction first, OCR only when necessary, OCR must never silently replace
// high-quality native extraction" requirement. pdfjs-dist/canvas/tesseract.js are required lazily
// inside the functions below so the normal (fast) upload path never pays the cost of loading them.
//
// pdfjs-dist is pinned to 3.11.174 in package.json specifically because v4+ dropped CommonJS
// support entirely (ESM-only, `require()` throws ERR_REQUIRE_ESM) — this file uses
// `pdfjs-dist/legacy/build/pdf.js`, the Node-targeted CJS build that was still shipped at 3.x.
// This version is ALSO the one flagged by `npm audit` for "arbitrary JavaScript execution upon
// opening a malicious PDF" (pdfjs-dist <=4.7.76) with no available non-breaking fix — 5.x's
// entire Node rendering path hardcodes @napi-rs/canvas internally (confirmed by inspecting its
// actual published source), which is the exact package/rendering combination the comment below
// already documents as crashing on this platform's own canvas-mutation pattern. A real version
// migration needs its own dedicated, carefully-tested effort; in the meantime, the actual PDF
// parsing/rendering step below runs sandboxed (see renderPdfPagesToPngBuffersSandboxed) — same
// unprivileged, network-denied identity the code judge already runs untrusted student code as —
// so a malicious resume PDF can't reach the database, any secret, or the network even if it
// successfully exploits this CVE. That containment is real security value on its own, independent
// of whichever pdfjs-dist version eventually lands.
//
// Uses the `canvas` package (node-canvas, Cairo-backed — see the added system libraries in
// Dockerfile), NOT @napi-rs/canvas. Confirmed live: pdfjs-dist's Node rendering path creates its
// OWN internal temporary canvases mid-render (for pattern/soft-mask operators) via a hardcoded
// bundled factory that is not the one passed in `getDocument()`'s `canvasFactory` option, and that
// internal factory calls `canvas.width = <n>` to recycle a canvas in place — @napi-rs/canvas's
// canvas object throws a native, uncatchable error the instant that happens (confirmed: neither a
// custom canvasFactory option nor wrapping every call in try/catch could intercept it, since it
// fires from a detached internal callback). `canvas` is the package pdfjs-dist's Node code was
// actually built and tested against, so this mutation is exactly what it expects.
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const { SANDBOX_UID, SANDBOX_GID, DROP_PRIVILEGES, JUDGE_ENV, cleanupTmpDir } = require("./judge");

// Bounds on a small, shared, resource-constrained host: OCR is CPU/memory-heavy compared to
// native text extraction, and a resume is essentially never legitimately longer than a few pages
// — capping page count and wall-clock time keeps one unusual upload from starving every other
// request on the same host.
const MAX_OCR_PAGES = 3;
const OCR_TIMEOUT_MS = 45000;
const RENDER_SCALE = 2; // upscale rendering — meaningfully improves OCR accuracy on small resume fonts
// A slice of OCR_TIMEOUT_MS specifically for the render step, leaving the rest of the 45s budget
// for Tesseract recognition afterward — rendering a 3-page PDF, even under a sandboxed Node
// child's slower cold-start, has never legitimately needed anywhere near this on this host.
const PDF_RENDER_TIMEOUT_MS = 20000;
// Node's own heap cap for the sandboxed renderer — deliberately NOT an OS-level `ulimit -v`
// (skipped below, same exemption judge.js documents for JS/Java: V8's own startup footprint can
// exceed a naive virtual-memory ulimit before any real work even runs). --max-old-space-size is
// the safe, V8-native way to bound it instead.
const RENDER_MAX_OLD_SPACE_MB = 384;
const MAX_PROCESSES = 32; // fork-bomb guard for the sandboxed renderer, generous for a single-threaded render

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Renders PDF pages to PNG buffers in a sandboxed child process (see pdfRenderWorker.js's own
// header comment for the full rationale) — spawned under the platform's existing SANDBOX_UID
// identity whenever DROP_PRIVILEGES is on (already true in production; see judge.js). Falls back
// to the original in-process rendering when it's off (e.g. a local dev machine without the
// sandbox uid/iptables setup already provisioned) so this never becomes a hard requirement to run
// the app at all — matching the exact same "ships dark, opt-in via existing env var" convention
// the judge sandbox itself already uses.
async function renderPdfPagesToPngBuffersSandboxed(pdfBuffer, maxPages) {
  if (!DROP_PRIVILEGES) return renderPdfPagesToPngBuffersInProcess(pdfBuffer, maxPages);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  // The worker script itself is copied INTO tmpDir rather than left at its real location under
  // /app/src/utils/ — confirmed live: the sandbox uid can't `require()` it there even with the
  // file's own permissions opened up, because /app/src/utils/ itself has no "other"-execute bit,
  // so uid 10001 can't even traverse into the directory to find it (a plain ENOENT/"Cannot find
  // module", not EACCES). tmpDir is the one place already set up for exactly this kind of
  // cross-uid handoff (see judge.js's own prepare()), so the worker rides along inside it instead.
  const workerPath = path.join(tmpDir, "worker.js");
  // Written while tmpDir is still owned by this (app) process — the handover to `sandbox` must
  // come after, exactly like judge.js's prepare() (see its own comment on why this ordering
  // matters once the process is genuinely unprivileged, not root).
  fs.writeFileSync(pdfPath, pdfBuffer);
  fs.copyFileSync(path.join(__dirname, "pdfRenderWorker.js"), workerPath);
  fs.chownSync(pdfPath, SANDBOX_UID, SANDBOX_GID);
  fs.chmodSync(pdfPath, 0o440); // sandbox needs to read its own input, never write it
  fs.chownSync(workerPath, SANDBOX_UID, SANDBOX_GID);
  fs.chmodSync(workerPath, 0o440); // read-only, same reasoning as the input PDF
  fs.chownSync(tmpDir, SANDBOX_UID, SANDBOX_GID);
  fs.chmodSync(tmpDir, 0o771); // sandbox: enter + write (its output pages go here too)

  try {
    const result = await new Promise((resolve) => {
      // Same ulimit/setpriv wrapping judge.js's own spawnWithTimeout uses (see its comments for
      // the full reasoning): `ulimit -u` is the fork-bomb guard, `ulimit -t` a CPU-time backstop
      // independent of CAP_SYS_RESOURCE, `setpriv --no-new-privs` closes the gap where a plain
      // uid/gid drop alone doesn't stop exec'ing a setuid-root binary. `ulimit -v` (memory) is
      // deliberately NOT applied here — same exemption judge.js documents for JS/Java: this is
      // itself a Node process, and V8's own startup footprint can exceed a naive virtual-memory
      // ulimit before any real work runs. --max-old-space-size below is the V8-safe equivalent.
      const cpuSeconds = Math.ceil(PDF_RENDER_TIMEOUT_MS / 1000) + 5;
      const innerCmd = `ulimit -u ${MAX_PROCESSES}; ulimit -t ${cpuSeconds}; exec setpriv --no-new-privs "$0" "$@"`;
      const child = spawn(
        "bash",
        ["-c", innerCmd, "node", `--max-old-space-size=${RENDER_MAX_OLD_SPACE_MB}`, workerPath, tmpDir, String(maxPages)],
        {
          // uid stays the sandbox identity (process/network isolation is keyed on UID — the
          // iptables DROP rule matches --uid-owner SANDBOX_UID regardless of gid). gid is
          // deliberately THIS process's own gid (i.e. "app"), not SANDBOX_GID: confirmed live
          // that adding sandbox to the app group via usermod does NOT help here, because Node's
          // spawn({uid, gid}) with plain numeric ids does a bare setuid/setgid, never an
          // initgroups()-style lookup — supplementary group membership from /etc/group is never
          // picked up. Setting gid directly to "app"'s own gid grants read+traverse into /app
          // (mode 750, group r-x — confirmed via `ls -ld /app`) through the GROUP permission bits
          // themselves, no supplementary-group mechanism required, while the effective UID stays
          // the distinct, network-denied sandbox identity throughout.
          uid: SANDBOX_UID, gid: process.getgid(),
          env: JUDGE_ENV, // whitelisted — never inherits JWT_SECRET/DATABASE_URL/GEMINI_API_KEY/etc.
          detached: true, // own process group, so a timeout kill also reaps any children pdfjs-dist itself might spawn
          killSignal: "SIGKILL",
        }
      );
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const killTimer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
      }, PDF_RENDER_TIMEOUT_MS);
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("close", () => {
        clearTimeout(killTimer);
        if (timedOut) return resolve({ ok: false, error: "PDF rendering timed out" });
        try {
          const parsed = JSON.parse(stdout.trim().split("\n").pop());
          resolve(parsed);
        } catch {
          resolve({ ok: false, error: stderr || "PDF rendering worker produced no readable output" });
        }
      });
      child.on("error", (err) => {
        clearTimeout(killTimer);
        resolve({ ok: false, error: err.message });
      });
    });

    if (!result.ok) throw new Error(result.error || "PDF rendering failed");

    // Restore this process's own ownership before reading the pages back — mirrors
    // cleanupTmpDir()'s own reasoning (this process is a genuinely unprivileged `app` uid, not
    // root, so it has no permission bits left on a directory still owned by `sandbox` under a
    // plain read once the handover above already happened).
    fs.chownSync(tmpDir, process.getuid(), process.getgid());
    const buffers = [];
    for (let i = 1; i <= result.pageCount; i++) {
      buffers.push(fs.readFileSync(path.join(tmpDir, `page-${i}.png`)));
    }
    return { buffers, totalPages: result.totalPages };
  } finally {
    // cleanupTmpDir() (judge.js) already re-chowns tmpDir back to this process before removing
    // it (guarded by the same DROP_PRIVILEGES check), so the failure path here needs no extra
    // handling beyond calling it — confirmed live that its internal chownSync succeeds even when
    // the success-path chown above was never reached (a thrown result.ok===false skips straight
    // here). It's a fire-and-forget async fs.rm with an intentionally swallowed error callback —
    // same as the judge's own tmpdirs — so a caller checking the filesystem synchronously right
    // after this returns can observe it mid-flight; that's a completion-timing artifact of the
    // shared helper, not a leak (confirmed live: the directory is gone moments later).
    cleanupTmpDir(tmpDir);
  }
}

// The original, in-process renderer — still used directly whenever DROP_PRIVILEGES is off (see
// renderPdfPagesToPngBuffersSandboxed above). Unchanged from before the sandboxing work.
async function renderPdfPagesToPngBuffersInProcess(pdfBuffer, maxPages) {
  const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
  const { createCanvas } = require("canvas");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    disableWorker: true, // no browser Worker in Node — the legacy build runs rendering inline
    useSystemFonts: true,
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
//
// Tesseract itself runs in-process (not sandboxed) — deliberately: by the time this runs, the
// untrusted PDF has already been fully parsed away into plain PNG image buffers by the sandboxed
// renderer above. Tesseract only ever sees benign, already-rendered raster images, never the
// original PDF's own file format/content stream — the actual untrusted-input attack surface
// (pdfjs-dist's PDF parsing) is what needed isolating, not OCR-ing a picture.
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
    renderPdfPagesToPngBuffersSandboxed(pdfBuffer, MAX_OCR_PAGES),
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
