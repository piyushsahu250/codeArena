const fs = require("fs");
const pdfParse = require("pdf-parse");

const files = ["full", "no-certs", "no-skills", "no-experience", "no-education", "no-projects", "minimal-modern"];

async function main() {
  for (const f of files) {
    const path = `/tmp/isolate-${f}.pdf`;
    try {
      const buf = fs.readFileSync(path);
      const result = await pdfParse(buf);
      console.log(`${f}: OK, ${result.text.length} chars extracted, ${result.numpages} page(s)`);
    } catch (e) {
      console.log(`${f}: PARSE FAILED — ${e.message}`);
    }
  }
}
main().then(() => process.exit(0));
