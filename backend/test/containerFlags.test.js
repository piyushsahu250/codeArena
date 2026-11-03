// REGRESSION (found 2026-11-03 on the live judge): the judge and API containers ran with no init process. A submission that forks leaves its killed children as zombies, and only PID 1 can
// reap them. PID 1 was the Node server, which never does, so ONE fork-bomb submission left 64 zombies owned by the sandbox user. They count against that user's process limit, so afterwards any
// program that started a thread failed ("can't start new thread") until the container was restarted, and about seven such submissions would have exhausted the container's pids-limit.
// docker run --init puts Docker's init (tini) at PID 1, which reaps them. This pins the flags on every container that can run student code, so a rewrite of the deploy script cannot drop them.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8").replace(/\r\n/g, "\n");
const script = read("scripts", "deploy-aws-host.sh");

// the text of one `docker run ...` command (with its backslash continuations) that sits inside the named shell function
function runCommandIn(fn) {
  const start = script.indexOf(`${fn}() {`);
  assert.ok(start >= 0, `${fn}() exists in the deploy script`);
  const body = script.slice(start, script.indexOf("\n}\n", start));
  const at = body.indexOf("docker run");
  assert.ok(at >= 0, `${fn}() starts a container with docker run`);
  const lines = []; for (const line of body.slice(at).split("\n")) { lines.push(line); if (!line.trimEnd().endsWith("\\")) break; }
  return lines.join(" ");
}

for (const [fn, what] of [["run_judge", "the judge container"], ["run_container", "the API container (it runs student code in-process when the judge is unreachable)"]]) {
  test(`${what} has an init process, the process cap and the network capability`, () => {
    const cmd = runCommandIn(fn);
    assert.match(cmd, /(^|\s)--init(\s|$)/, "--init, so the orphans of killed submissions are reaped");
    assert.match(cmd, /--pids-limit=512/, "the container-level fork cap");
    assert.match(cmd, /--cap-add=NET_ADMIN/, "the capability the sandbox's network rule needs");
    assert.ok(cmd.indexOf("--init") < cmd.indexOf("--env-file"), "an engine flag, placed before the image and its environment");
  });
}

test("the documented run command and its explanation carry --init as well", () => {
  const doc = read("docs", "DEPLOYMENT.md");
  assert.match(doc, /docker run -d --name codearena-backend --restart unless-stopped \\\n\s+--init \\/);
  assert.match(doc, /`--init`: \*\*required for the judge to stay usable/);
});

test("the deploy script is still valid shell around the change", () => {
  const { spawnSync } = require("node:child_process");
  const bash = spawnSync("bash", ["-n", path.join(__dirname, "..", "..", "scripts", "deploy-aws-host.sh")], { encoding: "utf8" });
  if (bash.error) return; // no bash on this machine
  assert.equal(bash.status, 0, bash.stderr);
});
