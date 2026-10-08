// Disposable accounts and data for the browser E2E suite (frontend/e2e). Everything created here is named "ZZ E2E ..." / e2e-*@example.invalid and
// is removed by --cleanup. Prints one JSON document with the credentials on stdout (passwords are random per run, never stored anywhere else).
//   node scripts/e2eSeed.js --seed      create and print
//   node scripts/e2eSeed.js --cleanup   remove everything this script created
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const TAG = "ZZ E2E";
async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.test.deleteMany({ where: { instituteId: { in: ids } } }); // attempts + submissions cascade
  await prisma.question.deleteMany({ where: { title: { startsWith: `${TAG} ` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "e2e-", endsWith: "@example.invalid" } } });
  await prisma.academicGroup.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.department.deleteMany({ where: { instituteId: { in: ids } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

async function seed() {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `${TAG} Alpha Institute ${ts}`, code: "E2EA" } });
  const B = await prisma.institute.create({ data: { name: `${TAG} Beta Institute ${ts}`, code: "E2EB" } });
  const dept = await prisma.department.create({ data: { name: "E2E Computer Science", instituteId: A.id } });
  const group = await prisma.academicGroup.create({ data: { instituteId: A.id, batch: "2026", departmentId: dept.id, section: "Section A" } });
  const mk = async (key, name, role, instituteId, extra = {}) => {
    const password = crypto.randomBytes(18).toString("base64url");
    const u = await prisma.user.create({ data: { name, email: `e2e-${key}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), role, instituteId, mustChangePassword: false, ...extra } });
    return { id: u.id, name, email: u.email, password, role, instituteId };
  };
  const users = {
    student: await mk("student", "Ela Student", "STUDENT", A.id, { department: "E2E Computer Science", academicGroupId: group.id, program: "B.Tech", rollNumber: "101" }),
    student2: await mk("student2", "Ben Student", "STUDENT", A.id, { department: "E2E Computer Science", academicGroupId: group.id, rollNumber: "102" }),
    studentB: await mk("studentb", "Zed Other", "STUDENT", B.id),
    staff: await mk("staff", "Sam Staff", "STAFF", A.id, { department: "E2E Computer Science" }),
    clerk: await mk("clerk", "Cora Clerk", "CLERK", A.id),
    instAdmin: await mk("instadmin", "Ivy Admin", "INSTITUTE_ADMIN", A.id),
    platform: await mk("platform", "Pat Platform", "ADMIN", null),
  };
  const mkQ = (n) => prisma.question.create({ data: { title: `${TAG} Question ${n}`, description: `E2E question ${n}: pick option B`, questionType: "MCQ", difficulty: "EASY", points: 5, options: ["Option A", "Option B", "Option C"], correctAnswer: [1], instituteId: A.id } });
  const questions = [await mkQ(1), await mkQ(2)];
  const now = Date.now();
  const mkTest = (title, extra = {}) => prisma.test.create({
    data: {
      title, durationMin: 20, startTime: new Date(now - 60000), endTime: new Date(now + 6 * 3600000), isPublished: true, showResults: true, requireFullscreen: false,
      createdById: users.staff.id, instituteId: A.id, academicGroups: { create: [{ academicGroupId: group.id }] },
      questions: { create: questions.map((q, order) => ({ questionId: q.id, order })) }, ...extra,
    },
  });
  const test = await mkTest(`${TAG} Standard Test`);
  const proctored = await mkTest(`${TAG} Proctored Test`, { securityLevel: "PROCTORED" });
  console.log(JSON.stringify({ users, institutes: { A: { id: A.id, name: A.name }, B: { id: B.id, name: B.name } }, testId: test.id, proctoredTestId: proctored.id, questionTexts: ["E2E question 1: pick option B", "E2E question 2: pick option B"] }));
}

(async () => {
  if (process.argv.includes("--cleanup")) { await cleanup(); console.error("e2e data removed"); }
  else if (process.argv.includes("--seed")) await seed();
  else { console.error("usage: --seed | --cleanup"); process.exit(2); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
