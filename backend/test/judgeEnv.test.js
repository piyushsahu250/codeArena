// The environment handed to sandboxed student programs. REGRESSION: it passed the server's own HOME (/root in production). The dropped-privilege sandbox user cannot read
// /root, so the wrapper shell printed "/root/.bashrc: Permission denied" first on every run, and that line became the headline of Java runtime errors and C crashes.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

test("the sandbox gets the temp dir as HOME, whatever HOME the server runs with", () => {
  const judgePath = path.join(__dirname, "..", "src", "utils", "judge.js").replace(/\\/g, "/");
  const run = (home) => spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(judgePath)}).JUDGE_ENV))`], {
    env: { ...process.env, HOME: home, JWT_SECRET: "should-not-appear", DATABASE_URL: "postgres://should-not-appear" }, encoding: "utf8",
  });
  for (const home of ["/root", "/home/server-user-private", "C:\\Users\\someone"]) {
    const r = run(home);
    assert.equal(r.status, 0, r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.HOME, os.tmpdir(), `server HOME ${home} must not reach the sandbox`);
    assert.ok(!JSON.stringify(env).includes(home), "the server's home path appears nowhere in the sandbox environment");
  }
});

test("the sandbox environment stays a short whitelist and carries no secrets", () => {
  const r = spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(__dirname, "..", "src", "utils", "judge.js").replace(/\\/g, "/"))}).JUDGE_ENV))`], {
    env: { ...process.env, JWT_SECRET: "should-not-appear", DATABASE_URL: "postgres://should-not-appear", GEMINI_API_KEY: "should-not-appear" }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const env = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"]);
  assert.ok(!/should-not-appear/.test(r.stdout));
});
