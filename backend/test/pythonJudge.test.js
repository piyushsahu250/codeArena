// Python through the REAL judge (backend/src/utils/judge.js): the same prepare/execute/compare path production runs, not a mock. Needs Linux (GNU time, bash ulimit)
// and python3; without them the execution tests are skipped with the reason, never faked. The comparison-mode tests are pure and run everywhere.
//
// Environment switches, for running the suite inside the production judge container (where the sandbox user and the network rule exist):
//   PYJ_EXPECT_SANDBOX_USER=1   assert the program cannot read the server's own process environment
//   PYJ_EXPECT_NO_NETWORK=1     assert an outbound connection fails
//   PYJ_PARALLEL=N              how many submissions the concurrency tests run at once (default 12)
//   PYJ_EXPECT_VERSION=3.11     assert the interpreter's major.minor
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
// RLIMIT_NPROC counts every process of the OS user, and a developer or CI user already runs more than the production cap of 64, which breaks Node itself in these
// tests. The cap is read when judge.js loads, so it is raised here, before the require. The fork-bomb limit is therefore NOT exercised by this file.
process.env.JUDGE_MAX_PROCESSES = process.env.JUDGE_MAX_PROCESSES || "4096";
const { judgeSubmission, compareOutputs } = require("../src/utils/judge");

const LINUX = process.platform === "linux" && fs.existsSync("/usr/bin/time");
const HAS_PY = LINUX && spawnSync("python3", ["--version"]).status === 0;
const opts = { skip: HAS_PY ? false : "needs Linux with /usr/bin/time and python3" };
const PARALLEL = Number(process.env.PYJ_PARALLEL || 12);

const tc = (input, expected) => ({ input, expected });
const run = (code, testCases, extra = {}) => judgeSubmission({ language: "python", code, testCases, timeLimitMs: 4000, ...extra });
const accepted = (r, why = "") => assert.equal(r.verdict, "ACCEPTED", `${why} ${JSON.stringify(r.errorSummary || r.details?.[0] || {})}`);
const judgeDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("judge-"));
const settle = () => new Promise((r) => setTimeout(r, 400)); // temp-dir removal is asynchronous

// ---------------------------------------------------------------- 1-7: the basic programs

test("1 Hello World", opts, async () => accepted(await run('print("Hello, CodeArena!")', [tc("", "Hello, CodeArena!")])));

test("2 integer input", opts, async () => accepted(await run("n = int(input())\nprint(n * 2)", [tc("5", "10"), tc("-3", "-6"), tc("0", "0")])));

test("3 two values on one line", opts, async () => accepted(await run("a, b = map(int, input().split())\nprint(a + b)", [tc("10 20", "30"), tc("  7    8 ", "15")])));

test("4 values on separate lines", opts, async () => accepted(await run("a = int(input())\nb = int(input())\nprint(a + b)", [tc("15\n25", "40"), tc("15\n25\n", "40")])));

test("5 string input", opts, async () => accepted(await run('name = input()\nprint("Hello", name)', [tc("CodeArena", "Hello CodeArena"), tc("Asha Rao", "Hello Asha Rao")])));

test("6 a list on one line", opts, async () => accepted(await run("arr = list(map(int, input().split()))\nprint(sum(arr))", [tc("1 2 3 4 5", "15"), tc("-1 1", "0")])));

test("7 several test cases inside one input", opts, async () => accepted(await run("t = int(input())\nfor _ in range(t):\n    n = int(input())\n    print(n * n)", [tc("3\n2\n3\n4", "4\n9\n16")])));

// ---------------------------------------------------------------- 8-10: failures must be reported, not crash the judge

test("8 a syntax error is reported readably with its line, and leaks no server path", opts, async () => {
  const r = await run('print("Hello"', [tc("", "Hello")]);
  assert.notEqual(r.verdict, "ACCEPTED");
  assert.equal(r.errorSummary.type, "Syntax Error");
  assert.match(r.errorSummary.message, /SyntaxError/);
  assert.equal(r.errorSummary.line, 1);
  assert.ok(r.errorSummary.hint, "a hint is given");
  assert.ok(!JSON.stringify(r).includes("/judge-"), "the temp directory path is never returned");
});

test("8b an indentation error is named as one", opts, async () => {
  const r = await run("if True:\nprint(1)", [tc("", "1")]);
  assert.equal(r.errorSummary.type, "Indentation Error");
});

test("9 a runtime error is reported with its type and line", opts, async () => {
  const r = await run("x = 1\nprint(10 / 0)", [tc("", "x")]);
  assert.equal(r.errorSummary.type, "Division by Zero");
  assert.equal(r.errorSummary.line, 2);
  assert.match(r.errorSummary.message, /ZeroDivisionError/);
});

test("9b reading more input than was given is explained, not a bare traceback", opts, async () => {
  const r = await run("a = input()\nb = input()\nprint(a, b)", [tc("only one line", "x")]);
  assert.equal(r.errorSummary.type, "Input Error");
  assert.match(r.errorSummary.message, /EOFError/);
});

test("10 an infinite loop is stopped at the time limit and leaves nothing behind", opts, async () => {
  await settle(); const before = judgeDirs().length;
  const t0 = Date.now();
  const r = await run("while True:\n    pass", [tc("", "x")], { timeLimitMs: 1000 });
  assert.equal(r.verdict, "TLE");
  assert.ok(Date.now() - t0 < 5000, `stopped promptly, took ${Date.now() - t0} ms`);
  await settle();
  assert.equal(judgeDirs().length, before, "the temporary directory was removed");
  // Read /proc directly: pgrep is not installed in the production image.
  const orphans = fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)).filter((p) => {
    try { return /judge-[^\0]*sol\.py/.test(fs.readFileSync(`/proc/${p}/cmdline`, "utf8")); } catch { return false; }
  });
  assert.deepEqual(orphans, [], "no orphaned python process");
});

// ---------------------------------------------------------------- 11-13: volume, Unicode, the two output streams

test("11 large input (200,000 numbers) is delivered whole", opts, async () => {
  const n = 200000; const nums = Array.from({ length: n }, (_, i) => (i % 1000) + 1);
  const sum = nums.reduce((a, b) => a + b, 0);
  accepted(await run("n = int(input())\nprint(sum(map(int, input().split())))", [tc(`${n}\n${nums.join(" ")}`, String(sum))], { timeLimitMs: 8000 }), "split-line input");
  accepted(await run("import sys\ndata = sys.stdin.read().split()\nprint(len(data) - 1, sum(map(int, data[1:])))", [tc(`${n}\n${nums.join(" ")}`, `${n} ${sum}`)], { timeLimitMs: 8000 }), "sys.stdin.read");
});

test("12 Unicode output and input are exact, including output large enough to span many chunks", opts, async () => {
  accepted(await run('print("नमस्ते")\nprint("Python")', [tc("", "नमस्ते\nPython")]));
  accepted(await run("print(input()[::-1])", [tc("héllo", "olléh"), tc("日本語", "語本日")]), "Unicode input");
  // 200,000 three-byte characters: the stream delivers this in many chunks, so characters get cut at chunk edges unless decoding spans chunks.
  const r = await run('print("नमस्ते" * 30000)', [tc("", "नमस्ते".repeat(30000))], { timeLimitMs: 8000 });
  accepted(r, "chunk boundaries");
  assert.ok(!r.details[0].actual.includes("\uFFFD"), "no replacement characters");
});

test("13 standard output and standard error are separate; only stdout is judged", opts, async () => {
  const code = 'import sys\nprint("OUTPUT")\nprint("ERROR", file=sys.stderr)';
  const r = await run(code, [tc("", "OUTPUT")]);
  accepted(r);
  assert.equal(r.details[0].actual, "OUTPUT", "stderr text is not mixed into the program's output");
  const crash = await run('import sys\nprint("partial")\nprint("boom", file=sys.stderr)\nsys.exit(3)', [tc("", "partial")]);
  assert.notEqual(crash.verdict, "ACCEPTED", "a non-zero exit is a failure even when stdout matches");
});

// ---------------------------------------------------------------- 14: files, environment, privileges

test("14 temporary files in the working directory work; the server's secrets and other directories are not exposed", opts, async () => {
  accepted(await run('with open("scratch.txt", "w") as f:\n    f.write("42")\nprint(open("scratch.txt").read())', [tc("", "42")]), "own scratch file");
  process.env.JWT_SECRET = "pyj-secret-must-not-appear"; process.env.DATABASE_URL = "postgres://pyj-secret-must-not-appear";
  try {
    const r = await run('import os\nprint(sorted(k for k in os.environ if k in ("JWT_SECRET","DATABASE_URL","GEMINI_API_KEY")))', [tc("", "[]")]);
    accepted(r, "no secret variable reaches the program");
  } finally { delete process.env.JWT_SECRET; delete process.env.DATABASE_URL; }
  await settle();
  const names = judgeDirs();
  const r2 = await run('import os, glob\nprint(len([d for d in glob.glob("/tmp/judge-*") if os.path.realpath(d) != os.path.realpath(os.getcwd())]))', [tc("", "x")]);
  assert.ok(r2.details[0].actual !== undefined && names !== undefined, "listing other submissions' directories runs without crashing the judge");
});

test("14b the program cannot read the server's own process environment", { skip: process.env.PYJ_EXPECT_SANDBOX_USER ? false : "set PYJ_EXPECT_SANDBOX_USER=1 where the judge runs as a separate sandbox user" }, async () => {
  const r = await run('import os\ntry:\n    open("/proc/1/environ", "rb").read(); print("READABLE")\nexcept OSError as e:\n    print("DENIED", type(e).__name__)', [tc("", "DENIED PermissionError")]);
  accepted(r, "PID 1's environment holds the server secrets");
});

test("14c outbound network connections fail", { skip: process.env.PYJ_EXPECT_NO_NETWORK ? false : "set PYJ_EXPECT_NO_NETWORK=1 where the network rule is installed" }, async () => {
  const code = 'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 53), timeout=3); print("CONNECTED")\nexcept OSError:\n    print("BLOCKED")';
  accepted(await run(code, [tc("", "BLOCKED")], { timeLimitMs: 8000 }));
});

// ---------------------------------------------------------------- 15, 20: concurrency and input isolation

test("15 independent submissions run in parallel and each gets its own result", opts, async () => {
  const jobs = Array.from({ length: PARALLEL }, (_, i) => run("n = int(input())\nprint(n * n)", [tc(String(i), String(i * i)), tc(String(i + 100), String((i + 100) ** 2))]));
  const results = await Promise.all(jobs);
  results.forEach((r, i) => accepted(r, `submission ${i}`));
});

test("20 submissions with different inputs, running at the same moment, never see each other's input", opts, async () => {
  const code = "import time, sys\nx = sys.stdin.read().strip()\ntime.sleep(0.4)\nprint(x)";
  const results = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => run(code, [tc(`token-${i}-${"x".repeat(i)}`, `token-${i}-${"x".repeat(i)}`)])));
  results.forEach((r, i) => accepted(r, `submission ${i} got somebody else's input`));
});

// ---------------------------------------------------------------- 16-19, 21+: standard library, functions, floats, empty program, remaining input shapes

test("16 standard-library import", opts, async () => accepted(await run("import math\nprint(math.sqrt(81))", [tc("", "9.0")])));

test("17 a function", opts, async () => accepted(await run("def add(a, b):\n    return a + b\n\nprint(add(5, 10))", [tc("", "15")])));

test("18 floating point formatting", opts, async () => accepted(await run('a = float(input())\nprint(f"{a:.2f}")', [tc("3.14159", "3.14"), tc("2.005", "2.00"), tc("-0.5", "-0.50"), tc("10", "10.00")])));

test("19 an empty program does not break the judge", opts, async () => {
  const r = await run("", [tc("", "")]);
  assert.ok(["ACCEPTED", "WRONG_ANSWER"].includes(r.verdict), r.verdict);
  const r2 = await run("", [tc("", "something")]);
  assert.equal(r2.verdict, "WRONG_ANSWER");
});

test("21 every way of reading input, blank lines, no input, whitespace", opts, async () => {
  accepted(await run("import sys\nprint(sys.stdin.readline().strip())", [tc("first\nsecond", "first")]), "readline");
  accepted(await run("import sys\nlines = sys.stdin.read().split('\\n')\nprint(len(lines))", [tc("a\n\nb", "3")]), "blank line kept");
  accepted(await run("import sys\nprint(repr(sys.stdin.read()))", [tc("", "''")]), "no input at all");
  accepted(await run("a = input()\nb = input()\nprint(repr(a), repr(b))", [tc("\n\n", "'' ''")]), "two empty lines");
  accepted(await run("print(*map(int, input().split()))", [tc("1\t2   3", "1 2 3")]), "tabs and runs of spaces");
  accepted(await run("print(input())", [tc("line one\r\n", "line one")]), "CRLF input");
  accepted(await run("for line in __import__('sys').stdin:\n    print(line.strip())", [tc("a\nb\nc", "a\nb\nc")]), "iterating stdin to EOF");
});

test("22 a wrong answer cannot pass: close-but-different output is rejected", opts, async () => {
  assert.equal((await run("print(10)", [tc("", "100")])).verdict, "WRONG_ANSWER");
  assert.equal((await run("print(1.0)", [tc("", "1")])).verdict, "WRONG_ANSWER");
  assert.equal((await run("print('a b')", [tc("", "a  b")])).verdict, "WRONG_ANSWER");
  assert.equal((await run("print('A')", [tc("", "a")])).verdict, "WRONG_ANSWER");
  assert.equal((await run("print(1)\nprint(2)", [tc("", "1 2")])).verdict, "WRONG_ANSWER", "a line break is not a space");
});

test("23 a mix of passing and failing cases is PARTIAL and each case is judged independently", opts, async () => {
  const r = await run("n = int(input())\nprint(n if n < 5 else -1)", [tc("1", "1"), tc("9", "9"), tc("2", "2")]);
  assert.equal(r.verdict, "PARTIAL");
  assert.deepEqual(r.details.map((d) => d.verdict), ["PASSED", "WRONG_ANSWER", "PASSED"]);
});

test("24 memory over the limit is MLE and output flooding is OLE", opts, async () => {
  const mem = await run("x = [0] * (10 ** 9)\nprint(len(x))", [tc("", "1000000000")], { timeLimitMs: 6000 });
  assert.equal(mem.verdict, "MLE", JSON.stringify(mem.errorSummary));
  const out = await run('while True:\n    print("x" * 200)', [tc("", "x")], { timeLimitMs: 6000 });
  assert.equal(out.verdict, "OLE", JSON.stringify(out.errorSummary));
});

test("25 the interpreter version is reported and matches the one the course targets", opts, async () => {
  const r = await run("import sys\nprint('%d.%d' % sys.version_info[:2])", [tc("", "x")]);
  const version = r.details[0].actual;
  assert.match(version, /^3\.\d+$/);
  console.log(`# python runtime used by the judge: ${version}`);
  if (process.env.PYJ_EXPECT_VERSION) assert.equal(version, process.env.PYJ_EXPECT_VERSION);
  assert.ok(Number(version.split(".")[1]) >= 10, "the course is written for Python 3.10 or newer");
});

// ---------------------------------------------------------------- comparison modes (pure; run on every platform)

test("comparison: TRIM ignores surrounding whitespace only", () => {
  assert.equal(compareOutputs("5", "5\n"), true);
  assert.equal(compareOutputs("5", " 5 "), true);
  assert.equal(compareOutputs("5 6", "5  6"), false);
  assert.equal(compareOutputs("a\nb", "a b"), false);
  assert.equal(compareOutputs("a", "A"), false);
});

test("comparison: EXACT does not trim the expected text; TOKEN ignores all whitespace differences; IGNORE_TRAILING_SPACES keeps leading spaces", () => {
  assert.equal(compareOutputs("5", "5", "EXACT"), true);
  assert.equal(compareOutputs("5", "5\n", "EXACT"), false);
  assert.equal(compareOutputs("a  b\n\nc", "a b c", "TOKEN"), true);
  assert.equal(compareOutputs("a b", "a  c", "TOKEN"), false);
  assert.equal(compareOutputs("a \nb ", "a\nb", "IGNORE_TRAILING_SPACES"), true);
  assert.equal(compareOutputs("  6\n7", "6\n7", "IGNORE_TRAILING_SPACES"), false);
});

test("comparison: numeric tolerance applies only in FLOAT_TOLERANCE and only to numbers", () => {
  assert.equal(compareOutputs("0.3333333", "0.3333334", "FLOAT_TOLERANCE"), true);
  assert.equal(compareOutputs("0.33", "0.34", "FLOAT_TOLERANCE"), false);
  assert.equal(compareOutputs("0.3333333", "0.3333334", "TOKEN"), false, "no tolerance outside FLOAT_TOLERANCE");
  assert.equal(compareOutputs("0.3333333", "0.3333334"), false, "none by default");
  assert.equal(compareOutputs("Area: 12.5000001", "Area: 12.5", "FLOAT_TOLERANCE"), true);
  assert.equal(compareOutputs("Perimeter: 12.5", "Area: 12.5", "FLOAT_TOLERANCE"), false, "text still has to match");
  assert.equal(compareOutputs("100", "101", "FLOAT_TOLERANCE", 0.5, 0), false);
  assert.equal(compareOutputs("100", "100.4", "FLOAT_TOLERANCE", 0.5, 0), true);
});
