const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "schema-guard-summary.sh");
const DEPLOY = path.join(__dirname, "..", "..", "scripts", "deploy-aws-host.sh");
const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;
const run = (diff) => spawnSync("bash", [SCRIPT], { input: diff, encoding: "utf8" });

const TRGM = ["course_name", "question_description", "question_title", "test_title", "user_employeeid", "user_mobile", "user_name", "user_registrationnumber", "user_rollnumber"]
  .map((n) => `-- DropIndex\nDROP INDEX "${n}_trgm_idx";\n`).join("\n");

test("the nine managed trigram DROP INDEX statements are described as ignored trigram indexes, not as additive", { skip: !hasBash }, () => {
  const r = run(TRGM);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /9 DROP INDEX statement\(s\) for the managed trigram search indexes/);
  assert.match(r.stdout, /ignored by design/);
  assert.match(r.stdout, /executes nothing/);
  assert.match(r.stdout, /no other schema statements/);
  assert.doesNotMatch(r.stdout, /additive\/index only/);
});

test("other statements are counted separately from the trigram ones", { skip: !hasBash }, () => {
  const diff = `${TRGM}\n-- CreateTable\nCREATE TABLE "x" (\n  "id" TEXT NOT NULL,\n  CONSTRAINT "x_pkey" PRIMARY KEY ("id")\n);\n\n-- DropIndex\nDROP INDEX "some_other_idx";\n\n-- AlterTable\nALTER TABLE "y" ADD COLUMN "z" TEXT;\n`;
  const r = run(diff);
  assert.match(r.stdout, /9 DROP INDEX statement\(s\) for the managed trigram search indexes/);
  assert.match(r.stdout, /3 other statement\(s\)/, "a non-trigram DROP INDEX is NOT hidden among the ignored ones");
});

test("an empty diff reports no trigram line and no other statements", { skip: !hasBash }, () => {
  const r = run("");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no destructive changes/);
  assert.doesNotMatch(r.stdout, /trigram/);
  assert.match(r.stdout, /no other schema statements/);
});

test("the summary never exits non-zero (the deploy script runs under set -e)", { skip: !hasBash }, () => {
  for (const d of ["", TRGM, "garbage\n", "DROP INDEX \"a_trgm_idx\"\n"]) assert.equal(run(d).status, 0);
});

test("the deploy script's safety check is unchanged and still runs before the summary", () => {
  const src = fs.readFileSync(DEPLOY, "utf8");
  assert.ok(src.includes("DROP TABLE|DROP COLUMN|DROP TYPE|ALTER COLUMN .* TYPE"), "destructive pattern is intact");
  assert.ok(src.includes('ALLOW_DESTRUCTIVE_SCHEMA'), "the explicit override is intact");
  assert.ok(src.indexOf("DESTRUCTIVE=$(") < src.indexOf("schema-guard-summary.sh"), "the check precedes the summary");
  assert.ok(!src.includes("additive/index only"), "the misleading wording is gone");
});
