// Live check for audit item T-3: ownership of the shared AI-review queues (interview question drafts, company pattern notes, company
// question jobs and candidate reports) and of the company catalogue. Two throwaway institutes; cleans up after itself.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

const BASE = process.env.VERIFY_BASE || "http://localhost:4000/api";
let failures = 0;
const check = (label, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); };
async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw) => (await call("POST", "/auth/login", null, { email, password: pw })).body?.token;

async function cleanup() {
  const insts = await prisma.institute.findMany({ where: { name: { startsWith: "ZZ Verify RO " } }, select: { id: true } });
  const ids = insts.map((i) => i.id);
  await prisma.interviewQuestionDraft.deleteMany({ where: { prompt: { startsWith: "ZZ-RO " } } });
  await prisma.interviewQuestion.deleteMany({ where: { prompt: { startsWith: "ZZ-RO " } } });
  await prisma.companyPatternNote.deleteMany({ where: { company: { startsWith: "ZZ Verify RO " } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: "ZZ Verify RO " } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "verify-ro-", endsWith: "@example.invalid" } } });
  await prisma.institute.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  await cleanup();
  const ts = Date.now();
  const A = await prisma.institute.create({ data: { name: `ZZ Verify RO A ${ts}` } });
  const B = await prisma.institute.create({ data: { name: `ZZ Verify RO B ${ts}` } });
  const mk = async (name, role, instituteId) => { const pw = crypto.randomBytes(18).toString("base64url"); const u = await prisma.user.create({ data: { name, email: `verify-ro-${name.toLowerCase().replace(/\W+/g, "")}-${ts}@example.invalid`, passwordHash: await bcrypt.hash(pw, 10), role, instituteId, mustChangePassword: false } }); return { ...u, token: await login(u.email, pw) }; };
  try {
    const stfA = await mk("Staff A", "STAFF", A.id), stfB = await mk("Staff B", "STAFF", B.id), stuA = await mk("Stu A", "STUDENT", A.id), stuB = await mk("Stu B", "STUDENT", B.id);
    const adminA = await mk("Inst Admin A", "INSTITUTE_ADMIN", A.id);
    const clkA = await mk("Clerk A", "CLERK", A.id), clkB = await mk("Clerk B", "CLERK", B.id), plat = await mk("Platform", "ADMIN", null), legacyAdmin = await mk("Legacy Admin A", "ADMIN", A.id);
    const co = await prisma.company.create({ data: { name: `ZZ Verify RO Co ${ts}`, createdByUserId: plat.id, createdByName: "t" } });
    const draft = (inst, tag) => prisma.interviewQuestionDraft.create({ data: { category: "HR", prompt: `ZZ-RO ${tag} ${ts}`, instituteId: inst } });
    const dA = await draft(A.id, "A"), dB = await draft(B.id, "B"), dL = await draft(null, "legacy");
    const note = (inst, company) => prisma.companyPatternNote.create({ data: { company, category: "HR", checklistItems: ["x"], instituteId: inst } });
    const nA = await note(A.id, `ZZ Verify RO Pat A ${ts}`), nB = await note(B.id, `ZZ Verify RO Pat B ${ts}`);
    const nL = await prisma.companyPatternNote.create({ data: { company: `ZZ Verify RO Pat L ${ts}`, category: "HR", checklistItems: ["x"], status: "APPROVED" } });
    const jobA = await prisma.questionGenerationJob.create({ data: { companyId: co.id, role: "dev", round: "HR", status: "FAILED", requestedByAdminId: stfA.id, requestedByName: "a", instituteId: A.id } });
    const jobB = await prisma.questionGenerationJob.create({ data: { companyId: co.id, role: "dev", round: "HR", status: "FAILED", requestedByAdminId: stfB.id, requestedByName: "b", instituteId: B.id } });
    const repA = await prisma.candidateQuestionReport.create({ data: { studentId: stuA.id, companyId: co.id, role: "dev", round: "HR", questionText: "ZZ-RO report A" } });
    const prompts = (r) => (r.body?.rows || r.body || []).map((x) => x.prompt).filter(Boolean);

    // ---------------- AI question draft queue ----------------
    const lA = await call("GET", "/interview/admin/drafts/questions?pageSize=200", stfA.token);
    check("institute A reviewer sees only institute A drafts (not B's, not platform-owned)", lA.status === 200 && prompts(lA).some((p) => p.includes("ZZ-RO A")) && !prompts(lA).some((p) => p.includes("ZZ-RO B") || p.includes("ZZ-RO legacy")), JSON.stringify(prompts(lA).filter((p) => p.startsWith("ZZ-RO"))));
    const lP = await call("GET", "/interview/admin/drafts/questions?pageSize=200", plat.token);
    check("a platform-level reviewer sees all of them (including platform-owned)", ["ZZ-RO A", "ZZ-RO B", "ZZ-RO legacy"].every((k) => prompts(lP).some((p) => p.includes(k))));
    check("staff of A cannot edit B's draft", (await call("PATCH", `/interview/admin/drafts/questions/${dB.id}`, stfA.token, { prompt: "ZZ-RO hacked" })).status === 404);
    check("staff of A cannot reject B's draft", (await call("POST", `/interview/admin/drafts/questions/${dB.id}/reject`, stfA.token, { reason: "x" })).status === 404);
    check("staff of A cannot approve B's draft", (await call("POST", `/interview/admin/drafts/questions/${dB.id}/approve`, stfA.token, {})).status === 404);
    const bulk = await call("POST", "/interview/admin/drafts/questions/bulk-approve", stfA.token, { ids: [dB.id, dL.id] });
    check("bulk-approve refuses other institutes' and platform-owned drafts", bulk.status === 200 && bulk.body.approved === 0 && bulk.body.failed === 2, JSON.stringify(bulk.body));
    check("staff of A cannot delete B's or a platform-owned draft", (await call("DELETE", `/interview/admin/drafts/questions/${dB.id}`, stfA.token)).status === 404 && (await call("DELETE", `/interview/admin/drafts/questions/${dL.id}`, stfA.token)).status === 404);
    check("...and both rows still exist", (await prisma.interviewQuestionDraft.count({ where: { id: { in: [dB.id, dL.id] } } })) === 2 && (await prisma.interviewQuestionDraft.findUnique({ where: { id: dB.id } })).prompt.includes("ZZ-RO B"));
    check("staff of A can edit and delete their own draft", (await call("PATCH", `/interview/admin/drafts/questions/${dA.id}`, stfA.token, { prompt: `ZZ-RO A edited ${ts}` })).status === 200 && (await call("DELETE", `/interview/admin/drafts/questions/${dA.id}`, stfA.token)).status === 200);
    check("a platform-level reviewer can delete a platform-owned draft", (await call("DELETE", `/interview/admin/drafts/questions/${dL.id}`, plat.token)).status === 200);

    // ---------------- company pattern notes ----------------
    const pn = await call("GET", "/interview/admin/drafts/patterns", stfA.token);
    const companies = (pn.body || []).map((n) => n.company);
    check("pattern-note review list is scoped to the reviewer's institute", pn.status === 200 && companies.includes(`ZZ Verify RO Pat A ${ts}`) && !companies.includes(`ZZ Verify RO Pat B ${ts}`));
    check("staff of A cannot edit / approve / reject / delete B's pattern note", [
      (await call("PATCH", `/interview/admin/drafts/patterns/${nB.id}`, stfA.token, { checklistItems: ["h"] })).status,
      (await call("POST", `/interview/admin/drafts/patterns/${nB.id}/approve`, stfA.token)).status,
      (await call("POST", `/interview/admin/drafts/patterns/${nB.id}/reject`, stfA.token)).status,
      (await call("DELETE", `/interview/admin/drafts/patterns/${nB.id}`, stfA.token)).status,
    ].every((s) => s === 404));
    await call("POST", `/interview/admin/drafts/patterns/${nA.id}/approve`, stfA.token);
    const seeA = await call("GET", `/interview/companies/${encodeURIComponent(nA.company)}/pattern`, stuA.token);
    const seeB = await call("GET", `/interview/companies/${encodeURIComponent(nA.company)}/pattern`, stuB.token);
    check("a pattern institute A approved is shown to A's students and not to B's", seeA.body?.length === 1 && seeB.body?.length === 0, `${seeA.body?.length}/${seeB.body?.length}`);
    const seeL = await call("GET", `/interview/companies/${encodeURIComponent(nL.company)}/pattern`, stuB.token);
    check("an approved platform-owned pattern is shown to every institute", seeL.body?.length === 1);

    // ---------------- company question jobs & candidate reports ----------------
    const jl = await call("GET", "/interview/admin/company-questions/jobs", stfA.token);
    check("generation-job list is scoped to the reviewer's institute", jl.status === 200 && jl.body.some((j) => j.id === jobA.id) && !jl.body.some((j) => j.id === jobB.id));
    check("job detail and retry of another institute's job are refused (404)", (await call("GET", `/interview/admin/company-questions/jobs/${jobB.id}`, stfA.token)).status === 404 && (await call("POST", `/interview/admin/company-questions/jobs/${jobB.id}/retry`, stfA.token)).status === 404);
    const rl = await call("GET", "/interview/admin/company-questions/reports", stfB.token);
    check("candidate reports from another institute's students are not listed", rl.status === 200 && !rl.body.some((r) => r.id === repA.id));
    check("a reviewer from another institute cannot verify them", (await call("PATCH", `/interview/admin/company-questions/reports/${repA.id}/verify`, stfB.token, { status: "REJECTED", rejectionReason: "x" })).status === 404);
    const rA = await call("GET", "/interview/admin/company-questions/reports", stfA.token);
    check("the student's own institute reviewer sees and can review it", rA.status === 200 && rA.body.some((r) => r.id === repA.id) && (await call("PATCH", `/interview/admin/company-questions/reports/${repA.id}/verify`, stfA.token, { status: "REJECTED", rejectionReason: "test" })).status === 200);

    // ---------------- company master ----------------
    const created = await call("POST", "/companies", clkA.token, { name: `ZZ Verify RO Clerk ${ts}`, companyType: "IT" });
    check("an institute clerk can add a company; it is stamped with their institute", created.status === 200 && created.body.instituteId === A.id, JSON.stringify(created.body?.instituteId));
    const cid = created.body.id;
    check("clerk of another institute cannot edit it (403)", (await call("PATCH", `/companies/${cid}`, clkB.token, { website: "https://evil.example" })).status === 403);
    check("the owning institute can edit its details", (await call("PATCH", `/companies/${cid}`, clkA.token, { website: "https://ok.example" })).status === 200);
    const tog = await call("PATCH", `/companies/${cid}`, clkA.token, { isActive: false });
    check("an institute clerk cannot deactivate a company (affects every institute)", tog.status === 403 && (await prisma.company.findUnique({ where: { id: cid } })).isActive === true);
    check("an institute clerk cannot edit a platform-catalogue company", (await call("PATCH", `/companies/${co.id}`, clkA.token, { name: `ZZ Verify RO Renamed ${ts}` })).status === 403);
    check("the company is unchanged after the refused edits", (await prisma.company.findUnique({ where: { id: co.id } })).name === `ZZ Verify RO Co ${ts}`);
    check("a platform-level admin can edit and deactivate any company", (await call("PATCH", `/companies/${cid}`, plat.token, { website: "https://plat.example" })).status === 200 && (await call("PATCH", `/companies/${cid}`, plat.token, { isActive: false })).status === 200);
    await call("PATCH", `/companies/${cid}`, plat.token, { isActive: true });
    const gl = await call("GET", "/companies", clkB.token);
    const mine = gl.body?.find((c) => c.id === cid), plain = gl.body?.find((c) => c.id === co.id);
    check("everyone can still read and use every company; the list says what the caller may edit", gl.status === 200 && mine?.editable === false && plain?.editable === false && mine?.canToggle === false);
    check("students can read the catalogue", (await call("GET", "/companies", stuA.token)).status === 200);

    // ---------------- T-3b: shared / legacy interview questions ----------------
    const mkQ = (inst, tag) => prisma.interviewQuestion.create({ data: { category: "HR", prompt: `ZZ-RO question ${tag} ${ts}`, instituteId: inst } });
    const qShared = await mkQ(null, "shared"), qA = await mkQ(A.id, "A"), qB = await mkQ(B.id, "B");
    const ql = await call("GET", "/interview/admin/questions?pageSize=500", stfA.token);
    const rowOf = (id) => (ql.body?.rows || []).find((r) => r.id === id);
    check("institute staff still READ shared questions and their own, but not another institute's", !!rowOf(qShared.id) && !!rowOf(qA.id) && !rowOf(qB.id));
    check("the list says which rows are editable (shared: no, own: yes)", rowOf(qShared.id)?.editable === false && rowOf(qA.id)?.editable === true);
    const ed = await call("PATCH", `/interview/admin/questions/${qShared.id}`, stfA.token, { prompt: "ZZ-RO hacked" });
    check("institute staff cannot edit a shared question (403)", ed.status === 403, String(ed.status));
    check("institute staff cannot delete a shared question (403) and it still exists", (await call("DELETE", `/interview/admin/questions/${qShared.id}`, stfA.token)).status === 403 && (await prisma.interviewQuestion.findUnique({ where: { id: qShared.id } })).prompt.includes("shared"));
    check("an institute ADMIN-tier account cannot change a shared question either", (await call("PATCH", `/interview/admin/questions/${qShared.id}`, adminA.token, { prompt: "ZZ-RO hacked" })).status === 403);
    check("another institute's question is invisible to edit/delete (404)", (await call("PATCH", `/interview/admin/questions/${qB.id}`, stfA.token, { prompt: "x" })).status === 404 && (await call("DELETE", `/interview/admin/questions/${qB.id}`, stfA.token)).status === 404);
    check("staff can still edit their own institute's question", (await call("PATCH", `/interview/admin/questions/${qA.id}`, stfA.token, { prompt: `ZZ-RO question A edited ${ts}` })).status === 200);
    check("a platform-level admin can edit and delete a shared question", (await call("PATCH", `/interview/admin/questions/${qShared.id}`, plat.token, { prompt: `ZZ-RO question shared edited ${ts}` })).status === 200 && (await call("DELETE", `/interview/admin/questions/${qShared.id}`, plat.token)).status === 200);

    // ---------------- platform-wide settings are platform-level only ----------------
    check("an institute-bound ADMIN cannot change platform-wide interview company profiles", (await call("PATCH", "/interview/admin/company-profiles/00000000-0000-0000-0000-000000000000", legacyAdmin.token, { notes: "x" })).status === 403);
    check("...nor create gamification badges", (await call("POST", "/gamification/badges", legacyAdmin.token, {})).status === 403);
    check("a platform-level admin reaches those handlers (validation/404, not 403)", [400, 404].includes((await call("PATCH", "/interview/admin/company-profiles/00000000-0000-0000-0000-000000000000", plat.token, { notes: "x" })).status));
  } finally {
    await cleanup();
  }
  console.log(failures === 0 ? "\nREVIEW QUEUE + COMPANY CATALOGUE OWNERSHIP VERIFIED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(2); });
