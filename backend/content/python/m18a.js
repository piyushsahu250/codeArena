// Phase 4 / Module 18, lessons 1-3: Git, branching with pull requests, and debugging.
// The Git examples drive a real git repository in a temporary folder (git must be installed, as it is on every developer machine and in CI).
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// Shared set-up for the examples that run real Git commands: a throw-away repository, no user config, fixed author.
const GIT = `import os, shutil, subprocess, tempfile, pathlib

work = pathlib.Path(tempfile.mkdtemp())
env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1", LC_ALL="C",
           GIT_AUTHOR_NAME="Asha", GIT_AUTHOR_EMAIL="asha@example.in",
           GIT_COMMITTER_NAME="Asha", GIT_COMMITTER_EMAIL="asha@example.in")


def git(*args, check=True):
    return subprocess.run(["git", "-c", "commit.gpgsign=false", *args], cwd=work, env=env,
                          capture_output=True, text=True, check=check)


def out(*args):
    return git(*args).stdout.rstrip("\\n")


def write(name, text):
    (work / name).write_bytes(text.encode())

`;

// ---------------------------------------------------------------- 1
lessons.push({
  title: "Git and GitHub Fundamentals: Tracking and Sharing Your Code",
  minutes: 60,
  learn: ["Explain the working directory, staging area, local repository and remote", "Use init, status, add, commit, diff, log, restore and clone", "Write a .gitignore so secrets and generated files never get committed", "Write clear commit messages and connect a local repository to GitHub"],
  why: "Every software team uses version control. Git gives you a safe history of your code, lets many people work together, and lets you undo mistakes. It is the first tool employers expect you to know.",
  realWorld: "A team of five fixes bugs and adds features in the same project at the same time. Git records who changed what and when, and GitHub is where the shared copy and the code reviews live.",
  simple: "Git is a <strong>time machine for your project</strong>. You <em>stage</em> the changes you want, <em>commit</em> them with a message to save a snapshot, and <em>push</em> the snapshots to GitHub to share them.",
  detail: `<h3>The four places your code lives</h3>
<ul><li><strong>Working directory</strong>: the files you edit.</li><li><strong>Staging area (index)</strong>: the changes you have chosen to include in the next commit (<code>git add</code>).</li><li><strong>Local repository</strong>: the history of commits on your machine (<code>git commit</code>).</li><li><strong>Remote</strong>: a shared copy on a server such as GitHub (<code>git push</code> and <code>git pull</code>).</li></ul>
${terminal("A first session (shown, not executed)", `$ git config --global user.name "Asha Rao"\n$ git config --global user.email "asha@example.in"\n$ git init\n$ git status\n$ git add app.py\n$ git commit -m "Add greeting app"\n$ git log --oneline\n$ git remote add origin https://github.com/asha/greeting.git\n$ git push -u origin main`)}
<h3>Everyday commands</h3>
${table(["Command", "What it does"], [["<code>git status</code>", "shows changed, staged and untracked files"], ["<code>git add FILE</code> / <code>git add -p</code>", "stages a file, or only the chunks you pick"], ["<code>git commit -m \"message\"</code>", "saves the staged changes as a snapshot"], ["<code>git diff</code> / <code>git diff --staged</code>", "shows unstaged / staged changes"], ["<code>git log --oneline</code>", "lists commits, newest first"], ["<code>git restore FILE</code>", "throws away uncommitted changes to a file"], ["<code>git restore --staged FILE</code>", "unstages a file but keeps the edit"], ["<code>git clone URL</code>", "copies a remote repository to your machine"], ["<code>git pull</code> / <code>git push</code>", "fetch and merge remote work / upload your commits"], ["<code>git revert COMMIT</code>", "adds a new commit that undoes an older one (safe for shared history)"]])}
<h3>What to keep out of Git</h3>
<p>A <code>.gitignore</code> file lists patterns Git must not track: <code>.env</code> (secrets), <code>__pycache__/</code>, <code>.venv/</code>, <code>*.log</code>, editor folders. <strong>If a secret was ever committed, treat it as leaked</strong>: rotate it. Deleting it in a later commit does not remove it from history.</p>
<h3>Good commit messages</h3>
<p>One logical change per commit. A short imperative subject line (about 50 characters): &quot;Fix off-by-one in pagination&quot;, not &quot;fixed stuff&quot;. Many teams follow <em>Conventional Commits</em>: <code>feat(api): add student endpoint</code>, <code>fix: handle empty input</code>, <code>docs: update README</code>.</p>
<h3>Git is not GitHub</h3>
<p>Git is the tool that runs on your machine. GitHub, GitLab and Bitbucket are services that host Git repositories and add pull requests, issues and automation (CI). Sign in with a personal access token or SSH key, never with a shared password, and never paste tokens into code.</p>`,
  syntax: { code: `git init\ngit add FILE\ngit commit -m "message"\ngit status --short\ngit log --oneline`, note: "Stage what you want, commit with a clear message, check status often." },
  diagram: graph("Where changes travel in Git", "Four boxes from left to right: working directory, staging area, local repository and remote on GitHub, joined by arrows labelled git add, git commit and git push.", 810, 150,
    [{ id: "w", k: "proc", t: "working\ndirectory", x: 80, y: 85, w: 120, h: 54 }, { id: "s", k: "proc", t: "staging\narea", x: 290, y: 85, w: 120, h: 54 }, { id: "l", k: "proc", t: "local\nrepository", x: 500, y: 85, w: 120, h: 54 }, { id: "r", k: "io", t: "remote\n(GitHub)", x: 710, y: 85, w: 130, h: 54 }],
    [{ from: "w", to: "s", label: "git add" }, { from: "s", to: "l", label: "git commit" }, { from: "l", to: "r", label: "git push" }]),
  example: { code: `${GIT}git("init", "-q", "-b", "main")
print("status:", out("status", "--short") or "clean")

write("app.py", "print('hello')\\n")
write(".env", "SECRET=abc\\n")
write(".gitignore", ".env\\n__pycache__/\\n")
print(out("status", "--short"))

git("add", ".gitignore", "app.py")
print(out("status", "--short"))
git("commit", "-q", "-m", "Add app and gitignore")

write("app.py", "print('hello, world')\\n")
print(out("status", "--short"))
print(out("diff", "--numstat").replace("\\t", " "))
git("commit", "-aqm", "Greet the world")

print(out("log", "--format=%s"))
print(out("rev-list", "--count", "HEAD"))
shutil.rmtree(work, ignore_errors=True)`, out: `status: clean
?? .gitignore
?? app.py
A  .gitignore
A  app.py
 M app.py
1 1 app.py
Greet the world
Add app and gitignore
2` },
  lineByLine: [["GIT set-up block", "Creates a throw-away folder and a git() helper that runs real Git commands there with a fixed author, so nothing touches your own settings."], ["git init -q -b main", "Starts a repository whose first branch is called main."], ["status --short ... clean", "A new repository has nothing to report."], ["?? .gitignore / ?? app.py", "?? means untracked. The .env file is missing from the list because .gitignore hides it."], ["A  app.py", "After git add the file is staged (added). The first column is the staging area."], ["M app.py with a leading space", "Modified in the working directory but not staged yet (second column)."], ["diff --numstat", "1 line added and 1 line removed in app.py."], ["commit -a", "Stages every tracked, modified file and commits in one step. It never adds new untracked files."], ["log --format=%s", "Prints only the subject lines, newest first."]],
  dryRun: { intro: "How one change moves through Git:", headers: ["Step", "Command", "Where the change is"], rows: [["1", "edit app.py", "working directory only"], ["2", "git add app.py", "staging area"], ["3", "git commit -m ...", "local repository (a new snapshot)"], ["4", "git push", "remote on GitHub"]] },
  realExample: { intro: "Checking commit messages against a convention, the way a commit-msg hook or CI step does.", code: `import re

PATTERN = re.compile(r"^(feat|fix|docs|test|refactor|chore)(\\([a-z0-9-]+\\))?: .{1,50}$")
messages = [
    "feat(api): add student endpoint",
    "fixed stuff",
    "fix: handle empty input",
    "feat: a very long subject line that goes on and on and on",
]
for message in messages:
    print(bool(PATTERN.match(message)), message)`, out: `True feat(api): add student endpoint
False fixed stuff
True fix: handle empty input
False feat: a very long subject line that goes on and on and on` },
  mistakes: ["Committing <code>.env</code>, passwords, API keys or large generated files.", "One giant commit called &quot;changes&quot;.", "Using <code>git add .</code> without looking at <code>git status</code> first.", "Working on <code>main</code> directly in a team project.", "Panicking after a mistake instead of using <code>git status</code>, <code>git log</code> and <code>git reflog</code> to understand it."],
  practices: ["Commit small, related changes often.", "Write the subject in the imperative: &quot;Add&quot;, &quot;Fix&quot;.", "Create <code>.gitignore</code> before the first commit.", "Run <code>git status</code> and <code>git diff --staged</code> before every commit."],
  interview: ["What is the difference between Git and GitHub?", "What is the staging area for?", "How do you undo the last commit that is already pushed?", "How do you stop tracking a file but keep it on disk?"],
  practiceQs: ["Which command shows what you staged?", "What does ?? mean in git status --short?", "Why is deleting a leaked password in a new commit not enough?", "Write a good commit message for fixing a division by zero."],
  revision: ["Working directory, staging area, local repository, remote.", "add, commit, push; status and diff to look.", ".gitignore keeps secrets and generated files out.", "Small commits with imperative subjects."],
  hinglish: "Git aapke code ka time machine hai. Pehle git add se changes stage karte hain, phir git commit se snapshot save hota hai, aur git push se GitHub par bhejte hain. .env jaisi secret files ko .gitignore mein daalo, aur commit message chhota aur saaf likho.",
  quiz: [
    mcq("Which command saves the staged changes as a snapshot in your local history?", ["git push", "git commit", "git status", "git clone"], 1, "commit records the staged changes; push only uploads existing commits."),
    mcq("In git status --short, what does ?? in front of a file name mean?", ["The file is deleted", "The file has a conflict", "The file is untracked", "The file is ignored"], 2, "?? marks an untracked file; ignored files are not listed at all."),
    mcq("A password was committed and pushed by mistake. What is the right response?", ["Delete it in the next commit and carry on", "Treat it as leaked and rotate it", "Rename the file", "Force-push an empty commit"], 1, "History keeps old versions and others may have copied it, so the secret must be changed."),
    mcq("Which pair names where a change sits after git add but before git commit?", ["Working directory", "Staging area", "Remote", "Stash only"], 1, "git add copies the change into the staging area (the index)."),
    mcq("Which is the best commit subject line?", ["changes", "fixed stuff", "Fix off-by-one in pagination", "WIP!!!"], 2, "It is short, imperative and says what changed.")
  ],
  tasks: [task("Replay a Git history", "Standard input holds commands, one per line: commit MESSAGE, branch NAME (a new branch that starts as a copy of the current one), checkout NAME, and log. There is a branch called main with no commits at the start. log prints the messages on the current branch, newest first, one per line, followed by a line with three dashes (---).", "import sys\nbranches = {\"main\": []}\ncurrent = \"main\"\nfor line in sys.stdin.read().splitlines():\n    command, _, rest = line.partition(\" \")\n    # handle commit, branch, checkout and log\n", `import sys
branches = {"main": []}
current = "main"
for line in sys.stdin.read().splitlines():
    command, _, rest = line.partition(" ")
    if command == "commit":
        branches[current].append(rest)
    elif command == "branch":
        branches[rest] = list(branches[current])
    elif command == "checkout":
        current = rest
    elif command == "log":
        for message in reversed(branches[current]):
            print(message)
        print("---")`, [["commit init\ncommit add login\nbranch feature\ncheckout feature\ncommit add logout\nlog\ncheckout main\ncommit fix typo\nlog", "add logout\nadd login\ninit\n---\nfix typo\nadd login\ninit\n---"], ["commit a\nlog", "a\n---"], ["log\ncommit x\nbranch b\ncommit y\ncheckout b\nlog\nbranch c\ncheckout c\ncommit z\nlog\ncheckout b\nlog", "---\nx\n---\nz\nx\n---\nx\n---"], ["commit one\ncommit two\ncommit three\nlog", "three\ntwo\none\n---"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Branching, Merging, Conflicts and Pull Requests",
  minutes: 60,
  learn: ["Create and switch branches and merge them", "Recognise and resolve a merge conflict", "Follow the GitHub flow: branch, commit, pull request, review, merge", "Choose between merge, squash and rebase and know when not to rewrite history"],
  why: "Branches let many people work on the same code without stepping on each other. Pull requests add review and automated checks before code reaches the main branch, which is how teams keep quality high.",
  realWorld: "A developer creates <code>feature/login-otp</code>, pushes it, opens a pull request, a teammate comments on two lines, CI runs the tests, and the change is merged into <code>main</code> the same day.",
  simple: "A <strong>branch</strong> is a movable label on a line of commits, so you can try work safely away from <code>main</code>. A <strong>pull request</strong> asks the team to review your branch and merge it. A <strong>conflict</strong> happens when two branches changed the same lines and Git needs a human to choose.",
  detail: `<h3>Branch commands</h3>
${table(["Task", "Command"], [["list branches", "<code>git branch</code>"], ["create and switch", "<code>git switch -c feature/login</code>"], ["switch", "<code>git switch main</code>"], ["merge a branch into the current one", "<code>git merge feature/login</code>"], ["delete a merged branch", "<code>git branch -d feature/login</code>"], ["save unfinished work", "<code>git stash</code> then <code>git stash pop</code>"], ["fetch without merging", "<code>git fetch</code>"], ["update from main", "<code>git switch feature</code> then <code>git merge main</code> (or rebase)"]])}
<h3>Fast-forward versus merge commit</h3>
<p>If <code>main</code> has not moved since you branched, Git can just slide the label forward (a <em>fast-forward</em>; no new commit). If both have new commits, Git creates a <em>merge commit</em> with two parents. If both changed the same lines, you get a <strong>conflict</strong>.</p>
<h3>Resolving a conflict</h3>
<ol><li>Run <code>git status</code>; files marked <code>UU</code> (both modified) need attention.</li><li>Open the file and find the markers: <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD</code> (your side), <code>=======</code>, <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt; feature</code> (their side).</li><li>Edit the file to the final text you want and delete all three marker lines.</li><li><code>git add FILE</code>, then <code>git commit</code> (or <code>git merge --continue</code>).</li><li>Run the tests. <code>git merge --abort</code> returns to the state before the merge if you want to start again.</li></ol>
<h3>The GitHub flow</h3>
${terminal("Typical team workflow (shown, not executed)", `$ git switch -c feature/otp-login\n... edit, test, commit small changes ...\n$ git push -u origin feature/otp-login\n(open a Pull Request on GitHub; teammates review; CI runs)\n(address comments with more commits)\n(merge the PR; delete the branch)\n$ git switch main && git pull`)}
<h3>Merge, squash or rebase?</h3>
<ul><li><strong>Merge commit</strong>: keeps the full history; easiest and safest.</li><li><strong>Squash and merge</strong>: turns the whole PR into one commit on main; tidy history.</li><li><strong>Rebase</strong>: replays your commits on top of the latest main for a straight line. <strong>Never rebase or force-push commits other people already use.</strong> If you must update your own pushed branch, use <code>git push --force-with-lease</code>.</li></ul>
<h3>A good pull request</h3>
<p>Small (ideally under a few hundred changed lines), one purpose, a description of <em>what</em> and <em>why</em>, tests included, screenshots for UI changes, and a link to the issue. As a reviewer: be specific, kind and quick; as an author: respond to every comment. Protect <code>main</code> with branch rules: required reviews and passing checks.</p>`,
  syntax: { code: `git switch -c feature/x\ngit merge feature/x\ngit merge --abort\ngit push -u origin feature/x`, note: "Branch, work, push, open a pull request." },
  diagram: chain("The GitHub flow", "Left to right: create a branch, commit your work, open a pull request, review with automated checks, merge into main.",
    [{ k: "proc", t: "branch" }, { k: "proc", t: "commit\nand push" }, { k: "proc", t: "open pull\nrequest" }, { k: "dec", t: "review +\nCI pass?" }, { k: "term", t: "merge to\nmain" }], { w: 130, gap: 28, hgt: 62 }),
  example: { code: `${GIT}git("init", "-q", "-b", "main")
write("notes.txt", "greeting=hello\\n")
git("add", "notes.txt")
git("commit", "-qm", "Start")

git("switch", "-q", "-c", "feature")
write("notes.txt", "greeting=namaste\\n")
git("commit", "-aqm", "Greet in Hindi")

git("switch", "-q", "main")
print("on branch:", out("branch", "--show-current"))
write("notes.txt", "greeting=hi\\n")
git("commit", "-aqm", "Greet casually")

merge = git("merge", "feature", check=False)
print("merge exit code:", merge.returncode)
print(out("status", "--short"))
print((work / "notes.txt").read_bytes().decode(), end="")

write("notes.txt", "greeting=namaste, hi\\n")
git("add", "notes.txt")
git("commit", "-q", "--no-edit")
print(out("log", "--first-parent", "--format=%s"))
print("parents of HEAD:", len(out("rev-list", "--parents", "-n", "1", "HEAD").split()) - 1)
print(out("branch", "--list", "--format=%(refname:short)"))
shutil.rmtree(work, ignore_errors=True)`, out: `on branch: main
merge exit code: 1
UU notes.txt
<<<<<<< HEAD
greeting=hi
=======
greeting=namaste
>>>>>>> feature
Merge branch 'feature'
Greet casually
Start
parents of HEAD: 2
feature
main` },
  lineByLine: [["switch -c feature", "Creates the branch feature and moves to it."], ["Two edits to the same line", "main says greeting=hi, feature says greeting=namaste. Git cannot decide which is right."], ["merge exit code: 1", "A merge that stops on a conflict exits with a non-zero code."], ["UU notes.txt", "Both sides modified the file: unmerged."], ["<<<<<<< HEAD ... >>>>>>> feature", "The conflict markers show your side (HEAD) above ======= and the other branch below."], ["write the final text", "We choose to keep both ideas; real conflicts need a human decision."], ["commit --no-edit", "Completes the merge using Git's default message."], ["log --first-parent", "Follows the main line only: the merge commit, then the commit on main, then the start."], ["parents of HEAD: 2", "A merge commit has two parents."]],
  dryRun: { intro: "The three versions Git compares in a three-way merge:", headers: ["Version", "greeting line"], rows: [["common ancestor (Start)", "greeting=hello"], ["main", "greeting=hi"], ["feature", "greeting=namaste"], ["result", "both sides changed it differently, so Git reports a conflict"]] },
  realExample: { intro: "A tiny pre-commit style check that finds leftover conflict markers.", code: `text = "a=1\\n<<<<<<< HEAD\\nb=2\\n=======\\nb=3\\n>>>>>>> feature\\nc=4\\n"
for number, line in enumerate(text.splitlines(), 1):
    if line.startswith(("<<<<<<<", "=======", ">>>>>>>")):
        print(number, line)`, out: `2 <<<<<<< HEAD
4 =======
6 >>>>>>> feature` },
  mistakes: ["Committing conflict markers.", "Long-lived branches that drift far from main.", "Force-pushing a shared branch.", "Giant pull requests nobody can review.", "Resolving a conflict by always choosing &quot;mine&quot; without reading it."],
  practices: ["Keep branches short-lived and pull from main often.", "Name branches by purpose: <code>feature/</code>, <code>fix/</code>, <code>docs/</code>.", "Run the tests after resolving a conflict.", "Require a review and passing CI before merging to main."],
  interview: ["Explain fast-forward versus three-way merge.", "Merge versus rebase?", "How do you resolve a merge conflict?", "What does git stash do?"],
  practiceQs: ["Which command creates and switches to a new branch?", "What does UU mean?", "When is it safe to rebase?", "What belongs in a pull request description?"],
  revision: ["Branches are cheap labels on commits.", "Fast-forward when main has not moved; otherwise a merge commit.", "Conflict markers must be removed by hand.", "Pull request = review + checks before merging."],
  hinglish: "Branch par aap main ko chhue bina naya kaam kar sakte ho. Do branches ne ek hi line badli ho to conflict aata hai; file kholo, markers hatao, sahi text rakho, git add aur commit karo. Pull request mein teammate review karte hain aur CI tests chalte hain.",
  quiz: [
    mcq("When can Git merge a branch with a fast-forward?", ["When main has no new commits since the branch was created", "When there is a conflict", "When both branches are deleted", "Never"], 0, "The branch simply continues main's history, so the label slides forward."),
    mcq("Which lines must you delete after resolving a conflict by hand?", ["Only the first line", "All the <<<<<<<, ======= and >>>>>>> marker lines", "Nothing", "The whole file"], 1, "The markers are not code and would break the program."),
    mcq("Which command cancels a merge that went wrong and restores the earlier state?", ["git merge --abort", "git push --force", "git clean -fd", "git reset --hard origin"], 0, "merge --abort restores the pre-merge state."),
    mcq("Why is force-pushing a shared branch dangerous?", ["It is slow", "It can erase commits teammates already pulled", "It changes the file names", "It deletes .gitignore"], 1, "Rewriting published history breaks other people's copies."),
    mcq("What does Squash and merge produce on main?", ["One commit for the whole pull request", "A commit per file", "No commit", "A new repository"], 0, "All commits of the branch become a single commit.")
  ],
  tasks: [task("Files changed on both branches", "Read two lines: the files changed on branch main and the files changed on branch feature (space separated, a line may be empty). Print review: NAME for every file that appears on both lines, in alphabetical order, one per line. If there is no such file print no overlap.", "a = set(input().split())\nb = set(input().split())\n# print the files changed on both branches\n", `a = set(input().split())
b = set(input().split())
common = sorted(a & b)
if common:
    for name in common:
        print("review:", name)
else:
    print("no overlap")`, [["app.py README.md\nREADME.md tests.py", "review: README.md"], ["a.py b.py\nc.py", "no overlap"], ["x.py y.py z.py\nz.py y.py w.py", "review: y.py\nreview: z.py"], ["\nfile.txt", "no overlap"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Debugging: Reading Tracebacks, pdb and a Systematic Method",
  minutes: 60,
  learn: ["Read a traceback from the bottom up", "Use print, f\"{x=}\", assert and logging to see what a program is doing", "Step through code with pdb and breakpoint()", "Apply a systematic method: reproduce, isolate, hypothesise, fix, prevent"],
  why: "Developers spend a large part of their time finding why code does not work. A calm, systematic method is faster than random edits and is a skill interviewers look for.",
  realWorld: "A report page crashes only for one customer. You reproduce it with their data, read the traceback, step to the failing line, find an empty list, fix it and add a test so it never comes back.",
  simple: "A <strong>traceback</strong> is a map of the calls that led to an error: read the <em>last line first</em> (what went wrong), then the frame just above it (where). A <strong>debugger</strong> lets you pause the program and look at the variables.",
  detail: `<h3>Reading a traceback</h3>
${terminal("A traceback", `Traceback (most recent call last):\n  File "app.py", line 10, in <module>\n    main()\n  File "app.py", line 6, in main\n    total = add(1, "2")\n  File "util.py", line 3, in add\n    return a + b\nTypeError: unsupported operand type(s) for +: 'int' and 'str'`)}
<ol><li>The <strong>last line</strong> is the exception type and message.</li><li>The <strong>frame just above</strong> is where it was raised (<code>util.py</code>, line 3, in <code>add</code>).</li><li>Frames above that show who called it. The bug is often in a caller that passed bad data, not in the line that crashed.</li><li>In chained errors (&quot;During handling of the above exception&quot;), read the first one: it is the root cause.</li></ol>
<h3>A systematic method</h3>
<ol><li><strong>Reproduce</strong> the bug reliably; write down the smallest input that triggers it.</li><li><strong>Isolate</strong>: cut code and data until it still fails (a minimal reproducible example). Use <code>git bisect</code> to find the commit that broke it.</li><li><strong>Hypothesise</strong>: &quot;the list is empty when the user has no orders&quot;. Predict what you will see.</li><li><strong>Test the hypothesis</strong> with a print, an assert or the debugger. Change one thing at a time.</li><li><strong>Fix the cause</strong>, not the symptom, then <strong>add a test</strong> and remove debug code.</li></ol>
<h3>Tools</h3>
${table(["Tool", "Use"], [["<code>print(f\"{value=}\")</code>", "quick look; prints name and value"], ["<code>assert cond, message</code>", "state what must be true (not for validating user input: asserts can be disabled with <code>-O</code>)"], ["<code>logging.debug(...)</code>", "debug output you can leave in and switch off"], ["<code>breakpoint()</code>", "pauses and opens pdb (set <code>PYTHONBREAKPOINT=0</code> to disable)"], ["<code>python -m pdb script.py</code>", "run under the debugger; <code>pdb.pm()</code> / <code>pdb.post_mortem()</code> after a crash"], ["<code>python -X dev</code>, <code>-W error</code>", "extra runtime checks; turn warnings into errors"], ["IDE debugger (VS Code, PyCharm)", "breakpoints, watches and call stack with the mouse"], ["<code>traceback</code> module", "get the stack as data"]])}
<h3>pdb commands</h3>
<p><code>n</code> next line, <code>s</code> step into a call, <code>c</code> continue, <code>b 12</code> breakpoint at line 12, <code>p expr</code> print, <code>pp</code> pretty-print, <code>l</code> list source, <code>w</code> where (call stack), <code>u</code> / <code>d</code> up / down a frame, <code>q</code> quit.</p>
<h3>Rubber-duck debugging</h3>
<p>Explaining the code line by line to someone (or a rubber duck) often reveals the wrong assumption. Take breaks: many bugs are obvious after a walk.</p>`,
  syntax: { code: `breakpoint()          # pause here\n# (Pdb) p variable   n   s   c   w   q\nprint(f"{total=}")`, note: "Read the last line of the traceback first." },
  diagram: chain("A debugging loop", "Left to right: reproduce the bug, isolate it, form a hypothesis, test it, then fix and add a test.",
    [{ k: "proc", t: "reproduce" }, { k: "proc", t: "isolate" }, { k: "proc", t: "hypothesise" }, { k: "dec", t: "confirmed\nby a test?" }, { k: "term", t: "fix and add\na test" }], { w: 130, gap: 28, hgt: 62 }),
  example: { code: `import io, pathlib, pdb, shutil, sys, tempfile

folder = pathlib.Path(tempfile.mkdtemp())
(folder / "demo.py").write_text(
    "def average(values):\\n"
    "    total = 0\\n"
    "    for value in values:\\n"
    "        total += value\\n"
    "    return total / len(values)\\n"
)
sys.path.insert(0, str(folder))
import demo

# Commands a person would type at the (Pdb) prompt:
commands = "break 4\\nc\\np value\\np total\\nc\\np value\\np total\\nc\\n"
captured = io.StringIO()
debugger = pdb.Pdb(stdin=io.StringIO(commands), stdout=captured)
debugger.use_rawinput = False
debugger.prompt = ""
result = debugger.runcall(demo.average, [4, 6])

lines = captured.getvalue().splitlines()
start = next(i for i, line in enumerate(lines) if line.startswith("Breakpoint 1"))
for line in lines[start + 1:]:
    if not line.startswith("> "):
        print(line)
print("returned", result)
shutil.rmtree(folder, ignore_errors=True)`, out: `-> total += value
4
0
-> total += value
6
4
returned 5.0` },
  lineByLine: [["demo.py with average()", "A small module written to a temporary folder so the debugger has real source lines to show."], ["commands = ...", "The keystrokes of a debugging session: set a breakpoint on line 4, continue, print value and total, continue again."], ["pdb.Pdb(stdin=..., stdout=...)", "Runs the debugger from a script so the session can be replayed. Normally you just type at the prompt."], ["runcall(demo.average, [4, 6])", "Calls the function under the debugger."], ["break 4 / c", "Stops each time line 4 (total += value) is about to run."], ["p value / p total", "First stop: value is 4 and total is still 0. Second stop: value is 6 and total is 4."], ["lines after Breakpoint 1", "Skips the start-up lines and the file-path lines, which differ from machine to machine and between Python versions."]],
  dryRun: { intro: "What the loop looks like at each breakpoint stop:", headers: ["Stop", "value", "total (before the line runs)"], rows: [["1", "4", "0"], ["2", "6", "4"], ["after the loop", "-", "10, and 10 / 2 = 5.0"]] },
  realExample: { intro: "The traceback module turns a crash into data: which functions were on the stack.", code: `import traceback


def parse(text):
    return int(text)


def load(row):
    return parse(row["age"])


try:
    load({"age": "twenty"})
except ValueError as error:
    for frame in traceback.extract_tb(error.__traceback__):
        print(frame.name, frame.lineno)
    print(type(error).__name__, "-", error)`, out: `<module> 13
load 9
parse 5
ValueError - invalid literal for int() with base 10: 'twenty'` },
  mistakes: ["Changing several things at once, so you do not know what fixed it.", "Fixing the symptom (catching the exception) instead of the cause.", "Leaving debug prints or <code>breakpoint()</code> in committed code.", "Not reading the error message.", "Not adding a test after the fix."],
  practices: ["Reproduce first; keep the smallest failing input.", "Read tracebacks bottom up.", "Prefer logging to print for anything you keep.", "Add a regression test for every bug fixed."],
  interview: ["How do you debug a failing program?", "What does breakpoint() do?", "What is a minimal reproducible example?", "How would you find which commit introduced a bug?"],
  practiceQs: ["Which line of a traceback tells you the exception type?", "What does pdb command n do?", "Why not use assert to validate user input?", "What does f\"{x=}\" print?"],
  revision: ["Traceback: last line = what, frame above = where.", "Method: reproduce, isolate, hypothesise, test, fix, add a test.", "pdb: n s c b p w q.", "git bisect finds the commit that broke it."],
  hinglish: "Traceback ko neeche se upar padho: aakhri line batati hai kya galat hua aur uske upar wala frame batata hai kahan. Pehle bug ko dobara chalao, chhota example banao, andaza lagao, ek ek cheez badal kar check karo, fix karo aur test jodo. breakpoint() se pdb khulta hai jahan n, s, c aur p use hote hain.",
  quiz: [
    mcq("Which part of a traceback names the exception type and message?", ["The first line", "The last line", "The middle frame", "The file name"], 1, "The final line is the error; the frames above show where it came from."),
    mcq("What does the pdb command c do?", ["Clears the screen", "Continues until the next breakpoint or the end", "Copies a variable", "Calls the debugger again"], 1, "c resumes execution."),
    mcq("What is the best first step when someone reports a bug?", ["Rewrite the module", "Reproduce it reliably", "Add try/except everywhere", "Blame the library"], 1, "A reliable reproduction is needed to test any theory."),
    mcq("Why should user input not be validated with assert?", ["Asserts are slow", "Python can run with -O, which removes asserts", "Asserts need a database", "Asserts only work in classes"], 1, "With the -O flag assert statements are not executed, so the check would silently vanish."),
    mcq("What does git bisect help you find?", ["The largest file", "The commit that introduced a bug", "Merge conflicts", "Unused imports"], 1, "It binary-searches the history using good and bad markers.")
  ],
  tasks: [task("Summarise a traceback", "Read a Python traceback from standard input. Print three lines: type: followed by the exception type, message: followed by the message (or (none) when there is no message), and where: followed by file:line in function taken from the innermost frame (the last File line).", "import re, sys\nlines = sys.stdin.read().splitlines()\n# find the innermost frame and the last line\n", `import re, sys
lines = [line for line in sys.stdin.read().splitlines() if line.strip()]
frames = [line for line in lines if line.lstrip().startswith('File "')]
match = re.search(r'File "(.+)", line (\\d+), in (.+)', frames[-1])
kind, _, message = lines[-1].partition(": ")
print("type:", kind)
print("message:", message or "(none)")
print(f"where: {match.group(1)}:{match.group(2)} in {match.group(3)}")`, [['Traceback (most recent call last):\n  File "app.py", line 10, in <module>\n    main()\n  File "app.py", line 6, in main\n    total = add(1, "2")\n  File "util.py", line 3, in add\n    return a + b\nTypeError: unsupported operand type(s) for +: \'int\' and \'str\'', "type: TypeError\nmessage: unsupported operand type(s) for +: 'int' and 'str'\nwhere: util.py:3 in add"], ['Traceback (most recent call last):\n  File "calc.py", line 2, in <module>\n    print(10 / 0)\nZeroDivisionError: division by zero', "type: ZeroDivisionError\nmessage: division by zero\nwhere: calc.py:2 in <module>"], ['Traceback (most recent call last):\n  File "gen.py", line 7, in run\n    next(it)\nStopIteration', "type: StopIteration\nmessage: (none)\nwhere: gen.py:7 in run"], ["Traceback (most recent call last):\n  File \"main.py\", line 4, in <module>\n    show(data)\n  File \"views.py\", line 12, in show\n    return row['name']\nKeyError: 'name'", "type: KeyError\nmessage: 'name'\nwhere: views.py:12 in show"]])],
});

module.exports = { lessons };
