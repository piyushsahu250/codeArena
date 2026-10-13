// Verifies the C judge's isolation FOR REAL, inside the environment it runs in. Meant to be run in the production container (docker exec codearena-backend node
// scripts/verifyCJudgeSandbox.js): it calls judgeSubmission() with probe programs written in C and asserts on what the sandboxed program actually experiences.
// Non-destructive by design: no live fork bomb (RLIMIT_NPROC is read, never exceeded), no real exfiltration (a read is only attempted to see it is refused), and
// the network probe uses one short connect() with a timeout. Where privilege dropping is off (a developer machine, CI) the isolation checks are reported as
// NOT APPLICABLE instead of failing, so the result never overstates what ran.
const { judgeSubmission, DROP_PRIVILEGES, SANDBOX_UID } = require("../src/utils/judge");
const { spawnSync } = require("child_process");

let failures = 0, notApplicable = 0;
const report = (label, status, extra = "") => { if (status === "FAIL") failures++; if (status === "N/A") notApplicable++; console.log(`${status.padEnd(4)}  ${label}${extra ? "  -> " + extra : ""}`); };
const probe = async (code, input = "") => {
  const r = await judgeSubmission({ language: "c", code, testCases: [{ input, expected: "__probe__" }], timeLimitMs: 6000 });
  const d = r.details && r.details[0];
  return { verdict: r.verdict, out: String((d && (d.actual ?? d.error)) ?? "").trim(), summary: r.errorSummary };
};

(async () => {
  const gcc = spawnSync("gcc", ["--version"], { encoding: "utf8" });
  console.log("gcc:", (gcc.stdout || gcc.stderr || "not found").split("\n")[0]);
  console.log("JUDGE_DROP_PRIVILEGES effective:", DROP_PRIVILEGES, DROP_PRIVILEGES ? `(sandbox uid ${SANDBOX_UID})` : "");
  // Which C dialect the compiler really provides: compile and run a one-line probe (no shell, argument arrays only).
  const fs = require("fs"), os = require("os"), path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cstd-"));
  fs.writeFileSync(path.join(dir, "p.c"), '#include <stdio.h>\nint main(void){printf("%ld\n",(long)__STDC_VERSION__);return 0;}\n');
  const built = spawnSync("gcc", ["-std=gnu17", path.join(dir, "p.c"), "-o", path.join(dir, "p")], { encoding: "utf8" });
  const ran = built.status === 0 ? spawnSync(path.join(dir, "p"), [], { encoding: "utf8" }) : { stdout: "" };
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("__STDC_VERSION__ under -std=gnu17:", (ran.stdout || "").trim() || "(could not compile the probe)", "(201710 = C17)");

  const sanity = await probe('#include <stdio.h>\n#include <math.h>\nint main(void){volatile double x=16; printf("%.0f\\n", sqrt(x)); return 0;}');
  report("sanity: C compiles with -lm and runs", sanity.out === "4" ? "PASS" : "FAIL", `${sanity.verdict} ${sanity.out}`);

  const secrets = await probe('#include <stdio.h>\n#include <stdlib.h>\nint main(void){const char*k[]={"JWT_SECRET","DATABASE_URL","DIRECT_DATABASE_URL","PII_ENCRYPTION_KEY","MAIL_PASSWORD","GEMINI_API_KEY","AWS_SECRET_ACCESS_KEY","AWS_SESSION_TOKEN"};int n=0;for(int i=0;i<8;i++)if(getenv(k[i]))n++;printf("%d\\n",n);return 0;}');
  report("the program sees none of the server's secret environment variables", secrets.out === "0" ? "PASS" : "FAIL", secrets.out);

  if (!DROP_PRIVILEGES) {
    ["runs as the unprivileged sandbox user", "cannot read /etc/shadow or the application's files", "cannot write outside its temporary directory", "has no outbound network", "has a process-count limit"].forEach((l) => report(l, "N/A", "privilege dropping is off in this environment"));
  } else {
    const who = await probe('#include <stdio.h>\n#include <unistd.h>\nint main(void){printf("%d %d\\n",(int)getuid(),(int)getgid());return 0;}');
    report("runs as the unprivileged sandbox user, not root", who.out.split(" ")[0] === String(SANDBOX_UID) && who.out.split(" ")[0] !== "0" ? "PASS" : "FAIL", who.out);
    const rd = await probe('#include <stdio.h>\nint main(void){const char*f[]={"/etc/shadow","/app/.env","/proc/1/environ","/root/.aws/credentials"};int ok=0;for(int i=0;i<4;i++){FILE*p=fopen(f[i],"r");if(p){ok++;fclose(p);}}printf("%d\\n",ok);return 0;}');
    report("cannot open /etc/shadow, /app/.env, /proc/1/environ or root's AWS files", rd.out === "0" ? "PASS" : "FAIL", `readable: ${rd.out}`);
    const wr = await probe('#include <stdio.h>\nint main(void){const char*f[]={"/app/pwned.txt","/etc/pwned.txt","/usr/local/bin/pwned"};int ok=0;for(int i=0;i<3;i++){FILE*p=fopen(f[i],"w");if(p){ok++;fclose(p);remove(f[i]);}}printf("%d\\n",ok);return 0;}');
    report("cannot create files in /app, /etc or /usr/local/bin", wr.out === "0" ? "PASS" : "FAIL", `writable: ${wr.out}`);
    const net = await probe('#include <stdio.h>\n#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <poll.h>\nint main(void){int s=socket(AF_INET,SOCK_STREAM,0);if(s<0){puts("blocked");return 0;}fcntl(s,F_SETFL,O_NONBLOCK);struct sockaddr_in a={0};a.sin_family=AF_INET;a.sin_port=htons(53);inet_pton(AF_INET,"8.8.8.8",&a.sin_addr);int r=connect(s,(struct sockaddr*)&a,sizeof a);if(r<0){struct pollfd p={s,POLLOUT,0};r=poll(&p,1,2000)>0?0:-1;}puts(r==0?"CONNECTED":"blocked");return 0;}');
    report("has no outbound network", net.out === "blocked" ? "PASS" : "FAIL", net.out);
    const lim = await probe('#include <stdio.h>\n#include <sys/resource.h>\nint main(void){struct rlimit r;getrlimit(RLIMIT_NPROC,&r);printf("%lu\\n",(unsigned long)r.rlim_cur);return 0;}');
    report("has a process-count limit applied (read only, no fork bomb)", Number(lim.out) > 0 && Number(lim.out) <= 1024 ? "PASS" : "FAIL", lim.out);
  }

  const mem = await probe('#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(void){size_t n=2000u*1024*1024;char*p=malloc(n);if(!p){puts("denied");return 0;}memset(p,1,n);puts("allocated");return 0;}');
  report("a 2 GB allocation is denied or killed, never accepted", mem.out !== "allocated" ? "PASS" : "FAIL", `${mem.verdict} ${mem.out}`);
  const tle = await judgeSubmission({ language: "c", code: "int main(void){for(;;){} }", testCases: [{ input: "", expected: "" }], timeLimitMs: 800 });
  report("an infinite loop ends as TLE", tle.verdict === "TLE" ? "PASS" : "FAIL", tle.verdict);
  const ole = await judgeSubmission({ language: "c", code: '#include <stdio.h>\nint main(void){for(;;)puts("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");}', testCases: [{ input: "", expected: "" }], timeLimitMs: 6000 });
  report("an output flood is cut off (OLE or TLE)", ["OLE", "TLE"].includes(ole.verdict) ? "PASS" : "FAIL", ole.verdict);
  const left = spawnSync("sh", ["-c", "ls /tmp 2>/dev/null | grep -c '^judge-'"], { encoding: "utf8" });
  report("no judge workspace is left behind after failures", Number((left.stdout || "0").trim()) === 0 ? "PASS" : "FAIL", `leftover judge-* directories: ${(left.stdout || "?").trim()}`);

  console.log(`\n${failures === 0 ? "C JUDGE SANDBOX: no failures" : failures + " FAILURE(S)"}${notApplicable ? `; ${notApplicable} check(s) not applicable here` : ""}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
