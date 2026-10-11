const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildHiddenTests, checkSamples, visibleSamples, MAP, PROBLEMS } = require("../src/utils/researchHiddenTests");

// Pending coding drafts from the master question bank that got hidden tests.
const MASTER_PENDING = `ADB-MTS-R1-001 ADB-MTS-R1-002 ADB-MTS-R1-003 ADB-MTS-R1-004 ADB-MTS-R1-005 ADB-MTS-R1-006 ADB-MTS-R1-008 ADB-MTS-R4-001 ADB-MTS-R5-001 ADB-MTS-R5-002 AMZ-SDE1-R1-001 AMZ-SDE1-R1-002 AMZ-SDE1-R1-003 AMZ-SDE1-R1-004 AMZ-SDE1-R1-005 AMZ-SDE1-R1-006 AMZ-SDE1-R1-007 AMZ-SDE1-R1-008 AMZ-SDE1-R1-009 AMZ-SDE1-R1-010 AMZ-SDE1-R2-001 AMZ-SDE1-R2-002 AMZ-SDE1-R2-003 AMZ-SDE1-R2-004 AMZ-SDE1-R3-001 AMZ-SDE1-R3-002 AMZ-SDE1-R3-003 AMZ-SDE1-R3-004 AMZ-SDE1-R4-001 CSC-SE-R1-012 CSC-SE-R1-013 CSC-SE-R1-014 CSC-SE-R1-017 CSC-SE-R1-018 CSC-SE-R1-019 CSC-SE-R1-020 CSC-SE-R2-012 DLT-SWE-R1-013 DLT-SWE-R1-014 DLT-SWE-R1-015 DLT-SWE-R2-001 DLT-SWE-R2-003 DLT-SWE-R2-004 GOO-STEP-R2-005 GOO-STEP-R3-004 GOO-STEP-R4-001 GOO-STEP-R4-003 GOO-SWE-R1-003 GOO-SWE-R1-005 GOO-SWE-R2-003 GOO-SWE-R2-004 GOO-SWE-R2-006 GOO-SWE-R3-003 GOO-SWE-R3-004 GOO-SWE-R3-005 GS-SWE-R1-001 GS-SWE-R1-002 GS-SWE-R1-003 GS-SWE-R2-001 GS-SWE-R2-002 GS-SWE-R2-003 GS-SWE-R2-004 GS-SWE-R2-005 GS-SWE-R2-006 GS-SWE-R2-008 GS-SWE-R2-009 GS-SWE-R2-010 GS-SWE-R3-013 IBM-ASE-R4-006 IBM-ASE-R4-007 INT-EMB-R2-001 INT-EMB-R2-002 INT-EMB-R2-003 INT-EMB-R2-004 INT-EMB-R2-005 INT-EMB-R2-006 INT-GTI-R2-001 INT-GTI-R2-002 JPM-SWE-R1-001 JPM-SWE-R2-001 JPM-SWE-R2-002 JPM-SWE-R2-003 JPM-SWE-R3-001 JPM-SWE-R3-003 MSF-SDE-R2-003 MSF-SDE-R4-007 NVD-SWE-R1-012 NVD-SWE-R2-001 NVD-SWE-R2-002 NVD-SWE-R2-003 NVD-SWE-R3-012 NVD-SWE-R3-013 ORA-ASD-R2-009 ORA-ASD-R2-010 ORA-ASD-R4-007 QCM-SWE-R2-009 QCM-SWE-R3-003 QCM-SWE-R3-004 QCM-VAL-R1-004 QCM-VAL-R3-001 SAP-AD-R1-008 SAP-AD-R1-009 SAP-AD-R3-002 SAP-AD-R3-004 ZOH-SD-R2-001 ZOH-SD-R2-002 ZOH-SD-R2-006 ZOH-SD-R2-007 ZOH-SD-R2-010 GS-SWE-R2-007 GOO-STEP-R2-001 GOO-STEP-R3-001 INT-GTI-R1-009 MSF-SDE-R1-006 ORA-ASD-R1-001 QCM-SWE-R3-001 SAP-AD-R3-001 GOO-SWE-R3-001 ZOH-SD-R3-004`.split(/\s+/);

const dataDir = path.join(__dirname, "..", "..", "docs", "interview-research", "data");
function jsonFiles(dir) {
  const out = [];
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...jsonFiles(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}
function codingQuestions() {
  const byId = new Map();
  for (const f of jsonFiles(dataDir)) {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const q of d.questions || []) if (q.question_type === "CODING") byId.set(q.question_id, q);
  }
  return [...byId.values()];
}

test("every generator belongs to a real coding question, and every master pending question has one", () => {
  const qs = codingQuestions();
  if (!qs.length) return;
  const ids = new Set(qs.map((q) => q.question_id));
  for (const id of Object.keys(MAP)) assert.ok(ids.has(id), `generator for unknown question ${id}`);
  for (const id of MASTER_PENDING) assert.ok(MAP[id], `no generator for ${id}`);
});

test("the reference solutions reproduce every visible sample of every question they cover", () => {
  for (const q of codingQuestions().filter((x) => MAP[x.question_id])) {
    const samples = visibleSamples(q.question_id, q.coding.samples.map((s) => ({ input: s.input, expected: s.output })));
    assert.deepEqual(checkSamples(q.question_id, samples), [], `${q.question_id} samples`);
  }
});

test("hidden tests build (reference agrees with brute force) with at least 5 distinct cases per question", () => {
  for (const q of codingQuestions().filter((x) => MAP[x.question_id])) {
    const { tests } = buildHiddenTests(q.question_id);
    assert.ok(tests.length >= 5, `${q.question_id} has ${tests.length}`);
    assert.ok(tests.every((t) => t.isHidden === true && typeof t.expected === "string" && t.expected.length > 0), `${q.question_id} malformed`);
  }
});

test("hidden tests are deterministic", () => {
  assert.equal(JSON.stringify(buildHiddenTests("INFY-SP-R1-001")), JSON.stringify(buildHiddenTests("INFY-SP-R1-001")));
  assert.equal(JSON.stringify(buildHiddenTests("AMZ-SDE1-R2-004")), JSON.stringify(buildHiddenTests("AMZ-SDE1-R2-004")));
  assert.ok(Object.keys(PROBLEMS).length > 90);
});

test("a question excludes inputs outside its own constraints", () => {
  const armstrong = buildHiddenTests("ZOH-SD-R2-001").tests.map((t) => t.input);
  assert.ok(!armstrong.includes("0"));
  assert.ok(buildHiddenTests("INFY-SE-R2-001").tests.map((t) => t.input).includes("0"), "the zero case is kept where n may be 0");
});

test("the centred pyramid sample is rewritten from the verified reference", () => {
  const fixed = visibleSamples("ZOH-SD-R2-007", [{ input: "3", expected: "*\n ***\n*****" }]);
  assert.equal(fixed[0].expected, "  *\n ***\n*****");
});
