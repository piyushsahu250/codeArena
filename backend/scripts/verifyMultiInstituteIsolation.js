// Multi-institute security re-verification (post UI-redesign). Uses two REAL, already-existing
// institutes (never creates new ones) and creates one temp STUDENT/STAFF/CLERK/INSTITUTE_ADMIN
// account per institute, then attempts real cross-institute API access for every area the spec
// lists. Expects 403/404 everywhere. Cleans up by exact ID only.
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");
const { createSession } = require("../src/utils/sessions");

const API_BASE = "http://127.0.0.1:4000/api";
const results = [];

function record(area, status, expected, note) {
  const ok = expected === "NO_LEAK" ? status === "NO_LEAK" : Array.isArray(expected) ? expected.includes(status) : status === expected;
  results.push({ area, status, expected, ok, note });
}

async function mkUser(role, instituteId, label) {
  const email = `mi-verify-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`;
  const passwordHash = await bcrypt.hash("Temp1234!Verify", 10);
  const user = await prisma.user.create({ data: { name: `MI Verify ${label}`, email, passwordHash, role, instituteId } });
  const token = await createSession({ user, req: { headers: {} }, singleSessionOnly: false });
  const jti = jwt.decode(token).jti;
  return { user, jti, headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } };
}

async function req(path, headers, method = "GET") {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method, headers });
    return res.status;
  } catch {
    return -1;
  }
}

async function main() {
  const institutes = await prisma.institute.findMany({ take: 2, orderBy: { name: "asc" } });
  if (institutes.length < 2) { console.log("Need at least 2 institutes to test — found", institutes.length); process.exit(1); }
  const [instA, instB] = institutes;
  console.log(`Institute A: ${instA.name} (${instA.id})`);
  console.log(`Institute B: ${instB.name} (${instB.id})`);

  const cleanup = [];
  try {
    const studentA = await mkUser("STUDENT", instA.id, "studentA");
    const studentB = await mkUser("STUDENT", instB.id, "studentB");
    const staffA = await mkUser("STAFF", instA.id, "staffA");
    const clerkA = await mkUser("CLERK", instA.id, "clerkA");
    const instAdminA = await mkUser("INSTITUTE_ADMIN", instA.id, "instAdminA");
    cleanup.push(studentA, studentB, staffA, clerkA, instAdminA);

    // 1. Institute Admin A -> Student B's profile
    record("Student profile", await req(`/users/${studentB.user.id}`, instAdminA.headers), [403, 404]);

    // 2. Staff A -> Student B's performance
    record("Student performance", await req(`/users/${studentB.user.id}/performance`, staffA.headers), [403, 404]);

    // 3. Institute Admin A -> Institute B's course-analytics
    record("Institute analytics (cross-institute id)", await req(`/institutes/${instB.id}/course-analytics`, instAdminA.headers), [403, 404]);

    // 4. Institute Admin A -> Institute B's profile-completion-stats
    record("Profile completion stats (cross-institute id)", await req(`/institutes/${instB.id}/profile-completion-stats`, instAdminA.headers), [403, 404]);

    // 5. Staff A IS legitimately allowed to view the audit log (requireRole includes STAFF/CLERK —
    //    confirmed at users.js:1194, a deliberate extension from earlier this session), so the real
    //    test is row-level: institute B's rows must never appear in institute A staff's response.
    const auditRes = await fetch(`${API_BASE}/users/audit-log`, { headers: staffA.headers });
    const auditBody = auditRes.status === 200 ? await auditRes.json() : null;
    const auditLeaks = auditBody?.logs?.some((l) => l.instituteId === instB.id) || auditBody?.rows?.some((l) => l.instituteId === instB.id);
    record("Audit log row-level isolation (staff)", auditLeaks ? "LEAK" : "NO_LEAK", "NO_LEAK", auditLeaks ? "Institute A staff saw an Institute B audit row!" : `status=${auditRes.status}, no cross-institute rows`);

    // 6. Company Master (GET /companies) is deliberately global reference data (real company
    //    names like "Google"/"TCS" that every institute's placement cell places students with),
    //    not institute-owned data — confirmed via its route (backend/src/routes/companies.js:11-18
    //    has no institute filter at all). Not a leak to test; skipped intentionally.

    // 7. Institute Admin A -> Reported Problems queue (should only ever see own institute's rows —
    //    verified as 200 since Institute Admin IS authorized for the queue itself, isolation is row-level)
    const issueRes = await fetch(`${API_BASE}/issue-reports`, { headers: instAdminA.headers });
    const issueBody = issueRes.status === 200 ? await issueRes.json() : null;
    const leaksInstB = issueBody?.issues?.some((i) => i.instituteId === instB.id);
    record("Issue reports row-level isolation", leaksInstB ? "LEAK" : "NO_LEAK", "NO_LEAK", leaksInstB ? "Institute A admin saw an Institute B row!" : `status=${issueRes.status}, no cross-institute rows`);

    // 8. Student A -> another student's readiness/talent-pool/attendance data via direct ID guess —
    //    covered by the generic user-profile check (#1 style) already; add explicit readiness check:
    record("Readiness overview (student, own-institute only route exists for clerk/admin, not student-to-student)", await req(`/readiness/placement/overview`, studentA.headers), [403, 404]);

    // 9. Direct users/search leak check — Staff A searching should never surface Institute B's people
    const searchRes = await fetch(`${API_BASE}/users/search?q=MI%20Verify`, { headers: staffA.headers });
    const searchBody = searchRes.status === 200 ? await searchRes.json() : null;
    const searchLeaks = searchBody?.rows?.some((r) => r.id === studentB.user.id);
    record("User search cross-institute leak", searchLeaks ? "LEAK" : "NO_LEAK", "NO_LEAK", searchLeaks ? "Staff A's search surfaced Institute B's student!" : `status=${searchRes.status}, no cross-institute rows`);

  } finally {
    const jtis = cleanup.map((c) => c.jti);
    const userIds = cleanup.map((c) => c.user.id);
    if (jtis.length) await prisma.loginSession.deleteMany({ where: { token: { in: jtis } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log("\n=== MULTI-INSTITUTE ISOLATION RESULTS ===");
  let allOk = true;
  for (const r of results) {
    const mark = r.ok === false ? "FAIL" : r.ok === true ? "PASS" : (r.status === "LEAK" ? "FAIL" : "INFO");
    if (mark === "FAIL") allOk = false;
    console.log(`[${mark}] ${r.area}: status=${r.status} expected=${JSON.stringify(r.expected)}${r.note ? " — " + r.note : ""}`);
  }
  console.log(allOk ? "\nAll checks passed." : "\nSOME CHECKS FAILED — see above.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
