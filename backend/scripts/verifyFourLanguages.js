// Runs the same stdin/stdout problem (sum of two integers) through the real judge in C, C++, Java and Python.
const { judgeSubmission } = require("../src/utils/judge");
const code = {
  c: `#include <stdio.h>
int main(){long a,b;scanf("%ld %ld",&a,&b);printf("%ld",a+b);putchar(10);return 0;}`,
  cpp: `#include <iostream>
int main(){long a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;return 0;}`,
  java: "import java.util.*; public class Main { public static void main(String[] x){ Scanner s=new Scanner(System.in); long a=s.nextLong(),b=s.nextLong(); System.out.println(a+b);} }",
  python: "a,b=map(int,input().split())\nprint(a+b)\n",
};
(async () => {
  let bad = 0;
  for (const [language, src] of Object.entries(code)) {
    const r = await judgeSubmission({ language, code: src, testCases: [{ input: "2 3", expected: "5" }, { input: "-5 -7", expected: "-12" }], evaluationType: "STDIO", timeLimitMs: 4000 });
    if (r.verdict !== "ACCEPTED") bad++;
    console.log(language.padEnd(7), r.verdict, r.verdict === "ACCEPTED" ? "" : JSON.stringify(r).slice(0, 400));
  }
  console.log(bad === 0 ? "ALL FOUR LANGUAGES OK" : "PROBLEM");
  process.exit(0);
})();
