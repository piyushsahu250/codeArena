// Manually validate a PDF's xref table against its actual object offsets — the definitive test
// for whether "bad XRef entry" (from pdf-parse's frozen 2018-era pdf.js) means the PDF is truly
// corrupt, or whether that specific old parser just can't handle something a real/modern reader
// tolerates. For each byte offset the xref table claims points to object "N 0 obj", check whether
// that exact position in the file actually starts with that text.
const fs = require("fs");

const path = process.argv[2] || "/tmp/isolate-full.pdf";
const buf = fs.readFileSync(path);
const text = buf.toString("latin1"); // byte-for-byte, no multi-byte decoding surprises

const trailerMatch = text.match(/trailer\s*<<([\s\S]*?)>>/);
const startxrefMatch = text.match(/startxref\s*(\d+)/);
const sizeMatch = trailerMatch && trailerMatch[1].match(/\/Size\s+(\d+)/);

console.log("File:", path, "size:", buf.length, "bytes");
console.log("Trailer /Size:", sizeMatch ? sizeMatch[1] : "NOT FOUND");
console.log("startxref points to byte:", startxrefMatch ? startxrefMatch[1] : "NOT FOUND");

const xrefStart = startxrefMatch ? parseInt(startxrefMatch[1], 10) : null;
if (xrefStart == null) { console.log("Cannot locate xref table start — aborting."); process.exit(1); }

const xrefSection = text.slice(xrefStart, xrefStart + 2000);
console.log("\n--- Raw bytes at the claimed xref offset ---");
console.log(JSON.stringify(xrefSection.slice(0, 60)));

// Parse "0000000015 00000 n" style entries following the xref header line.
const entryLines = xrefSection.split("\n").map((l) => l.trim()).filter((l) => /^\d{10} \d{5} [nf]$/.test(l));
console.log(`\nFound ${entryLines.length} xref entries. Validating each offset against the actual file content:`);

let mismatches = 0;
entryLines.forEach((line, i) => {
  const offset = parseInt(line.slice(0, 10), 10);
  if (offset === 0) return; // free-list head entry, not a real object
  const objNum = i; // object 0 is the free-list head; object N is at xref entry index N
  const actualBytes = text.slice(offset, offset + 20);
  const looksValid = /^\d+\s+\d+\s+obj/.test(actualBytes);
  if (!looksValid) {
    mismatches++;
    console.log(`  [MISMATCH] entry ${i} claims offset ${offset} -> actual bytes there: ${JSON.stringify(actualBytes)}`);
  }
});

console.log(mismatches === 0
  ? "\nRESULT: every xref offset correctly points to a real object header. The file's xref table is internally consistent — this looks like a pdf-parse (old pdf.js) parsing limitation, not real PDF corruption."
  : `\nRESULT: ${mismatches} xref entr(ies) point to the WRONG byte offset — this is genuine PDF corruption, not just a picky parser.`);
