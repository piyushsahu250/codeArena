// One-off: real HTTP-level verification that /resume/me/improve and /resume/me/ai-review
// actually use Gemini (not the rule-based fallback) for a real student session.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  if (!institute) throw new Error("Testing Institute not found");

  const email = `verify-resume-ai-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({
    data: { name: "Verify Resume AI Temp", email, passwordHash, role: "STUDENT", instituteId: institute.id },
  });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  const headers = { "content-type": "application/json", Authorization: `Bearer ${token}` };

  try {
    // Seed a minimal resume so /me/ai-review has something to review.
    await prisma.resume.upsert({
      where: { studentId: user.id },
      update: {},
      create: {
        studentId: user.id, fullName: "Verify Resume AI Temp", email,
        summary: "Aspiring backend developer with a passion for building reliable systems.",
        skills: [{ category: "Programming", items: ["Java", "Python"] }],
        projects: [{ title: "Library Management System", description: "Worked on library portal.", technologies: "Java, MySQL" }],
      },
    });

    const improveRes = await fetch("http://127.0.0.1:4000/api/resume/me/improve", {
      method: "POST", headers,
      body: JSON.stringify({ text: "Worked on library portal.", section: "project" }),
    });
    const improveBody = await improveRes.json();
    console.log("IMPROVE STATUS", improveRes.status);
    console.log("IMPROVE source:", improveBody.source);
    console.log("IMPROVE result:", JSON.stringify(improveBody).slice(0, 300));

    const reviewRes = await fetch("http://127.0.0.1:4000/api/resume/me/ai-review", { method: "POST", headers });
    const reviewBody = await reviewRes.json();
    console.log("AI-REVIEW STATUS", reviewRes.status);
    console.log("AI-REVIEW result:", JSON.stringify(reviewBody).slice(0, 400));
  } finally {
    await prisma.resume.deleteMany({ where: { studentId: user.id } });
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
