// One-off: live verification that JUDGE_DROP_PRIVILEGES=true (currently set in production) is
// ACTUALLY dropping privileges for real, not just configured-and-unverified. Calls judgeSubmission()
// directly (same code path every real student submission uses) with probe programs designed to be
// informative without being destructive — no live fork bomb (RLIMIT_NPROC is read via resource.
// getrlimit(), never triggered by actually forking past it), no real exfiltration attempt beyond
// confirming a read is blocked.
const { judgeSubmission } = require("../src/utils/judge");

async function run(label, language, code) {
  const result = await judgeSubmission({ language, code, testCases: [{ input: "", expected: "__probe__" }], timeLimitMs: 5000 });
  const detail = result.details?.[0];
  console.log(`\n=== ${label} (${language}) ===`);
  console.log("verdict:", result.verdict, "| actual output:", JSON.stringify(detail?.actual ?? detail?.error));
}

async function main() {
  await run("UID/GID the process actually runs as", "python",
    "import os\nprint(os.getuid(), os.getgid())\n");

  await run("Read attempt: /app/.env (app secrets)", "python",
    "try:\n  print(open('/app/.env').read()[:30])\nexcept Exception as e:\n  print('BLOCKED:', e)\n");

  await run("Read attempt: /etc/shadow (root-only)", "python",
    "try:\n  print(open('/etc/shadow').read()[:30])\nexcept Exception as e:\n  print('BLOCKED:', e)\n");

  await run("Write attempt: outside tmp dir (/app)", "python",
    "try:\n  open('/app/pwned.txt','w').write('x')\n  print('WRITE ALLOWED')\nexcept Exception as e:\n  print('BLOCKED:', e)\n");

  await run("Network egress attempt", "python",
    "import socket\ntry:\n  s = socket.create_connection(('8.8.8.8', 53), timeout=3)\n  print('NETWORK ALLOWED')\nexcept Exception as e:\n  print('BLOCKED:', e)\n");

  await run("Process-count ulimit actually applied (read-only, no live fork)", "python",
    "import resource\nsoft, hard = resource.getrlimit(resource.RLIMIT_NPROC)\nprint('soft:', soft, 'hard:', hard)\n");

  await run("Legitimate correctness check (sanity — normal code still works)", "python",
    "print(2 + 2)\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
