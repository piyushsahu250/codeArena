// Live check: the readiness-subject boot seed must not undo an admin's decisions. REGRESSION: it re-created DSA / JAVA / DBMS on every container start after an admin
// deleted them, and overwrote an admin's edits and deactivation. Uses a throwaway subject code (ZZ-RSD-*), so the real built-in subjects are never touched; cleans up after itself.
const prisma = require("../src/prisma");
const { seedReadinessSubjects } = require("./seedReadinessSubjects");

const CODE = `ZZ-RSD-${Date.now()}`;
const subject = { name: `ZZ Seed Probe ${CODE}`, code: CODE, department: "Computer Science", description: "probe", topics: [{ name: "T", subtopics: ["a"] }], questionTypesAllowed: ["MCQ"], employabilityIndicators: [] };
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
const find = () => prisma.readinessSubject.findFirst({ where: { code: CODE, instituteId: null } });

async function cleanup() {
  await prisma.readinessSubject.deleteMany({ where: { code: CODE } });
  await prisma.auditLog.deleteMany({ where: { action: "READINESS_SUBJECT_DELETED", details: { path: ["code"], equals: CODE } } });
}

(async () => {
  await cleanup();
  try {
    let r = await seedReadinessSubjects([subject]);
    check("a missing built-in subject is created on first run", r.created === 1 && !!(await find()), JSON.stringify(r));

    const row = await find();
    await prisma.readinessSubject.update({ where: { id: row.id }, data: { name: "Renamed by admin", isActive: false, topics: [{ name: "Edited", subtopics: [] }] } });
    r = await seedReadinessSubjects([subject]);
    const after = await find();
    check("a re-run leaves an existing subject untouched (name, deactivation, topics kept)", r.created === 0 && r.kept === 1 && after.name === "Renamed by admin" && after.isActive === false && after.topics[0].name === "Edited");

    // what DELETE /readiness/admin/subjects/:id does: remove the row and write the audit entry
    await prisma.readinessSubject.delete({ where: { id: row.id } });
    await prisma.auditLog.create({ data: { action: "READINESS_SUBJECT_DELETED", adminId: "verify", adminName: "verify", adminRole: "ADMIN", instituteId: null, details: { subjectId: row.id, name: "Renamed by admin", code: CODE } } });
    r = await seedReadinessSubjects([subject]);
    check("a subject deleted on purpose is not re-created at the next boot", r.created === 0 && r.skippedDeleted === 1 && !(await find()), JSON.stringify(r));
    r = await seedReadinessSubjects([subject]);
    check("...and stays deleted on every later boot", r.created === 0 && !(await find()));

    // deletions recorded before the audit entry carried the code have only the name
    await prisma.auditLog.deleteMany({ where: { action: "READINESS_SUBJECT_DELETED", details: { path: ["code"], equals: CODE } } });
    await prisma.auditLog.create({ data: { action: "READINESS_SUBJECT_DELETED", adminId: "verify", adminName: "verify", adminRole: "ADMIN", instituteId: null, details: { subjectId: row.id, name: subject.name } } });
    r = await seedReadinessSubjects([subject]);
    check("an older deletion record (name only, no code) also blocks re-creation", r.created === 0 && r.skippedDeleted === 1 && !(await find()), JSON.stringify(r));
  } catch (err) {
    failures++;
    console.log("FAIL  unexpected error ->", err.message);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(failures ? `${failures} check(s) FAILED` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})();
