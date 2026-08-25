// One-off: real HTTP-level verification of the AI Draft/View "Generate" flow (company pattern
// note) — a temp INSTITUTE_ADMIN session hits the real route, confirms a real DB row was created
// via a real Gemini call, then cleans up both the draft row and the temp user/session.
const jwt = require("jsonwebtoken");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");
const bcrypt = require("bcryptjs");

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: "Testing Institute" } });
  if (!institute) throw new Error("Testing Institute not found");

  const email = `verify-ai-draft-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({
    data: { name: "Verify AI Draft Temp", email, passwordHash, role: "INSTITUTE_ADMIN", instituteId: institute.id },
  });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  const company = `VerifyTestCo-${Date.now()}`;

  try {
    const res = await fetch("http://127.0.0.1:4000/api/interview/admin/drafts/patterns/generate", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ company, category: "TECHNICAL" }),
    });
    const body = await res.json();
    console.log("STATUS", res.status);
    console.log("BODY", JSON.stringify(body).slice(0, 400));

    const row = await prisma.companyPatternNote.findFirst({ where: { company } });
    console.log("DB row created:", !!row, row ? `checklistItems=${JSON.stringify(row.checklistItems)}` : "");
    if (row) await prisma.companyPatternNote.delete({ where: { id: row.id } });
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
