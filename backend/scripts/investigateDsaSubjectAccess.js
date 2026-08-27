// One-off, read-only: the bulk question-upload report shows every row failing with
// `Subject "DSA" not found or you're not authorized to use it` (backend/src/routes/questions.js,
// resolveSubjectUnitTopicByName). That one message covers two different real causes — the Subject
// genuinely doesn't exist (in this institute or globally), OR it exists but a STAFF uploader isn't
// its creator and has no StaffSubjectAssignment for it (subjectAccess.js's canStaffUseSubject).
// This surfaces which one it actually is, plus who CAN currently use it, so the fix is targeted
// instead of guessed. No writes.
const prisma = require("../src/prisma");

async function main() {
  const subjects = await prisma.subject.findMany({
    where: { name: { contains: "DSA", mode: "insensitive" } },
    select: {
      id: true, name: true, instituteId: true, createdById: true,
      institute: { select: { name: true } },
      createdBy: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  console.log(`Found ${subjects.length} subject(s) matching "DSA" (case-insensitive, substring):\n`);
  for (const s of subjects) {
    console.log(`Subject "${s.name}" (id=${s.id})`);
    console.log(`  institute: ${s.institute?.name || "(none — global/platform-wide subject)"} (instituteId=${s.instituteId || "null"})`);
    console.log(`  created by: ${s.createdBy ? `${s.createdBy.name} <${s.createdBy.email}> (${s.createdBy.role})` : "(unknown/deleted user)"}`);

    const assignments = await prisma.staffSubjectAssignment.findMany({
      where: { subjectId: s.id },
      select: { staff: { select: { name: true, email: true } } },
    });
    console.log(`  explicitly assigned staff (${assignments.length}): ${assignments.map((a) => `${a.staff.name} <${a.staff.email}>`).join(", ") || "(none)"}`);
    console.log("");
  }

  if (subjects.length === 0) {
    console.log("No Subject named anything like \"DSA\" exists anywhere in the database.");
    console.log("This means the bulk-upload template's Subject column value doesn't match ANY existing Subject name at all —");
    console.log("the fix is to create the Subject first (Admin/Institute Admin), or correct the spelling in the upload file to an existing Subject's exact name.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
