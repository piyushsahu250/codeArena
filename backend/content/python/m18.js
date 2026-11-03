// Phase 4 / Module 18: Software Engineering and Development Tools. Lessons live in m18a.js to m18c.js; this file adds the module assessment.
"use strict";
const { task } = require("./lib");
const lessons = [...require("./m18a").lessons, ...require("./m18b").lessons, ...require("./m18c").lessons];

module.exports = {
  module: {
    title: "Phase 4 - Software Engineering and Development Tools",
    description: "Git and GitHub, branching and pull requests, debugging with tracebacks and pdb, testing with pytest, test-driven development and mocks, code quality with PEP 8, Ruff and Black, logging and configuration, project structure and packaging, and secure coding.",
    chapters: [
      { title: "Version Control and Collaboration", description: "Git, branches, merges, conflicts and pull requests.", lessons: lessons.slice(0, 2) },
      { title: "Debugging and Testing", description: "Finding bugs systematically and proving code works with automated tests.", lessons: lessons.slice(2, 5) },
      { title: "Quality, Configuration and Packaging", description: "Clean code, logging, settings, project layout and dependencies.", lessons: lessons.slice(5, 8) },
      { title: "Secure Coding", description: "Writing code that survives hostile input.", lessons: lessons.slice(8) },
    ],
    assessment: {
      title: "Module 18 Assessment: Software Engineering and Development Tools",
      description: "Standard-library problems on versions, commit messages, log levels and test reports.",
      questions: [
        task("Which version is newer", "Read two dotted version numbers on separate lines (numeric parts only; a missing part counts as 0). Print A is newer or B is newer, using the text of the newer version in place of the letter, or print same when they are equal.", "", `def parts(text):
    return [int(p) for p in text.split(".")]


a, b = input(), input()
pa, pb = parts(a), parts(b)
size = max(len(pa), len(pb))
pa += [0] * (size - len(pa))
pb += [0] * (size - len(pb))
if pa > pb:
    print(f"{a} is newer")
elif pb > pa:
    print(f"{b} is newer")
else:
    print("same")`, [["1.10.0\n1.9.9", "1.10.0 is newer"], ["2.0\n2.0.0", "same"], ["1.2.3\n1.2.4", "1.2.4 is newer"], ["0.9\n0.10", "0.10 is newer"]]),
        task("Validate commit messages", "Read n and then n commit messages. A message is valid when it matches type: subject or type(scope): subject, where type is one of feat, fix, docs, test, refactor, chore, the scope uses lower-case letters, digits and dashes, and the subject is 1 to 50 characters. Print valid: MESSAGE or invalid: MESSAGE for each.", "", `import re

PATTERN = re.compile(r"^(feat|fix|docs|test|refactor|chore)(\\([a-z0-9-]+\\))?: .{1,50}$")
n = int(input())
for _ in range(n):
    message = input()
    print(("valid: " if PATTERN.match(message) else "invalid: ") + message)`, [["3\nfeat(api): add student endpoint\nfixed stuff\nfix: handle empty input", "valid: feat(api): add student endpoint\ninvalid: fixed stuff\nvalid: fix: handle empty input"], ["2\nchore: update deps\nDocs: update readme", "valid: chore: update deps\ninvalid: Docs: update readme"], ["2\nfix(Auth): wrong scope case\ntest(db-layer): cover the rollback path", "invalid: fix(Auth): wrong scope case\nvalid: test(db-layer): cover the rollback path"], ["2\nfeat:\nrefactor(core): " + "x".repeat(51), "invalid: feat:\ninvalid: refactor(core): " + "x".repeat(51)]]),
        task("Filter log lines by level", "Read a minimum level (DEBUG, INFO, WARNING, ERROR or CRITICAL, in that order of severity), then n, then n log lines that each start with a level. Print the lines whose level is at least the minimum, in their original order, then kept K of N.", "", `LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
minimum = LEVELS.index(input())
n = int(input())
kept = 0
for _ in range(n):
    line = input()
    if LEVELS.index(line.split()[0]) >= minimum:
        print(line)
        kept += 1
print(f"kept {kept} of {n}")`, [["WARNING\n4\nINFO started\nWARNING retry 1\nERROR failed\nDEBUG detail", "WARNING retry 1\nERROR failed\nkept 2 of 4"], ["DEBUG\n2\nDEBUG a\nINFO b", "DEBUG a\nINFO b\nkept 2 of 2"], ["CRITICAL\n3\nERROR x\nCRITICAL y\nINFO z", "CRITICAL y\nkept 1 of 3"], ["ERROR\n1\nINFO only", "kept 0 of 1"]]),
        task("Summarise a test run", "Read lines NAME: RESULT where RESULT is PASSED, FAILED or SKIPPED. Print a summary like pytest does, listing only categories that occurred, in the order failed, passed, skipped, separated by a comma and a space (for example 1 failed, 2 passed, 1 skipped). On the next line print exit code: 1 if anything failed, otherwise exit code: 0.", "", `import sys

counts = {"FAILED": 0, "PASSED": 0, "SKIPPED": 0}
for line in sys.stdin.read().splitlines():
    if line.strip():
        counts[line.rsplit(":", 1)[1].strip()] += 1
parts = [f"{counts[key]} {key.lower()}" for key in ("FAILED", "PASSED", "SKIPPED") if counts[key]]
print(", ".join(parts))
print("exit code:", 1 if counts["FAILED"] else 0)`, [["t1: PASSED\nt2: FAILED\nt3: PASSED\nt4: SKIPPED", "1 failed, 2 passed, 1 skipped\nexit code: 1"], ["a: PASSED", "1 passed\nexit code: 0"], ["a: SKIPPED\nb: SKIPPED", "2 skipped\nexit code: 0"], ["x: FAILED\ny: FAILED", "2 failed\nexit code: 1"]]),
      ],
    },
  },
};
