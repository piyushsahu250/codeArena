// Phase 0 / Module 2: Installation and Environment Setup. Version-sensitive statements (release numbers, installer names,
// Windows install manager commands, macOS installer) were checked against python.org and docs.python.org on 2026-11-02.
"use strict";
const { chain, graph, table, terminal } = require("./render");

const mcq = (prompt, options, answer, explanation, type = "MCQ") => ({ type, prompt, options, correctAnswer: answer, explanation });
const task = (title, statement, starter, solution, cases, hiddenCases = cases) => ({
  title, statement, starter, solution,
  testCases: [...cases.slice(0, 2).map(([input, expected]) => ({ input, expected, isHidden: false })), ...hiddenCases.map(([input, expected]) => ({ input, expected, isHidden: true }))],
});
const VERSION_NOTE = `<p><em>Checked against python.org and docs.python.org on 2 November 2026: the latest stable release is Python 3.15 (3.15.2 on 25 October 2026). Release numbers change, so always confirm on <a href="https://www.python.org/downloads/" rel="noopener noreferrer" target="_blank">python.org/downloads</a> before you install.</em></p>`;

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "Choosing and Downloading the Right Python",
  minutes: 25,
  learn: ["Understand Python's yearly release cycle and support stages", "Choose a version for this course", "Download Python only from the official website", "Know what the interpreter, pip and the standard library are"],
  why: "Installing an unsupported or unofficial Python is the most common cause of &quot;it works on my friend's laptop&quot; problems and a security risk.",
  realWorld: "A company standardises on one Python version for a project and writes it down (in a README or a pyproject file) so every developer and server runs the same one.",
  simple: "Python publishes a new version every October. Each version is looked after for about five years, then retired. For learning, install the <strong>newest stable release</strong> from python.org, or at least a version that is still supported.",
  detail: `${VERSION_NOTE}
<h3>Release stages</h3>
${table(["Stage", "Meaning", "Should you use it?"], [["feature / pre-release", "Under development (alpha, beta, release candidate)", "No, unless you are testing Python itself"], ["bugfix", "Newest stable versions; bugs and security fixed", "Yes. Best choice for learning"], ["security", "Only security fixes are released", "Acceptable for existing projects"], ["end-of-life", "No more fixes of any kind", "No. Never start new work on it"]])}
<p>As of November 2026 the Python developer guide lists Python 3.11 to 3.15 as supported, with 3.15 in the bugfix stage, and 3.10 as end-of-life since October 2026.</p>
<h3>This course's version policy</h3>
<ul><li><strong>Recommended:</strong> the latest stable release (3.15 at the time of writing).</li><li><strong>Minimum:</strong> Python 3.12. Every example in this course is executed automatically by CodeArena's content checks before publication.</li><li>Features introduced in newer versions are marked in the lesson.</li></ul>
<h3>What you are actually installing</h3>
<ul><li>The <strong>interpreter</strong> (<code>python</code>), which runs your programs.</li><li>The <strong>standard library</strong>, a large set of ready-made modules.</li><li><strong>pip</strong>, the tool that installs third-party packages from PyPI.</li><li><strong>IDLE</strong>, a small editor that comes with the Windows and macOS installers.</li></ul>
<h3>Download safely</h3>
<ul><li>Use <strong>python.org/downloads</strong> only. Avoid &quot;free download&quot; sites, torrents and pop-up ads.</li><li>You do not need to pay for Python. It is free and open source.</li><li>Your college lab may have a managed Python; ask the lab in-charge before changing it.</li></ul>`,
  diagram: chain("Life of a Python version", "Four stages left to right: feature or pre-release, bugfix, security fixes only, end of life.",
    [{ k: "term", t: "Pre-release\n(testing)" }, { k: "proc", t: "Bugfix\n(learn here)" }, { k: "proc", t: "Security only\n(~5 yrs total)" }, { k: "term", t: "End of life\n(do not use)" }], { w: 135, gap: 30, hgt: 58 }),
  example: { code: `import sys\nmajor, minor = sys.version_info[:2]\nprint(major)\nprint(minor >= 10)`, out: `3\nTrue` },
  lineByLine: [["import sys", "Loads the <code>sys</code> module, which reports facts about the running interpreter."], ["sys.version_info[:2]", "A tuple-like value (major, minor, ...). <code>[:2]</code> keeps the first two items."], ["major, minor = ...", "Unpacks the two items into two variables."], ["print(minor >= 10)", "Compares and prints <code>True</code> or <code>False</code>."]],
  dryRun: { intro: "Suppose you are running Python 3.15.2:", headers: ["Expression", "Value"], rows: [["sys.version_info", "(3, 15, 2, 'final', 0)"], ["sys.version_info[:2]", "(3, 15)"], ["major", "3"], ["minor", "15"], ["minor >= 10", "True"]] },
  realExample: { intro: "Programs and scripts often refuse to run on a Python that is too old. (The <code>if</code> statement is taught in Module 5; read it as plain English.)", code: `import sys\nREQUIRED = (3, 12)\nif sys.version_info >= REQUIRED:\n    print("Python version OK")\nelse:\n    print("Please upgrade Python")`, out: `Python version OK` },
  mistakes: ["Downloading from a random website instead of python.org.", "Installing a pre-release (alpha/beta/rc) because it has the highest number.", "Following an old tutorial for Python 2 or 3.6.", "Having several Pythons and not knowing which one runs."],
  practices: ["Write the version you used in your project README.", "Install the stable release, not a pre-release.", "Update to the newest patch release (the third number) regularly: it contains fixes."],
  interview: ["What does Python's release cycle look like?", "Why should production systems avoid end-of-life Python?", "What is the difference between 3.15.0 and 3.15.2?", "What does pip do?"],
  practiceQs: ["Open python.org/downloads and write the latest stable version and its date.", "Look at the Python developer guide's version table. Which versions are in the bugfix stage?", "Why is the number after the second dot called the patch release?"],
  revision: ["New Python version every October; about five years of support.", "Use the latest stable release; never end-of-life.", "Download only from python.org (or the Microsoft Store / your OS package manager).", "Installer includes interpreter, standard library, pip."],
  hinglish: "Python har saal October mein naya version laata hai aur lagbhag paanch saal tak support karta hai. Seekhne ke liye latest stable version python.org se download karo. Pre-release ya end-of-life version kabhi mat use karo.",
  quiz: [
    mcq("From where should you download Python?", ["Any free-software website", "python.org", "A torrent", "A WhatsApp link"], 1, "The official website is the only trustworthy source (or your OS's official package manager)."),
    mcq("Which stage should a beginner choose?", ["Pre-release", "Bugfix (latest stable)", "End-of-life", "The oldest version"], 1, "The latest stable (bugfix-stage) release receives fixes and works with current tools."),
    mcq("In 3.15.2, what is 2?", ["Major version", "Minor version", "Patch release", "Year"], 2, "Format is major.minor.patch."),
    mcq("What does this print on Python 3.15.2?\n\nimport sys\nprint(sys.version_info[:2])", ["(3, 15)", "3.15", "(3, 15, 2)", "15"], 0, "Slicing the version tuple to two items gives (3, 15).", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Version check", "Write a program that prints the word True if the running Python major version is 3, otherwise False. Use sys.version_info.", "import sys\n# print whether the major version is 3\n", `import sys\nprint(sys.version_info[0] == 3)`, [["", "True"], ["", "True"]], [["", "True"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Installing Python on Windows",
  minutes: 40,
  learn: ["Install Python with the Python install manager", "Know when the traditional installer applies and what its PATH option does", "Verify the installation from a terminal", "Check that pip works"],
  why: "A correct Windows installation avoids the two classic problems: &quot;'python' is not recognized&quot; and running the wrong Python.",
  realWorld: "Most students and many developers in India work on Windows, so a clean and verified install is the first task in any new project or job.",
  simple: "Download the <strong>Python install manager</strong> from python.org (or the Microsoft Store), run it, then open a <em>new</em> terminal and type <code>python --version</code>. If you see a version number, you are done.",
  detail: `${VERSION_NOTE}
<h3>Option A (recommended): Python install manager</h3>
<p>The official Python documentation for Windows now recommends the <strong>Python install manager</strong>. It installs and updates Python runtimes and gives you the commands <code>python</code>, <code>py</code> and <code>pymanager</code>.</p>
<ol><li>Open <strong>python.org/downloads</strong> and choose the Python install manager download, or search for &quot;Python Install Manager&quot; in the Microsoft Store and click Install. Both give the same program.</li><li>If you downloaded the <code>.msix</code> file, double-click it and choose Install (or run <code>Add-AppxPackage &lt;path&gt;</code> in PowerShell).</li><li>Open a <strong>new</strong> Command Prompt or PowerShell window.</li><li>Run <code>py install</code> to install the latest Python runtime if one is not installed yet. When asked whether to add the aliases directory to PATH, say yes if you want commands such as <code>python3.15</code>.</li><li>Check with <code>python --version</code> and <code>py list</code>.</li></ol>
${terminal("PowerShell", `> python --version\nPython 3.15.2\n\n> py list\n(shows the Python runtimes you have installed)\n\n> python -m pip --version\npip 26.x from ...\\site-packages\\pip (python 3.15)`)}
<p>Scripted installation with WinGet (useful in labs): <code>winget install 9NQ7512CXL7T -e --accept-package-agreements --disable-interactivity</code> then <code>py install --configure -y</code>.</p>
<h3>Option B: the traditional installer</h3>
<p>The classic <code>python-3.x.y-amd64.exe</code> installer still exists for current releases, but it is <strong>deprecated since Python 3.14</strong> and will not be produced for Python 3.16 and later. If your lab or an older course tells you to use it: tick the checkbox that adds Python to PATH on the first screen (its label mentions PATH), then choose Install Now. If you forget this, <code>python</code> will not be found.</p>
<h3>Where is Python installed?</h3>
<p>The install manager keeps runtimes under your user profile (for example <code>%LocalAppData%\\Python</code>), so no administrator rights are normally needed. To see exactly which file runs, type <code>where python</code> in Command Prompt or <code>Get-Command python</code> in PowerShell.</p>
<h3>Upgrading pip</h3>
<p>pip ships with Python. Always call it as <code>python -m pip</code> so it is certain to belong to the Python you just checked: <code>python -m pip install --upgrade pip</code>.</p>`,
  syntax: { code: `python --version\npy list\npython -m pip --version`, lang: "powershell", note: "Run these in a <strong>new</strong> terminal window after installing." },
  diagram: chain("Installing on Windows", "Vertical flow: download install manager, install, open new terminal, python --version, python -m pip --version.",
    [{ k: "term", t: "python.org -> install manager" }, { k: "proc", t: "Install, then open a NEW terminal" }, { k: "proc", t: "python --version" }, { k: "proc", t: "python -m pip --version" }, { k: "term", t: "Ready" }], { vertical: true, w: 250, hgt: 40, gap: 22 }),
  example: { code: `import os, sys, platform\nprint(os.path.basename(sys.executable).lower().startswith("python"))\nprint(platform.python_implementation())`, out: `True\nCPython` },
  lineByLine: [["import os, sys, platform", "Imports three standard modules in one line."], ["sys.executable", "Full path to the interpreter file running this program, e.g. <code>C:\\Users\\you\\AppData\\Local\\Python\\...\\python.exe</code>."], ["os.path.basename(...)", "Keeps only the file name at the end of the path."], ["platform.python_implementation()", "Reports CPython, PyPy, etc."]],
  dryRun: { intro: "On a typical Windows install:", headers: ["Expression", "Value"], rows: [["sys.executable", "C:\\Users\\Asha\\AppData\\Local\\Python\\pythoncore-3.15-64\\python.exe"], ["os.path.basename(...)", "python.exe"], [".lower().startswith(\"python\")", "True"], ["platform.python_implementation()", "CPython"]] },
  realExample: { intro: "Print a short setup report you could paste into a help request.", code: `import platform\nreport = {"implementation": platform.python_implementation(), "major": 3}\nfor key, value in report.items():\n    print(f"{key}: {value}")`, out: `implementation: CPython\nmajor: 3` },
  mistakes: ["Testing in an already-open terminal: a terminal opened before installation does not see the new PATH. Open a new one.", "Typing <code>python</code> in the Python prompt (<code>&gt;&gt;&gt;</code>) instead of the terminal.", "Typing <code>pip</code> alone and getting a different Python's pip. Use <code>python -m pip</code>.", "On a fresh Windows PC, <code>python</code> opens the Microsoft Store: install Python (or turn off the Python app-execution alias in Settings) so the real one runs."],
  practices: ["Always open a new terminal after installing.", "Use <code>python -m pip</code> rather than bare <code>pip</code>.", "Record <code>python --version</code> in every bug report.", "Do not install Python into a folder with spaces or non-English characters if you are using the traditional installer and run into trouble."],
  interview: ["How do you check which Python executable runs when you type python?", "Why use <code>python -m pip</code>?", "What does adding Python to PATH mean?"],
  practiceQs: ["Install Python and write the output of <code>python --version</code>.", "Run <code>where python</code> (or <code>Get-Command python</code>). What path is shown?", "Why do you need a new terminal window after installing?"],
  revision: ["Preferred: Python install manager from python.org or the Microsoft Store.", "Check: python --version, py list, python -m pip --version.", "Open a new terminal after installation.", "Traditional installer: deprecated since 3.14; tick the PATH option if you use it."],
  hinglish: "Windows par python.org se Python install manager download karke install karo. Install ke baad naya terminal kholo aur python --version likho. pip ke liye hamesha python -m pip use karo.",
  quiz: [
    mcq("Which command checks the installed Python version?", ["python --version", "py --pythonize", "pip run", "install --python"], 0, "python --version prints the version of the Python found first on PATH."),
    mcq("After installing, \"python\" is not recognised in an old terminal. What should you do first?", ["Reinstall Windows", "Open a new terminal window", "Buy a licence", "Delete Python"], 1, "A terminal reads PATH when it starts; a new one sees the new PATH."),
    mcq("What is the safest way to run pip?", ["pip", "python -m pip", "pip3.exe from any folder", "Double-click pip"], 1, "python -m pip guarantees the pip belongs to the Python you just checked."),
    mcq("The classic Windows installer was deprecated in which version?", ["3.8", "3.11", "3.14", "3.15"], 2, "The documentation states it is deprecated since 3.14 and will not be produced for 3.16 and later."),
  ],
  tasks: [task("Implementation report", "Print the Python implementation name using the platform module. The expected output is: CPython", "import platform\n# print the implementation name\n", `import platform\nprint(platform.python_implementation())`, [["", "CPython"], ["", "CPython"]], [["", "CPython"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Installing Python on Linux and macOS",
  minutes: 35,
  learn: ["Check whether Python is already installed on Linux or macOS", "Install Python and venv support on Ubuntu/Debian", "Install Python on macOS with the official installer", "Avoid breaking the operating system's own Python"],
  why: "Servers run Linux, and many developers use macOS. You must know how to get a clean, separate Python without touching the one the system relies on.",
  realWorld: "Every cloud server that runs your Python API is Linux. The commands you learn here are the ones used to set it up.",
  simple: "On Linux and macOS the command is <code>python3</code>. Check it first; install or update using your system's package manager (Linux) or the python.org installer (macOS). Never delete or overwrite the system Python.",
  detail: `${VERSION_NOTE}
<h3>Linux (Ubuntu / Debian)</h3>
<p>Python 3 comes preinstalled on most Linux distributions. Check it, then install pip and the venv module if they are missing:</p>
${terminal("Ubuntu terminal", `$ python3 --version\nPython 3.x.y\n\n$ sudo apt update\n$ sudo apt install python3 python3-pip python3-venv idle`)}
<ul><li>The version you get is the one your Ubuntu release ships. That is fine for this course as long as it is 3.12 or newer. On an older release, install a newer Python from the distribution's backports or build it with <code>make altinstall</code>.</li><li>Never run <code>make install</code> when building from source: it can overwrite the system's <code>python3</code>. Use <code>make altinstall</code>.</li><li>Newer Debian/Ubuntu releases protect the system Python: <code>pip install ...</code> outside a virtual environment is refused with an <em>externally-managed-environment</em> message. This is correct behaviour; use a virtual environment (lesson 6).</li><li>Other families: <code>sudo dnf install python3 python3-pip</code> (Fedora/RHEL), <code>sudo zypper install python3</code> (SUSE), <code>sudo apk add python3 py3-pip</code> (Alpine).</li></ul>
<h3>macOS</h3>
<ol><li>Download the macOS <code>.pkg</code> installer from python.org/downloads (a universal build for Apple Silicon and Intel).</li><li>Double-click and follow the steps. You need an administrator account.</li><li>At the end open <code>/Applications/Python 3.15/</code> (the folder name matches the version) and double-click <strong>Install Certificates.command</strong> so HTTPS downloads work from Python.</li><li>Open Terminal and run <code>python3 --version</code>.</li></ol>
${terminal("Terminal (macOS)", `$ python3 --version\nPython 3.15.2\n$ python3 -m pip --version\npip 26.x from ... (python 3.15)`)}
<p>Do not change Apple's <code>/usr/bin/python3</code>. Homebrew (<code>brew install python</code>) is a popular alternative if you already use it.</p>
<h3>Windows vs Linux vs macOS at a glance</h3>
${table(["", "Windows", "Linux", "macOS"], [["Command", "python (or py)", "python3", "python3"], ["Install from", "Install manager (python.org / Store)", "Package manager (apt, dnf, ...)", "python.org .pkg or Homebrew"], ["Activate a venv", ".venv\\Scripts\\activate", "source .venv/bin/activate", "source .venv/bin/activate"], ["Leave a venv", "deactivate", "deactivate", "deactivate"]])}`,
  syntax: { code: `python3 --version\npython3 -m pip --version\npython3 -m venv .venv`, lang: "bash", note: "Linux and macOS use <code>python3</code>; inside an activated virtual environment plain <code>python</code> also works." },
  diagram: graph("Linux and macOS install decision", "Decision flow: run python3 --version; if a suitable version appears you are done; otherwise install with apt on Linux or the python.org installer on macOS.", 600, 270,
    [{ id: "a", k: "term", t: "python3 --version", x: 300, y: 36, w: 170 }, { id: "b", k: "dec", t: "3.12 or\nnewer?", x: 300, y: 124, w: 130, h: 70 }, { id: "c", k: "term", t: "Done", x: 500, y: 124, w: 100 }, { id: "d", k: "proc", t: "Linux:\nsudo apt install\npython3 python3-venv", x: 140, y: 230, w: 210, h: 56 }, { id: "e", k: "proc", t: "macOS: python.org\n.pkg installer", x: 460, y: 230, w: 190, h: 56 }],
    [{ from: "a", to: "b" }, { from: "b", to: "c", label: "yes", dx: -8 }, { from: "b", to: "d", label: "no (Linux)", dx: -80 }, { from: "b", to: "e", label: "no (Mac)", dx: 6 }]),
  example: { code: `import sys\nprint(sys.platform in ("win32", "linux", "darwin"))\nprint(len("python3"))`, out: `True\n7` },
  lineByLine: [["sys.platform", "A short text naming the operating system: <code>win32</code>, <code>linux</code> or <code>darwin</code> (macOS)."], ["x in (a, b, c)", "<code>in</code> checks whether a value is one of the items."], ["len(\"python3\")", "Counts characters: 7."]],
  dryRun: { intro: "On Ubuntu:", headers: ["Expression", "Value"], rows: [["sys.platform", "'linux'"], ["'linux' in ('win32','linux','darwin')", "True"], ["len('python3')", "7"]] },
  realExample: { intro: "The activation command differs by operating system. A lookup table makes the difference clear.", code: `activate = {\n    "win32": r".venv\\Scripts\\activate",\n    "linux": "source .venv/bin/activate",\n    "darwin": "source .venv/bin/activate",\n}\nfor system in ("win32", "linux", "darwin"):\n    print(system, "->", activate[system])`, out: `win32 -> .venv\\Scripts\\activate\nlinux -> source .venv/bin/activate\ndarwin -> source .venv/bin/activate` },
  mistakes: ["Typing <code>python</code> on Linux/macOS and getting &quot;command not found&quot;. Use <code>python3</code>.", "Running <code>sudo pip install</code>. It can break system tools; use a virtual environment.", "Skipping <code>python3-venv</code> on Ubuntu, then <code>python3 -m venv</code> fails.", "Forgetting <code>Install Certificates.command</code> on macOS, which causes SSL certificate errors."],
  practices: ["Check <code>python3 --version</code> before installing anything.", "Never modify the OS's own Python; work in virtual environments.", "Use your distribution's package manager for system-wide installs."],
  interview: ["Why shouldn't you use <code>sudo pip install</code>?", "Which command creates a virtual environment on Linux?", "What does <code>make altinstall</code> do differently from <code>make install</code>?"],
  practiceQs: ["On your OS, run <code>python3 --version</code> (or <code>python --version</code> on Windows) and note the result.", "Explain what an externally-managed-environment error means.", "Which activation command applies to your computer?"],
  revision: ["Linux/macOS command: python3.", "Ubuntu: apt install python3 python3-pip python3-venv.", "macOS: python.org .pkg, then Install Certificates.command.", "Never overwrite or pip-install into the system Python."],
  hinglish: "Linux aur macOS par command python3 hoti hai. Ubuntu par sudo apt install python3 python3-pip python3-venv chalao. System ke Python ko kabhi delete ya overwrite mat karo; virtual environment use karo.",
  quiz: [
    mcq("Which command is normally used on Linux and macOS?", ["python3", "pythonw", "py.exe", "pyrun"], 0, "Linux and macOS ship python3; plain python may not exist."),
    mcq("What does the externally-managed-environment error protect?", ["Your internet", "The operating system's own Python packages", "Your editor", "Your browser"], 1, "Distributions protect system Python from conflicting pip installs."),
    mcq("What is the activation command on Linux/macOS?", ["source .venv/bin/activate", ".venv\\Scripts\\activate", "activate python", "venv start"], 0, "On Unix-like systems the venv's bin/activate script is sourced."),
    mcq("What is printed?\n\nprint(\"darwin\" in (\"win32\", \"linux\"))", ["True", "False", "darwin", "Error"], 1, "darwin is not one of the two items.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Count the letters", "Print the number of characters in the text python3 using len.", "# print the length of \"python3\"\n", `print(len("python3"))`, [["", "7"], ["", "7"]], [["", "7"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Running Python: Shell, IDLE, Terminal and VS Code",
  minutes: 40,
  learn: ["Use the interactive Python shell", "Create and run a .py file from the terminal", "Use IDLE", "Set up VS Code with the Python extension and choose the interpreter"],
  why: "You will switch between quick experiments (shell) and real programs (files). Knowing both, and an editor, makes you productive from day one.",
  realWorld: "Developers test an idea in the shell in seconds, then move the working lines into a file that others can run.",
  simple: "Type <code>python</code> and press Enter to chat with Python line by line (the <code>&gt;&gt;&gt;</code> prompt). Write longer programs in a text file that ends with <code>.py</code> and run it with <code>python filename.py</code>.",
  detail: `<h3>Four ways to run Python</h3>
${table(["Way", "How", "Best for"], [["Interactive shell (REPL)", "Type <code>python</code>; leave with <code>exit()</code>", "Trying one-line ideas, quick maths"], ["Script from the terminal", "<code>python hello.py</code>", "Real programs, automation"], ["IDLE", "Start menu / <code>python -m idlelib</code>; <em>File &rarr; New File</em>, press F5 to run", "First days, no setup"], ["VS Code", "Open folder, open .py, press the Run button or use the terminal", "Daily development"]])}
<h3>The interactive shell</h3>
${terminal("Terminal", `> python\nPython 3.15.2 (...)\nType "help", "copyright", "credits" or "license" for more information.\n>>> 2 + 3\n5\n>>> print("Hello")\nHello\n>>> exit()`)}
<p>In the shell, a bare expression such as <code>2 + 3</code> shows its value. In a <code>.py</code> file it does not: you must call <code>print()</code>.</p>
<h3>Your first script</h3>
<ol><li>Create a folder, for example <code>python-course</code>.</li><li>Save a file named <code>hello.py</code> containing <code>print("Hello from a file")</code> (make sure the extension is really .py and not .py.txt: turn on &quot;File name extensions&quot; in Windows Explorer).</li><li>Open a terminal in that folder and run <code>python hello.py</code>.</li></ol>
<h3>Set up VS Code</h3>
<ol><li>Install Visual Studio Code from code.visualstudio.com.</li><li>Open the Extensions view (Ctrl+Shift+X), search for <strong>Python</strong> (published by Microsoft), and install it.</li><li>File &rarr; Open Folder, choose your course folder.</li><li>Press Ctrl+Shift+P, type <strong>Python: Select Interpreter</strong>, and choose the Python you installed (or your project's <code>.venv</code> later).</li><li>Open <code>hello.py</code> and click the Run &#9655; button at the top right, or open the terminal (Ctrl+<code>\`</code>) and run <code>python hello.py</code>.</li></ol>
<h3>The special name <code>__name__</code></h3>
<p>When a file is run directly Python sets <code>__name__</code> to <code>"__main__"</code>. When the same file is imported by another file it is set to the module name instead. The idiom <code>if __name__ == "__main__":</code> therefore means &quot;run this part only when the file is started directly&quot;. You will use it in every real project.</p>`,
  syntax: { code: `python hello.py\npython -m idlelib\npython -c "print('quick check')"`, lang: "bash", note: "<code>-c</code> runs a short program passed as text." },
  diagram: graph("Four ways to run the same program", "A central box hello.py connected to four ways of running it: shell, terminal, IDLE, VS Code.", 620, 250,
    [{ id: "c", k: "term", t: "hello.py", x: 310, y: 125, w: 120 }, { id: "a", k: "proc", t: "Terminal:\npython hello.py", x: 100, y: 45, w: 170 }, { id: "b", k: "proc", t: "VS Code:\nRun button", x: 520, y: 45, w: 160 }, { id: "d", k: "proc", t: "IDLE:\nF5", x: 100, y: 205, w: 150 }, { id: "e", k: "proc", t: "Shell:\nimport hello", x: 520, y: 205, w: 160 }],
    [{ from: "c", to: "a" }, { from: "c", to: "b" }, { from: "c", to: "d" }, { from: "c", to: "e" }]),
  example: { code: `print(__name__)\nif __name__ == "__main__":\n    print("Run directly")`, out: `__main__\nRun directly` },
  lineByLine: [["print(__name__)", "Shows the special variable holding this file's name. When run directly it is <code>__main__</code>."], ["if __name__ == \"__main__\":", "True only when this file was started directly, not imported."], ["print(\"Run directly\")", "Indented under the <code>if</code>, so it belongs to it."]],
  dryRun: { intro: "Running the file two different ways:", headers: ["Way of starting", "Value of __name__", "Last line prints?"], rows: [["python hello.py", "__main__", "Yes"], ["import hello (from another file)", "hello", "No"]] },
  realExample: { intro: "A script reports how many extra arguments it was given (command-line arguments are covered in Module 11).", code: `import sys\nprint("Arguments given:", len(sys.argv) - 1)`, out: `Arguments given: 0` },
  mistakes: ["Saving the file as hello.py.txt.", "Running <code>python hello.py</code> from the wrong folder (&quot;can't open file&quot;). Use <code>cd</code> or open the folder in VS Code.", "Typing <code>python hello.py</code> at the <code>&gt;&gt;&gt;</code> prompt.", "Naming your file <code>random.py</code> or <code>test.py</code> and shadowing a standard module.", "Selecting the wrong interpreter in VS Code, so imports fail."],
  practices: ["Keep one folder per project and open the folder (not single files) in VS Code.", "Use lowercase file names with underscores: <code>student_card.py</code>.", "Use the shell to experiment, files to keep your work.", "Install only the Microsoft <em>Python</em> extension (and Pylance, which it brings) to start."],
  interview: ["What is a REPL?", "What does <code>if __name__ == \"__main__\":</code> do?", "What is the difference between running a script and importing it?"],
  practiceQs: ["In the shell, calculate 17 * 23 and the remainder of 100 divided by 7.", "Create hello.py with your name and run it from the terminal.", "Why does 2 + 3 show 5 in the shell but nothing in a file?"],
  revision: ["Shell: python, exit().", "Script: python file.py.", "IDLE: File &rarr; New, F5.", "VS Code: Python extension, Select Interpreter.", "__name__ is &quot;__main__&quot; when run directly."],
  hinglish: "Chhote experiments ke liye python shell, bade programs ke liye .py file. Terminal mein python hello.py likhkar chalao. VS Code mein Python extension install karke Select Interpreter chuno.",
  quiz: [
    mcq("How do you leave the interactive shell?", ["exit()", "stop", "Ctrl+X only", "Alt+F4 is required"], 0, "exit() (or Ctrl+Z then Enter on Windows, Ctrl+D on Linux/macOS) ends the session."),
    mcq("Which command runs hello.py?", ["python hello.py", "run hello", "hello.py python", "py -install hello"], 0, "Pass the file name to python."),
    mcq("In VS Code, which command chooses the Python version for a project?", ["Python: Select Interpreter", "File: Compile", "Terminal: Install", "View: Python"], 0, "Open the Command Palette (Ctrl+Shift+P) and choose Python: Select Interpreter."),
    mcq("What does this print when run directly?\n\nprint(__name__)", ["__main__", "main", "hello", "None"], 0, "Python sets __name__ to \"__main__\" for the file you start.", "OUTPUT_PREDICTION"),
    { type: "FILL_BLANK", prompt: "Python source files end with the extension: .____", correctAnswer: "py", explanation: "Python files use the .py extension." },
  ],
  tasks: [task("Run only when started directly", "Write a program that prints Hello from main only when the file is run directly, using the __name__ check.", "# add the __name__ check\n", `if __name__ == "__main__":\n    print("Hello from main")`, [["", "Hello from main"], ["", "Hello from main"]], [["", "Hello from main"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Jupyter Notebook and Google Colab",
  minutes: 30,
  learn: ["Explain what a notebook is and when to use it", "Install and start Jupyter Notebook", "Use Google Colab without installing anything", "Know the differences between notebooks and scripts"],
  why: "Data analysis, AI and teaching material are usually written in notebooks. You will need them from Module 19 onward, and Colab works on any computer with a browser.",
  realWorld: "A data analyst shares a notebook where code, charts and notes are together so a manager can follow the analysis.",
  simple: "A notebook is a document made of <strong>cells</strong>. Some cells hold code you can run one at a time, others hold notes. The result appears right under the cell.",
  detail: `<h3>Notebook or script?</h3>
${table(["", "Script (.py)", "Notebook (.ipynb)"], [["Runs", "Top to bottom, every time", "Cell by cell, in any order"], ["Shows results", "Only what you print()", "The last expression of each cell is displayed"], ["Best for", "Applications, automation, tests", "Exploration, data analysis, teaching"], ["Risk", "Fewer", "Out-of-order runs give confusing state; restart and run all before sharing"]])}
<h3>Jupyter Notebook on your computer</h3>
<p>Do this inside a virtual environment (lesson 6) so the packages stay with the project:</p>
${terminal("Terminal", `$ python -m pip install notebook\n$ jupyter notebook\n(a browser tab opens at http://localhost:8888/ )`)}
<p>Choose <strong>New &rarr; Python 3</strong>, type code in a cell and press <strong>Shift+Enter</strong> to run it. Stop the server with Ctrl+C in the terminal. VS Code can also open <code>.ipynb</code> files directly once the Jupyter extension is installed.</p>
<h3>Google Colab</h3>
<ol><li>Open <strong>colab.research.google.com</strong> and sign in with a Google account.</li><li>Choose <em>New notebook</em>; the code runs on Google's computers, not yours.</li><li>Files created on the temporary runtime disappear when the session ends; save a copy to Google Drive for anything you want to keep.</li><li>Do not upload private data or passwords to a shared notebook.</li></ol>
<p>A cell shows the value of its <em>last expression</em> automatically. In a script that same line would print nothing: you must call <code>print()</code>. That is the biggest everyday difference.</p>`,
  syntax: { code: `python -m pip install notebook\njupyter notebook`, lang: "bash", note: "Press <strong>Shift+Enter</strong> to run a cell." },
  diagram: chain("Notebook workflow", "Left to right: write a cell, run it with Shift+Enter, see output below, edit and repeat.",
    [{ k: "proc", t: "Write\nin a cell" }, { k: "proc", t: "Shift+Enter\nruns it" }, { k: "io", t: "Output\nappears below" }, { k: "proc", t: "Edit &\nrun again" }], { w: 130, gap: 30 }),
  example: { code: `3 + 4\nprint(3 + 4)`, out: `7` },
  lineByLine: [["3 + 4", "In a <em>notebook</em> this last-line value would be displayed. In a <em>script</em> it is calculated and thrown away."], ["print(3 + 4)", "Explicit output works everywhere, including scripts."]],
  dryRun: { intro: "The same two lines in two places:", headers: ["Where", "Line 1 (3 + 4)", "Line 2 (print)"], rows: [["Script", "evaluated, nothing shown", "7"], ["Notebook cell (two lines)", "not shown: only the last expression is auto-displayed, and here the last line is print", "7"]] },
  realExample: { intro: "A typical first notebook cell: compute an average from a list of marks.", code: `marks = [72, 85, 90]\naverage = sum(marks) / len(marks)\nprint(round(average, 2))`, out: `82.33` },
  mistakes: ["Running cells out of order and trusting the result: use <em>Restart &amp; Run All</em> before you share.", "Uploading private data to Colab.", "Installing Jupyter into the system Python.", "Forgetting that Colab files vanish when the runtime resets."],
  practices: ["Keep a notebook short and linear; move reusable code into .py files.", "Restart and run all before submitting.", "Write a short note cell before each section of analysis."],
  interview: ["When would you pick a notebook over a script?", "Why can notebook results be unreliable?", "What does Shift+Enter do?"],
  practiceQs: ["Start a Colab notebook and run print(\"Hello Colab\").", "Why is a notebook not ideal for a production web service?", "Compute the average of 40, 50 and 60 in a cell."],
  revision: ["Notebook = cells + output.", "Shift+Enter runs a cell.", "Colab = free browser notebook on Google's computers; save to Drive.", "Restart and Run All before sharing."],
  hinglish: "Notebook mein code cells hote hain jo ek-ek karke chalte hain. Colab browser mein chalta hai, install ki zaroorat nahi, lekin runtime band hone par files delete ho jaati hain, isliye Drive mein save karo.",
  quiz: [
    mcq("Which key combination runs a notebook cell?", ["Shift+Enter", "Alt+F4", "Ctrl+W", "F12"], 0, "Shift+Enter runs the cell and moves to the next."),
    mcq("Where does code in Google Colab run?", ["On your laptop", "On Google's computers", "On your phone", "In the browser's history"], 1, "Colab runs on a remote runtime provided by Google."),
    mcq("In a plain .py script, what does the line 5 * 5 (alone) show?", ["25", "Nothing", "An error", "5"], 1, "Scripts do not display expression values automatically.", "OUTPUT_PREDICTION"),
    mcq("Before sharing a notebook, you should:", ["Run cells in random order", "Restart and run all", "Delete the first cell", "Rename it .py"], 1, "It proves the notebook works top to bottom."),
  ],
  tasks: [task("Average of marks", "The list marks = [40, 50, 60] is given. Print its average rounded to 2 decimal places.", "marks = [40, 50, 60]\n# print the average, rounded to 2 decimals\n", `marks = [40, 50, 60]\nprint(round(sum(marks) / len(marks), 2))`, [["", "50.0"], ["", "50.0"]], [["", "50.0"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Virtual Environments, pip and requirements.txt",
  minutes: 40,
  learn: ["Explain why every project gets its own virtual environment", "Create, activate and deactivate a venv on every operating system", "Install packages with pip", "Record and recreate dependencies with requirements.txt"],
  why: "Two projects may need different versions of the same package. A virtual environment keeps them apart so one project's upgrade never breaks another.",
  realWorld: "A teammate clones your repository, runs two commands from your README and has exactly your packages: that is the professional way to share Python projects.",
  simple: "A <strong>virtual environment</strong> is a private folder that holds a copy of the Python tools and the packages for <em>one</em> project. <strong>pip</strong> installs packages into it. <strong>requirements.txt</strong> is the shopping list so others can install the same things.",
  detail: `<h3>Create and use a venv</h3>
${terminal("Windows (Command Prompt or PowerShell)", `> python -m venv .venv\n> .venv\\Scripts\\activate\n(.venv) > python -m pip install requests\n(.venv) > deactivate`)}
${terminal("Linux / macOS", `$ python3 -m venv .venv\n$ source .venv/bin/activate\n(.venv) $ python -m pip install requests\n(.venv) $ deactivate`)}
<ul><li>The folder name <code>.venv</code> is a convention; many tools recognise it. VS Code offers to use it automatically.</li><li>When active, your prompt starts with <code>(.venv)</code> and <code>python</code> / <code>pip</code> belong to that environment.</li><li>PowerShell may refuse the activation script ( <em>running scripts is disabled on this system</em>). Either use Command Prompt, or allow local scripts for your own account once: <code>Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</code>.</li><li>Never copy or commit the <code>.venv</code> folder: it is large and machine-specific. Add it to <code>.gitignore</code> and recreate it from <code>requirements.txt</code>.</li></ul>
<h3>pip essentials</h3>
${table(["Task", "Command"], [["Install a package", "<code>python -m pip install requests</code>"], ["Install an exact version", "<code>python -m pip install requests==2.32.3</code> (example version)"], ["Upgrade", "<code>python -m pip install --upgrade requests</code>"], ["List installed", "<code>python -m pip list</code>"], ["Remove", "<code>python -m pip uninstall requests</code>"], ["Save the list", "<code>python -m pip freeze &gt; requirements.txt</code>"], ["Install from the list", "<code>python -m pip install -r requirements.txt</code>"]])}
<h3>requirements.txt format</h3>
<p>One requirement per line. <code>==</code> pins an exact version, <code>&gt;=</code> sets a minimum. Pinning makes builds repeatable; leaving versions loose makes upgrades easier. Choose deliberately, and review packages for known vulnerabilities before using them (tools such as <code>pip-audit</code> help).</p>
<h3>Install only trusted packages</h3>
<p>Anyone can upload to PyPI. Check the package name carefully (typo-squatting attacks use near-identical names), its release history, its homepage and how widely it is used.</p>`,
  syntax: { code: `python -m venv .venv\nsource .venv/bin/activate      # Linux/macOS\n.venv\\Scripts\\activate         # Windows\npython -m pip install -r requirements.txt`, lang: "bash" },
  diagram: graph("Why virtual environments", "Two project folders, each with its own .venv holding different versions of the same package, both using the one installed Python.", 600, 250,
    [{ id: "p", k: "term", t: "Installed Python", x: 300, y: 36, w: 190 }, { id: "a", k: "proc", t: "Project A\n.venv: requests 2.31", x: 140, y: 140, w: 220, h: 60 }, { id: "b", k: "proc", t: "Project B\n.venv: requests 2.32", x: 460, y: 140, w: 220, h: 60 }, { id: "r", k: "io", t: "requirements.txt\nrecreates each one", x: 300, y: 224, w: 230, h: 46 }],
    [{ from: "p", to: "a" }, { from: "p", to: "b" }, { from: "a", to: "r" }, { from: "b", to: "r" }]),
  example: { code: `requirements = """requests==2.32.3\nrich>=13\n"""\nfor line in requirements.splitlines():\n    name = line.replace("==", " ").replace(">=", " ").split()[0]\n    print(name)`, out: `requests\nrich` },
  lineByLine: [["requirements = \"\"\"...\"\"\"", "A triple-quoted string spanning lines; the content mimics a requirements.txt file."], ["splitlines()", "Splits the text into a list of lines."], ["line.replace(\"==\", \" \")", "Turns <code>requests==2.32.3</code> into <code>requests 2.32.3</code>."], [".split()[0]", "Splits on spaces and takes the first item: the package name."]],
  dryRun: { intro: "Walking through the loop:", headers: ["line", "after replace", "split()[0]"], rows: [["requests==2.32.3", "requests 2.32.3", "requests"], ["rich>=13", "rich 13", "rich"]] },
  realExample: { intro: "Count how many packages a project depends on.", code: `lines = ["requests==2.32.3", "rich>=13", "pytest==8.3.2"]\nprint(f"{len(lines)} dependencies")\nfor item in sorted(lines):\n    print("-", item)`, out: `3 dependencies\n- pytest==8.3.2\n- requests==2.32.3\n- rich>=13` },
  mistakes: ["Installing packages globally and polluting the system Python.", "Forgetting to activate the environment, then wondering why <code>import</code> fails.", "Committing <code>.venv</code> to Git.", "Using bare <code>pip</code> that belongs to another Python; use <code>python -m pip</code>.", "Copying a venv folder to another computer: recreate it instead."],
  practices: ["One venv per project, created inside the project folder.", "Always pin versions in applications you deploy; document the Python version too.", "Add <code>.venv/</code> to <code>.gitignore</code>.", "Re-run <code>pip freeze</code> after adding a package."],
  interview: ["What problem do virtual environments solve?", "Difference between <code>pip freeze</code> and writing requirements by hand?", "How do you reproduce an environment on another machine?", "What is typo-squatting?"],
  practiceQs: ["Create a venv, activate it, install a package and run <code>python -m pip list</code>.", "Create requirements.txt from your environment, delete the venv and rebuild it.", "What does the (.venv) in your prompt mean?"],
  revision: ["python -m venv .venv.", "Activate: Windows .venv\\Scripts\\activate; Linux/macOS source .venv/bin/activate.", "pip freeze > requirements.txt; pip install -r requirements.txt.", "Never commit .venv."],
  hinglish: "Har project ke liye alag virtual environment banao: python -m venv .venv. Activate karke hi pip install karo. requirements.txt mein packages ki list rakho taaki dusre log wahi setup bana sakein. .venv ko Git mein commit mat karo.",
  quiz: [
    mcq("Which command creates a virtual environment named .venv?", ["python -m venv .venv", "pip create .venv", "python venv new", "venv --python"], 0, "The venv module is run with -m."),
    mcq("What does the (.venv) in the prompt tell you?", ["The environment is active", "An error occurred", "Python is outdated", "pip is missing"], 0, "It shows the active virtual environment."),
    mcq("Which command saves installed packages to a file?", ["python -m pip freeze > requirements.txt", "pip save", "python --export", "pip list --file"], 0, "pip freeze prints installed packages in requirements format."),
    mcq("What does this print?\n\nprint(\"rich>=13\".replace(\">=\", \" \").split()[0])", ["rich", "13", "rich>=13", "rich 13"], 0, "After replace it is 'rich 13'; split()[0] is 'rich'.", "OUTPUT_PREDICTION"),
    mcq("Which folder should never be committed to Git?", [".venv/", "README.md", "main.py", "requirements.txt"], 0, "It is large, machine-specific and recreated from requirements.txt."),
  ],
  tasks: [task("Package names", "The list lines = [\"flask==3.0.3\", \"pandas>=2\"] is given. For each line print only the package name (the text before == or >=), one per line.", "lines = [\"flask==3.0.3\", \"pandas>=2\"]\n# print only the package names\n", `lines = ["flask==3.0.3", "pandas>=2"]\nfor line in lines:\n    print(line.replace("==", " ").replace(">=", " ").split()[0])`, [["", "flask\npandas"], ["", "flask\npandas"]], [["", "flask\npandas"]])],
});

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Fixing Setup Problems, Debugging Setup and Git/GitHub Basics",
  minutes: 45,
  learn: ["Diagnose the most common installation and environment errors", "Run a program under the debugger in VS Code", "Create a Git repository and push a Python project to GitHub", "Lay out a clean project folder"],
  why: "Setup problems cost beginners the most time and confidence. A checklist plus version control from day one removes both.",
  realWorld: "Every employer expects code in Git. A GitHub profile with tidy repositories is the first thing many recruiters open.",
  simple: "When something fails, read the message, find your row in the table below, apply one fix, and test again. Put your project under Git early so you can undo mistakes and show your work.",
  detail: `<h3>Setup troubleshooting table</h3>
${table(["Symptom", "Likely cause", "Fix"], [["'python' is not recognized (Windows)", "Python not installed, PATH not updated, or terminal opened before install", "Install via the install manager, open a <strong>new</strong> terminal; try <code>py --version</code>"], ["Windows opens the Microsoft Store when you type python", "App-execution alias points to the Store stub", "Install Python; or disable the alias in Settings &rarr; Apps &rarr; Advanced app settings &rarr; App execution aliases"], ["python: command not found (Linux/macOS)", "Command is python3", "Use <code>python3</code>, or activate a venv"], ["No module named X", "Package not installed in the <em>active</em> Python", "Activate the venv, then <code>python -m pip install X</code>"], ["No module named pip / venv", "Missing OS package (Debian/Ubuntu)", "<code>sudo apt install python3-pip python3-venv</code>"], ["externally-managed-environment", "System Python is protected", "Create a venv and install inside it"], ["PowerShell cannot run Activate.ps1", "Script execution policy", "Use Command Prompt, or <code>Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</code>"], ["SSL certificate error on macOS", "Certificates not installed", "Run <strong>Install Certificates.command</strong>"], ["Code runs in terminal but VS Code shows import errors", "Wrong interpreter selected", "Ctrl+Shift+P &rarr; Python: Select Interpreter"], ["Wrong version runs", "Several Pythons on PATH", "<code>where python</code> / <code>which python3</code>; use <code>python --version</code> inside the active venv"]])}
<h3>Debugging setup in VS Code</h3>
<ol><li>Open your file and click to the left of a line number to set a <strong>breakpoint</strong> (red dot).</li><li>Press F5 and choose <em>Python File</em>.</li><li>The program pauses on the breakpoint. Use <strong>F10</strong> (step over) and <strong>F11</strong> (step into); watch variable values in the Variables panel.</li><li>Press Shift+F5 to stop.</li></ol>
<h3>Git and GitHub in six commands</h3>
${terminal("Terminal", `$ git --version\n$ git init\n$ git add .\n$ git commit -m "Add student card program"\n$ git branch -M main\n$ git remote add origin https://github.com/<your-user>/<repo>.git\n$ git push -u origin main`)}
<p>Create the empty repository on github.com first, then run the commands above. Add a <code>.gitignore</code> file so you never commit <code>.venv/</code>, <code>__pycache__/</code> or secrets. Never put passwords or API keys in your code or repository.</p>
<h3>A clean project layout</h3>
<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px"><code>student-card/\n  main.py\n  requirements.txt\n  README.md\n  .gitignore</code></pre>`,
  syntax: { code: `git init\ngit add .\ngit commit -m "message"\ngit push -u origin main`, lang: "bash" },
  diagram: graph("Setup troubleshooting flow", "Flow: run python --version; if it prints a version, test pip; if not, install or fix PATH in a new terminal; then retest.", 600, 260,
    [{ id: "a", k: "term", t: "python --version", x: 100, y: 40, w: 160 }, { id: "b", k: "dec", t: "Version\nshown?", x: 300, y: 40, w: 120, h: 64 }, { id: "c", k: "proc", t: "python -m pip --version", x: 500, y: 40, w: 180 }, { id: "d", k: "proc", t: "Install / fix PATH,\nopen NEW terminal", x: 300, y: 150, w: 200, h: 56 }, { id: "e", k: "term", t: "Setup verified", x: 500, y: 150, w: 150 }],
    [{ from: "a", to: "b" }, { from: "b", to: "c", label: "yes", dx: -4 }, { from: "b", to: "d", label: "no", dx: 8 }, { from: "d", to: "a" }, { from: "c", to: "e" }]),
  example: { code: `try:\n    import not_a_real_package\nexcept ModuleNotFoundError as error:\n    print("Missing:", error.name)`, out: `Missing: not_a_real_package` },
  lineByLine: [["try:", "Starts a block where an error may occur (exceptions are taught in Module 9)."], ["import not_a_real_package", "Python cannot find this module, so it raises <code>ModuleNotFoundError</code>."], ["except ModuleNotFoundError as error:", "Catches that exact error and stores it in <code>error</code>."], ["error.name", "The name of the module that could not be found."]],
  dryRun: { intro: "What happens at each step:", headers: ["Step", "Result"], rows: [["import runs", "Python searches the active environment: not found"], ["ModuleNotFoundError is raised", "control jumps to the except block"], ["print runs", "Missing: not_a_real_package"]] },
  realExample: { intro: "Print the standard project layout from a list.", code: `project = "student-card"\nfiles = ["main.py", "requirements.txt", "README.md", ".gitignore"]\nprint(f"{project}/")\nfor name in files:\n    print(f"  {name}")`, out: `student-card/\n  main.py\n  requirements.txt\n  README.md\n  .gitignore` },
  mistakes: ["Retrying the same command without reading the error text.", "Fixing several things at once and not knowing which one worked.", "Committing secrets, .venv or large data files.", "Pushing code without a README so nobody knows how to run it.", "Using a work or college account for personal code when your institute prohibits it."],
  practices: ["Run <code>python --version</code> and <code>python -m pip --version</code> as your setup check.", "Commit small and often with meaningful messages.", "Write a README with: what it does, how to install, how to run.", "Search the exact error message and prefer official documentation."],
  interview: ["What does ModuleNotFoundError mean and how do you fix it?", "Difference between Git and GitHub?", "What should go in .gitignore for a Python project?", "How do you debug with a breakpoint?"],
  practiceQs: ["Create a GitHub repository for your course work and push hello.py.", "Cause and fix a ModuleNotFoundError on purpose.", "Write the README for your student card program."],
  revision: ["Read the error; match it in the table; change one thing.", "ModuleNotFoundError: activate the venv and install the package.", "Breakpoint + F5, F10/F11 in VS Code.", "git init, add, commit, remote add, push.", ".gitignore: .venv/, __pycache__/, secrets."],
  hinglish: "Error aaye to message padho, table mein apna case dhundho aur ek hi fix lagao. Code ko Git mein rakho: git init, add, commit, push. .gitignore mein .venv/ aur secrets zaroor daalo.",
  quiz: [
    mcq("ModuleNotFoundError: No module named 'requests'. What is the best first step?", ["Reinstall Windows", "Activate your venv and run python -m pip install requests", "Rename the file", "Delete Python"], 1, "The package is missing from the active environment."),
    mcq("Which file stops Git tracking .venv/?", [".gitignore", "requirements.txt", "README.md", "setup.py"], 0, ".gitignore lists patterns Git should not track."),
    mcq("Which key steps over a line in the VS Code debugger?", ["F10", "F5 only", "Delete", "Ctrl+S"], 0, "F10 steps over; F11 steps into; F5 continues."),
    mcq("What is printed?\n\ntry:\n    import nope_nope\nexcept ModuleNotFoundError:\n    print(\"missing\")", ["missing", "nothing", "An uncaught error", "nope_nope"], 0, "The exception is caught, so the program prints missing.", "OUTPUT_PREDICTION"),
    mcq("Git is to GitHub as:", ["A tool is to a hosting website for it", "A browser is to a keyboard", "Python is to pip", "They are the same"], 0, "Git is the version-control tool; GitHub hosts repositories online."),
  ],
  tasks: [task("Project layout", "Print this exact layout:\n\nmy-app/\n  main.py\n  README.md", "# print the layout\n", `print("my-app/")\nprint("  main.py")\nprint("  README.md")`, [["", "my-app/\n  main.py\n  README.md"], ["", "my-app/\n  main.py\n  README.md"]], [["", "my-app/\n  main.py\n  README.md"]])],
});

module.exports = {
  module: {
    title: "Phase 0 - Module 2: Installation and Environment Setup",
    description: "Install Python on Windows, Linux or macOS; run programs from the shell, IDLE, terminal and VS Code; use notebooks; create virtual environments; fix common problems; start with Git and GitHub.",
    chapters: [{ title: "Installation and Environment Setup", description: "Version choice, OS-specific installation, editors, notebooks, virtual environments, troubleshooting and Git.", lessons }],
    assessment: {
      title: "Module 2 Assessment: Setup Verification",
      description: "Short programs that prove your Python installation and tools work.",
      questions: [
        task("Setup OK", "Print exactly: Setup OK", "", `print("Setup OK")`, [["", "Setup OK"], ["", "Setup OK"]], [["", "Setup OK"]]),
        task("Python major version", "Print True if the major version of the running Python is 3, otherwise print False.", "import sys\n", `import sys\nprint(sys.version_info.major == 3)`, [["", "True"], ["", "True"]], [["", "True"]]),
        task("Requirement names", "Given lines = [\"numpy==2.1.0\", \"pytest>=8\"], print each package name on its own line.", "lines = [\"numpy==2.1.0\", \"pytest>=8\"]\n", `lines = ["numpy==2.1.0", "pytest>=8"]\nfor line in lines:\n    print(line.replace("==", " ").replace(">=", " ").split()[0])`, [["", "numpy\npytest"], ["", "numpy\npytest"]], [["", "numpy\npytest"]]),
      ],
    },
  },
};
