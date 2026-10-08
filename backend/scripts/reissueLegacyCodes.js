// One-time reissue of the guessable legacy verification codes (audit item T-4).
//   node scripts/reissueLegacyCodes.js            -> dry run: prints what WOULD change, changes nothing
//   node scripts/reissueLegacyCodes.js --apply    -> replaces the codes
// A code is "legacy" when it does not end in the 60-bit XXXX-XXXX-XXXX suffix (utils/secureCode.js). The readable prefix (CA-2025-INST-PROG)
// is kept so the code still looks familiar; only the guessable tail is replaced. Every change is written to CodeReissueLog in the same
// transaction (old -> new), so nothing is lost and the change can be reversed. Idempotent: already-new codes are skipped.
// EFFECT: the old code stops verifying. A certificate or marksheet PDF downloaded or printed earlier carries the old code in its QR and
// text and will show "not found" until the holder downloads it again (PDFs are generated on demand with the current code).
const prisma = require("../src/prisma");
const { randomGroupedCode } = require("../src/utils/secureCode");

const APPLY = process.argv.includes("--apply");
const NEW_SUFFIX = /-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const prefixOf = (code) => code.slice(0, code.lastIndexOf("-"));

const TARGETS = [
  { kind: "CERTIFICATE", model: "certificate", field: "certificateCode", where: {} },
  { kind: "INTERVIEW_CERTIFICATE", model: "interviewCertificate", field: "certificateCode", where: {} },
  { kind: "MARKSHEET", model: "resultEntry", field: "verificationCode", where: { verificationCode: { not: null } } },
];

async function main() {
  const summary = {};
  for (const t of TARGETS) {
    const rows = await prisma[t.model].findMany({ where: t.where, select: { id: true, [t.field]: true } });
    const legacy = rows.filter((r) => r[t.field] && !NEW_SUFFIX.test(r[t.field]));
    summary[t.kind] = { total: rows.length, legacy: legacy.length, reissued: 0 };
    console.log(`[${t.kind}] ${rows.length} codes, ${legacy.length} legacy${legacy[0] ? ` (e.g. ${legacy[0][t.field]})` : ""}`);
    if (!APPLY) continue;
    for (const r of legacy) {
      const oldCode = r[t.field];
      let done = false;
      for (let attempt = 0; attempt < 10 && !done; attempt++) {
        const newCode = `${prefixOf(oldCode)}-${randomGroupedCode()}`;
        try {
          await prisma.$transaction([
            prisma[t.model].update({ where: { id: r.id }, data: { [t.field]: newCode } }),
            prisma.codeReissueLog.create({ data: { kind: t.kind, entityId: r.id, oldCode, newCode } }),
          ]);
          summary[t.kind].reissued++;
          done = true;
        } catch (e) {
          if (e.code !== "P2002") throw e; // unique clash with another code: draw a new suffix
        }
      }
      if (!done) throw new Error(`could not allocate a unique code for ${t.kind} ${r.id}`);
    }
  }
  console.log(APPLY ? "APPLIED" : "DRY RUN (nothing changed; pass --apply)", JSON.stringify(summary));
}
main().then(() => process.exit(0)).catch((e) => { console.error("[reissueLegacyCodes] failed:", e.message); process.exit(1); });
