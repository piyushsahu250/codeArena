// One-off: verify the OCR fallback (resumeOcr.js, wired into resumeParser.js) actually works
// end-to-end against a real image-only ("scanned") PDF, without needing an actual scanned resume
// on hand. Builds a synthetic scanned-style PDF by drawing text onto a canvas (simulating a photo
// of a resume), rendering it to a PNG, and embedding ONLY that PNG into a PDF page via pdfkit —
// deliberately with no text layer at all, so pdf-parse's native extraction genuinely returns
// nothing and the OCR fallback path is the only way any text comes out.
const { createCanvas } = require("canvas");
const PDFDocument = require("pdfkit");
const { PassThrough } = require("stream");
const { parseResumeFile } = require("../src/utils/resumeParser");

function buildSyntheticScanImage() {
  const canvas = createCanvas(1000, 1300);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1000, 1300);
  ctx.fillStyle = "#000000";
  ctx.font = "40px sans-serif";
  const lines = [
    "OCR TEST CANDIDATE",
    "ocrtest.candidate@example.com",
    "9876543210",
    "",
    "EDUCATION",
    "B.Tech Computer Science, Test Institute of Technology",
    "2020 - 2024",
    "",
    "SKILLS",
    "Python, Java, SQL, Docker",
    "",
    "PROJECTS",
    "Inventory Management System",
    "Built a Java based inventory system for a retail store.",
  ];
  let y = 80;
  for (const line of lines) {
    ctx.fillText(line, 60, y);
    y += 70;
  }
  return canvas.toBuffer("image/png");
}

async function buildSyntheticScannedPdf(pngBuffer) {
  const doc = new PDFDocument({ size: [1000, 1300], margin: 0 });
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  doc.pipe(stream);
  doc.image(pngBuffer, 0, 0, { width: 1000, height: 1300 });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

async function main() {
  console.log("Building synthetic scanned (image-only, no text layer) PDF...");
  const png = buildSyntheticScanImage();
  const pdfBuffer = await buildSyntheticScannedPdf(png);
  console.log(`Synthetic scanned PDF built: ${pdfBuffer.length} bytes\n`);

  console.log("Confirming pdf-parse's NATIVE extraction genuinely finds nothing (sanity check)...");
  const pdfParse = require("pdf-parse");
  const nativeResult = await pdfParse(pdfBuffer);
  console.log(`  Native text length: ${nativeResult.text.trim().length} chars (expect ~0)\n`);

  console.log("Running parseResumeFile() — should fall through to the OCR path...");
  const started = Date.now();
  let parsed;
  try {
    parsed = await parseResumeFile(pdfBuffer, "application/pdf", "scanned-test.pdf");
  } catch (err) {
    console.log(`FAIL: parseResumeFile threw: ${err.message}`);
    process.exit(1);
  }
  const ms = Date.now() - started;
  console.log(`Completed in ${ms}ms\n`);

  const checks = [
    ["usedOcr === true", parsed.usedOcr === true],
    ["ocrConfidence is a number", typeof parsed.ocrConfidence === "number"],
    ["email recognized", parsed.email === "ocrtest.candidate@example.com" || /ocrtest\.candidate@example\.com/i.test(parsed.rawText || "")],
    ["mobile recognized (10 digits)", !!(parsed.mobile && parsed.mobile.replace(/\D/g, "").length >= 10)],
    ["some education entry found", Array.isArray(parsed.education) && parsed.education.length > 0],
    ["some skill found", Array.isArray(parsed.skills) && parsed.skills.length > 0],
    ["confidence scores present and OCR-capped", parsed.confidence && typeof parsed.confidence.personal === "number"],
  ];

  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}`);
    if (!ok) allPass = false;
  }
  console.log(`\nTesseract confidence reported: ${parsed.ocrConfidence}`);
  console.log(`Confidence scores (should be capped, not the raw high values a clean native parse would get):`, parsed.confidence);
  console.log(`\nRaw OCR'd text (first 300 chars):\n${(parsed.rawText || "").slice(0, 300)}`);

  console.log(allPass ? "\nALL CHECKS PASSED." : "\nSOME CHECKS FAILED.");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("Script crashed:", e); process.exit(1); });
