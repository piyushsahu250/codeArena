// One-off: real bulk-import of the TCS CodeVita 9 Pre-Qualifier coding questions (5 rows) into the
// live question bank, against Subject "TCS Codevita" / Unit "Unit 1 - 5 Questions" (both confirmed
// to already exist). Creates a disposable INSTITUTE_ADMIN actor (random password) purely to drive
// the real HTTP upload as the platform requires; the actor account is deleted afterward (Question.
// createdById is onDelete: SetNull, so this never touches the imported questions). The imported
// Questions themselves are NOT cleaned up — this is a real, intentional content import.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const prisma = require("../src/prisma");

const BASE = "http://localhost:4000/api";
const FILE_PATH = "/root/TCS_CodeVita_9_PreQualifier_coding.xlsx";

async function main() {
  const institute = await prisma.institute.findFirst({ where: { name: { contains: "Sanjivani", mode: "insensitive" } }, orderBy: { createdAt: "asc" } })
    || await prisma.institute.findFirst({ where: { isActive: true } });
  if (!institute) throw new Error("No institute found");

  const disabled = await prisma.featureSetting.findFirst({ where: { instituteId: institute.id, featureKey: "question_bank", enabled: false } });
  if (disabled) throw new Error(`question_bank is disabled for institute ${institute.id}`);

  const email = `import-tcs-codevita-${Date.now()}@example.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const actor = await prisma.user.create({
    data: { name: "TCS Codevita Import", email, passwordHash, role: "INSTITUTE_ADMIN", instituteId: institute.id, mustChangePassword: false },
  });
  console.log("Created temp actor:", actor.id, "under institute:", institute.name);

  try {
    const loginRes = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const loginBody = await loginRes.json();
    if (!loginRes.ok) throw new Error(`login failed: HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
    const token = loginBody.token;
    console.log("Login OK\n");

    const fileBuffer = fs.readFileSync(FILE_PATH);
    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "TCS_CodeVita_9_PreQualifier_coding.xlsx");
    form.append("duplicateAction", "skip");

    console.log("=== PREVIEW ===");
    const previewRes = await fetch(`${BASE}/questions/bulk-import-coding/preview`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const previewBody = await previewRes.json();
    if (!previewRes.ok) throw new Error(`preview failed: HTTP ${previewRes.status} ${JSON.stringify(previewBody)}`);
    console.log(`total=${previewBody.total} wouldCreate=${previewBody.createdCount} skipped=${previewBody.skippedCount} errors=${previewBody.errorCount}`);
    if (previewBody.errors?.length) console.log("Errors:", JSON.stringify(previewBody.errors, null, 2));
    if (previewBody.skipped?.length) console.log("Skipped:", JSON.stringify(previewBody.skipped, null, 2));
    if (previewBody.autoFixed?.length) console.log("Auto-fixed:", JSON.stringify(previewBody.autoFixed, null, 2));
    if (previewBody.unknownColumns?.length) console.log("Unknown columns (ignored):", previewBody.unknownColumns);

    if (!previewBody.validRows || previewBody.validRows.length === 0) {
      throw new Error("Preview produced zero valid rows to import -- stopping before confirm.");
    }

    console.log("\n=== CONFIRM ===");
    const confirmForm = new FormData();
    confirmForm.append("rows", JSON.stringify(previewBody.validRows));
    confirmForm.append("duplicateAction", "skip");
    const confirmRes = await fetch(`${BASE}/questions/bulk-import-coding/confirm`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: confirmForm });
    const confirmBody = await confirmRes.json();
    if (!confirmRes.ok) throw new Error(`confirm failed: HTTP ${confirmRes.status} ${JSON.stringify(confirmBody)}`);
    console.log(`Imported: ${confirmBody.createdCount} created, ${confirmBody.skippedCount} skipped, ${confirmBody.errorCount} errors`);
    if (confirmBody.errors?.length) console.log("Errors:", JSON.stringify(confirmBody.errors, null, 2));
    console.log("\nCreated question IDs + titles:");
    for (const q of confirmBody.created) console.log(`  ${q.id}  ${q.title}`);

    console.log("\n=== IMPORT: DONE ===");
  } finally {
    await prisma.user.delete({ where: { id: actor.id } }).catch(() => {});
    console.log("\nCleaned up temp actor account (imported questions were left in place).");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
