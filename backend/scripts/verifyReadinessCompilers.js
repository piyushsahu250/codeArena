// Runs every DSA readiness question's per-language starter + the generic default starters through
// the real judge: a starter must COMPILE (verdict may be WRONG_ANSWER, never COMPILE_ERROR). Also
// runs correct reference solutions for "Array Sum and Average Classifier" in Java/Python/C/C++.
const prisma = require("../src/prisma");
const { judgeSubmission } = require("../src/utils/judge");
const D = {
  python: "# Read input via input(), print your answer\n",
  c: '#include <stdio.h>\n\nint main() {\n    // read input with scanf, print your answer with printf\n    return 0;\n}\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // read input with cin, print your answer with cout\n    return 0;\n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // read input via sc, print your answer with System.out\n    }\n}\n',
};
const REF = {
  java: 'import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); long s=0; for(int i=0;i<n;i++) s+=sc.nextInt(); if(n==0){System.out.println("EMPTY");return;} System.out.println(s); System.out.println(s/n);} }',
  python: 'n=int(input())\narr=list(map(int,input().split())) if n>0 else []\nif n==0: print("EMPTY")\nelse:\n    s=sum(arr); print(s); print(int(s/n))\n',
  c: `#include <stdio.h>
int main(){int n;scanf("%d",&n);long s=0;for(int i=0;i<n;i++){int x;scanf("%d",&x);s+=x;} if(n==0){puts("EMPTY");return 0;} printf("%ld",s);putchar(10);printf("%ld",s/n);putchar(10);return 0;}`,
  cpp: `#include <bits/stdc++.h>
using namespace std;int main(){int n;cin>>n;long long s=0;for(int i=0;i<n;i++){int x;cin>>x;s+=x;} if(n==0){cout<<"EMPTY"<<endl;return 0;} cout<<s<<endl<<s/n<<endl;}`,
};
(async () => {
  let bad = 0;
  const pool = await prisma.readinessQuestionPool.findMany({ where: { subject: { name: "DSA" } }, include: { question: { include: { testCases: true } } } });
  for (const { question: q } of pool) {
    if (q.questionType !== "CODING") continue;
    const cases = q.testCases.slice(0, 2).map((t) => ({ input: t.input, expected: t.expected }));
    for (const lang of ["java", "python", "c", "cpp"]) {
      const code = q.starterCodeByLanguage?.[lang] || D[lang];
      const src = q.starterCodeByLanguage?.[lang] ? "question starter" : "generic default";
      const r = await judgeSubmission({ language: lang, code, testCases: cases, evaluationType: q.evaluationType, functionSignature: q.functionSignature, timeLimitMs: q.timeLimitMs });
      const ok = r.verdict !== "COMPILE_ERROR" && r.verdict !== "RUNTIME_ERROR" || /EMPTY|TODO/.test(code);
      if (r.verdict === "COMPILE_ERROR") bad++;
      console.log(`${r.verdict === "COMPILE_ERROR" ? "FAIL" : "PASS"}  ${q.title.slice(0, 40).padEnd(40)} ${lang.padEnd(6)} ${src.padEnd(16)} -> ${r.verdict}${r.errorSummary?.message ? " " + r.errorSummary.message.slice(0, 80) : ""}`);
    }
  }
  const q = pool.find((p) => p.question.title === "Array Sum and Average Classifier").question;
  const all = q.testCases.map((t) => ({ input: t.input, expected: t.expected }));
  for (const lang of ["java", "python", "c", "cpp"]) {
    const r = await judgeSubmission({ language: lang, code: REF[lang], testCases: all, evaluationType: q.evaluationType, timeLimitMs: q.timeLimitMs });
    if (r.verdict !== "ACCEPTED") bad++;
    console.log(`${r.verdict === "ACCEPTED" ? "PASS" : "FAIL"}  Array Sum reference solution ${lang.padEnd(6)} -> ${r.verdict} ${r.passedCases}/${r.totalCases} ${JSON.stringify(r.errorSummary || r.details?.[0] || "").slice(0, 400)}`);
  }
  console.log(bad ? `${bad} FAILURES` : "ALL COMPILER CHECKS PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
