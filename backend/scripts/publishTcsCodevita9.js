// One-off: publish the real "TCS Codevita 9" test via the actual PATCH /tests/:id/publish route
// (not a raw DB write) so the platform's own pre-publish validation, audit log, and student
// notification all fire exactly as they would for a real staff click. Creates one disposable
// INSTITUTE_ADMIN actor under the test's own institute to drive the call; deletes it afterward.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";
const TEST_ID = "1a429557-590d-4f08-8851-351826f88574";

async function main() {
  const test = await prisma.test.findUnique({ where: { id: TEST_ID }, select: { instituteId: true, title: true, isPublished: true } });
  if (!test) throw new Error("Test not found");
  console.log("Before:", test.title, "isPublished:", test.isPublished);

  const email = `publish-tcs9-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const actor = await prisma.user.create({
    data: { name: "Publish TCS9", email, passwordHash: await bcrypt.hash(password, 10), role: "INSTITUTE_ADMIN", instituteId: test.instituteId, mustChangePassword: false },
  });

  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: ${JSON.stringify(loginBody)}`);
    const auth = { Authorization: `Bearer ${loginBody.token}`, "Content-Type": "application/json" };

    const pubRes = await fetch(`${BASE}/tests/${TEST_ID}/publish`, { method: "PATCH", headers: auth, body: JSON.stringify({ isPublished: true }) });
    const pubBody = await pubRes.json();
    if (!pubRes.ok) {
      console.log("PUBLISH FAILED:", pubRes.status, JSON.stringify(pubBody, null, 2));
      throw new Error("Publish rejected");
    }
    console.log("PUBLISHED. isPublished:", pubBody.isPublished, "startTime:", pubBody.startTime, "endTime:", pubBody.endTime);
  } finally {
    await prisma.user.delete({ where: { id: actor.id } }).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
