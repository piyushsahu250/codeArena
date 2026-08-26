// One-off: confirm both certificate PDF generators still render correctly with the new Acrosoft
// attribution line added, and inspect the raw PDF bytes for the attribution text (PDF text isn't
// trivially greppable since it's often encoded, but pdfkit's default WinAnsi text often stays
// literal for plain ASCII strings like this one, so a raw byte search is a reasonable smoke check).
const { PassThrough } = require("stream");
const pdfParse = require("pdf-parse");
const { generateCertificatePdf } = require("../src/utils/certificatePdf");
const { generateInterviewCertificatePdf } = require("../src/utils/interviewCertificatePdf");

function captureStream() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => stream.on("end", resolve));
  return { stream, done, getBuffer: () => Buffer.concat(chunks) };
}

async function main() {
  const cert = captureStream();
  await generateCertificatePdf({
    studentName: "Verify Student", title: "Verify Course", programName: "Verify Program",
    certificateCode: "VERIFY-001", issuedAt: new Date(), status: "ISSUED",
    verifyUrl: "https://codearena.site/verify/VERIFY-001", instituteName: "Testing Institute",
  }, cert.stream);
  await cert.done;
  const certBuf = cert.getBuffer();
  const certText = (await pdfParse(certBuf)).text;
  console.log("Learning Module certificate PDF bytes:", certBuf.length, "| extracted text contains attribution:", certText.includes("Acrosoft Webtech Solution"));

  const interview = captureStream();
  await generateInterviewCertificatePdf({
    studentName: "Verify Student", averageScore: 85, certificateCode: "VERIFY-002",
    issuedAt: new Date(), verifyUrl: "https://codearena.site/verify/VERIFY-002",
  }, interview.stream);
  await interview.done;
  const interviewBuf = interview.getBuffer();
  const interviewText = (await pdfParse(interviewBuf)).text;
  console.log("Interview certificate PDF bytes:", interviewBuf.length, "| extracted text contains attribution:", interviewText.includes("Acrosoft Webtech Solution"));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
