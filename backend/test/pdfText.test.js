// The bounded PDF reader (utils/pdfText.js) and the resume upload's use of it. REGRESSION (2026-10 audit): a student's PDF used to be parsed on the API's own thread with no limit on
// pages, time or memory, and a renamed file (any bytes named .pdf) went straight to the library. See pdfText.js for the rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const PDFDocument = require("pdfkit");
const { Writable } = require("stream");
const { generateResumePdf } = require("../src/utils/resumePdf");
const { extractPdfText, looksLikePdf, MAX_PAGES, MAX_CONCURRENT, MAX_QUEUED, MESSAGES } = require("../src/utils/pdfText");
const { extractTextFromFile } = require("../src/utils/resumeParser");

const T = { timeout: 60000 };

// Test PDFs are deliberately SMALL (the reading-order one is under 2 KB): REGRESSION, found live on 2026-10-26 — the first version of the worker gave pdf.js a Node Buffer, and every PDF under
// about 4 KB (including the ones this platform's own resume builder produces) failed with "bad XRef entry". Large files hid it, so the tests must include small ones.
function pdfOf(pages) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const lines of pages) {
      doc.addPage();
      let y = 72;
      for (const line of lines) { doc.text(line, 72, y); y += 20; }
    }
    doc.end();
  });
}

function generatedResume() {
  return new Promise((resolve) => {
    const chunks = [];
    const sink = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
    sink.setHeader = () => {};
    sink.on("finish", () => resolve(Buffer.concat(chunks)));
    generateResumePdf({
      template: "minimal", fullName: "Aarav Sharma", email: "aarav.sharma@example.com", mobile: "9876543210",
      summary: "Final-year Computer Science student with hands-on project experience in full-stack web development.",
      education: [{ degree: "B.TECH", specialization: "Computer Science", institution: "Sample Institute of Technology", startYear: "2021", endYear: "2025", score: "8.4 CGPA", status: "Pursuing" }],
      skills: [{ category: "Programming Languages", name: "Java" }, { category: "Databases", name: "MySQL" }],
      projects: [], experience: [], certifications: [], achievements: [], languages: [],
    }, sink);
  });
}

test("a real PDF is read, in reading order", T, async () => {
  const pdf = await pdfOf([["Asha Patil", "Skills", "JavaScript, SQL"]]);
  const text = await extractPdfText(pdf);
  assert.ok(text.indexOf("Asha Patil") !== -1 && text.indexOf("Asha Patil") < text.indexOf("Skills") && text.indexOf("Skills") < text.indexOf("JavaScript"), text);
});

test("only the first pages are read", T, async () => {
  const pdf = await pdfOf(Array.from({ length: MAX_PAGES + 5 }, (_, i) => [`Marker page ${i + 1} end`]));
  const text = await extractPdfText(pdf);
  assert.ok(text.includes(`Marker page ${MAX_PAGES} end`), "the last allowed page is read");
  assert.ok(!text.includes(`Marker page ${MAX_PAGES + 1} end`), "a page beyond the limit is not read");
});

test("a file that is not a PDF is refused before any library sees it, whatever its name", T, async () => {
  assert.equal(looksLikePdf(Buffer.from("PK\u0003\u0004 not a pdf")), false);
  assert.equal(looksLikePdf(Buffer.alloc(0)), false);
  assert.equal(looksLikePdf("%PDF-1.4"), false, "only a Buffer counts");
  await assert.rejects(() => extractPdfText(Buffer.from("this is plain text, not a pdf")), { message: MESSAGES.NOT_PDF });
  await assert.rejects(() => extractTextFromFile(Buffer.from("plain text"), "application/pdf", "resume.pdf"), { message: MESSAGES.NOT_PDF });
  const withHeaderLate = Buffer.concat([Buffer.alloc(900, 32), Buffer.from("%PDF-1.7\n")]);
  assert.equal(looksLikePdf(withHeaderLate), true, "the specification allows the header within the first 1024 bytes");
  assert.equal(looksLikePdf(Buffer.concat([Buffer.alloc(1100, 32), Buffer.from("%PDF-1.7\n")])), false);
});

test("a damaged PDF gets a plain message, not a crash", T, async () => {
  const bad = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("garbage that is not a pdf body ".repeat(20))]);
  await assert.rejects(() => extractPdfText(bad), { message: /^Couldn't read this PDF\./ });
});

test("a read that runs past its deadline is stopped and says so", T, async () => {
  const pdf = await pdfOf([["Some text"]]);
  await assert.rejects(() => extractPdfText(pdf, { deadlineMs: 1 }), { message: MESSAGES.TOO_SLOW });
  // the slot was given back: a normal read still works afterwards
  assert.ok((await extractPdfText(pdf)).includes("Some text"));
});

test("only a few files are read at once; a short queue waits; the rest are told to try again", T, async () => {
  const pdf = await pdfOf([["Queue test"]]);
  const total = MAX_CONCURRENT + MAX_QUEUED + 3;
  const results = await Promise.allSettled(Array.from({ length: total }, () => extractPdfText(pdf)));
  const ok = results.filter((r) => r.status === "fulfilled");
  const busy = results.filter((r) => r.status === "rejected" && r.reason.message === MESSAGES.BUSY);
  assert.equal(ok.length, MAX_CONCURRENT + MAX_QUEUED, "the running and the queued ones all finish");
  assert.equal(busy.length, 3, "the ones beyond the queue are refused with the busy message");
  assert.ok(ok.every((r) => r.value.includes("Queue test")));
  // and the limiter is clear again
  assert.ok((await extractPdfText(pdf)).includes("Queue test"));
});

test("a small PDF made by the resume builder itself is read (the bug that only small files showed)", T, async () => {
  const pdf = await generatedResume();
  assert.ok(pdf.length < 4096, `the fixture must be small to mean anything (${pdf.length} bytes)`);
  const text = await extractPdfText(pdf);
  assert.ok(text.includes("Aarav Sharma") && text.includes("Computer Science"), text.slice(0, 200));
});
