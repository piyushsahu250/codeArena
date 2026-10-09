// Links research-imported PENDING drafts to the shared Company catalogue (creates a platform-owned Company row only when none exists
// by name). Only touches InterviewQuestionDraft rows that came from the research importer (importKey set), are still PENDING and have
// no companyId. DRY RUN by default; --apply writes.
//   node scripts/linkResearchCompanies.js [--apply]
const prisma = require("../src/prisma");

(async () => {
  const apply = process.argv.includes("--apply");
  const drafts = await prisma.interviewQuestionDraft.findMany({
    where: { importKey: { not: null }, status: "PENDING", companyId: null },
    select: { id: true, company: true },
  });
  const names = [...new Set(drafts.map((d) => d.company).filter(Boolean))];
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const byLower = new Map(companies.map((c) => [c.name.toLowerCase(), c]));
  const owner = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true, name: true } });
  if (!owner) throw new Error("no SUPER_ADMIN found to own new catalogue entries");

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${drafts.length} unlinked research drafts across ${names.length} company names`);
  for (const name of names) {
    let company = byLower.get(name.toLowerCase());
    const count = drafts.filter((d) => d.company === name).length;
    if (!company) {
      console.log(`  ${name}: no Company row -> ${apply ? "creating" : "would create"} (platform catalogue, owner ${owner.name}); ${count} drafts`);
      if (apply) company = await prisma.company.create({ data: { name, createdByUserId: owner.id, createdByName: owner.name, instituteId: null } });
    } else {
      console.log(`  ${name}: existing Company ${company.id}; ${count} drafts`);
    }
    if (apply && company) {
      const r = await prisma.interviewQuestionDraft.updateMany({ where: { importKey: { not: null }, status: "PENDING", companyId: null, company: name }, data: { companyId: company.id } });
      console.log(`    linked ${r.count}`);
    }
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
