// Regression coverage for utils/bulkImageZip.js — the ZIP-of-question-images helper used by bulk
// question upload's optional "Image File Name" column. Builds real in-memory ZIPs with adm-zip's
// own writer API (no fixture files needed) and reads them back through extractImageZip/
// validateZipImage exactly as the bulk-import routes do. Run with `npm test`.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const { extractImageZip, validateZipImage } = require("../src/utils/bulkImageZip");

// A minimal valid 1x1 PNG (real magic bytes: sniffImageMime must recognize it) — smaller than
// hand-rolling a JPEG/GIF and just as good for exercising the format-sniff path.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function buildZip(entries) {
  const zip = new AdmZip();
  for (const [name, data] of entries) zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  return zip.toBuffer();
}

describe("extractImageZip", () => {
  test("extracts files keyed by lowercased basename, ignoring folder paths", () => {
    const buf = buildZip([
      ["triangle.png", PNG_1PX],
      ["figures/Circle.PNG", PNG_1PX],
    ]);
    const { filesByName, error } = extractImageZip(buf);
    assert.equal(error, null);
    assert.ok(filesByName.has("triangle.png"));
    assert.ok(filesByName.has("circle.png")); // basename only, lowercased
    assert.equal(filesByName.size, 2);
  });

  test("a corrupt/non-zip buffer is rejected gracefully, never throws", () => {
    const { filesByName, error } = extractImageZip(Buffer.from("this is not a zip file at all"));
    assert.equal(filesByName, null);
    assert.ok(error && error.length > 0);
  });

  test("an empty zip extracts to an empty map, not an error", () => {
    const { filesByName, error } = extractImageZip(buildZip([]));
    assert.equal(error, null);
    assert.equal(filesByName.size, 0);
  });

  test("directory entries are skipped, not treated as files", () => {
    const zip = new AdmZip();
    zip.addFile("figures/", Buffer.alloc(0)); // a directory entry
    zip.addFile("figures/triangle.png", PNG_1PX);
    const { filesByName } = extractImageZip(zip.toBuffer());
    assert.equal(filesByName.size, 1);
    assert.ok(filesByName.has("triangle.png"));
  });

  test("two entries with the same basename in different folders -- first one wins, never crashes", () => {
    const buf = buildZip([
      ["a/shape.png", PNG_1PX],
      ["b/shape.png", Buffer.from("different bytes but still under the same basename")],
    ]);
    const { filesByName } = extractImageZip(buf);
    assert.equal(filesByName.size, 1);
    assert.ok(filesByName.has("shape.png"));
  });
});

describe("validateZipImage", () => {
  test("a real PNG's bytes are recognized", () => {
    const { mime, error } = validateZipImage(PNG_1PX, "triangle.png");
    assert.equal(error, undefined);
    assert.equal(mime, "image/png");
  });

  test("missing (undefined/null) buffer -- clear 'not found' error, not a crash", () => {
    const { error, mime } = validateZipImage(undefined, "triangle.png");
    assert.equal(mime, undefined);
    assert.match(error, /not found/i);
    assert.match(error, /triangle\.png/);
  });

  test("a file that exists but isn't a real image (renamed .txt, say) is rejected by content, not by name", () => {
    const { error, mime } = validateZipImage(Buffer.from("just some plain text, not an image"), "fake.png");
    assert.equal(mime, undefined);
    assert.match(error, /not a recognized image format/i);
  });
});
