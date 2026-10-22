// The images ZIP that accompanies a bulk question upload. REGRESSION (2026-10 audit, npm audit GHSA-xcpc-8h2w-3j85 / GHSA-7q85-xj36-vmfc): extraction trusted the
// uncompressed size a ZIP header DECLARES and then let the library inflate the entry in full, so a crafted archive that understates its size could make the API process
// allocate gigabytes. Entries are now inflated with a hard output ceiling, and the total counts the real inflated bytes.
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const AdmZip = require("adm-zip");
const { extractImageZip, MAX_SINGLE_FILE_BYTES } = require("../src/utils/bulkImageZip");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const zipOf = (files) => { const z = new AdmZip(); for (const [name, data] of files) z.addFile(name, data); return z.toBuffer(); };

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) { crc ^= byte; for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
// A one-entry archive written by hand with method 0 (stored), as several zip tools do for images.
function storedZip(name, data) {
  const n = Buffer.from(name), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, n, data]);
  const cd = Buffer.concat([central, n]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, end]);
}
// Rewrites the declared uncompressed size in every local and central header, which is what a bomb does to slip past a size check.
function lieAboutSize(buf, fakeSize) {
  const b = Buffer.from(buf);
  for (let i = 0; i + 30 < b.length; i++) {
    if (b.readUInt32LE(i) === 0x04034b50) b.writeUInt32LE(fakeSize, i + 22);
    if (b.readUInt32LE(i) === 0x02014b50) b.writeUInt32LE(fakeSize, i + 24);
  }
  return b;
}

test("images are extracted by lower-cased basename, folders inside the ZIP do not matter", () => {
  const { filesByName, error } = extractImageZip(zipOf([["a.png", PNG], ["figures/B.PNG", PNG]]));
  assert.equal(error, null);
  assert.deepEqual([...filesByName.keys()].sort(), ["a.png", "b.png"]);
  assert.ok(filesByName.get("a.png").equals(PNG));
});

test("a stored (uncompressed) entry still extracts", () => {
  const { filesByName, error } = extractImageZip(storedZip("stored.png", PNG));
  assert.equal(error, null);
  assert.ok(filesByName.get("stored.png") && filesByName.get("stored.png").equals(PNG));
});

test("an entry that honestly declares more than the per-image cap is skipped, the rest still extract", () => {
  const { filesByName, error } = extractImageZip(zipOf([["ok.png", PNG], ["big.png", Buffer.alloc(MAX_SINGLE_FILE_BYTES + 1024, 0)]]));
  assert.equal(error, null);
  assert.ok(filesByName.has("ok.png"));
  assert.equal(filesByName.has("big.png"), false);
});

test("a bomb that UNDERSTATES its size is skipped, not inflated", () => {
  // 100 MB of zeros deflates to roughly 100 KB; the headers are then rewritten to claim 100 bytes.
  const lying = lieAboutSize(zipOf([["bomb.png", Buffer.alloc(100 * 1024 * 1024, 0)], ["ok.png", PNG]]), 100);
  const before = process.memoryUsage().rss;
  const { filesByName, error } = extractImageZip(lying);
  const grewMb = (process.memoryUsage().rss - before) / (1024 * 1024);
  if (error) {
    // the library may refuse a header that contradicts the data; that is also a safe outcome
    assert.match(error, /Could not read the uploaded images ZIP/);
    assert.equal(filesByName, null);
  } else {
    assert.equal(filesByName.has("bomb.png"), false, "the bomb entry must not be returned");
    assert.ok(filesByName.has("ok.png"), "ordinary entries still extract");
  }
  assert.ok(grewMb < 50, `inflating must stop at the ceiling, not at the real size (process grew ${grewMb.toFixed(0)} MB)`);
});

test("the total counts real inflated bytes: many entries that each fit but together exceed the limit are refused", () => {
  const entries = [];
  for (let i = 0; i < 22; i++) entries.push([`img${i}.png`, Buffer.alloc(MAX_SINGLE_FILE_BYTES - 1024, i % 250)]);
  const { filesByName, error } = extractImageZip(zipOf(entries));
  assert.equal(filesByName, null);
  assert.match(error, /too large once extracted/);
});

test("too many entries, and a corrupt archive, are refused with readable messages", () => {
  const many = []; for (let i = 0; i < 2001; i++) many.push([`f${i}.png`, Buffer.from("x")]);
  assert.match(extractImageZip(zipOf(many)).error, /too many files/);
  assert.match(extractImageZip(Buffer.from("this is not a zip file at all")).error, /Could not read the uploaded images ZIP/);
});

test("a bounded inflate is what protects us: the zlib ceiling throws instead of allocating", () => {
  const deflated = zlib.deflateRawSync(Buffer.alloc(8 * 1024 * 1024, 0));
  assert.throws(() => zlib.inflateRawSync(deflated, { maxOutputLength: 1024 * 1024 }), /Cannot create a Buffer larger|ERR_BUFFER_TOO_LARGE|larger than/i);
});
