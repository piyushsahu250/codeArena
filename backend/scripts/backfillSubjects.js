/**
 * One-time (idempotent) backfill for Question.subjectId / Test.subjectId, introduced alongside
 * the Subject/Unit/Topic taxonomy (see prisma/schema.prisma's Subject model comment and
 * backend/src/utils/subjectAccess.js). Every Question/Test predating this feature carries only
 * the legacy free-text subject string (Question.subject / Test.subject) — this script infers real
 * Subject catalog rows from those strings and links subjectId back to them.
 *
 * unitId is deliberately NEVER set by this script: Unit never existed before this feature, and
 * there is no reliable signal (the free-text Question.topic is not a safe proxy for Unit) to
 * infer it from — guessing here is exactly the "Unit 1 is not globally unique" ambiguity this
 * whole feature exists to eliminate. Every backfilled row surfaces in QuestionBank.jsx as "Needs
 * Unit assignment" for a human to resolve, per the spec's explicit safe-migration instruction
 * ("do not randomly assign a subject or unit... flag for review").
 *
 * Also grants StaffSubjectAssignment to every staff member who has already authored a Question
 * under an inferred Subject — a system-inferred Subject has no single "creator" (createdById is
 * left null, matching this platform's own nullable-institute/creator "legacy = shared" convention
 * elsewhere), so without this step every staff member who's been working under that subject for
 * years would suddenly lose the ability to add more questions to it the moment server-side
 * authorization (subjectAccess.js) is enforced. This preserves existing access, it doesn't invent
 * new classification — it doesn't conflict with "never randomly assign."
 *
 * Idempotent — only touches Question/Test rows where subjectId IS NULL, and Subject rows are
 * looked up before create (never duplicated), so re-running this on every deploy (see Dockerfile)
 * is always safe.
 */
const prisma = require("../src/prisma");

async function findOrCreateSubject(instituteId, name) {
  const existing = await prisma.subject.findFirst({
    where: { instituteId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;
  return prisma.subject.create({ data: { instituteId, name, createdById: null } });
}

async function backfillQuestionSubjects() {
  const candidates = await prisma.question.findMany({
    where: { subjectId: null, subject: { not: null } },
    select: { id: true, subject: true, instituteId: true, createdById: true },
  });

  const subjectCache = new Map(); // `${instituteId}::${nameLower}` -> Subject row
  const staffGrants = new Set(); // `${staffId}::${subjectId}` — deduped before writing
  let updatedCount = 0;

  for (const q of candidates) {
    const name = (q.subject || "").trim();
    if (!name) continue;
    const cacheKey = `${q.instituteId || ""}::${name.toLowerCase()}`;
    let subject = subjectCache.get(cacheKey);
    if (!subject) {
      subject = await findOrCreateSubject(q.instituteId, name);
      subjectCache.set(cacheKey, subject);
    }
    await prisma.question.update({ where: { id: q.id }, data: { subjectId: subject.id } });
    updatedCount++;
    if (q.createdById) staffGrants.add(`${q.createdById}::${subject.id}`);
  }

  let grantedCount = 0;
  for (const key of staffGrants) {
    const [staffId, subjectId] = key.split("::");
    try {
      await prisma.staffSubjectAssignment.create({ data: { staffId, subjectId, assignedById: "system-backfill" } });
      grantedCount++;
    } catch (err) {
      if (err.code !== "P2002") throw err; // already granted (prior run) — fine, idempotent
    }
  }

  return { updatedCount, candidateTotal: candidates.length, grantedCount, subjectCache };
}

async function backfillTestSubjects(subjectCache) {
  const candidates = await prisma.test.findMany({
    where: { subjectId: null, subject: { not: null } },
    select: { id: true, subject: true, instituteId: true },
  });

  let updatedCount = 0;
  for (const t of candidates) {
    const name = (t.subject || "").trim();
    if (!name) continue;
    const cacheKey = `${t.instituteId || ""}::${name.toLowerCase()}`;
    let subject = subjectCache.get(cacheKey);
    if (!subject) {
      subject = await findOrCreateSubject(t.instituteId, name);
      subjectCache.set(cacheKey, subject);
    }
    await prisma.test.update({ where: { id: t.id }, data: { subjectId: subject.id } });
    updatedCount++;
  }

  return { updatedCount, candidateTotal: candidates.length };
}

async function main() {
  const q = await backfillQuestionSubjects();
  const t = await backfillTestSubjects(q.subjectCache);
  console.log(
    `[backfillSubjects] Questions: linked ${q.updatedCount}/${q.candidateTotal} to a Subject, granted ${q.grantedCount} ` +
    `staff-subject access row(s). Tests: linked ${t.updatedCount}/${t.candidateTotal} to a Subject. unitId is left null ` +
    `everywhere — see QuestionBank.jsx's "Needs Unit assignment" filter for manual follow-up.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfillSubjects] failed:", err);
  process.exit(1);
});
