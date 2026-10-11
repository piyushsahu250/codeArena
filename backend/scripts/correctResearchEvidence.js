// Re-derives the EVIDENCE fields of already-imported research questions from the current research files, for an explicit list of question ids, and updates
// both the live question and its approved draft. Nothing else about a question changes (prompt, answer, options, tests, student-facing text stay as they are).
// Every change writes an audit entry holding the before and after values, which is the recovery record. DRY RUN by default.
//   node scripts/correctResearchEvidence.js <dir-or-file>... --ids=ID,ID,...              show what would change
//   node scripts/correctResearchEvidence.js <dir-or-file>... --ids=ID,ID --apply --confirm=CORRECT-EVIDENCE
const fs = require("fs");
const path = require("path");
const prisma = require("../src/prisma");
const { logAudit, AUDIT_ACTIONS } = require("../src/utils/auditLog");
const { mapQuestion, contentHash, SCHEMA } = require("../src/utils/interviewResearchImport");

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const FIELDS = ["sourceType", "sourceUrl", "sourceDate", "confidenceLevel", "verificationCount", "researchMeta"];

function loadQuestions(inputs) {
  const files = [];
  for (const p of inputs) {
    if (fs.statSync(p).isDirectory()) fs.readdirSync(p).filter((f) => f.endsWith(".json")).sort().forEach((f) => files.push(path.join(p, f)));
    else files.push(p);
  }
  const out = new Map();
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const q of data.questions || []) out.set(q.question_id, { payload: mapQuestion(data, q, path.basename(f)) });
  }
  return out;
}
const pick = (row) => Object.fromEntries(FIELDS.map((k) => [k, row[k] === undefined ? null : row[k]]));
const brief = (v) => (v && typeof v === "object" ? { evidenceClass: v.evidenceClass, timesReported: v.timesReported, sources: (v.sources || []).length } : v);

(async () => {
  const inputs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const ids = (arg("ids", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!inputs.length || !ids.length) { console.error("usage: correctResearchEvidence.js <dir-or-file>... --ids=ID,ID [--apply --confirm=CORRECT-EVIDENCE]"); process.exit(2); }
  const apply = process.argv.includes("--apply");
  if (apply && arg("confirm") !== "CORRECT-EVIDENCE") { console.error("--apply needs --confirm=CORRECT-EVIDENCE"); process.exit(2); }

  const wanted = loadQuestions(inputs);
  const owner = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true, name: true } });
  let changed = 0;
  for (const id of ids) {
    const w = wanted.get(id);
    if (!w) { console.log(`  ${id}: not in the given files, skipped`); continue; }
    const key = `${SCHEMA}:${id}`;
    const [question, draft] = await Promise.all([prisma.interviewQuestion.findFirst({ where: { importKey: key } }), prisma.interviewQuestionDraft.findUnique({ where: { importKey: key } })]);
    if (!question) { console.log(`  ${id}: no live question with that import key, skipped`); continue; }
    const after = pick(w.payload);
    const before = pick(question);
    const diff = FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (!diff.length) { console.log(`  ${id}: already correct`); continue; }
    console.log(`  ${id}: ${diff.map((k) => `${k} ${JSON.stringify(brief(before[k]))} -> ${JSON.stringify(brief(after[k]))}`).join("; ")}`);
    changed++;
    if (!apply) continue;
    const data = { ...after, researchMeta: after.researchMeta };
    await prisma.$transaction([
      prisma.interviewQuestion.update({ where: { id: question.id }, data }),
      ...(draft ? [prisma.interviewQuestionDraft.update({ where: { id: draft.id }, data: { ...data, importHash: contentHash(w.payload) } })] : []),
    ]);
    await logAudit({
      action: AUDIT_ACTIONS.QUESTION_UPDATED, actorId: owner.id, actorName: owner.name, actorRole: "SUPER_ADMIN", instituteId: null,
      details: { entity: "research-evidence-correction", questionId: question.id, importKey: key, reason: "evidence reclassified by the stricter rule: the source named a topic, not this question", fields: diff, before, after },
    });
  }
  console.log(`${apply ? "Corrected" : "Would correct"}: ${changed}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
