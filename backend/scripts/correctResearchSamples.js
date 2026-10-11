// Replaces the VISIBLE sample test cases of PENDING research coding drafts with the samples in the current research files, for an explicit list of question ids.
// Hidden tests, prompt and every other field stay as they are; run addHiddenTestsToResearchDrafts.js afterwards to rebuild hidden tests against the new samples.
// Each change writes an audit entry with the before and after samples. DRY RUN by default.
//   node scripts/correctResearchSamples.js <dir-or-file>... --ids=ID,ID
//   node scripts/correctResearchSamples.js <dir-or-file>... --ids=ID,ID --apply --confirm=CORRECT-SAMPLES
const fs = require("fs");
const path = require("path");
const prisma = require("../src/prisma");
const { logAudit, AUDIT_ACTIONS } = require("../src/utils/auditLog");
const { mapQuestion, contentHash, SCHEMA } = require("../src/utils/interviewResearchImport");

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };

function loadQuestions(inputs) {
  const files = [];
  for (const p of inputs) {
    if (fs.statSync(p).isDirectory()) fs.readdirSync(p).filter((f) => f.endsWith(".json")).sort().forEach((f) => files.push(path.join(p, f)));
    else files.push(p);
  }
  const out = new Map();
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const q of data.questions || []) out.set(q.question_id, mapQuestion(data, q, path.basename(f)));
  }
  return out;
}

(async () => {
  const inputs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const ids = (arg("ids", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!inputs.length || !ids.length) { console.error("usage: correctResearchSamples.js <dir-or-file>... --ids=ID,ID [--apply --confirm=CORRECT-SAMPLES]"); process.exit(2); }
  const apply = process.argv.includes("--apply");
  if (apply && arg("confirm") !== "CORRECT-SAMPLES") { console.error("--apply needs --confirm=CORRECT-SAMPLES"); process.exit(2); }
  const wanted = loadQuestions(inputs);
  const owner = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true, name: true } });
  let changed = 0;
  for (const id of ids) {
    const payload = wanted.get(id);
    if (!payload || !payload.testCases) { console.log(`  ${id}: not a coding question in the given files, skipped`); continue; }
    const draft = await prisma.interviewQuestionDraft.findUnique({ where: { importKey: `${SCHEMA}:${id}` } });
    if (!draft) { console.log(`  ${id}: no draft, skipped`); continue; }
    if (draft.status !== "PENDING") { console.log(`  ${id}: draft is ${draft.status}, not changed`); continue; }
    const all = Array.isArray(draft.testCases) ? draft.testCases : [];
    const before = all.filter((t) => !t.isHidden);
    const after = payload.testCases;
    if (JSON.stringify(before) === JSON.stringify(after)) { console.log(`  ${id}: already correct`); continue; }
    console.log(`  ${id}: ${before.map((t) => t.expected).join(",")} -> ${after.map((t) => t.expected).join(",")}  (hidden tests kept: ${all.length - before.length})`);
    changed++;
    if (!apply) continue;
    await prisma.interviewQuestionDraft.update({ where: { id: draft.id }, data: { testCases: [...after, ...all.filter((t) => t.isHidden)], importHash: contentHash(payload) } });
    await logAudit({
      action: AUDIT_ACTIONS.QUESTION_UPDATED, actorId: owner.id, actorName: owner.name, actorRole: "SUPER_ADMIN", instituteId: null,
      details: { entity: "research-sample-correction", draftId: draft.id, importKey: draft.importKey, reason: "sample outputs belonged to a different problem than the statement", before, after },
    });
  }
  console.log(`${apply ? "Corrected" : "Would correct"}: ${changed}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
