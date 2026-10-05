// Regression check: a submission that never reads stdin, given a large input, must produce a normal
// verdict and must NOT raise a process-level uncaughtException (write EPIPE).
const fs = require("fs");
const { judgeSubmission } = require("../src/utils/judge");
const logFile = `/app/logs/app-${new Date().toISOString().slice(0, 10)}.log`;
const countEpipe = () => { try { return (fs.readFileSync(logFile, "utf8").match(/uncaughtException","message":"write EPIPE/g) || []).length; } catch { return 0; } };
(async () => {
  const before = countEpipe();
  let uncaught = 0;
  process.on("uncaughtException", () => { uncaught++; });
  const big = Array.from({ length: 200000 }, (_, i) => i).join(" ");
  const langs = { python: "print(1)\n", java: "public class Main { public static void main(String[] a){ System.out.println(1); } }", c: "#include <stdio.h>\nint main(){putchar(49);putchar(10);return 0;}" };
  let bad = 0;
  for (const [language, code] of Object.entries(langs)) {
    for (let i = 0; i < 5; i++) {
      const r = await judgeSubmission({ language, code, testCases: [{ input: big, expected: "1" }], evaluationType: "STDIO", timeLimitMs: 4000 });
      if (r.verdict !== "ACCEPTED") { bad++; console.log("FAIL", language, i, r.verdict); }
    }
  }
  await new Promise((r) => setTimeout(r, 500));
  const after = countEpipe();
  console.log(`non-ACCEPTED verdicts=${bad}, uncaughtExceptions seen=${uncaught}, EPIPE log lines before=${before} after=${after}`);
  console.log(bad === 0 && uncaught === 0 && after === before ? "JUDGE EPIPE FIX VERIFIED" : "PROBLEM REMAINS");
  process.exit(0);
})();
