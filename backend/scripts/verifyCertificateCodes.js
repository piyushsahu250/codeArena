// Live check for audit item T-4: new certificate / marksheet / interview-certificate codes are unguessable, old codes still verify,
// verification tolerates case. Throwaway institute + student; cleans up (certificates are Restrict-linked, so they go first).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { generateCertificateCode } = require("../src/utils/certificates");
const { generateMarksheetCode } = require("../src/utils/resultCode");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const get = async (path) => { const r = await fetch(`${BASE}${path}`); let b = null; try { b = await r.json(); } catch { /* empty */ } return { status: r.status, body: b }; };

async function cleanup() {
  const u = await prisma.user.findMany({ where: { email: { startsWith: "verify-cc-", endsWith: "@example.invalid" } }, select: { id: true } });
  const ids = u.map((x) => x.id);
  await prisma.certificate.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.interviewCertificate.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.institute.deleteMany({ where: { name: { startsWith: "ZZ Verify CC " } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const inst = await prisma.institute.create({ data: { name: `ZZ Verify CC ${ts}`, code: "ZZCC" } });
  const stu = await prisma.user.create({ data: { name: "Cert Holder", email: `verify-cc-${ts}@example.invalid`, passwordHash: await bcrypt.hash(crypto.randomBytes(12).toString("hex"), 10), role: "STUDENT", instituteId: inst.id, mustChangePassword: false } });
  try {
    const NEW = /^CA-\d{4}-ZZCC-DEMOPROG-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
    const codes = new Set();
    for (let i = 0; i < 300; i++) codes.add(await generateCertificateCode({ instituteCode: "ZZCC", programCode: "DemoProg" }));
    check("new certificate codes have the grouped 60-bit suffix and are all distinct", codes.size === 300 && [...codes].every((c) => NEW.test(c)), [...codes][0]);
    const ms = await generateMarksheetCode({ instituteCode: "ZZCC" });
    check("new marksheet codes use the same suffix", /^MS-\d{4}-ZZCC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(ms), ms);

    const newCode = [...codes][0];
    await prisma.certificate.create({ data: { certificateCode: newCode, type: "MANUAL", studentId: stu.id, title: "New-format cert" } });
    const legacy = `CA-2025-ZZCC-OLDPROG-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    await prisma.certificate.create({ data: { certificateCode: legacy, type: "MANUAL", studentId: stu.id, title: "Legacy-format cert" } });
    const a = await get(`/certificates/verify/${newCode}`);
    check("a new-format certificate verifies", a.status === 200 && a.body.valid === true && a.body.certificateCode === newCode);
    const b = await get(`/certificates/verify/${legacy}`);
    check("a certificate issued with the OLD 6-digit format still verifies (nothing was rewritten)", b.status === 200 && b.body.valid === true && b.body.certificateCode === legacy);
    const c = await get(`/certificates/verify/${newCode.toLowerCase()}`);
    check("verification tolerates lower case", c.status === 200 && c.body.valid === true);
    check("a one-character change is not found (404)", (await get(`/certificates/verify/${newCode.slice(0, -1)}${newCode.endsWith("A") ? "B" : "A"}`)).status === 404);
    check("guessing from the readable prefix alone finds nothing", (await get(`/certificates/verify/CA-${new Date().getFullYear()}-ZZCC-DEMOPROG-000000`)).status === 404);

    await prisma.interviewCertificate.create({ data: { certificateCode: `CA-INTERVIEW-${new Date().getFullYear()}-AB12-CD34-EF56`, studentId: stu.id, averageScore: 70 } });
    const ic = await get(`/interview/certificate/verify/ca-interview-${new Date().getFullYear()}-ab12-cd34-ef56`);
    check("interview certificate verification works with the new shape and any case", ic.status === 200 && ic.body.valid === true);
    const old = await get("/interview/certificate/verify/CA-INTERVIEW-2025-ABC123");
    check("an unknown/old-shape interview code that does not exist is a clean 404", old.status === 404);
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nCERTIFICATE CODES VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
