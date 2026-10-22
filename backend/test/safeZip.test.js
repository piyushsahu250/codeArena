// The shared ZIP check (utils/safeZip.js) and its second user, the .docx resume upload. REGRESSION (2026-10 audit): after the spreadsheet uploads were bounded, the student resume upload
// was the one ZIP-based reader left without a limit: mammoth unpacks every part of a .docx into memory inside the API process, and the 10 MB upload limit says nothing about how far a
// file inflates (a few kilobytes of XML full of spaces describe gigabytes). The check inflates each part with a hard ceiling before the library sees the file.
const test = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const { checkZip } = require("../src/utils/safeZip");
const { extractTextFromFile } = require("../src/utils/resumeParser");
const { generateResumeDocx } = require("../src/utils/resumeDocx");

const T = { timeout: 60000 };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MB = 1024 * 1024;
const LIMITS = { maxPartBytes: 1 * MB, maxTotalBytes: 3 * MB, maxParts: 5 };
const zipOf = (parts) => { const z = new AdmZip(); for (const [name, data] of Object.entries(parts)) z.addFile(name, data); return z.toBuffer(); };
function lieAboutSize(buf, fakeSize) { // rewrites the declared uncompressed size in every local and central ZIP header, as a bomb does
  const b = Buffer.from(buf);
  for (let i = 0; i + 30 < b.length; i++) {
    if (b.readUInt32LE(i) === 0x04034b50) b.writeUInt32LE(fakeSize, i + 22);
    if (b.readUInt32LE(i) === 0x02014b50) b.writeUInt32LE(fakeSize, i + 24);
  }
  return b;
}

// ---- the check itself, with small limits so the tests stay quick ------------------------------------------------------------------------------------------------

test("an ordinary archive is within the limits", T, () => {
  assert.equal(checkZip(zipOf({ "a.xml": Buffer.from("<a/>"), "b/c.xml": Buffer.from("<c/>") }), LIMITS), null);
});

test("a part that inflates past the per-part ceiling is refused", T, () => {
  assert.equal(checkZip(zipOf({ "big.xml": Buffer.alloc(2 * MB, 0x20) }), LIMITS), "too-large");
  assert.equal(checkZip(zipOf({ "ok.xml": Buffer.alloc(900 * 1024, 0x20) }), LIMITS), null, "a part under the ceiling is allowed");
});

test("the total across parts is capped as well", T, () => {
  const part = Buffer.alloc(900 * 1024, 0x20);
  assert.equal(checkZip(zipOf({ "1.xml": part, "2.xml": part, "3.xml": part, "4.xml": part }), LIMITS), "too-large", "each part is under the ceiling, 3.5 MB together");
  assert.equal(checkZip(zipOf({ "1.xml": part, "2.xml": part, "3.xml": part }), LIMITS), null, "2.6 MB together is allowed");
});

test("too many parts is refused, and directories do not count", T, () => {
  const many = {}; for (let i = 0; i < 6; i++) many[`p${i}.xml`] = Buffer.from("<p/>");
  assert.equal(checkZip(zipOf(many), LIMITS), "too-many-parts");
  const z = new AdmZip(); for (let i = 0; i < 5; i++) z.addFile(`p${i}.xml`, Buffer.from("<p/>")); z.addFile("folder/", Buffer.alloc(0));
  assert.equal(checkZip(z.toBuffer(), LIMITS), null);
});

test("something that is not a ZIP is reported as unreadable, not as too large", T, () => {
  assert.equal(checkZip(Buffer.from("this is not an archive at all"), LIMITS), "unreadable");
});

test("a bomb whose headers UNDERSTATE the size is refused too (the headers are never trusted)", T, () => {
  const lying = lieAboutSize(zipOf({ "big.xml": Buffer.alloc(2 * MB, 0x20) }), 100);
  const before = process.memoryUsage().rss;
  const verdict = checkZip(lying, LIMITS);
  assert.ok(verdict === "too-large" || verdict === "unreadable", `got ${verdict}`);
  assert.ok((process.memoryUsage().rss - before) / MB < 100, "the inflate stopped at the ceiling");
});

// ---- the .docx resume upload ---------------------------------------------------------------------------------------------------------------------------------

test("an ordinary .docx resume still reads", T, async () => {
  const resume = {
    fullName: "Aarav Sharma", email: "aarav.sharma@example.invalid", mobile: "9876543210", summary: "Final-year Computer Science student.",
    education: [{ degree: "B.TECH", institution: "Sample Institute", startYear: "2021", endYear: "2025" }],
    skills: [{ category: "Programming Languages", name: "Java" }],
    projects: [{ title: "Library Management System", description: "Built a full-stack library management system.", technologies: "Java, MySQL" }],
    experience: [], certifications: [], achievements: [], languages: [], template: "minimal",
  };
  const buffer = await generateResumeDocx(resume);
  const text = await extractTextFromFile(buffer, DOCX, "resume.docx");
  assert.match(text, /Aarav Sharma/);
  assert.match(text, /Library Management System/);
});

test("a .docx that inflates past the ceiling is refused before mammoth unpacks it", T, async () => {
  const bomb = zipOf({ "[Content_Types].xml": Buffer.from("<Types/>"), "word/document.xml": Buffer.alloc(33 * MB, 0x20) }); // ~33 MB of spaces compresses to well under 100 KB
  assert.ok(bomb.length < 1 * MB, `the upload is tiny (${bomb.length} bytes)`);
  const started = Date.now();
  await assert.rejects(() => extractTextFromFile(bomb, DOCX, "bomb.docx"), /too large to read once unpacked/);
  assert.ok(Date.now() - started < 20000, "refused promptly");
});

test("a .docx bomb with understated headers is refused as well, by our own check and not left to mammoth", T, async () => {
  const lying = lieAboutSize(zipOf({ "word/document.xml": Buffer.alloc(33 * MB, 0x20) }), 100);
  const before = process.memoryUsage().rss;
  await assert.rejects(() => extractTextFromFile(lying, DOCX, "bomb.docx"), /too large to read once unpacked|could not be opened/);
  assert.ok((process.memoryUsage().rss - before) / MB < 250, "nothing inflated past the ceiling");
});

test("a file that is not really a .docx gets a plain message", T, async () => {
  await assert.rejects(() => extractTextFromFile(Buffer.from("plain text pretending to be a document"), DOCX, "fake.docx"), /could not be opened/);
});
