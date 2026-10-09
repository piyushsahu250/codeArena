const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { validateFile, mapQuestion, planImport, summarize, minConfidence } = require("../src/utils/interviewResearchImport");

const base = () => ({
  schema_version: "codearena-interview-import/1",
  research: { company: "Acme", role: "Engineer", experience_level: "FRESHER", hiring_region: "India", researched_on: "2026-10-09", researcher: "tester", limitations: [] },
  sources: [
    { source_id: "S1", kind: "JOB_DESCRIPTION", url: "https://acme.test/jd", title: "JD", published_on: "2026-08" },
    { source_id: "S2", kind: "CANDIDATE_REPORT", url: "https://blog.test/a", title: "Report", published_on: "2026-09-07" },
  ],
  rounds: [{ round_id: "R1", name: "Technical", category: "CORE_TECHNICAL", evidence: "REPORTED", source_ids: ["S2"] }],
  questions: [
    { question_id: "ACME-R1-001", round_id: "R1", topic: "Java", subtopic: "JVM", question_type: "TECHNICAL", difficulty: "EASY", prompt: "Explain how the garbage collector reclaims memory in Java.", relevance_to_role: "x", evidence_class: "B_CANDIDATE_REPORTED", source_ids: ["S2"], times_reported: 1, verification_status: "UNVERIFIED", confidence: "HIGH", originality_status: "PARAPHRASED", expected_answer: "Unreachable objects are collected.", rubric: [{ criterion: "a", weight: 5 }], key_concepts: ["GC"], follow_ups: [], common_mistakes: [], suggested_time_min: 4, tags: ["java"] },
  ],
});

test("a valid file passes and maps to a pending-draft payload", () => {
  const d = base();
  assert.deepEqual(validateFile(d, "ACME.json").errors, []);
  const p = mapQuestion(d, d.questions[0], "ACME.json");
  assert.equal(p.category, "TECHNICAL");
  assert.equal(p.sourceType, "PUBLIC_INTERVIEW_REPORT");
  assert.equal(p.roundName, "Technical");
  assert.equal(p.importKey, "codearena-interview-import/1:ACME-R1-001");
  assert.equal(p.confidenceLevel, "MEDIUM", "a single candidate report can never exceed MEDIUM");
  assert.equal(p.sourceUrl, "https://blog.test/a");
  assert.equal(p.sourceDate.toISOString().slice(0, 10), "2026-09-07");
});

test("placeholder and example files are rejected", () => {
  const d = base();
  d.research.company = "ExampleCorp";
  assert.ok(validateFile(d, "x.json").errors[0].includes("placeholder"));
  assert.ok(validateFile(base(), "EXAMPLE__x.json").errors[0].includes("placeholder"));
});

test("evidence rules: practice cannot cite sources, A/B/C need one, VERIFIED needs support", () => {
  const d = base();
  d.questions[0].evidence_class = "D_PRACTICE";
  assert.ok(validateFile(d).errors.some((e) => e.includes("practice question cannot cite")));
  const e = base();
  e.questions[0].source_ids = [];
  assert.ok(validateFile(e).errors.some((x) => x.includes("needs a source")));
  const v = base();
  v.questions[0].verification_status = "VERIFIED";
  assert.ok(validateFile(v).errors.some((x) => x.includes("VERIFIED")));
});

test("practice and JD-inferred questions are capped at LOW confidence", () => {
  assert.equal(minConfidence("HIGH", "LOW"), "LOW");
  const d = base();
  d.questions[0].evidence_class = "C_INFERRED_FROM_JD";
  d.questions[0].source_ids = ["S1"];
  assert.equal(mapQuestion(d, d.questions[0], "f").confidenceLevel, "LOW");
});

test("re-running is idempotent and an unchanged import is skipped", () => {
  const d = base();
  const first = planImport([{ fileName: "f.json", data: d }], []);
  assert.deepEqual(summarize(first), { CREATE_PENDING_DRAFT: 1 });
  const p = first[0].payload;
  const existing = [{ id: "d1", kind: "draft", status: "PENDING", prompt: p.prompt, importKey: p.importKey, importHash: first[0].hash }];
  assert.deepEqual(summarize(planImport([{ fileName: "f.json", data: d }], existing)), { SKIP_ALREADY_IMPORTED: 1 });
});

test("changed content updates a pending draft but never touches a reviewed one", () => {
  const d = base();
  const first = planImport([{ fileName: "f.json", data: d }], []);
  const p = first[0].payload;
  d.questions[0].prompt = "Describe the generational garbage collection strategy used by the JVM.";
  const pend = [{ id: "d1", kind: "draft", status: "PENDING", prompt: p.prompt, importKey: p.importKey, importHash: first[0].hash }];
  assert.deepEqual(summarize(planImport([{ fileName: "f.json", data: d }], pend)), { UPDATE_PENDING_DRAFT: 1 });
  const done = [{ id: "d1", kind: "draft", status: "APPROVED", prompt: p.prompt, importKey: p.importKey, importHash: first[0].hash }];
  assert.deepEqual(summarize(planImport([{ fileName: "f.json", data: d }], done)), { NEEDS_REVISION_REVIEW: 1 });
});

test("a near-duplicate of an existing question is flagged, not imported", () => {
  const existing = [{ id: "q9", kind: "question", status: "live", company: "Acme", prompt: "Explain how the garbage collector reclaims memory in Java" }];
  const rows = planImport([{ fileName: "f.json", data: base() }], existing);
  assert.equal(rows[0].action, "POSSIBLE_DUPLICATE");
});

test("the audited TCS files validate and map without errors", () => {
  const dir = path.join(__dirname, "..", "..", "docs", "interview-research", "data", "tcs");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({ fileName: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
  assert.equal(files.length, 3);
  const rows = planImport(files, []);
  assert.equal(rows.filter((r) => r.action === "FILE_REJECTED").length, 0, JSON.stringify(rows.filter((r) => r.action === "FILE_REJECTED")));
  const counts = summarize(rows);
  const total = (counts.CREATE_PENDING_DRAFT || 0) + (counts.POSSIBLE_DUPLICATE || 0);
  assert.equal(total, 50);
  assert.ok(rows.filter((r) => r.payload).every((r) => r.payload.category && r.payload.importKey));
});
