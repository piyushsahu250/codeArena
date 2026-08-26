// Verify PATCH /profile/me/account end-to-end: a real tiny PNG data URL through the actual save
// path (not the raw prisma write), confirming validation + persistence + rejection cases.
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");

const API_BASE = "http://127.0.0.1:4000/api";
// A real, tiny (1x1 red pixel) valid PNG, base64-encoded — genuine image bytes, not a fake string.
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function main() {
  const institute = await prisma.institute.findFirst();
  const email = `photo-verify-${Date.now()}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: "Photo Verify", email, passwordHash, role: "STAFF", instituteId: institute.id } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  const headers = { "content-type": "application/json", Authorization: `Bearer ${token}` };

  try {
    // 1. Valid photo + LinkedIn
    const r1 = await fetch(`${API_BASE}/profile/me/account`, {
      method: "PATCH", headers,
      body: JSON.stringify({ name: "Photo Verify Updated", mobile: "9876543210", profilePhotoUrl: TINY_PNG, linkedinUrl: "https://linkedin.com/in/testuser" }),
    });
    const b1 = await r1.json();
    console.log("1. Valid photo+LinkedIn save ->", r1.status, JSON.stringify(b1).slice(0, 200));

    // 2. Reject non-image data URL (spoofed)
    const r2 = await fetch(`${API_BASE}/profile/me/account`, {
      method: "PATCH", headers, body: JSON.stringify({ profilePhotoUrl: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" }),
    });
    console.log("2. Reject non-image data URL ->", r2.status, "(expect 400)");

    // 3. Reject bad LinkedIn URL
    const r3 = await fetch(`${API_BASE}/profile/me/account`, {
      method: "PATCH", headers, body: JSON.stringify({ linkedinUrl: "javascript:alert(1)" }),
    });
    console.log("3. Reject unsafe LinkedIn URL ->", r3.status, "(expect 400)");

    // 4. Reject oversized data URL
    const bigFake = "data:image/png;base64," + "A".repeat(800_000);
    const r4 = await fetch(`${API_BASE}/profile/me/account`, {
      method: "PATCH", headers, body: JSON.stringify({ profilePhotoUrl: bigFake }),
    });
    console.log("4. Reject oversized photo ->", r4.status, "(expect 400)");

    // 5. Confirm persisted correctly
    const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, mobile: true, profilePhotoUrl: true, linkedinUrl: true } });
    console.log("5. Persisted:", JSON.stringify({ name: fresh.name, mobile: fresh.mobile, hasPhoto: !!fresh.profilePhotoUrl, linkedinUrl: fresh.linkedinUrl }));
  } finally {
    await prisma.loginSession.deleteMany({ where: { token: jti } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
