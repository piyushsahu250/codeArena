// Diagnostic: fetches the module-test lesson payload ("Coding Problems") as a disposable student cloned from a real student's institute/group, and
// prints the shape. Creates one temporary user and removes it. Usage: node scripts/debugLessonPage.js [moduleNumber]
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
(async () => {
  const modNo = Number(process.argv[2] || 3);
  const lessons = await prisma.lesson.findMany({ where: { isModuleTest: true, title: "Coding Problems" }, include: { module: { include: { course: true } } } });
  const target = lessons.filter((l) => l.module.order === modNo || l.module.title.startsWith(`Module ${modNo}`) || true);
  console.log("module-test lessons:", target.map((l) => `${l.module.course.name}/${l.module.title}/${l.id}/published=${l.status ?? l.published ?? "?"}`).slice(0, 8));
  const lesson = target.find((l) => /3/.test(l.module.title)) || target[0];
  const prog = await prisma.lessonProgress.findFirst({ where: { lessonId: lesson.id }, orderBy: { updatedAt: "desc" }, include: { student: true } }).catch(() => null);
  const donor = prog?.student || (await prisma.user.findFirst({ where: { role: "STUDENT", instituteId: { not: null }, academicGroupId: { not: null } } }));
  const pw = crypto.randomBytes(12).toString("base64url");
  const u = await prisma.user.create({ data: { name: "ZZ Lesson Debug", email: `zz-lessondebug-${Date.now()}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role: "STUDENT", instituteId: donor.instituteId, academicGroupId: donor.academicGroupId, department: donor.department, mustChangePassword: false } });
  try {
    const login = await (await fetch("http://localhost:4000/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, password: pw }) })).json();
    const H = { Authorization: `Bearer ${login.token}` };
    const r = await fetch(`http://localhost:4000/api/learning/lessons/${lesson.id}`, { headers: H });
    const body = await r.json();
    console.log("lesson", lesson.id, "status", r.status, "keys", Object.keys(body));
    if (body.questions) {
      console.log("questions:", body.questions.length);
      for (const q of body.questions) console.log(" ", q.type, "options:", Array.isArray(q.options) ? q.options.length : typeof q.options, "starter:", typeof q.starterCode, "lang:", q.language, "keys:", Object.keys(q).join(","));
    } else console.log("NO questions in payload:", JSON.stringify(body).slice(0, 400));
    for (const p of ["lesson", "module", "course"]) console.log(p, body[p] ? "present" : "MISSING");
  } finally {
    await prisma.user.deleteMany({ where: { id: u.id } });
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
