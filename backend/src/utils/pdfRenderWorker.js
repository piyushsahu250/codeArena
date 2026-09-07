// Standalone worker process for PDF-to-PNG rendering — spawned (never require()'d directly) by
// resumeOcr.js's renderPdfPagesToPngBuffersSandboxed(), under the platform's existing sandbox
// identity (see judge.js's SANDBOX_UID/DROP_PRIVILEGES). This file exists specifically because
// pdfjs-dist has a known "arbitrary JavaScript execution upon opening a malicious PDF" CVE class
// (pdfjs-dist <=4.7.76, no non-breaking fix currently available — see resumeOcr.js's own header
// comment for the full pdfjs-dist version story) — parsing a student/candidate-uploaded PDF is
// exactly the untrusted-input scenario that CVE targets, and this used to happen inline in the
// main API process, with full access to JWT_SECRET/DATABASE_URL/the database itself.
//
// Running it here instead means: whatever this process does, it does as the same unprivileged,
// network-denied, minimal-env identity the code judge already runs untrusted student code as —
// it cannot reach the database, cannot see any secret, and cannot make an outbound connection
// (the iptables DROP rule docker-entrypoint.sh installs for this uid blocks it regardless of what
// this code — or a successful exploit inside it — tries to do). This does not patch the CVE; it
// contains its blast radius the same way the judge already contains a malicious student submission.
//
// Contract: argv[2] = a tmpDir already containing "input.pdf" (written by the parent BEFORE
// ownership was handed to this process's uid — see resumeOcr.js). Writes "page-N.png" files into
// that same directory, one per rendered page, then writes a single line of JSON to stdout:
//   { ok: true, pageCount, totalPages } on success
//   { ok: false, error } on failure (a corrupt/malformed/hostile PDF is an EXPECTED failure mode
//   here, not a crash — resumeOcr.js already surfaces a clean user-facing error for this).
// Never touches the network, the database, or anything outside tmpDir.
const path = require("path");
const fs = require("fs");

const RENDER_SCALE = 2; // matches resumeOcr.js's own OCR-accuracy rationale for upscaling

async function main() {
  const tmpDir = process.argv[2];
  const maxPages = Number(process.argv[3]) || 3;
  if (!tmpDir) throw new Error("pdfRenderWorker: no tmpDir argument given");

  // Lazy require, same rationale as resumeOcr.js: this worker is only ever spawned on the OCR
  // fallback path, so the cost of loading pdfjs-dist/canvas is only ever paid there.
  //
  // Absolute paths into /app/node_modules, not bare specifiers — this file itself lives inside a
  // per-invocation tmpDir under /tmp (copied there so the sandboxed uid can even find it — see
  // resumeOcr.js's own comment on why /app/src/utils isn't reachable), and confirmed live that
  // plain `require("pdfjs-dist/...")` from that location doesn't reliably pick up NODE_PATH
  // through the bash/setpriv/exec chain this process is spawned through (process.env.NODE_PATH
  // is correctly set by the time this runs, but Module.globalPaths doesn't reflect it — a real,
  // observed quirk, not a permissions issue: reading these exact files directly, by absolute
  // path, as this same sandboxed uid/gid, already works). An absolute path sidesteps node_modules
  // directory-walk resolution (and NODE_PATH) entirely, so it isn't exposed to that quirk.
  const pdfjsLib = require("/app/node_modules/pdfjs-dist/legacy/build/pdf.js");
  const { createCanvas } = require("/app/node_modules/canvas");

  const pdfBuffer = fs.readFileSync(path.join(tmpDir, "input.pdf"));
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    disableWorker: true, // no browser Worker in Node — the legacy build renders inline
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  try {
    const pageCount = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      fs.writeFileSync(path.join(tmpDir, `page-${i}.png`), canvas.toBuffer("image/png"));
    }
    console.log(JSON.stringify({ ok: true, pageCount, totalPages: doc.numPages }));
  } finally {
    await doc.destroy();
  }
}

main().catch((err) => {
  // Deliberately still exit 0 here (a thrown error is reported via the JSON payload, which the
  // parent parses either way) — a non-zero exit would make the parent's own child.on("close")
  // handling have to juggle two different failure signals (bad exit code vs. ok:false JSON) for
  // the exact same class of expected failure (a PDF that doesn't parse). One signal is simpler.
  console.log(JSON.stringify({ ok: false, error: (err && err.message) || String(err) }));
});
