// One-off: bounded, self-limiting proof that --pids-limit=512 (container-level, cgroup-enforced)
// actually stops excessive process creation — not an unbounded fork bomb. The loop below tries to
// spawn 600 short-lived child processes (more than the 512 limit) and simply counts how many
// succeeded vs failed with a resource error, then exits — every spawned child is `true` (exits
// immediately), so there is no accumulation risk even in the failure-to-protect case.
const { judgeSubmission } = require("../src/utils/judge");

async function main() {
  const code =
    "import subprocess, sys\n" +
    "ok, failed = 0, 0\n" +
    "procs = []\n" +
    "try:\n" +
    "  for i in range(600):\n" +
    "    try:\n" +
    "      p = subprocess.Popen(['true'])\n" +
    "      procs.append(p)\n" +
    "      ok += 1\n" +
    "    except OSError as e:\n" +
    "      failed += 1\n" +
    "      break\n" +
    "finally:\n" +
    "  for p in procs:\n" +
    "    try: p.wait(timeout=2)\n" +
    "    except Exception: pass\n" +
    "print('spawned_ok:', ok, 'failed_at:', failed)\n";
  const result = await judgeSubmission({ language: "python", code, testCases: [{ input: "", expected: "__probe__" }], timeLimitMs: 15000 });
  console.log("verdict:", result.verdict);
  console.log("output:", JSON.stringify(result.details?.[0]?.actual ?? result.details?.[0]?.error));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
