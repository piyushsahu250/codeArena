const test = require("node:test");
const assert = require("node:assert");
const { detectAppRestriction, probeBlocked, buildCapabilities } = require("../lib/attest");

// Fake child_process.execFile: returns the mapped output when the command line contains the key, otherwise fails.
const fakeExec = (map) => (cmd, args, opts, cb) => {
  const key = `${cmd} ${args.join(" ")}`;
  const hit = Object.entries(map).find(([k]) => key.includes(k));
  if (hit && hit[1] !== null) cb(null, hit[1]);
  else cb(new Error("not found"), "");
};

test("AppLocker counts only when the service runs AND rules exist", async () => {
  const on = await detectAppRestriction({ exec: fakeExec({ "sc query appidsvc": "STATE : 4 RUNNING", "SrpV2\\Exe": "ok" }) });
  assert.ok(on.ok && on.appLocker);
  const noRules = await detectAppRestriction({ exec: fakeExec({ "sc query appidsvc": "STATE : 4 RUNNING", "SrpV2\\Exe": null, "AssignedAccessConfiguration": null, "Winlogon\\AssignedAccess": null }) });
  assert.ok(!noRules.ok);
  const stopped = await detectAppRestriction({ exec: fakeExec({ "sc query appidsvc": "STATE : 1 STOPPED", "SrpV2\\Exe": "ok", "AssignedAccessConfiguration": null, "Winlogon\\AssignedAccess": null }) });
  assert.ok(!stopped.ok);
});

test("Assigned Access alone is enough for application restriction", async () => {
  const r = await detectAppRestriction({ exec: fakeExec({ "sc query appidsvc": "STATE : 1 STOPPED", "SrpV2\\Exe": null, "AssignedAccessConfiguration": "ok" }) });
  assert.ok(r.ok && r.assignedAccess);
});

test("network probe: unreachable canary = blocked (good), reachable = not blocked", async () => {
  assert.strictEqual(await probeBlocked(["https://x"], async () => { throw new Error("blocked"); }), true);
  assert.strictEqual(await probeBlocked(["https://x"], async () => ({ ok: true })), false);
});

test("capabilities are derived from real state, never assumed", async () => {
  const caps = await buildCapabilities({ window: { isKiosk: () => true, isFullScreen: () => true }, config: { networkAttest: "client" }, platform: "linux" });
  assert.strictEqual(caps.kiosk, true);
  assert.strictEqual(caps.appRestriction, false, "non-Windows cannot attest application restriction");
  assert.strictEqual(caps.screenCaptureProtection, false, "non-Windows cannot attest capture protection");
  const notKiosk = await buildCapabilities({ window: { isKiosk: () => false, isFullScreen: () => false }, config: { networkAttest: "client" }, platform: "linux" });
  assert.strictEqual(notKiosk.kiosk, false);
  assert.strictEqual(notKiosk.fullscreen, false);
});
