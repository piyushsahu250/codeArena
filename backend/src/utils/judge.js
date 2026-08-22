/**
 * Lightweight code judge for JavaScript, Python, C, C++, and Java.
 *
 * IMPORTANT (production note):
 * Running arbitrary student-submitted code with plain child_process is NOT
 * sufficiently secure for a real, internet-facing deployment — students could
 * attempt filesystem access, network calls, fork bombs, etc. For production,
 * replace this module with a call to a hardened sandbox such as:
 *   - Judge0 (self-hosted or RapidAPI) — https://judge0.com
 *   - A per-submission Docker/gVisor/firecracker container with strict
 *     CPU/memory/network limits
 * This implementation is a functional reference for local development and
 * demos, using OS-level timeouts and resource limits as a minimum safeguard.
 *
 * C/C++/Java require their toolchains (gcc, g++, javac/java) to be present
 * wherever this runs — see backend/Dockerfile.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { mapWithConcurrency } = require("./queue");
const { wrapFunctionCode, looksLikeFullProgram } = require("./functionHarness");
const { judgeSqlSubmission } = require("./sqlJudge");

// Node's child_process.spawn inherits the FULL parent environment by default when no `env`
// option is given — that meant every compiled/executed student submission ran with
// JWT_SECRET/DATABASE_URL/ANTHROPIC_API_KEY/mailer credentials sitting right there in its
// process environment, readable by trivially printing it (`print(os.environ)`,
// `System.getenv()`, `getenv()`, etc.) and returned straight back to the student in the /run
// endpoints' response (unlike /submit paths, which strip raw output). Whitelisting to exactly
// what a compiler/interpreter actually needs to run closes this at the source, regardless of
// what the submitted code does or which endpoint returns the output.
const JUDGE_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME || os.tmpdir(),
  LANG: process.env.LANG || "C.UTF-8",
  LC_ALL: process.env.LC_ALL || "C.UTF-8",
  TMPDIR: os.tmpdir(),
};

const CASE_CONCURRENCY = Number(process.env.JUDGE_CASE_CONCURRENCY || 2);
const MEMORY_LIMIT_KB = Number(process.env.JUDGE_MEMORY_LIMIT_KB || 262144); // 256 MB default
// Compilation budget — separate from and typically larger than any single test case's own
// timeLimitMs, since it's a one-time cost per submission (not per case) and, per this file's own
// queue.js, this instance is confirmed (Render dashboard, Settings -> Instance Type) to be running
// on the actual Free plan: 0.1 CPU / 512MB, with no payment method on file to upgrade it. A cold
// `javac`/`gcc` invocation on that little CPU — especially with JUDGE_CONCURRENCY (default 2)
// submissions compiling at once and competing for the same fractional core — routinely took longer
// than the original 10s budget, which misreported perfectly valid, simple student code as
// "Compilation timed out" (first observed live during a real classroom assessment on trivially
// small Java code). Raising this alone from 10s to 30s (an earlier change) did NOT fix it — the
// same failure reproduced again on equally trivial code — because the timeout was never the actual
// bottleneck, the instance's fractional CPU is. This second bump to 45s plus the javac JVM-startup
// flags below (TieredStopAtLevel=1, Xshare:auto) are mitigations, not a real fix: the durable fix is
// a paid Render instance with a real CPU allocation. Still configurable per-deployment without a
// code change.
const COMPILE_TIMEOUT_MS = Number(process.env.JUDGE_COMPILE_TIMEOUT_MS || 45000);
// Caps the number of processes/threads a single submission can hold open — the concrete,
// well-understood defense against a fork bomb (`while(1) fork();` / infinite thread spawn)
// hanging the whole instance. Generous enough for legitimate multi-threaded submissions.
//
// KNOWN LIMITATION (mitigated, see DROP_PRIVILEGES below): by default this container still runs
// everything as root (no USER directive in the Dockerfile's final stage), and Linux lets a
// process holding CAP_SYS_RESOURCE (which root has) exceed RLIMIT_NPROC entirely — so this ulimit
// alone does not stop a fork bomb run as root. The fix — spawning both compile and execute as a
// dedicated non-root `sandbox` uid/gid — exists below, gated behind JUDGE_DROP_PRIVILEGES (off by
// default) until it's been verified against the real deployed container. ulimit -v (memory) is
// unaffected by this gap either way; it's enforced via a separate kernel mechanism root doesn't
// bypass.
const MAX_PROCESSES = Number(process.env.JUDGE_MAX_PROCESSES || 64);
// Caps total accumulated stdout+stderr per run — without this, a fast infinite print loop can
// buffer unbounded output in this Node process's memory well within the wall-clock time limit
// (see the kill logic in spawnWithTimeout). 2MB is generous for any legitimate test-case output.
const MAX_OUTPUT_BYTES = Number(process.env.JUDGE_MAX_OUTPUT_BYTES || 2 * 1024 * 1024);

// Fixed uid/gid for the unprivileged `sandbox` system user created in the Dockerfile —
// keep these two numbers in sync with the Dockerfile's `useradd --uid ... --gid ...`.
const SANDBOX_UID = Number(process.env.JUDGE_SANDBOX_UID || 10001);
const SANDBOX_GID = Number(process.env.JUDGE_SANDBOX_GID || 10001);
// Gates the actual privilege drop for both compiling AND running untrusted code.
// Defaults to false (today's root behavior, unchanged) so this ships dark — flip
// JUDGE_DROP_PRIVILEGES=true on Render (which restarts the container, applying the new
// value) only after the Dockerfile's `sandbox` user/permissions are live and the test
// matrix below has been run. Like every other JUDGE_* constant in this file, this is
// read once at module load; there is no cheaper "live toggle" — process.env cannot
// change under a running process, so a restart is required either way.
const DROP_PRIVILEGES = process.env.JUDGE_DROP_PRIVILEGES === "true";
// CPU-time ceiling for `ulimit -t`, in whole seconds (no sub-second granularity).
// Ships unconditionally (independent of DROP_PRIVILEGES) since RLIMIT_CPU's
// exceeded-limit signal (SIGXCPU/SIGKILL) is a plain accounting mechanism, not gated by
// CAP_SYS_RESOURCE the way RLIMIT_NPROC's fork()-time check is — unlike `ulimit -u`,
// this backstop is real even before any privilege drop. Generous headroom over
// timeLimitMs (which is wall-clock ms, not CPU seconds) so a legitimate multi-threaded
// submission consuming >1 core-second of CPU per wall-clock second doesn't false-trip;
// the wall-clock killTimer remains the primary timeout, this is defense-in-depth.
function cpuTimeLimitSeconds(timeLimitMs) {
  return Math.max(1, Math.ceil((timeLimitMs / 1000) * 2) + 1);
}

// Best-effort network denial for submitted code: run it inside its own network namespace with
// no interfaces, so outbound connections fail immediately instead of hanging or exfiltrating
// anything. `unshare -n` needs CAP_SYS_ADMIN, which containers running as root normally have
// within their own namespace — but that's not guaranteed on every host, so this is probed once
// at startup and silently disabled (falling back to today's behavior) if it doesn't work, rather
// than risk breaking every code execution on this platform over a hardening measure.
let networkDenialAvailable = null;
function checkNetworkDenialAvailable() {
  if (networkDenialAvailable !== null) return Promise.resolve(networkDenialAvailable);
  return new Promise((resolve) => {
    // Must probe under the SAME identity real execution will use, or this predicts
    // nothing. `unshare -n` needs CAP_SYS_ADMIN — root has it within its own container
    // namespace, but the unprivileged `sandbox` user (once DROP_PRIVILEGES is on)
    // almost certainly won't, so this is expected to start returning false once that
    // flag flips. That's an accepted, documented trade-off (see DROP_PRIVILEGES
    // comment) — the existing graceful fallback below (log + run without network
    // isolation) already handles it safely.
    const probeOptions = DROP_PRIVILEGES ? { uid: SANDBOX_UID, gid: SANDBOX_GID } : {};
    const probe = spawn("unshare", ["-n", "true"], probeOptions);
    probe.on("error", () => { networkDenialAvailable = false; resolve(false); });
    probe.on("close", (code) => {
      networkDenialAvailable = code === 0;
      if (!networkDenialAvailable) console.warn("judge: `unshare -n` unavailable on this host — running submissions without network-namespace isolation");
      resolve(networkDenialAvailable);
    });
  });
}

// Text patterns that show up in stderr when a program actually ran out of the memory budget
// `ulimit -v` gave it, as opposed to some unrelated crash — used to report a distinct "Memory
// Limit Exceeded" verdict instead of a generic Runtime Error.
const OOM_PATTERNS = /cannot allocate memory|bad_alloc|outofmemoryerror|memoryerror|std::length_error|java\.lang\.outofmemory/i;

// Compiled languages need the source filename to match what the compiler expects
// (Java in particular requires the file to be named after its public class, so
// student code is expected to declare `public class Main`).
const RUNNERS = {
  javascript: {
    srcName: "sol.js",
    run: (file) => ({ cmd: "node", args: [file] }),
  },
  python: {
    srcName: "sol.py",
    run: (file) => ({ cmd: "python3", args: [file] }),
  },
  c: {
    srcName: "sol.c",
    compile: (file, dir) => ({ cmd: "gcc", args: [file, "-O2", "-o", path.join(dir, "sol_bin")] }),
    run: (_file, dir) => ({ cmd: path.join(dir, "sol_bin"), args: [] }),
  },
  cpp: {
    srcName: "sol.cpp",
    compile: (file, dir) => ({ cmd: "g++", args: [file, "-O2", "-o", path.join(dir, "sol_bin")] }),
    run: (_file, dir) => ({ cmd: path.join(dir, "sol_bin"), args: [] }),
  },
  java: {
    srcName: "Main.java",
    // -J-XX:TieredStopAtLevel=1 and -J-Xshare:auto are passed through to javac's own JVM (the "-J"
    // prefix is javac's documented way to forward a flag to the JVM it runs in, not to the compiled
    // program). TieredStopAtLevel=1 skips the C2 JIT tier — pure overhead for a process as short-
    // lived as a single-file javac invocation, since C2's optimization work never has time to pay
    // for itself before the process exits. -Xshare:auto uses Class Data Sharing (a pre-parsed
    // archive of the JDK's own core classes) to skip re-parsing them from disk every invocation.
    // Neither changes compiled output — both only reduce javac's own startup cost, which matters
    // disproportionately on the fractional-CPU instance this runs on (see COMPILE_TIMEOUT_MS above).
    compile: (file, dir) => ({ cmd: "javac", args: ["-J-XX:TieredStopAtLevel=1", "-J-Xshare:auto", file] }),
    // -Xmx bounds the JVM's own heap to the same budget the OS-level ulimit enforces for the
    // other languages. Java runs skip that OS-level ulimit (see the enforceMemory call below) —
    // -Xmx is the JVM's actual memory guard here, not an addition to it. TieredStopAtLevel/Xshare
    // are the same JVM-startup-cost mitigations as the compile step above — a fresh JVM launches
    // per test case here too (CASE_CONCURRENCY runs several concurrently), and per-test-case
    // timeLimitMs is typically far too short (2s default) for C2's extra optimization to ever pay
    // for itself, so skipping it is a pure win here, not a tradeoff.
    run: (_file, dir, memoryLimitKb) => ({ cmd: "java", args: [`-Xmx${memoryLimitKb}k`, "-XX:TieredStopAtLevel=1", "-Xshare:auto", "-cp", dir, "Main"] }),
  },
};

// Turns a raw compiler/interpreter stderr dump into a short, readable summary — students
// were seeing a full page of gcc/javac/Python-traceback noise instead of "line 12: ...".
const LINE_PATTERNS = {
  c: /:(\d+):\d+:\s*(?:fatal error|error):\s*(.+)/,
  cpp: /:(\d+):\d+:\s*(?:fatal error|error):\s*(.+)/,
  java: /:(\d+):\s*error:\s*(.+)/,
};
// `studentCodeOffset` (from functionHarness.js's wrapFunctionCode(), 0 for STDIO-mode or for
// languages where the driver is appended after the student's code) shifts a compiler-reported
// line number back to the line the student actually sees in their own editor. If subtracting the
// offset would put the line at or before the student's own code (i.e. the error is somewhere in
// the invisible generated driver, not the student's code — should never happen for a genuinely
// valid signature, but a defensive floor beats showing a confusing/negative line number), the line
// is dropped instead of shown.
function summarizeError(language, rawMessage, studentCodeOffset = 0) {
  const message = String(rawMessage || "").trim();
  if (!message) return { line: null, message: "Unknown error" };

  let line = null;
  let summary = null;

  if (LINE_PATTERNS[language]) {
    const match = message.match(LINE_PATTERNS[language]);
    if (match) {
      line = Number(match[1]);
      if (studentCodeOffset > 0) {
        const studentLine = line - studentCodeOffset;
        line = studentLine > 0 ? studentLine : null;
      }
      summary = match[2].split("\n")[0].trim();
    }
  } else if (language === "python") {
    // Traceback ends with "File "sol.py", line N, in ..." then the exception on the last line
    const lineMatch = [...message.matchAll(/File "[^"]+", line (\d+)/g)].pop();
    if (lineMatch) line = Number(lineMatch[1]);
    const lastLine = message.trim().split("\n").pop();
    summary = lastLine?.trim();
  } else if (language === "javascript") {
    const lineMatch = message.match(/sol\.js:(\d+)/);
    if (lineMatch) line = Number(lineMatch[1]);
    const errorLine = message.split("\n").find((l) => /error/i.test(l));
    summary = (errorLine || message.split("\n")[0]).trim();
  }

  if (!summary) summary = message.split("\n")[0].trim();
  if (summary.length > 220) summary = `${summary.slice(0, 220)}…`;

  return { line, message: summary };
}

// Common compile-error signatures mapped to a one-line, deterministic hint — pattern matching
// against known compiler wording, not an analysis of the student's actual logic (same "rule-
// based, not real AI" honesty as the rest of this platform's grading/suggestions).
const COMPILE_ERROR_HINTS = [
  [/cannot find symbol/i, "Check for a typo in a variable/method/class name, or a missing declaration/import."],
  [/reached end of file while parsing/i, "You're likely missing a closing brace '}' somewhere."],
  [/';' expected/i, "You're likely missing a semicolon on the previous line."],
  [/expected ';' before/i, "You're likely missing a semicolon on the previous line."],
  [/undeclared \(first use/i, "Check for a typo, or a missing variable declaration."],
  [/implicit declaration of function/i, "Check that the function is declared before use, or that the right header is included."],
  [/expected '\)'|expected '\('/i, "Check for a missing or extra parenthesis."],
  [/unexpected EOF while parsing|invalid syntax/i, "Check for a missing colon, bracket, or parenthesis."],
  [/IndentationError/i, "Check your indentation — Python requires consistent spacing for blocks."],
  [/Unexpected token/i, "Check for a missing bracket, parenthesis, brace, or comma."],
  [/is not defined/i, "Check for a typo, or a variable/function used before it was declared."],
];
function findCompileHint(message) {
  const text = String(message || "");
  for (const [pattern, hint] of COMPILE_ERROR_HINTS) {
    if (pattern.test(text)) return hint;
  }
  return null;
}

// Runtime exception/crash signatures worth naming specifically instead of a generic "Runtime
// Error" — matched against raw stderr, most-specific pattern first per language. Same
// deterministic pattern-matching approach as COMPILE_ERROR_HINTS above.
const RUNTIME_ERROR_PATTERNS = {
  java: [
    [/StackOverflowError/, "Stack Overflow", "Your program recursed too deeply — check for a recursive function missing its base case."],
    [/OutOfMemoryError/, "Out of Memory", "Your program tried to allocate more memory than available — check for unbounded loops building up data."],
    [/NullPointerException/, "Null Pointer Exception", "Your code tried to use an object reference that was null — check for unhandled null values before calling methods on them."],
    [/ArrayIndexOutOfBoundsException/, "Array Index Out of Bounds", "Your code accessed an array index outside its valid range — check your loop bounds and array sizes."],
    [/StringIndexOutOfBoundsException/, "String Index Out of Bounds", "Your code accessed a string index outside its valid range."],
    [/ArithmeticException.*by zero/i, "Division by Zero", "Your code divided by zero — check that a divisor can't be 0 before dividing."],
    [/ClassCastException/, "Class Cast Exception", "Your code tried to cast an object to an incompatible type."],
    [/NumberFormatException/, "Number Format Exception", "Your code tried to parse text that isn't a valid number."],
  ],
  c: [
    [/[Ss]egmentation fault/, "Segmentation Fault", "Your program accessed memory it shouldn't have — check for out-of-bounds array access, a null/uninitialized pointer, or too-deep recursion."],
    [/stack smashing detected|stack overflow/i, "Stack Overflow", "Your program's call stack grew too large — check for infinite or too-deep recursion."],
    [/[Ff]loating point exception/, "Division by Zero", "Your program divided by zero (or used an invalid modulo) — check your divisor before dividing."],
    [/double free|free\(\): invalid/, "Memory Error", "Your program freed memory incorrectly — check for a duplicate or invalid free() call."],
    [/[Aa]borted/, "Aborted", "Your program called abort() or hit a runtime-checked failure — check assertions and error-handling paths."],
  ],
  python: [
    [/ZeroDivisionError/, "Division by Zero", "Your code divided by zero — check your divisor before dividing."],
    [/IndexError/, "Index Error", "Your code accessed a list/string index outside its valid range."],
    [/KeyError/, "Key Error", "Your code accessed a dictionary key that doesn't exist — check the key exists first."],
    [/TypeError/, "Type Error", "Your code used a value of the wrong type — check the types being combined or passed to a function."],
    [/AttributeError/, "Attribute Error", "Your code called a method/attribute that doesn't exist on that object."],
    [/RecursionError/, "Recursion Error", "Your code recursed too deeply — check for a recursive function missing its base case."],
    [/NameError/, "Name Error", "Your code referenced a variable that hasn't been defined."],
    [/ValueError/, "Value Error", "Your code passed a value of the right type but an invalid value (e.g. a bad conversion)."],
  ],
  javascript: [
    [/RangeError.*call stack/i, "Stack Overflow", "Your function recursed too deeply — check for a recursive function missing its base case."],
    [/TypeError: Cannot read propert(y|ies) .* of (null|undefined)/, "Null/Undefined Reference", "Your code tried to access a property on null or undefined — check the value exists first."],
    [/TypeError/, "Type Error", "Your code called something that isn't a function, or used a value of the wrong type."],
    [/ReferenceError/, "Reference Error", "Your code referenced a variable that hasn't been defined."],
    [/RangeError/, "Range Error", "Your code used a value outside its valid range (e.g. an invalid array length)."],
  ],
};
RUNTIME_ERROR_PATTERNS.cpp = [
  ...RUNTIME_ERROR_PATTERNS.c,
  [/std::out_of_range/, "Out of Range", "Your code accessed a container (vector/string/map) at an invalid index or key."],
  [/std::bad_alloc/, "Out of Memory", "Your program tried to allocate more memory than available."],
];
function classifyRuntimeError(language, rawMessage) {
  const message = String(rawMessage || "");
  for (const [pattern, type, hint] of RUNTIME_ERROR_PATTERNS[language] || []) {
    if (pattern.test(message)) return { type, hint };
  }
  return null;
}

// Runs `cmd args...` under a virtual-memory ulimit (real OS-level enforcement — a process that
// exceeds it gets allocation failures, not just a number we report after the fact) and under
// `/usr/bin/time -v`, which writes real peak-RSS to a separate file (statsFile) so its report
// never gets mixed into the submitted program's own stderr.
async function spawnWithTimeout(cmd, args, options, input, timeLimitMs, { enforceMemory = true, memoryLimitKb = MEMORY_LIMIT_KB } = {}) {
  const networkDenied = enforceMemory && await checkNetworkDenialAvailable(); // only for actual execution, not compilation
  return new Promise((resolve) => {
    const statsFile = path.join(os.tmpdir(), `judge-time-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    // The memory/process/CPU ulimits only apply to actually running submitted code, not to
    // compilation — javac in particular needs real JVM headroom well beyond a student program's
    // own budget, and capping it the same way would misreport legitimate compiler memory use as
    // an MLE (or block javac's own worker threads as a false fork-bomb trip). DROP_PRIVILEGES, in
    // contrast, applies to BOTH compile and execute — compiling untrusted source is itself
    // untrusted input to gcc/g++/javac, and dropping privileges for the whole lifecycle after
    // mkdtempSync (see prepare()) is simpler to reason about than a split where compile stays
    // root and only execute drops.
    //
    // `setpriv --no-new-privs` runs *inside* the shell, immediately before the final exec: it
    // only needs to set a per-process flag any uid can set for itself, so it's safe to run after
    // the uid/gid drop below already took effect at spawn() time. Native spawn({uid,gid}) alone
    // drops identity but doesn't block the sandboxed process from exec'ing a setuid-root binary
    // if one were reachable; --no-new-privs closes that gap.
    const cpuSeconds = cpuTimeLimitSeconds(timeLimitMs);
    const execTail = DROP_PRIVILEGES ? `exec setpriv --no-new-privs "$0" "$@"` : `exec "$0" "$@"`;
    const innerCmd = enforceMemory
      ? `ulimit -v ${memoryLimitKb}; ulimit -u ${MAX_PROCESSES}; ulimit -t ${cpuSeconds}; ${execTail}`
      : execTail;
    const wrappedArgs = enforceMemory || DROP_PRIVILEGES
      ? ["-v", "-o", statsFile, "sh", "-c", innerCmd, cmd, ...args]
      : ["-v", "-o", statsFile, cmd, ...args];
    const timeArgs = networkDenied ? ["-n", "/usr/bin/time", ...wrappedArgs] : wrappedArgs;
    const timeCmd = networkDenied ? "unshare" : "/usr/bin/time";
    // detached so the child becomes its own process-group leader — on timeout we kill the whole
    // group (process.kill(-pid, ...)), not just this one PID, which also reaps any children the
    // submitted program itself forked (a plain child.kill() would leave those running).
    // env explicitly whitelisted (see JUDGE_ENV above) — never inherit process.env's secrets.
    // uid/gid (when DROP_PRIVILEGES is on) setuid/setgid this child to `sandbox` BEFORE it execs
    // anything — the whole chain that follows (unshare -> time -> sh -> ulimit -> setpriv -> the
    // real cmd) therefore runs unprivileged from its very first exec onward, not just the final
    // one; dropping privileges only after some earlier step already ran as root would not
    // actually close the gap this fix exists for. If the drop itself fails (bad uid/gid, a
    // tmpDir ownership mismatch), spawn() emits 'error' on the child, which the existing handler
    // below already turns into ok:false — there is intentionally no catch-and-retry-as-root path
    // anywhere in this function.
    const spawnOptions = { ...options, env: { ...JUDGE_ENV, ...options.env }, detached: true, killSignal: "SIGKILL" };
    if (DROP_PRIVILEGES) {
      spawnOptions.uid = SANDBOX_UID;
      spawnOptions.gid = SANDBOX_GID;
    }
    const child = spawn(timeCmd, timeArgs, spawnOptions);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputExceeded = false;
    const startedAt = Date.now();

    const killTimer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    }, timeLimitMs);

    if (input !== undefined) {
      child.stdin.write(input || "");
      child.stdin.end();
    }

    // Wall-clock timeout alone doesn't bound how much a submission can print — a fast infinite
    // print loop (`while(true) System.out.println(...)`) can emit gigabytes well within the time
    // limit, buffering it all in this process's memory (stdout/stderr are plain JS strings) before
    // the killTimer ever fires. Cap accumulated size the same way the timeout caps wall time: once
    // either stream crosses MAX_OUTPUT_BYTES, kill the whole process group immediately rather than
    // waiting for the timeout, and report it distinctly (like timedOut) instead of a generic error.
    function trackOutput(chunk, current) {
      if (outputExceeded) return current;
      const next = current + chunk.toString();
      if (next.length > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
        return next.slice(0, MAX_OUTPUT_BYTES);
      }
      return next;
    }
    child.stdout.on("data", (d) => { stdout = trackOutput(d, stdout); });
    child.stderr.on("data", (d) => { stderr = trackOutput(d, stderr); });

    function readStatsAndCleanup() {
      let memoryKb = null;
      try {
        const raw = fs.readFileSync(statsFile, "utf8");
        const match = raw.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
        if (match) memoryKb = Number(match[1]);
      } catch { /* stats file may not exist if the process never actually started */ }
      fs.rm(statsFile, () => {});
      return memoryKb;
    }

    child.on("close", (codeExit) => {
      clearTimeout(killTimer);
      const timeMs = Date.now() - startedAt;
      const memoryKb = readStatsAndCleanup();
      if (timedOut) return resolve({ ok: false, timedOut: true, timeMs, memoryKb });
      if (outputExceeded) return resolve({ ok: false, error: "Output limit exceeded", outputExceeded: true, timeMs, memoryKb });
      if (codeExit !== 0) {
        const memoryExceeded = memoryKb != null && memoryKb >= memoryLimitKb * 0.97;
        const oom = memoryExceeded || OOM_PATTERNS.test(stderr);
        return resolve({ ok: false, error: stderr || "Runtime error", oom, timeMs, memoryKb });
      }
      resolve({ ok: true, stdout, timeMs, memoryKb });
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      readStatsAndCleanup();
      resolve({ ok: false, error: err.message, timeMs: Date.now() - startedAt });
    });
  });
}

// Writes the source and compiles it (once) if the language needs it.
// Returns { ok: true, execute(input, timeLimitMs) } or { ok: false, error }.
async function prepare(language, code) {
  const runner = RUNNERS[language];
  if (!runner) return { ok: false, error: "Unsupported language" };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "judge-"));
  if (DROP_PRIVILEGES) {
    // tmpDir is created by this (still-root) process, but compilation and execution now
    // both run as `sandbox` (see spawnWithTimeout) — it needs to enter (x) and write (w)
    // here, since it compiles its own output into this same directory. 0770: owner
    // (sandbox) full access, no access for anyone else — root retains access for
    // cleanup() regardless of the chmod, since root bypasses permission checks entirely.
    fs.chownSync(tmpDir, SANDBOX_UID, SANDBOX_GID);
    fs.chmodSync(tmpDir, 0o770);
  }
  const file = path.join(tmpDir, runner.srcName);
  fs.writeFileSync(file, code);
  if (DROP_PRIVILEGES) {
    // sandbox needs read access to compile/interpret its own source, but never write —
    // least privilege, and prevents a running submission from rewriting its own source
    // file mid-execution for no legitimate reason.
    fs.chownSync(file, SANDBOX_UID, SANDBOX_GID);
    fs.chmodSync(file, 0o440);
  }

  if (runner.compile) {
    const { cmd, args } = runner.compile(file, tmpDir);
    // Compilation gets a generous fixed budget, separate from the per-test-case run limit, and
    // is exempt from the execution memory ulimit (see spawnWithTimeout's enforceMemory comment).
    const compileResult = await spawnWithTimeout(cmd, args, { cwd: tmpDir }, undefined, COMPILE_TIMEOUT_MS, { enforceMemory: false });
    // Logged unconditionally (not just on timeout) so real compile-time data accumulates in Render's
    // logs — without this, "Compilation timed out" reports have no way to distinguish "consistently
    // near the budget under load" from "one freak spike," which is exactly the ambiguity that made
    // the previous 10s->30s bump a guess rather than a measurement-backed fix.
    if (compileResult.timeMs > COMPILE_TIMEOUT_MS * 0.5) {
      console.warn(`judge: ${language} compile took ${compileResult.timeMs}ms (budget ${COMPILE_TIMEOUT_MS}ms)${compileResult.timedOut ? " — TIMED OUT" : ""}`);
    }
    if (!compileResult.ok) {
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
      return {
        ok: false,
        error: compileResult.timedOut ? "Compilation timed out" : compileResult.error || "Compilation failed",
      };
    }

    // javac happily compiles a file containing only a non-public class (e.g. a LeetCode-style
    // `class Solution { ... }` with no `public class Main`) — the filename only has to match a
    // *public* class if the file declares one. Without this check, RUNNERS.java.run's `java ...
    // Main` then fails at JVM launch with a cryptic "Could not find or load main class Main",
    // which (since compilation itself "succeeded") got misclassified per-test-case as a generic
    // Runtime Error / WRONG_ANSWER instead of the real problem: there's no entry point at all.
    // Catching it here instead routes it through the same well-labeled COMPILE_ERROR path real
    // compile failures use. Harmless/never triggers in FUNCTION mode, since the generated driver
    // (functionHarness.js's javaDriver()) always declares `public class Main` itself.
    if (language === "java" && !fs.existsSync(path.join(tmpDir, "Main.class"))) {
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
      return {
        ok: false,
        error: "No 'public class Main' with 'public static void main' was found. If you wrote a LeetCode-style " +
          "'class Solution' only, ask an admin to enable Function-based mode for this question.",
      };
    }
  }

  return {
    ok: true,
    async execute(input, timeLimitMs, memoryLimitKb = MEMORY_LIMIT_KB) {
      const { cmd, args } = runner.run(file, tmpDir, memoryLimitKb);
      // The OS-level ulimit -v (virtual memory) is skipped for Java: the JVM reserves virtual
      // address space (metaspace, thread stacks, JIT code cache) well beyond this budget just to
      // start up, regardless of the student's code, which made every single Java run fail with a
      // generic "Runtime Error" — the -Xmx flag on the java command above is Java's real memory
      // guard instead, enforced by the JVM itself rather than the OS.
      const result = await spawnWithTimeout(cmd, args, { cwd: tmpDir, timeout: timeLimitMs }, input, timeLimitMs, { enforceMemory: language !== "java", memoryLimitKb });
      if (!result.ok) return result;
      return { ok: true, stdout: result.stdout.trim(), timeMs: result.timeMs, memoryKb: result.memoryKb };
    },
    cleanup() {
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    },
  };
}

// Fire-and-forget warm-up: compiles a trivial program in each compiled language once, meant to be
// called right after the server starts listening (see index.js), not awaited by any request. This
// specifically targets Render free-tier's behavior of evicting the whole container — including the
// OS page cache — after ~15 minutes idle, then rebuilding it cold on the next request. Without this,
// the very first real submission after any idle period pays the full cold-disk-read cost of loading
// javac/gcc/g++ and their shared libraries on top of the CPU cost already described in
// COMPILE_TIMEOUT_MS's comment above — exactly the kind of compound, load-dependent slowdown that
// makes "Compilation timed out" look random rather than systemic. This does not fix the underlying
// fractional-CPU constraint, it only removes one of the several costs stacked on top of it. Never
// throws — a failed warm-up must not crash startup or block real traffic.
async function warmUpCompilers() {
  const samples = {
    java: "public class Main { public static void main(String[] a) {} }\n",
    c: "int main() { return 0; }\n",
    cpp: "int main() { return 0; }\n",
  };
  for (const [language, code] of Object.entries(samples)) {
    const startedAt = Date.now();
    try {
      const prepared = await prepare(language, code);
      if (prepared.ok) prepared.cleanup();
      console.log(`judge: warm-up compile (${language}) took ${Date.now() - startedAt}ms${prepared.ok ? "" : ` — failed: ${prepared.error}`}`);
    } catch (err) {
      console.warn(`judge: warm-up compile (${language}) threw`, err.message);
    }
  }
}

/**
 * Runs `code` against a list of test cases: [{ input, expected }]
 * Returns { passedCases, totalCases, verdict, details: [...] }
 */
async function judgeSubmission({ language, code, testCases, timeLimitMs = 2000, memoryLimitKb = MEMORY_LIMIT_KB, evaluationType, functionSignature, sqlSchema }) {
  // SQL questions run on a completely separate path — no compile/run subprocess, no ulimits,
  // an in-process (worker-thread-isolated) SQLite engine instead. See sqlJudge.js.
  if (language === "sql") {
    return judgeSqlSubmission({ sqlSchema, code, testCases, timeLimitMs: timeLimitMs || 3000 });
  }
  let sourceCode = code;
  let studentCodeOffset = 0;
  if (evaluationType === "FUNCTION" && functionSignature) {
    if (looksLikeFullProgram(language, code)) {
      // The student wrote a complete, self-contained program instead of just the method body —
      // FUNCTION-mode questions accept both. Run it exactly like a STDIO submission (no driver
      // wrapping) against the same test cases; sourceCode/studentCodeOffset stay at their
      // just-run-the-code-as-is defaults.
    } else {
      try {
        const wrapped = wrapFunctionCode(language, functionSignature, code);
        sourceCode = wrapped.code;
        studentCodeOffset = wrapped.studentCodeOffset;
      } catch (err) {
        return {
          passedCases: 0,
          totalCases: testCases.length,
          verdict: "COMPILE_ERROR",
          details: [],
          errorSummary: { type: "Compilation Error", line: null, message: err.message, hint: null },
        };
      }
    }
  }
  const prepared = await prepare(language, sourceCode);
  if (!prepared.ok) {
    // Sanitized the same way errorSummary below already is -- this `details[].error` field is
    // exactly what a "Run" caller (submissions.js's /run and its equivalents on every other
    // execution surface) sends straight to the student with no further stripping, unlike Submit
    // responses which drop `details` entirely. The raw compiler stderr this platform's runners
    // produce embeds the real server temp-directory path (see prepare()'s mkdtempSync), so
    // leaving it unsanitized here was a real path-disclosure leak on every Run call, not just a
    // cosmetic one.
    const cleanedError = summarizeError(language, prepared.error, studentCodeOffset).message;
    const details = testCases.map((tc) => ({
      input: tc.input,
      expected: tc.expected,
      actual: null,
      verdict: "RUNTIME_ERROR",
      error: cleanedError,
    }));
    return {
      passedCases: 0,
      totalCases: testCases.length,
      verdict: "COMPILE_ERROR",
      details,
      errorSummary: { type: "Compilation Error", ...summarizeError(language, prepared.error, studentCodeOffset), hint: findCompileHint(prepared.error) },
    };
  }

  let details;
  try {
    // Test cases are independent (same compiled binary, fresh process each run),
    // so run a bounded number concurrently — this mostly cuts down on wall-clock
    // time lost to process-startup overhead (especially the JVM) rather than
    // raw CPU, which matters most on a low-core instance.
    details = await mapWithConcurrency(testCases, CASE_CONCURRENCY, async (tc) => {
      const result = await prepared.execute(tc.input, timeLimitMs, memoryLimitKb);
      if (!result.ok) {
        // Same path-disclosure concern as the compile-error branch above -- a runtime crash's
        // stderr (segfault message, uncaught exception, etc.) can also embed the real temp-dir
        // source path; clean it the same way before it's ever attached to a per-case result.
        return {
          input: tc.input,
          expected: tc.expected,
          actual: null,
          verdict: result.timedOut ? "TLE" : result.oom ? "MLE" : "RUNTIME_ERROR",
          error: summarizeError(language, result.error).message,
          timeMs: result.timeMs ?? null,
          memoryKb: result.memoryKb ?? null,
        };
      }
      const actual = result.stdout;
      const expected = String(tc.expected).trim();
      const isMatch = actual === expected;
      return {
        input: tc.input,
        expected,
        actual,
        verdict: isMatch ? "PASSED" : "WRONG_ANSWER",
        timeMs: result.timeMs ?? null,
        memoryKb: result.memoryKb ?? null,
      };
    });
  } finally {
    prepared.cleanup();
  }

  const passed = details.filter((d) => d.verdict === "PASSED").length;

  let verdict = "ACCEPTED";
  if (passed === 0) {
    verdict = details.some((d) => d.verdict === "TLE") ? "TLE" : details.some((d) => d.verdict === "MLE") ? "MLE" : "WRONG_ANSWER";
  } else if (passed < testCases.length) {
    verdict = "PARTIAL";
  }

  const maxTimeMs = details.reduce((max, d) => (d.timeMs != null && d.timeMs > max ? d.timeMs : max), 0);
  const maxMemoryKb = details.reduce((max, d) => (d.memoryKb != null && d.memoryKb > max ? d.memoryKb : max), 0);

  // Only surface a technical error summary when every case failed the same way — a mixed
  // pass/fail result (verdict PARTIAL) stays silent here since exposing it would leak how
  // many cases passed, which submissions.js is specifically trying not to reveal.
  let errorSummary = null;
  if (passed === 0) {
    if (verdict === "TLE") {
      errorSummary = { type: "Time Limit Exceeded", line: null, message: "Your program took too long to produce output — the algorithm is likely too slow for the input size; try a more efficient approach.", hint: null };
    } else if (verdict === "MLE") {
      errorSummary = { type: "Memory Limit Exceeded", line: null, message: "Your program used more memory than allowed — check for unbounded data structures, infinite recursion, or unnecessarily large allocations.", hint: null };
    } else {
      const errored = details.find((d) => d.verdict === "RUNTIME_ERROR");
      if (errored) {
        const base = summarizeError(language, errored.error);
        const classified = classifyRuntimeError(language, errored.error);
        errorSummary = classified
          ? { type: classified.type, line: base.line, message: base.message, hint: classified.hint }
          : { type: "Runtime Error", ...base, hint: null };
      }
    }
  }

  return { passedCases: passed, totalCases: testCases.length, verdict, details, errorSummary, maxTimeMs, maxMemoryKb: maxMemoryKb || null };
}

module.exports = { judgeSubmission, warmUpCompilers };
