// One-off, read-only: replicates GET /tests' exact staff-branch query (routes/tests.js) for the
// real INSTITUTE_ADMIN account reported as unable to see their own just-created tests, confirming
// the isStaff fix actually resolves it against real production data. No writes.
const prisma = require("../src/prisma");
const { staffTestAccessWhere } = require("../src/utils/testOwnership");

async function main() {
  const email = "tnpaptitudetrainer@sanjivani.org.in";
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true, name: true, role: true, instituteId: true } });
  if (!user) { console.log(`No user found with email ${email}`); process.exit(1); }
  console.log(`User: ${user.name} <${email}> role=${user.role} instituteId=${user.instituteId}\n`);

  const req = { user, requesterInstituteId: user.instituteId };
  const isStaffOld = req.user.role === "ADMIN" || req.user.role === "STAFF";
  const isStaffNew = ["ADMIN", "SUPER_ADMIN", "INSTITUTE_ADMIN", "STAFF"].includes(req.user.role);
  console.log(`isStaff under the OLD check: ${isStaffOld} (this is the bug — this role was falling into the STUDENT branch)`);
  console.log(`isStaff under the FIXED check: ${isStaffNew}\n`);

  const instituteWhere = req.requesterInstituteId
    ? {
        OR: [
          { classes: { some: { class: { instituteId: req.requesterInstituteId } } } },
          { academicGroups: { some: { academicGroup: { instituteId: req.requesterInstituteId } } } },
          { classes: { none: {} }, academicGroups: { none: {} }, OR: [{ instituteId: null }, { instituteId: req.requesterInstituteId }] },
        ],
      }
    : {};
  const where = { AND: [instituteWhere, staffTestAccessWhere(req)] };

  const tests = await prisma.test.findMany({ where, select: { id: true, title: true, isPublished: true } });
  console.log(`Tests this account would see as STAFF/ADMIN-tier (fixed query): ${tests.length}`);
  for (const t of tests) console.log(`  - "${t.title}" (published=${t.isPublished})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
