// Java, C, C++ and JavaScript through the REAL judge (backend/src/utils/judge.js): the same compile / run / compare path production runs, not a mock. Added in the 2026-11 audit, which found that only
// Python had been verified end to end (see docs/AUDIT_2026-11_PHASE2.md). Needs Linux (GNU time, bash ulimit) and the language's toolchain; a language whose toolchain is missing is skipped with the
// reason, never faked. Hidden test cases are a route-level concern (the judge itself returns what it ran); examEngine.integration.test.js checks them through the HTTP API for every language.
//
// Environment switches, for running the suite inside the production judge container (where the sandbox user and the network rule exist):
//   JLX_EXPECT_SANDBOX_USER=1   assert the program cannot read the server's own process environment
//   JLX_EXPECT_NO_NETWORK=1     assert an outbound connection fails
//   JLX_PARALLEL=N              how many submissions the concurrency test runs at once (default 12)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
// RLIMIT_NPROC counts every process of the OS user; a developer or CI user already runs more than the production cap of 64, which breaks Node itself. Raised before the require; the fork-bomb limit is
// therefore not exercised here.
process.env.JUDGE_MAX_PROCESSES = process.env.JUDGE_MAX_PROCESSES || "4096";
const { judgeSubmission } = require("../src/utils/judge");

const LINUX = process.platform === "linux" && fs.existsSync("/usr/bin/time");
const has = (cmd, arg = "--version") => { try { return spawnSync(cmd, [arg], { encoding: "utf8" }).status === 0; } catch { return false; } };
const TOOLS = { java: has("javac", "-version") && has("java", "-version"), c: has("gcc"), cpp: has("g++"), javascript: has("node") };
const PARALLEL = Number(process.env.JLX_PARALLEL || 12);
const skipFor = (lang) => (!LINUX ? "needs Linux with /usr/bin/time" : TOOLS[lang] ? false : `${lang} toolchain is not installed`);

const tc = (input, expected) => ({ input, expected });
// Java starts a JVM per run, so it gets more time than the others; the limits being tested are the point, not the speed of the machine.
const limitFor = (lang) => (lang === "java" ? 8000 : 4000);
const run = (language, code, testCases, extra = {}) => judgeSubmission({ language, code, testCases, timeLimitMs: limitFor(language), ...extra });
const why = (r) => JSON.stringify(r.errorSummary || r.details?.[0] || {}).slice(0, 300);
const accepted = (r, label) => assert.equal(r.verdict, "ACCEPTED", `${label}: ${why(r)}`);
const judgeDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("judge-"));
const settle = () => new Promise((r) => setTimeout(r, 500)); // temp-dir removal is asynchronous

// One program per scenario per language. {{n}} style values are inlined by the helpers below.
const P = {
  sum: {
    java: "import java.util.*; public class Main { public static void main(String[] x){ Scanner s=new Scanner(System.in); long a=s.nextLong(), b=s.nextLong(); System.out.println(a+b); } }",
    c: '#include <stdio.h>\nint main(void){ long a,b; if(scanf("%ld %ld",&a,&b)!=2) return 1; printf("%ld\\n",a+b); return 0; }',
    cpp: "#include <iostream>\nint main(){ long a,b; std::cin>>a>>b; std::cout<<a+b<<std::endl; return 0; }",
    javascript: 'const [a,b]=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number); console.log(a+b);',
  },
  // reads n, then n words, prints them in reverse order: multi-line input, strings, loops
  reverseWords: {
    java: "import java.util.*; public class Main { public static void main(String[] x){ Scanner s=new Scanner(System.in); int n=s.nextInt(); String[] w=new String[n]; for(int i=0;i<n;i++) w[i]=s.next(); for(int i=n-1;i>=0;i--) System.out.println(w[i]); } }",
    c: '#include <stdio.h>\nint main(void){ int n; char w[100][64]; scanf("%d",&n); for(int i=0;i<n;i++) scanf("%63s",w[i]); for(int i=n-1;i>=0;i--) printf("%s\\n",w[i]); return 0; }',
    cpp: "#include <iostream>\n#include <vector>\n#include <string>\nint main(){ int n; std::cin>>n; std::vector<std::string> w(n); for(auto&s:w) std::cin>>s; for(int i=n-1;i>=0;i--) std::cout<<w[i]<<\"\\n\"; return 0; }",
    javascript: 'const t=require("fs").readFileSync(0,"utf8").split(/\\s+/).filter(Boolean); const n=Number(t[0]); console.log(t.slice(1,1+n).reverse().join("\\n"));',
  },
  wrong: {
    java: "public class Main { public static void main(String[] x){ System.out.println(\"wrong\"); } }",
    c: '#include <stdio.h>\nint main(void){ puts("wrong"); return 0; }',
    cpp: '#include <iostream>\nint main(){ std::cout<<"wrong\\n"; return 0; }',
    javascript: 'console.log("wrong");',
  },
  syntax: {
    java: "public class Main { public static void main(String[] a){ int x = ; } }",
    c: "int main(void){ int x = ; return 0; }",
    cpp: "int main(){ int x = ; return 0; }",
    javascript: "console.log(",
  },
  crash: {
    java: "public class Main { public static void main(String[] a){ int[] x=new int[1]; System.out.println(x[3]); } }",
    c: "int main(void){ volatile int *p=0; *p=1; return 0; }",
    cpp: '#include <stdexcept>\nint main(){ throw std::runtime_error("boom"); }',
    javascript: 'throw new Error("boom");',
  },
  exitNonZero: {
    java: "public class Main { public static void main(String[] a){ System.exit(3); } }",
    c: "int main(void){ return 3; }",
    cpp: "int main(){ return 3; }",
    javascript: "process.exit(3);",
  },
  loop: {
    java: "public class Main { public static void main(String[] a){ while(true){} } }",
    c: "int main(void){ for(;;){} return 0; }",
    cpp: "int main(){ for(;;){} return 0; }",
    javascript: "for(;;){}",
  },
  // allocates far more than the limit and writes to it, through a volatile or real use so the compiler cannot delete it
  memory: {
    java: "public class Main { public static void main(String[] a){ long[] x=new long[500_000_000]; for(int i=0;i<x.length;i+=512) x[i]=1; System.out.println(\"done\"); } }",
    c: '#include <stdio.h>\n#include <stdlib.h>\nint main(void){ size_t n=900u*1024*1024; volatile char*p=(volatile char*)malloc(n); if(!p){ puts("denied"); return 0; } for(size_t i=0;i<n;i+=4096) p[i]=1; puts("done"); return 0; }',
    cpp: '#include <cstdlib>\n#include <cstdio>\nint main(){ size_t n=900u*1024*1024; volatile char*p=(volatile char*)std::malloc(n); if(!p){ std::puts("denied"); return 0; } for(size_t i=0;i<n;i+=4096) p[i]=1; std::puts("done"); return 0; }',
    javascript: 'const b=Buffer.alloc(3*1024*1024*1024); b.fill(1); console.log("done");',
  },
  flood: {
    java: 'public class Main { public static void main(String[] a){ while(true) System.out.println("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"); } }',
    c: '#include <stdio.h>\nint main(void){ for(;;) puts("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"); return 0; }',
    cpp: '#include <cstdio>\nint main(){ for(;;) std::puts("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"); return 0; }',
    javascript: 'for(;;) console.log("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");',
  },
  env: {
    java: 'public class Main { public static void main(String[] a){ System.out.println(System.getenv("JWT_SECRET")!=null||System.getenv("DATABASE_URL")!=null ? "LEAK" : "none"); } }',
    c: '#include <stdio.h>\n#include <stdlib.h>\nint main(void){ puts(getenv("JWT_SECRET")||getenv("DATABASE_URL")?"LEAK":"none"); return 0; }',
    cpp: '#include <cstdio>\n#include <cstdlib>\nint main(){ std::puts(std::getenv("JWT_SECRET")||std::getenv("DATABASE_URL")?"LEAK":"none"); return 0; }',
    javascript: 'console.log(process.env.JWT_SECRET||process.env.DATABASE_URL?"LEAK":"none");',
  },
  // sums 100,000 integers read from one 600 KB line
  bigInput: {
    java: "import java.io.*; import java.util.*; public class Main { public static void main(String[] x) throws IOException { BufferedReader r=new BufferedReader(new InputStreamReader(System.in)); long n=Long.parseLong(r.readLine().trim()); StringTokenizer t=new StringTokenizer(r.readLine()); long s=0; while(t.hasMoreTokens()) s+=Long.parseLong(t.nextToken()); System.out.println(s); } }",
    c: '#include <stdio.h>\nint main(void){ long n; scanf("%ld",&n); long s=0,v; while(scanf("%ld",&v)==1) s+=v; printf("%ld\\n",s); return 0; }',
    cpp: "#include <iostream>\nint main(){ std::ios::sync_with_stdio(false); long n; std::cin>>n; long s=0,v; while(std::cin>>v) s+=v; std::cout<<s<<\"\\n\"; return 0; }",
    javascript: 'const t=require("fs").readFileSync(0,"utf8").split(/\\s+/).filter(Boolean).map(Number); console.log(t.slice(1).reduce((a,b)=>a+b,0));',
  },
  echoLine: {
    java: "import java.io.*; public class Main { public static void main(String[] x) throws IOException { System.out.println(new BufferedReader(new InputStreamReader(System.in)).readLine()); } }",
    c: '#include <stdio.h>\nint main(void){ char b[256]; if(fgets(b,256,stdin)) fputs(b,stdout); return 0; }',
    cpp: "#include <iostream>\n#include <string>\nint main(){ std::string s; std::getline(std::cin,s); std::cout<<s<<\"\\n\"; return 0; }",
    javascript: 'console.log(require("fs").readFileSync(0,"utf8").split("\\n")[0]);',
  },
};

for (const lang of ["java", "c", "cpp", "javascript"]) {
  const opts = { skip: skipFor(lang) };
  const lbl = (s) => `${lang}: ${s}`;

  test(lbl("custom input and output: two numbers on a line, including negatives and a large sum"), opts, async () => {
    accepted(await run(lang, P.sum[lang], [tc("2 3", "5"), tc("-5 -7", "-12"), tc("3000000000 4000000000", "7000000000"), tc("  10    20  \n", "30")]), "sum");
  });

  test(lbl("custom input and output: multi-line input, several words, output spread over lines"), opts, async () => {
    accepted(await run(lang, P.reverseWords[lang], [tc("3\nalpha\nbeta\ngamma", "gamma\nbeta\nalpha"), tc("1\nsolo", "solo")]), "reverse words");
  });

  test(lbl("a wrong answer is WRONG_ANSWER and says which case failed, and a run with no input at all works"), opts, async () => {
    const r = await run(lang, P.wrong[lang], [tc("", "right")]);
    assert.equal(r.verdict, "WRONG_ANSWER", why(r));
    assert.equal(r.passedCases, 0);
    assert.equal(r.totalCases, 1);
    accepted(await run(lang, P.wrong[lang], [tc("", "wrong")]), "no input");
  });

  test(lbl("a syntax or compile error is reported readably and leaks no server path"), opts, async () => {
    const r = await run(lang, P.syntax[lang], [tc("", "")]);
    assert.notEqual(r.verdict, "ACCEPTED");
    if (lang === "javascript") {
      // JavaScript has no separate compile step: the syntax error surfaces when the program starts, as a runtime error of the case. (By design the overall verdict of a run where every case failed
      // that way is WRONG_ANSWER; the type and message in errorSummary carry the specifics.)
      assert.equal(r.details[0].verdict, "RUNTIME_ERROR", why(r));
    } else {
      assert.equal(r.verdict, "COMPILE_ERROR", why(r));
    }
    assert.ok(r.errorSummary && r.errorSummary.message, "an explanation is given");
    const text = JSON.stringify(r.errorSummary || r.details || "");
    assert.ok(text.length > 20, "an explanation is given");
    assert.ok(!/\/tmp\/judge-|\/app\/|\/home\/|\\Users\\/.test(text), `no server path in: ${text.slice(0, 200)}`);
  });

  test(lbl("an uncaught exception, a crash and a non-zero exit are runtime errors, never accepted"), opts, async () => {
    // By design the overall verdict when every case failed this way is WRONG_ANSWER; the case verdict and the error summary say what happened (same contract as pythonJudge.test.js and judgeC.test.js).
    const crash = await run(lang, P.crash[lang], [tc("", "")]);
    assert.notEqual(crash.verdict, "ACCEPTED", "a crash never passes");
    assert.equal(crash.details[0].verdict, "RUNTIME_ERROR", why(crash));
    assert.ok(crash.errorSummary && crash.errorSummary.type && crash.errorSummary.message, "the crash is explained");
    const exit = await run(lang, P.exitNonZero[lang], [tc("", "")]);
    assert.notEqual(exit.verdict, "ACCEPTED", "a non-zero exit never passes");
    assert.equal(exit.details[0].verdict, "RUNTIME_ERROR", `a non-zero exit is a runtime error of the case: ${why(exit)}`);
  });

  test(lbl("an infinite loop ends as TLE close to the limit, and the next submission still works"), opts, async () => {
    const t0 = Date.now();
    const r = await run(lang, P.loop[lang], [tc("", "")], { timeLimitMs: lang === "java" ? 3000 : 1500 });
    assert.equal(r.verdict, "TLE", why(r));
    assert.ok(Date.now() - t0 < 30000, "the loop was stopped, not waited out");
    accepted(await run(lang, P.sum[lang], [tc("1 2", "3")]), "judge still healthy after a TLE");
  });

  test(lbl("a program that allocates far more than the memory limit is not accepted"), opts, async () => {
    const r = await run(lang, P.memory[lang], [tc("", "done")], lang === "javascript" ? {} : { memoryLimitKb: 65536 });
    assert.notEqual(r.verdict, "ACCEPTED", `${lang} allocated past the limit and was accepted`);
  });

  test(lbl("an output flood is cut off as OLE or TLE"), opts, async () => {
    const r = await run(lang, P.flood[lang], [tc("", "")], { timeLimitMs: 5000 });
    assert.ok(["OLE", "TLE"].includes(r.verdict), `an output flood ends as OLE or TLE, got ${r.verdict}`);
  });

  test(lbl("the program cannot read the server's secrets from its environment"), opts, async () => {
    process.env.JWT_SECRET = "must-never-reach-student-code";
    process.env.DATABASE_URL = "postgres://secret";
    accepted(await run(lang, P.env[lang], [tc("", "none")]), "environment whitelist");
  });

  test(lbl("a 600 KB input line is read completely"), opts, async () => {
    const n = 100000; const nums = Array.from({ length: n }, (_, i) => (i % 9) + 1); const sum = nums.reduce((a, b) => a + b, 0);
    accepted(await run(lang, P.bigInput[lang], [tc(`${n}\n${nums.join(" ")}`, String(sum))], { timeLimitMs: lang === "java" ? 10000 : 6000 }), "big input");
  });
}

// ---------------------------------------------------------------- JavaScript memory: no OS cap exists for Node, so two other guards must hold (audit finding A2-20)
// Measured on the production judge on 2026-11-16: a JavaScript program that allocated and touched 100 MB up to 2,000 MB was ACCEPTED at the default 256 MB limit (peak 2,085,996 KB), because the peak
// memory was only compared with the limit after a FAILED run. The heap is now capped (--max-old-space-size) and the peak is compared after a normal exit too.
const jsOpts = { skip: skipFor("javascript") };
test("javascript: one huge heap allocation is Memory Limit Exceeded", jsOpts, async () => {
  const r = await run("javascript", "const a=[]; for(let i=0;i<40;i++) a.push(new Array(10000000).fill(1.5)); console.log(a.length);", [tc("", "40")], { timeLimitMs: 10000 });
  assert.equal(r.verdict, "MLE", `got ${r.verdict}: ${why(r)}`);
  assert.equal(r.errorSummary && r.errorSummary.type, "Memory Limit Exceeded");
});

test("javascript: a heap that grows without end is stopped (as MLE, or TLE if the engine thrashes first), never accepted and never left running", jsOpts, async () => {
  const t0 = Date.now();
  const r = await run("javascript", "const a=[]; for(;;) a.push(new Array(100000).fill(1.5));", [tc("", "")], { timeLimitMs: 6000 });
  assert.ok(["MLE", "TLE"].includes(r.verdict), `got ${r.verdict}: ${why(r)}`);
  assert.ok(Date.now() - t0 < 30000, "stopped promptly");
});

test("javascript: a large allocation outside the heap (Buffer) that exits normally is Memory Limit Exceeded, not accepted", jsOpts, async () => {
  const r = await run("javascript", 'const b=Buffer.alloc(1500*1024*1024); b.fill(1); console.log("done");', [tc("", "done")], { timeLimitMs: 10000 });
  assert.notEqual(r.verdict, "ACCEPTED", "1.5 GB allocated and accepted at a 256 MB limit");
  assert.equal(r.verdict, "MLE", `got ${r.verdict}: ${why(r)}`);
});

test("javascript: a legitimately memory-hungry solution (3 million numbers, a copy of them, a sum) is still accepted", jsOpts, async () => {
  accepted(await run("javascript", "const a=Array.from({length:3000000},(_,i)=>i); const b=a.map(x=>x); let s=0; for(const x of b) s+=x; console.log(s);", [tc("", "4499998500000")], { timeLimitMs: 10000 }), "3 million numbers");
});

test("javascript: a very small memory limit does not make the language unusable (Node's own baseline is exempt)", jsOpts, async () => {
  accepted(await run("javascript", "console.log(1+1)", [tc("", "2")], { memoryLimitKb: 65536 }), "64 MB limit, trivial program");
});

// ---------------------------------------------------------------- concurrency and isolation across languages

test("concurrent submissions in all four languages each get their own result, and leave no temp directories behind", { skip: !LINUX ? "needs Linux with /usr/bin/time" : false }, async () => {
  const langs = ["java", "c", "cpp", "javascript"].filter((l) => TOOLS[l]);
  if (!langs.length) return;
  const before = judgeDirs().length;
  const jobs = [];
  for (let i = 0; i < PARALLEL; i++) {
    const lang = langs[i % langs.length];
    const token = `${lang}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    jobs.push(run(lang, P.echoLine[lang], [tc(token, token)]).then((r) => ({ lang, token, r })));
  }
  const results = await Promise.all(jobs);
  for (const { lang, token, r } of results) {
    assert.equal(r.verdict, "ACCEPTED", `${lang} ${token}: ${why(r)}`);
    assert.equal(r.passedCases, 1);
  }
  // a wrong program among the others must stay wrong: results are not mixed up
  const mixed = await Promise.all(langs.flatMap((lang) => [run(lang, P.wrong[lang], [tc("", "right")]), run(lang, P.sum[lang], [tc("20 22", "42")])]));
  mixed.forEach((r, i) => assert.equal(r.verdict, i % 2 === 0 ? "WRONG_ANSWER" : "ACCEPTED", `mixed job ${i}: ${why(r)}`));
  await settle();
  assert.ok(judgeDirs().length <= before, `temp directories left behind: ${judgeDirs().length - before}`);
});

test("a submission that fails to compile does not leave its working directory behind", { skip: !LINUX || !TOOLS.cpp ? "needs Linux with g++" : false }, async () => {
  const before = judgeDirs().length;
  for (let i = 0; i < 5; i++) await run("cpp", P.syntax.cpp, [tc("", "")]);
  await settle();
  assert.ok(judgeDirs().length <= before, "no leftover judge-* directory");
});

test("the production sandbox: no outbound network and no view of the server's own environment (only when asked for, inside the judge container)", { skip: !LINUX ? "needs Linux" : false }, async () => {
  if (process.env.JLX_EXPECT_NO_NETWORK === "1" && TOOLS.javascript) {
    const code = 'const net=require("net"); const s=net.connect({host:"1.1.1.1",port:53,timeout:1500}); s.on("connect",()=>{console.log("CONNECTED");process.exit(0)}); s.on("error",()=>{console.log("blocked");process.exit(0)}); s.on("timeout",()=>{console.log("blocked");process.exit(0)});';
    accepted(await run("javascript", code, [tc("", "blocked")], { timeLimitMs: 6000 }), "no outbound network");
  }
  if (process.env.JLX_EXPECT_SANDBOX_USER === "1" && TOOLS.c) {
    const code = '#include <stdio.h>\nint main(void){ FILE*f=fopen("/proc/1/environ","r"); puts(f?"READABLE":"denied"); return 0; }';
    accepted(await run("c", code, [tc("", "denied")]), "the server's process environment is not readable");
  }
});
