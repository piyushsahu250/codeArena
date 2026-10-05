const crypto = require("crypto"), bcrypt = require("bcryptjs"), prisma = require("../src/prisma");
const BASE = "http://localhost:4000/api";
(async () => {
  const subject = await prisma.readinessSubject.findFirst({ where: { name: "DSA" }, include: { academicGroupAssignments: { include: { academicGroup: true } } } });
  const as = subject.academicGroupAssignments[0];
  const instituteId = as ? as.academicGroup.instituteId : (await prisma.institute.findFirst({ where: { isActive: true } })).id;
  const email = `verify-fnd-${Date.now()}@example.invalid`, password = crypto.randomBytes(18).toString("base64url");
  const u = await prisma.user.create({ data: { name: "Verify Foundation", email, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT", instituteId, mustChangePassword: false, academicGroupId: as?.academicGroupId || null, program: as?.program || null } });
  try {
    const l = await (await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
    const h = { Authorization: `Bearer ${l.token}`, "Content-Type": "application/json" };
    for (const n of [10, 15]) {
      const r = await fetch(`${BASE}/readiness/assessments`, { method: "POST", headers: h, body: JSON.stringify({ subjectId: subject.id, assessmentMode: process.env.MODE || "FOUNDATION", questionCount: n }) });
      const b = await r.json();
      if (!r.ok) { console.log("FAIL start", n, JSON.stringify(b)); continue; }
      const types = {}, btl = {}, topics = {};
      for (const q of b.questions) { types[q.questionType] = (types[q.questionType] || 0) + 1; btl[q.btlLevel] = (btl[q.btlLevel] || 0) + 1; topics[q.topic] = (topics[q.topic] || 0) + 1; }
      console.log(`count=${n}: got ${b.questions.length}, shortfallLevels=${JSON.stringify(b.shortfallLevels)}, usedFallback=${b.usedFallback}, types=${JSON.stringify(types)}, btl=${JSON.stringify(btl)}, topics=${Object.keys(topics).length}`);
      await prisma.readinessAssessment.delete({ where: { id: b.assessment.id } });
    }
  } finally { await prisma.loginSession.deleteMany({ where: { userId: u.id } }); await prisma.user.delete({ where: { id: u.id } }).catch(() => {}); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
