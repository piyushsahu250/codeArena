#!/usr/bin/env node
/**
 * Mechanical documentation drift check for /docs.
 *
 * This does NOT use AI and does NOT rewrite prose. It only recomputes facts that can be
 * counted directly from the codebase (API endpoint count, Prisma model/enum count) and,
 * if they've drifted from what's recorded in docs/platform-manifest.json, updates that
 * manifest and appends a dated CHANGELOG.md entry flagging which prose docs need a human
 * (or AI-assisted, human-reviewed) pass. Run daily and on schema/route changes via
 * .github/workflows/docs-sync.yml — never claim this covers more than it does.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ROUTES_DIR = path.join(ROOT, "backend", "src", "routes");
const SCHEMA_PATH = path.join(ROOT, "backend", "prisma", "schema.prisma");
const MANIFEST_PATH = path.join(ROOT, "docs", "platform-manifest.json");
const CHANGELOG_PATH = path.join(ROOT, "docs", "CHANGELOG.md");

const ROUTE_RE = /^router\.(get|post|put|patch|delete)\(/;
const MODEL_RE = /^model \w/;
const ENUM_RE = /^enum \w/;

function countRoutes() {
  let total = 0;
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".js")) continue;
    const lines = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8").split("\n");
    total += lines.filter((l) => ROUTE_RE.test(l.trim())).length;
  }
  return total;
}

function countSchema() {
  const lines = fs.readFileSync(SCHEMA_PATH, "utf8").split("\n");
  return {
    models: lines.filter((l) => MODEL_RE.test(l)).length,
    enums: lines.filter((l) => ENUM_RE.test(l)).length,
  };
}

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`docSync: ${MANIFEST_PATH} not found, skipping.`);
    process.exit(0);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const actualApiCount = countRoutes();
  const actualSchema = countSchema();

  const recordedApiCount = manifest.apiCount;
  const recordedModelCount = manifest.databaseEntities && manifest.databaseEntities.modelCount;
  const recordedEnumCount = manifest.databaseEntities && manifest.databaseEntities.enumCount;

  const drift = [];
  if (actualApiCount !== recordedApiCount) {
    drift.push(
      `API endpoint count: ${recordedApiCount} -> ${actualApiCount} (review API_DOCUMENTATION.md)`
    );
  }
  if (actualSchema.models !== recordedModelCount) {
    drift.push(
      `Database model count: ${recordedModelCount} -> ${actualSchema.models} (review DATABASE.md, DATA_DICTIONARY.md)`
    );
  }
  if (actualSchema.enums !== recordedEnumCount) {
    drift.push(`Database enum count: ${recordedEnumCount} -> ${actualSchema.enums} (review DATABASE.md)`);
  }

  if (drift.length === 0) {
    console.log("docSync: no drift detected. Counts match platform-manifest.json.");
    process.exit(0);
  }

  console.log("docSync: drift detected:\n" + drift.map((d) => "  - " + d).join("\n"));

  manifest.apiCount = actualApiCount;
  manifest.databaseEntities = manifest.databaseEntities || {};
  manifest.databaseEntities.modelCount = actualSchema.models;
  manifest.databaseEntities.enumCount = actualSchema.enums;
  manifest.lastUpdated = todayUTC();
  manifest.platformRevision = manifest.platformRevision || {};
  manifest.platformRevision.backend = currentCommit();

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

  const entry = [
    `\n## ${todayUTC()} (auto-detected drift)`,
    ...drift.map((d) => `- ${d}`),
    "- This entry was generated mechanically by `scripts/docSync.js` (counts only — no AI involved, no prose rewritten).",
    "- Manual review needed: update the prose in the doc file(s) referenced above to describe what actually changed and why.",
    "",
  ].join("\n");

  fs.appendFileSync(CHANGELOG_PATH, entry);
  console.log("docSync: updated platform-manifest.json and appended a CHANGELOG.md entry.");
}

main();
