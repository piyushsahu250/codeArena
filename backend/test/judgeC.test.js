// End-to-end tests of C through the real judge (backend/src/utils/judge.js): compile with gcc, run in the same sandboxed spawn path production uses,
// compare output. They need gcc on the machine (the CI runner and the production image both have it) and are skipped, never faked, without it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
// RLIMIT_NPROC counts every process of the OS user, and the judge caps it at 64 for the sandbox user in production. A developer or CI user already runs more than that,
// which broke Node (it starts threads) in these tests only. The cap is read when judge.js loads, so it is raised here, before the require.
process.env.JUDGE_MAX_PROCESSES = process.env.JUDGE_MAX_PROCESSES || "4096";
const { judgeSubmission } = require("../src/utils/judge");
const H = require("../src/utils/functionHarness");

const has = (cmd) => { try { return spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0; } catch { return false; } };
const HAS_GCC = has("gcc");
const opts = { skip: HAS_GCC ? false : "gcc is not installed on this machine" };

const tc = (input, expected) => ({ input, expected });
const run = (code, testCases, extra = {}) => judgeSubmission({ language: "c", code, testCases, timeLimitMs: 4000, ...extra });
const accepted = (r, why = "") => assert.equal(r.verdict, "ACCEPTED", `${why} ${JSON.stringify(r.errorSummary || r.details?.[0] || {})}`);

test("the C compile command is an argument array that compiles as C with the math library linked", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "utils", "judge.js"), "utf8");
  const m = src.match(/c: \{\s*srcName: "sol\.c",[\s\S]*?compile: \(file, dir\) => \(\{ cmd: "(\w+)", args: (\[[^\]]*\])/);
  assert.ok(m, "the C runner is defined");
  assert.equal(m[1], "gcc", "C is compiled by gcc, not g++");
  assert.match(m[2], /"-std=gnu17"/);
  assert.match(m[2], /"-lm"\]$/, "-lm comes after the source and output so the linker can resolve math symbols");
  assert.ok(m[2].indexOf("file") < m[2].indexOf('"-lm"'));
});

test("Hello World", opts, async () => accepted(await run('#include <stdio.h>\nint main(void){ printf("Hello World\\n"); return 0; }', [tc("", "Hello World")])));

test("integer addition, even/odd, loop summation, several inputs", opts, async () => {
  accepted(await run('#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}', [tc("2 3", "5"), tc("-4\n10", "6")]), "add");
  accepted(await run('#include <stdio.h>\nint main(){int n;scanf("%d",&n);puts(n%2==0?"Even":"Odd");return 0;}', [tc("4", "Even"), tc("7", "Odd")]), "even/odd");
  accepted(await run('#include <stdio.h>\nint main(){int n;long s=0;scanf("%d",&n);for(int i=1;i<=n;i++)s+=i;printf("%ld\\n",s);return 0;}', [tc("100", "5050")]), "sum");
});

test("arrays, strings with spaces, multiple test cases, large input", opts, async () => {
  accepted(await run('#include <stdio.h>\nint main(){int n,a[100];scanf("%d",&n);for(int i=0;i<n;i++)scanf("%d",&a[i]);int m=a[0];for(int i=1;i<n;i++)if(a[i]>m)m=a[i];printf("%d\\n",m);return 0;}', [tc("5\n3 9 2 7 1", "9")]), "array max");
  accepted(await run('#include <stdio.h>\n#include <string.h>\nint main(){char s[256];fgets(s,sizeof s,stdin);int w=0,in=0;for(char*p=s;*p;p++){if(*p==\' \'||*p==\'\\n\')in=0;else if(!in){in=1;w++;}}printf("%d\\n",w);return 0;}', [tc("the quick brown fox\n", "4")]), "words");
  accepted(await run('#include <stdio.h>\nint main(){int t;scanf("%d",&t);while(t--){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a*b);}return 0;}', [tc("3\n1 2\n3 4\n5 6", "2\n12\n30")]), "T cases");
  const n = 200000; const nums = Array.from({ length: n }, (_, i) => (i % 1000) + 1); const sum = nums.reduce((a, b) => a + b, 0);
  accepted(await run('#include <stdio.h>\nint main(){int n,x;long s=0;scanf("%d",&n);while(n--){scanf("%d",&x);s+=x;}printf("%ld\\n",s);return 0;}', [tc(`${n}\n${nums.join(" ")}`, String(sum))], { timeLimitMs: 6000 }), "large input");
});

test("empty input is handled by the program, not by the judge", opts, async () => accepted(await run('#include <stdio.h>\nint main(){int x; if(scanf("%d",&x)!=1) puts("none"); else puts("some"); return 0;}', [tc("", "none")])));

test("math.h functions on runtime values link (needs -lm)", opts, async () => {
  const r = await run('#include <stdio.h>\n#include <math.h>\nint main(){double x;scanf("%lf",&x);printf("%.3f %.1f\\n",sqrt(x),pow(x,2.0));return 0;}', [tc("16", "4.000 256.0"), tc("2", "1.414 4.0")]);
  accepted(r, "sqrt/pow");
});

test("wrong answer, compilation error (line kept, no server path), runtime error, timeout", opts, async () => {
  const wa = await run('#include <stdio.h>\nint main(){puts("nope");return 0;}', [tc("", "yes")]);
  assert.equal(wa.verdict, "WRONG_ANSWER");
  const ce = await run('#include <stdio.h>\nint main(){\n  int x = ;\n  return 0;\n}', [tc("", "")]);
  assert.equal(ce.verdict, "COMPILE_ERROR");
  assert.equal(ce.errorSummary.line, 3, "the compiler line number reaches the student");
  assert.ok(!/judge-|\/tmp\/|sol_bin|\/var\//.test(JSON.stringify(ce)), "no temporary server path in the response");
  const rt = await run("int main(){int*p=0;*p=1;return 0;}", [tc("", "")]);
  assert.notEqual(rt.verdict, "ACCEPTED", "a segfault never passes");
  assert.ok(rt.details[0].verdict === "RUNTIME_ERROR", `segfault is a runtime error, got ${rt.details[0].verdict}`);
  assert.equal(rt.errorSummary.type, "Segmentation Fault");
  const tle = await run("int main(){for(;;){} return 0;}", [tc("", "")], { timeLimitMs: 500 });
  assert.equal(tle.verdict, "TLE");
});

test("excessive memory is not accepted; excessive output is cut off", opts, async () => {
  const mem = await run('#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(){size_t n=900u*1024*1024;char*p=malloc(n);if(!p){puts("fail");return 0;}memset(p,1,n);puts("done");return 0;}', [tc("", "done")], { memoryLimitKb: 65536 });
  assert.notEqual(mem.verdict, "ACCEPTED", "a 900 MB allocation under a 64 MB limit must not be accepted");
  const out = await run('#include <stdio.h>\nint main(){for(;;)puts("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");return 0;}', [tc("", "")], { timeLimitMs: 5000 });
  assert.ok(["OLE", "TLE"].includes(out.verdict), `an output flood ends as OLE or TLE, got ${out.verdict}`);
});

test("the program cannot read the server's secrets from its environment", opts, async () => {
  process.env.JWT_SECRET = "must-never-reach-student-code"; process.env.DATABASE_URL = "postgres://secret";
  const r = await run('#include <stdio.h>\n#include <stdlib.h>\nint main(){puts(getenv("JWT_SECRET")||getenv("DATABASE_URL")?"LEAK":"none");return 0;}', [tc("", "none")]);
  accepted(r, "env whitelist");
});

test("concurrent submissions are isolated from each other", opts, async () => {
  const code = '#include <stdio.h>\nint main(){long n;scanf("%ld",&n);printf("%ld\\n",n*n);return 0;}';
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => run(code, [tc(String(i + 3), String((i + 3) * (i + 3)))])));
  results.forEach((r, i) => assert.equal(r.verdict, "ACCEPTED", `submission ${i}`));
});

test("a partially correct program is PARTIAL and a bad language is refused by the judge", opts, async () => {
  const r = await run('#include <stdio.h>\nint main(){int n;scanf("%d",&n);printf("%d\\n",n<5?n:0);return 0;}', [tc("1", "1"), tc("9", "9")]);
  assert.equal(r.verdict, "PARTIAL");
  const bad = await judgeSubmission({ language: "c23-evil", code: "x", testCases: [tc("", "")] });
  assert.equal(bad.verdict, "COMPILE_ERROR");
});

// ---- Function-based mode ----
const sig = (methodName, returnType, ...params) => ({ methodName, returnType, params: params.map(([name, type]) => ({ name, type })) });
const fn = (signature, code, cases, extra = {}) => judgeSubmission({ language: "c", code, testCases: cases, timeLimitMs: 4000, evaluationType: "FUNCTION", functionSignature: signature, ...extra });

test("function mode: scalars, strings, booleans and doubles", opts, async () => {
  accepted(await fn(sig("addNums", "int", ["a", "int"], ["b", "int"]), "int addNums(int a, int b) { return a + b; }", [tc("2\n3", "5"), tc("-7\n7", "0")]), "int");
  accepted(await fn(sig("lenOf", "int", ["s", "string"]), "#include <string.h>\nint lenOf(char* s) { return (int)strlen(s); }", [tc("hello world", "11")]), "string");
  accepted(await fn(sig("isPos", "boolean", ["x", "int"]), "int isPos(int x) { return x > 0; }", [tc("5", "true"), tc("-1", "false")]), "boolean");
  accepted(await fn(sig("pi", "double", ["x", "int"]), "double pi(int x) { return 3.14159265358979; }", [tc("0", "3.14159265358979")]), "double keeps full precision");
  accepted(await fn(sig("half", "double", ["x", "int"]), "double half(int x) { return x / 2.0; }", [tc("7", "3.5")]), "double");
});

test("function mode: arrays (pointer + length in, malloc'd array + returnSize out)", opts, async () => {
  accepted(await fn(sig("sumArr", "int", ["nums", "int[]"]), "int sumArr(int* nums, int numsSize) { int s = 0; for (int i = 0; i < numsSize; i++) s += nums[i]; return s; }", [tc("1 2 3 4", "10"), tc("", "0")]), "int[] in");
  accepted(await fn(sig("doubleAll", "int[]", ["a", "int[]"]), "#include <stdlib.h>\nint* doubleAll(int* a, int aSize, int* returnSize) { int* r = malloc((aSize ? aSize : 1) * sizeof(int)); for (int i = 0; i < aSize; i++) r[i] = a[i] * 2; *returnSize = aSize; return r; }", [tc("1 2 3", "2 4 6"), tc("", "")]), "int[] out");
  accepted(await fn(sig("flags", "boolean[]", ["a", "int[]"]), "#include <stdlib.h>\nint* flags(int* a, int aSize, int* returnSize) { int* r = malloc((aSize ? aSize : 1) * sizeof(int)); for (int i = 0; i < aSize; i++) r[i] = a[i] > 1; *returnSize = aSize; return r; }", [tc("1 2 3", "false true true")]), "boolean[] out");
  accepted(await fn(sig("meanOf", "double", ["a", "double[]"]), "double meanOf(double* a, int aSize) { double s = 0; for (int i = 0; i < aSize; i++) s += a[i]; return aSize ? s / aSize : 0; }", [tc("1.5 2.5 3.5", "2.5")]), "double[] in");
  accepted(await fn(sig("big", "long[]", ["a", "long[]"]), "#include <stdlib.h>\nlong* big(long* a, int aSize, int* returnSize) { long* r = malloc(aSize * sizeof(long)); for (int i = 0; i < aSize; i++) r[i] = a[i] * 3000000000L; *returnSize = aSize; return r; }", [tc("1 2", "3000000000 6000000000")]), "long[]");
});

test("function mode: compile error line maps to the student's own code, a full program is also accepted", opts, async () => {
  const bad = await fn(sig("addNums", "int", ["a", "int"], ["b", "int"]), "int addNums(int a, int b) {\n  return a +;\n}", [tc("1\n2", "3")]);
  assert.equal(bad.verdict, "COMPILE_ERROR");
  assert.equal(bad.errorSummary.line, 2, "line numbers do not include the hidden driver");
  accepted(await fn(sig("addNums", "int", ["a", "int"], ["b", "int"]), '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}', [tc("2\n3", "5")]), "full program in a function question");
});

test("function-mode starter code and language availability follow the C conventions", () => {
  const s = sig("doubleAll", "int[]", ["a", "int[]"]);
  assert.ok(H.languagesSupportedBy(s).includes("c"), "array signatures are offered in C now");
  const starter = H.generateStarterCode("c", s);
  assert.match(starter, /int\* doubleAll\(int\* a, int aSize, int\* returnSize\)/);
  assert.match(starter, /malloc'd/);
  assert.ok(!H.languagesSupportedBy(sig("f", "int", ["xs", "string[]"])).includes("c"), "string[] is the one shape C does not offer");
  assert.throws(() => H.generateStarterCode("c", sig("f", "int", ["xs", "string[]"])), /string\[\]/);
  assert.throws(() => H.wrapFunctionCode("c", sig("f", "string[]", ["a", "int"]), "x"), /string\[\]/);
  assert.match(H.generateStarterCode("c", sig("addNums", "int", ["a", "int"], ["b", "int"])), /int addNums\(int a, int b\)/, "scalar starter is unchanged");
});

test("regression: the other languages still run through the same judge", async (t) => {
  if (has("python3")) accepted(await judgeSubmission({ language: "python", code: "print(int(input())+1)", testCases: [tc("4", "5")], timeLimitMs: 4000 }), "python");
  else t.diagnostic("python3 not installed: skipped");
  if (has("node")) accepted(await judgeSubmission({ language: "javascript", code: "console.log(Number(require('fs').readFileSync(0,'utf8'))+1)", testCases: [tc("4", "5")], timeLimitMs: 4000 }), "javascript");
  if (has("g++")) accepted(await judgeSubmission({ language: "cpp", code: "#include <iostream>\nint main(){int x;std::cin>>x;std::cout<<x+1<<std::endl;}", testCases: [tc("4", "5")], timeLimitMs: 8000 }), "cpp");
  else t.diagnostic("g++ not installed: skipped");
});
