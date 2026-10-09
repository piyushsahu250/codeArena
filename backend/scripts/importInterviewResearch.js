// Company interview research import (schema codearena-interview-import/1).
//
//   node scripts/importInterviewResearch.js <file-or-dir> [more...] [--json=/tmp/import-report.json]   DRY RUN (default): reads only, writes nothing
//   node scripts/importInterviewResearch.js <file-or-dir> --apply --confirm=IMPORT-AS-PENDING-DRAFTS    creates PENDING drafts only
//
// Apply never publishes a question and never touches an existing InterviewQuestion or an approved/
// rejected draft. It creates one InterviewQuestionDraft (status PENDING) per new question, keyed by
// importKey so re-running is a no-op. Possible duplicates and changed-but-already-reviewed questions
// are reported and skipped. Drafts are platform-owned (instituteId null) and are reviewed in the
// existing admin drafts screen.
const fs = require("fs");
const path = require("path");
const prisma = require("../src/prisma");
const { planImport, summarize } = require("../src/utils/interviewResearchImport");

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const flag = (n) => process.argv.includes(`--${n}`);

function collectFiles(inputs) {
  const out = [];
  for (const p of inputs) {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) { if (f.endsWith(".json")) out.push(path.join(p, f)); }
    else out.push(p);
  }
  return out;
}

async function loadExisting() {
  let schemaReady = true;
  let questions;
  let drafts;
  try {
    questions = await prisma.interviewQuestion.findMany({ where: { generatedForStudentId: null }, select: { id: true, prompt: true, title: true, company: true, isActive: true, importKey: true } });
    drafts = await prisma.interviewQuestionDraft.findMany({ select: { id: true, prompt: true, title: true, company: true, status: true, importKey: true, importHash: true } });
  } catch (e) {
    if (!/does not exist|P2022|Unknown field|Unknown arg/i.test(String(e.message))) throw e;
    schemaReady = false; // new columns not deployed yet: dry run still works, apply is refused
    questions = await prisma.interviewQuestion.findMany({ where: { generatedForStudentId: null }, select: { id: true, prompt: true, title: true, company: true, isActive: true } });
    drafts = await prisma.interviewQuestionDraft.findMany({ select: { id: true, prompt: true, title: true, company: true, status: true } });
  }
  const existing = [
    ...questions.map((q) => ({ ...q, kind: "question", status: q.isActive ? "live" : "inactive" })),
    ...drafts.map((d) => ({ ...d, kind: "draft" })),
  ];
  return { existing, schemaReady };
}

(async () => {
  const inputs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!inputs.length) { console.error("usage: importInterviewResearch.js <file-or-dir>... [--apply --confirm=IMPORT-AS-PENDING-DRAFTS] [--json=out.json]"); process.exit(2); }
  const apply = flag("apply");
  if (apply && arg("confirm") !== "IMPORT-AS-PENDING-DRAFTS") { console.error("--apply needs --confirm=IMPORT-AS-PENDING-DRAFTS"); process.exit(2); }

  const files = collectFiles(inputs).map((p) => ({ fileName: path.basename(p), data: JSON.parse(fs.readFileSync(p, "utf8")) }));
  const { existing, schemaReady } = await loadExisting();
  const rows = planImport(files, existing);

  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const companyId = (name) => (companies.find((c) => c.name.toLowerCase() === String(name).toLowerCase()) || {}).id || null;
  for (const r of rows) if (r.payload) r.companyId = companyId(r.payload.company);

  const counts = summarize(rows);
  console.log(`\nMode: ${apply ? "APPLY (pending drafts only)" : "DRY RUN (nothing is written)"}   schema columns present: ${schemaReady}`);
  console.log(`Existing rows compared: ${existing.length} (${existing.filter((e) => e.kind === "question").length} questions, ${existing.filter((e) => e.kind === "draft").length} drafts)`);
  console.log("Plan:", counts);
  const missingCompany = [...new Set(rows.filter((r) => r.payload && !r.companyId).map((r) => r.payload.company))];
  if (missingCompany.length) console.log(`No Company row for: ${missingCompany.join(", ")} (drafts keep the company name text; companyId stays empty)`);
  for (const r of rows.filter((x) => !["CREATE_PENDING_DRAFT", "SKIP_ALREADY_IMPORTED"].includes(x.action))) {
    console.log(`  ${r.action}  ${r.questionId || r.fileName}  ${r.reasons.join(" | ")}`);
  }
  for (const r of rows.filter((x) => x.flags && x.flags.length)) console.log(`  note ${r.questionId}: ${r.flags.join("; ")}`);

  if (arg("json")) {
    fs.writeFileSync(arg("json"), JSON.stringify({ counts, schemaReady, rows: rows.map(({ payload, ...rest }) => ({ ...rest, company: payload && payload.company, round: payload && payload.roundName })) }, null, 2));
    console.log(`Report written to ${arg("json")}`);
  }

  if (apply) {
    if (!schemaReady) { console.error("\nRefusing to apply: the new import columns are not in the database yet. Deploy the schema first."); process.exit(1); }
    const sourceRun = `research-import:${new Date().toISOString().slice(0, 10)}`;
    let created = 0;
    for (const r of rows.filter((x) => x.action === "CREATE_PENDING_DRAFT")) {
      const { payload } = r;
      try {
        await prisma.interviewQuestionDraft.create({ data: { ...payload, companyId: r.companyId, importHash: r.hash, status: "PENDING", sourceRun, instituteId: null, createdById: null } });
        created++;
      } catch (e) {
        if (e.code === "P2002") console.log(`  skipped ${r.questionId}: importKey already exists`);
        else throw e;
      }
    }
    console.log(`\nCreated ${created} PENDING drafts. Nothing was published.`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
