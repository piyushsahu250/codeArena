// One-off: reproduce the PATCH /profile/me 400 errors multiple real, first-time-login students
// (from today's bulk-uploaded TCS Codevita 9 cohorts) are hitting right now. Creates a disposable
// student in the SAME state as the affected real accounts (mustChangePassword: true, no
// StudentProfile row yet) and submits a realistic first-time profile-completion payload through
// the real route, to see the actual validation error (never visible in server logs -- only the
// status code is logged, not the response body).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: { contains: "Sanjivani", mode: "insensitive" } } });
  const group = await prisma.academicGroup.findFirst({ where: { department: { name: "Artificial Intelligence and Machine Learning" } } });

  const email = `verify-profile-400-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const student = await prisma.user.create({
    data: {
      name: "Verify Profile400", email, passwordHash: await bcrypt.hash(password, 10), role: "STUDENT",
      instituteId: institute.id, academicGroupId: group.id, program: "AIML", department: "Artificial Intelligence and Machine Learning",
      batchYear: "2022-2026", mobile: "9876543210", rollNumber: "999", mustChangePassword: true,
    },
  });
  console.log("Created temp student in same state as affected accounts (mustChangePassword=true, no profile row)\n");

  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: ${JSON.stringify(loginBody)}`);
    console.log("Login response mustChangePassword:", loginBody.user.mustChangePassword, "\n");
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };

    // Attempt 1: a realistic first-time profile-completion payload a student might submit.
    const payloads = [
      { label: "firstName/lastName only", body: { firstName: "Verify", lastName: "Student" } },
      { label: "+ mobile re-confirm", body: { firstName: "Verify", lastName: "Student", mobile: "9876543210" } },
      { label: "+ personalEmail", body: { firstName: "Verify", lastName: "Student", personalEmail: "verify.student@gmail.com" } },
      { label: "+ dob + gender + address fields", body: { firstName: "Verify", lastName: "Student", dob: "2003-05-15", gender: "Male", address: "123 Main St", district: "Ahmednagar", state: "Maharashtra", pincode: "412411" } },
      { label: "+ rollNumber unchanged", body: { firstName: "Verify", lastName: "Student", rollNumber: "999" } },
    ];

    for (const p of payloads) {
      const res = await fetch(`${BASE}/profile/me`, { method: "PATCH", headers: auth, body: JSON.stringify(p.body) });
      const body = await res.json();
      console.log(`[${p.label}] HTTP ${res.status} — ${JSON.stringify(body)}`);
    }
  } finally {
    await prisma.studentProfile.deleteMany({ where: { studentId: student.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: student.id } }).catch(() => {});
    console.log("\nCleaned up temp student.");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
