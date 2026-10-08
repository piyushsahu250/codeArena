// Tells the holders whose verification codes were replaced by scripts/reissueLegacyCodes.js (audit item T-4).
//   node scripts/notifyReissuedCodes.js                  -> dry run: who would be told, nothing sent
//   node scripts/notifyReissuedCodes.js --apply          -> in-app notification (bell) for each affected student
//   node scripts/notifyReissuedCodes.js --apply --email  -> ALSO email them, throttled (default 1 per 2 s, --rate-ms=N to change)
// One message per student however many items they hold. Idempotent: a student who already has a CODE_REISSUED notification (or a
// CODE_REISSUE_NOTICE email) is skipped, so the script can be re-run, e.g. to send the emails later once the mail provider has headroom.
// Email is opt-in on purpose: it shares the daily sending budget with password and login emails.
const prisma = require("../src/prisma");
const { emailStudent } = require("../src/utils/notifications");

const APPLY = process.argv.includes("--apply");
const EMAIL = process.argv.includes("--email");
const RATE_MS = Number((process.argv.find((a) => a.startsWith("--rate-ms=")) || "").split("=")[1]) || 2000;
const TYPE = "CODE_REISSUED";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function main() {
  const log = await prisma.codeReissueLog.findMany({ select: { kind: true, entityId: true } });
  const certIds = log.filter((l) => l.kind === "CERTIFICATE").map((l) => l.entityId);
  const sheetIds = log.filter((l) => l.kind === "MARKSHEET").map((l) => l.entityId);
  const interviewIds = log.filter((l) => l.kind === "INTERVIEW_CERTIFICATE").map((l) => l.entityId);
  const [certs, sheets, icerts] = await Promise.all([
    prisma.certificate.findMany({ where: { id: { in: certIds } }, select: { studentId: true } }),
    prisma.resultEntry.findMany({ where: { id: { in: sheetIds } }, select: { studentId: true } }),
    prisma.interviewCertificate.findMany({ where: { id: { in: interviewIds } }, select: { studentId: true } }),
  ]);
  const byStudent = new Map();
  const bump = (id, k) => { const o = byStudent.get(id) || { cert: 0, sheet: 0, icert: 0 }; o[k]++; byStudent.set(id, o); };
  certs.forEach((c) => bump(c.studentId, "cert"));
  sheets.forEach((s) => bump(s.studentId, "sheet"));
  icerts.forEach((c) => bump(c.studentId, "icert"));

  const ids = [...byStudent.keys()];
  const [students, already, emailed] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, name: true, email: true, instituteId: true } }),
    prisma.notification.findMany({ where: { type: TYPE, recipientId: { in: ids } }, select: { recipientId: true } }),
    prisma.emailLog.findMany({ where: { emailType: "CODE_REISSUE_NOTICE", studentId: { in: ids } }, select: { studentId: true } }),
  ]);
  const notified = new Set(already.map((a) => a.recipientId));
  const emailedSet = new Set(emailed.map((a) => a.studentId));
  const todo = students.filter((s) => !notified.has(s.id));
  const emailTodo = students.filter((s) => !emailedSet.has(s.id) && s.email);
  console.log(`[notifyReissuedCodes] affected students ${ids.length}, active ${students.length}, to notify in-app ${todo.length}, to email ${EMAIL ? emailTodo.length : "(not requested)"}`);
  if (!APPLY) { console.log("DRY RUN (nothing sent; pass --apply)"); return; }

  const wording = (o) => {
    const parts = [];
    if (o.sheet) parts.push(plural(o.sheet, "marksheet"));
    if (o.cert) parts.push(plural(o.cert, "certificate"));
    if (o.icert) parts.push(plural(o.icert, "interview certificate"));
    return parts.join(" and ");
  };
  const linkOf = (o) => (o.sheet ? "/results" : "/certificates");
  const message = (o) => `The verification code on your ${wording(o)} was renewed for security. A copy you downloaded or printed earlier will no longer verify - please download it again. No action is needed otherwise.`;

  let inApp = 0;
  for (let i = 0; i < todo.length; i += 200) {
    const chunk = todo.slice(i, i + 200);
    await prisma.notification.createMany({ data: chunk.map((s) => ({ recipientId: s.id, type: TYPE, message: message(byStudent.get(s.id)), link: linkOf(byStudent.get(s.id)) })) });
    inApp += chunk.length;
  }
  console.log(`in-app notifications created: ${inApp}`);

  if (EMAIL) {
    let sent = 0;
    const batchId = `code-reissue-${Date.now()}`;
    for (const s of emailTodo) {
      const o = byStudent.get(s.id);
      await emailStudent(
        prisma, s, "Your verification code was renewed",
        `<p>Hi ${s.name},</p><p>For security, the verification code on your <strong>${wording(o)}</strong> was renewed. A copy you downloaded or printed earlier will no longer verify when someone scans its QR code or looks up its code.</p><p>Please download it again from <strong>${o.sheet ? "My Results" : "My Certificates"}</strong>; the new copy carries the current code. No other action is needed.</p>`,
        "CODE_REISSUE_NOTICE", batchId,
      );
      sent++;
      if (sent % 50 === 0) console.log(`emails queued: ${sent}/${emailTodo.length}`);
      await sleep(RATE_MS);
    }
    console.log(`emails attempted: ${sent} (check EmailLog batch ${batchId})`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("[notifyReissuedCodes] failed:", e.message); process.exit(1); });
