// Follow-up probe: is the ulimit gap isolated to RLIMIT_NPROC, or systemic (memory/CPU limits
// also not actually applying despite being in the shell command chain)? Read-only checks, no live
// fork/OOM/CPU-burn triggered.
const { judgeSubmission } = require("../src/utils/judge");

async function run(label, code) {
  const result = await judgeSubmission({ language: "python", code, testCases: [{ input: "", expected: "__probe__" }], timeLimitMs: 5000 });
  console.log(`\n=== ${label} ===`);
  console.log("actual output:", JSON.stringify(result.details?.[0]?.actual ?? result.details?.[0]?.error));
}

async function main() {
  await run("All rlimits as seen inside the process",
    "import resource\n" +
    "for name in ['RLIMIT_NPROC','RLIMIT_AS','RLIMIT_CPU','RLIMIT_FSIZE','RLIMIT_NOFILE']:\n" +
    "  try:\n" +
    "    val = resource.getrlimit(getattr(resource, name))\n" +
    "    print(name, val)\n" +
    "  except Exception as e:\n" +
    "    print(name, 'ERROR', e)\n");

  await run("Actual memory allocation attempt (should hit MLE if ulimit -v is real)",
    "x = bytearray(500 * 1024 * 1024)\n" + // 500MB, above the 256MB default MEMORY_LIMIT_KB
    "print('ALLOCATED', len(x))\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
