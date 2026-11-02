// Phase 4 / Module 18, lessons 7-9: logging and configuration, project structure and packaging, secure coding.
// Examples need packaging (installed with pytest in the course's virtual environment). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Logging and Configuration: Environment Variables and Settings",
  minutes: 55,
  learn: ["Use the logging module: loggers, levels, handlers and formatters", "Choose log levels and write messages that help during an incident", "Read configuration from environment variables with defaults and validation", "Keep secrets out of code and out of logs"],
  why: "When software runs on a server nobody is watching a terminal. Logs are how you learn what happened, and configuration (database address, secret keys, debug switch) must change between your laptop, staging and production without editing code.",
  realWorld: "A payment fails at 2 a.m. The on-call engineer searches the logs for the order id, sees a timeout warning followed by an error, and finds the root cause in minutes. The database URL she is connecting to comes from an environment variable, not from the code.",
  simple: "<code>print</code> is for you; <strong>logging</strong> is for the system: it has levels (DEBUG to CRITICAL), can go to the console, files or a log service, and can be switched on or off without changing code. <strong>Configuration</strong> is read from the environment so the same code runs everywhere.",
  detail: `<h3>Logging basics</h3>
<ul><li>Create one logger per module: <code>log = logging.getLogger(__name__)</code>.</li><li>Use levels: <code>DEBUG</code> detail for developers, <code>INFO</code> normal events, <code>WARNING</code> something unexpected but handled, <code>ERROR</code> an operation failed, <code>CRITICAL</code> the service may be down.</li><li>Pass values as arguments: <code>log.info(&quot;charging %s rupees&quot;, amount)</code>, not f-strings (the work is skipped when the level is off).</li><li><code>log.exception(&quot;message&quot;)</code> inside an <code>except</code> block logs the message <em>and the traceback</em>.</li><li>Loggers form a tree by dotted name: <code>shop.payments</code> is a child of <code>shop</code> and inherits its level and handlers.</li></ul>
${table(["Part", "Role"], [["Logger", "what your code calls (<code>log.info</code>)"], ["Level", "a threshold: messages below it are dropped"], ["Handler", "where records go: <code>StreamHandler</code>, <code>FileHandler</code>, <code>RotatingFileHandler</code>"], ["Formatter", "how a record looks: time, level, logger name, message"]])}
<p>Configure logging <strong>once</strong>, in the application's entry point (<code>logging.basicConfig(...)</code> or <code>logging.config.dictConfig(...)</code>). Libraries should create loggers but never configure handlers. For machines, log structured lines (JSON) so a log service can search by field. <strong>Never log passwords, tokens, card numbers or full personal data.</strong></p>
<h3>Configuration the twelve-factor way</h3>
<ul><li>Keep config in <strong>environment variables</strong>: <code>os.environ.get(&quot;APP_PORT&quot;, &quot;8000&quot;)</code>. Environment values are always strings: convert and validate them (<code>int(...)</code>, <code>== &quot;1&quot;</code> for booleans).</li><li>Order of precedence (highest first): command-line options, environment variables, a config file, built-in defaults.</li><li>Local development: a <code>.env</code> file loaded by a tool such as <code>python-dotenv</code> (never committed; commit a <code>.env.example</code> with fake values).</li><li>Fail fast: if a required setting is missing, stop at start-up with a clear message.</li><li>Group settings in one object (a frozen <code>dataclass</code>, or <code>pydantic-settings</code> in larger projects) and pass it around instead of reading <code>os.environ</code> everywhere.</li><li>Secrets belong in a secret manager or the platform's secret store, not in the repository or the image.</li></ul>`,
  syntax: { code: `import logging\nlogging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")\nlog = logging.getLogger(__name__)\nlog.info("started on port %s", port)`, note: "Configure once; log with %s arguments." },
  diagram: chain("How a log record travels", "Left to right: code calls the logger, the level filter drops or keeps the record, a handler receives it, a formatter writes the line to its destination.",
    [{ k: "proc", t: "log.info(...)" }, { k: "dec", t: "level\nenough?" }, { k: "proc", t: "handler" }, { k: "proc", t: "formatter" }, { k: "io", t: "console / file /\nlog service" }], { w: 135, gap: 28, hgt: 62 }),
  example: { code: `import logging
import sys

handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("%(levelname)-8s %(name)s: %(message)s"))
root = logging.getLogger()
root.addHandler(handler)
root.setLevel(logging.INFO)

log = logging.getLogger("shop.payments")
log.debug("not shown: below INFO")
log.info("charging %s rupees", 499)
log.warning("retry %d of %d", 1, 3)
log.error("charge failed for order %s", "A-17")

logging.getLogger("shop").setLevel(logging.ERROR)
log.info("hidden: the parent logger now requires ERROR")
log.error("still shown")
print(logging.getLevelName(log.getEffectiveLevel()), log.isEnabledFor(logging.INFO))`, out: `INFO     shop.payments: charging 499 rupees
WARNING  shop.payments: retry 1 of 3
ERROR    shop.payments: charge failed for order A-17
ERROR    shop.payments: still shown
ERROR False` },
  lineByLine: [["StreamHandler(sys.stdout)", "A handler that writes records to standard output."], ["Formatter(\"%(levelname)-8s ...\")", "Left-aligns the level in 8 characters, then the logger name and message."], ["root.setLevel(logging.INFO)", "The root logger drops DEBUG records."], ["getLogger(\"shop.payments\")", "A child of shop; with no level of its own it inherits from its parents."], ["log.info(\"charging %s rupees\", 499)", "Arguments are merged into the message only if the record is emitted."], ["getLogger(\"shop\").setLevel(ERROR)", "Raising the level on the parent changes the effective level of all its children."], ["getEffectiveLevel()", "The level actually used after inheritance: ERROR."]],
  dryRun: { intro: "Which records reach the console after the level change?", headers: ["Call", "Level", "Effective level", "Printed?"], rows: [["log.debug", "DEBUG", "INFO", "no"], ["log.info (before)", "INFO", "INFO", "yes"], ["log.info (after)", "INFO", "ERROR", "no"], ["log.error (after)", "ERROR", "ERROR", "yes"]] },
  realExample: { intro: "Settings read from the environment once, validated, and passed around as one object.", code: `from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    debug: bool
    port: int
    database_url: str

    @classmethod
    def from_env(cls, env):
        return cls(
            debug=env.get("APP_DEBUG", "0") == "1",
            port=int(env.get("APP_PORT", "8000")),
            database_url=env["DATABASE_URL"],
        )


print(Settings.from_env({"DATABASE_URL": "sqlite:///app.db", "APP_PORT": "9000"}))
try:
    Settings.from_env({})
except KeyError as error:
    print("missing setting", error)
try:
    Settings.from_env({"DATABASE_URL": "x", "APP_PORT": "eighty"})
except ValueError as error:
    print("bad setting:", error)`, out: `Settings(debug=False, port=9000, database_url='sqlite:///app.db')
missing setting 'DATABASE_URL'
bad setting: invalid literal for int() with base 10: 'eighty'` },
  mistakes: ["Using <code>print</code> for production diagnostics.", "Logging secrets, tokens or personal data.", "Configuring handlers in every module (duplicate lines).", "Reading <code>os.environ</code> all over the code and forgetting that values are strings.", "Committing <code>.env</code> or putting production secrets in the repository."],
  practices: ["One logger per module, configured once at start-up.", "Pass log arguments instead of pre-formatting; use log.exception in except blocks.", "Validate settings at start-up and fail fast.", "Commit <code>.env.example</code>, never <code>.env</code>."],
  interview: ["Why logging instead of print?", "What are the logging levels?", "How do you handle secrets in configuration?", "What is the twelve-factor approach to config?"],
  practiceQs: ["Which level would you use for a handled retry?", "What does log.exception add?", "Why is APP_DEBUG=0 a trap if you test it with bool()?", "Where should logging be configured?"],
  revision: ["DEBUG, INFO, WARNING, ERROR, CRITICAL.", "Logger name tree; handlers and formatters.", "Config from environment: defaults, validate, fail fast.", "No secrets in code or logs."],
  hinglish: "Server par koi terminal nahi dekhta, isliye print ki jagah logging use hoti hai jisme levels hote hain: DEBUG se CRITICAL tak. Configuration environment variables se aati hai taaki wahi code laptop aur production dono par chale. Secrets ko code ya logs mein kabhi mat daalo.",
  quiz: [
    mcq("Which log level fits \"a payment attempt failed and the operation was aborted\"?", ["DEBUG", "INFO", "ERROR", "CRITICAL only"], 2, "ERROR means an operation failed; CRITICAL is for the whole service being at risk."),
    mcq("What does log.exception(\"msg\") add compared with log.error(\"msg\")?", ["Nothing", "The current traceback", "A file handler", "A higher level"], 1, "Inside an except block it records the exception details."),
    mcq("Environment variables are always which type?", ["int", "bool", "str", "bytes"], 2, "Convert and validate them yourself."),
    mcq("Why should a library not configure logging handlers?", ["It is impossible", "The application decides where logs go", "Handlers are slow", "Libraries have no loggers"], 1, "The application owns the output configuration; libraries only create loggers."),
    mcq("Which file should be committed to the repository?", [".env with real keys", ".env.example with fake values", "secrets.txt", "the production password file"], 1, "An example file documents the settings without leaking secrets.")
  ],
  tasks: [task("Configuration with sources", "Read three blocks separated by a line containing only ---: the built-in defaults, the config file and the environment, each as lines KEY=VALUE (a block may be empty). The environment wins over the file, and the file wins over the defaults. Print every key in alphabetical order as KEY=VALUE (from SOURCE), where SOURCE is env, file or default.", "import sys\nblocks = sys.stdin.read().split(\"---\\n\")\n# merge by precedence and print with the source\n", `import sys

blocks = sys.stdin.read().split("---\\n")
names = ["default", "file", "env"]
merged = {}
for name, block in zip(names, blocks):
    for line in block.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            merged[key.strip()] = (value.strip(), name)
for key in sorted(merged):
    value, source = merged[key]
    print(f"{key}={value} (from {source})")`, [["PORT=8000\nDEBUG=0\n---\nPORT=9000\n---\nDEBUG=1", "DEBUG=1 (from env)\nPORT=9000 (from file)"], ["HOST=localhost\n---\n---\n", "HOST=localhost (from default)"], ["A=1\nB=2\n---\nB=3\nC=4\n---\nC=5\nD=6", "A=1 (from default)\nB=3 (from file)\nC=5 (from env)\nD=6 (from env)"], ["---\nLEVEL=info\n---\nLEVEL=debug", "LEVEL=debug (from env)"]])],
});

// ---------------------------------------------------------------- 8
lessons.push({
  title: "Project Structure, Dependencies and Packaging",
  minutes: 60,
  learn: ["Lay out a Python project with src, tests and pyproject.toml", "Manage dependencies with virtual environments, requirements files and lock files", "Understand semantic versioning and version specifiers", "Build a package with entry points and know how it is distributed"],
  why: "Anyone should be able to clone your project, install it with one command and run the tests. A clear layout and pinned dependencies make that possible, and they make your code installable by other people and by servers.",
  realWorld: "A new teammate clones the repository, creates a virtual environment, installs the project with <code>pip install -e .[dev]</code>, runs <code>pytest</code> and is productive within the hour. The same pinned versions are used in CI and in production.",
  simple: "<code>pyproject.toml</code> is the one file that describes your project: name, version, dependencies, tools and how to build it. A <strong>virtual environment</strong> keeps each project's packages separate, and a <strong>lock file</strong> records the exact versions that were tested.",
  detail: `<h3>A typical layout</h3>
${terminal("src layout", `studentkit/\n  pyproject.toml\n  README.md\n  LICENSE\n  .gitignore\n  src/\n    studentkit/\n      __init__.py\n      __main__.py     # python -m studentkit\n      cli.py\n      grades.py\n  tests/\n    test_grades.py\n  docs/`)}
<p>The <code>src</code> layout stops you from accidentally importing the folder instead of the installed package, so tests exercise what users get. Small scripts can stay a single file; use a package when there are several modules.</p>
<h3>Virtual environments and installing</h3>
<ul><li><code>python -m venv .venv</code>, then activate (<code>.venv\\Scripts\\activate</code> on Windows, <code>source .venv/bin/activate</code> on macOS and Linux). Never install project packages into the system Python.</li><li><code>python -m pip install requests</code>; <code>pip install -e .</code> installs your own project in editable mode; <code>pip install -e &quot;.[dev]&quot;</code> adds the optional <em>dev</em> extras.</li><li><code>uv</code>, <code>poetry</code> and <code>pdm</code> are modern tools that create environments and lock files for you. The standard pieces underneath are the same: <code>pyproject.toml</code>, wheels and PyPI.</li></ul>
<h3>Dependencies</h3>
${table(["Idea", "Example", "Meaning"], [["compatible release", "<code>requests~=2.31</code>", "2.31 or newer but below 3.0"], ["range", "<code>requests&gt;=2.31,&lt;3</code>", "any 2.x from 2.31"], ["exact pin", "<code>requests==2.32.3</code>", "exactly that version (for applications and lock files)"], ["extras", "<code>httpx[http2]</code>", "optional feature bundle"], ["environment marker", "<code>tomli; python_version &lt; &quot;3.11&quot;</code>", "only on older Pythons"]])}
<p><strong>Libraries</strong> declare wide ranges so they fit with other packages; <strong>applications</strong> pin exact versions in a lock file (<code>requirements.txt</code> from <code>pip freeze</code> or <code>pip-compile</code>, <code>uv.lock</code>, <code>poetry.lock</code>) so every machine installs the same thing. Update on purpose, run the tests, and audit for known vulnerabilities (<code>pip-audit</code>).</p>
<h3>Semantic versioning</h3>
<p><code>MAJOR.MINOR.PATCH</code>: PATCH for bug fixes, MINOR for backward-compatible features, MAJOR for breaking changes. Python's own version rules are described in PEP 440 (pre-releases such as <code>1.0rc1</code> sort before <code>1.0</code>).</p>
<h3>Building and publishing</h3>
<ul><li><code>[build-system]</code> names the backend (setuptools, hatchling, flit, uv_build...). <code>python -m build</code> produces a <em>wheel</em> (<code>.whl</code>) and an sdist.</li><li><code>[project.scripts]</code> creates a command: <code>studentkit = &quot;studentkit.cli:main&quot;</code> installs a <code>studentkit</code> program.</li><li>Upload with <code>twine</code> or a CI job using PyPI <em>trusted publishing</em>; try TestPyPI first. Companies often use a private package index.</li><li>Applications are usually shipped as a container image instead.</li></ul>`,
  syntax: { code: `# pyproject.toml\n[project]\nname = "studentkit"\nversion = "0.1.0"\ndependencies = ["requests>=2.31,<3"]\n[project.scripts]\nstudentkit = "studentkit.cli:main"`, note: "One file describes the project." },
  diagram: chain("From source to installed package", "Left to right: source code and pyproject.toml, build a wheel, upload to a package index, then pip install on another machine.",
    [{ k: "proc", t: "src/ +\npyproject.toml" }, { k: "proc", t: "python -m build\n(wheel)" }, { k: "io", t: "package index\n(PyPI / private)" }, { k: "term", t: "pip install" }], { w: 160, gap: 32, hgt: 62 }),
  example: { code: `import pathlib
import shutil
import subprocess
import sys
import tempfile
import tomllib
import venv

root = pathlib.Path(tempfile.mkdtemp()) / "studentkit"
package = root / "src" / "studentkit"
package.mkdir(parents=True)
(root / "tests").mkdir()

(root / "pyproject.toml").write_text('''[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "studentkit"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = ["requests>=2.31,<3"]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff"]

[project.scripts]
studentkit = "studentkit.cli:main"

[tool.ruff]
line-length = 100
''')
(package / "__init__.py").write_text('__version__ = "0.1.0"\\n')
(package / "grades.py").write_text('def grade(marks):\\n    return "pass" if marks >= 40 else "fail"\\n')
(package / "cli.py").write_text('import sys\\nfrom .grades import grade\\n\\n\\ndef main():\\n    marks = int(sys.argv[1])\\n    print(marks, "->", grade(marks))\\n')
(package / "__main__.py").write_text("from .cli import main\\n\\nmain()\\n")
(root / "tests" / "test_grades.py").write_text("def test_placeholder():\\n    assert True\\n")

for name in sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()):
    print(name)

config = tomllib.loads((root / "pyproject.toml").read_text())
print(config["project"]["name"], config["project"]["version"], config["project"]["dependencies"])
print(config["project"]["scripts"], config["tool"]["ruff"]["line-length"])

done = subprocess.run([sys.executable, "-B", "-m", "studentkit", "75"], cwd=root, env={"PYTHONPATH": "src"},
                      capture_output=True, text=True)
print(done.stdout.strip())

venv.EnvBuilder(with_pip=False).create(root / ".venv")
print("venv created:", (root / ".venv" / "pyvenv.cfg").exists())
shutil.rmtree(root.parent, ignore_errors=True)`, out: `pyproject.toml
src/studentkit/__init__.py
src/studentkit/__main__.py
src/studentkit/cli.py
src/studentkit/grades.py
tests/test_grades.py
studentkit 0.1.0 ['requests>=2.31,<3']
{'studentkit': 'studentkit.cli:main'} 100
75 -> pass
venv created: True` },
  lineByLine: [["src/studentkit/", "The importable package lives under src; tests live beside it, not inside it."], ["pyproject.toml sections", "[build-system] says how to build, [project] describes the package, [project.scripts] defines a command, [tool.ruff] configures a tool."], ["tomllib.loads", "Python 3.11+ reads TOML in the standard library; this is how tools read pyproject.toml."], ["__main__.py", "Makes python -m studentkit work: it runs main()."], ["PYTHONPATH=src", "Lets the example import the package without installing it; pip install -e . does this properly."], ["from .grades import grade", "A relative import inside the package."], ["venv.EnvBuilder(with_pip=False)", "Creates a virtual environment folder; pyvenv.cfg marks it."]],
  dryRun: { intro: "What happens when someone runs <code>pip install -e \".[dev]\"</code>:", headers: ["Step", "Action"], rows: [["1", "pip reads pyproject.toml and finds the build backend"], ["2", "installs the declared dependencies (requests) and the dev extras (pytest, ruff)"], ["3", "links the project folder into the environment so edits take effect at once"], ["4", "creates the studentkit command from [project.scripts]"]] },
  realExample: { intro: "Checking version numbers against a requirement with the packaging library (the same code pip uses).", code: `from packaging.requirements import Requirement
from packaging.version import Version

requirement = Requirement("requests>=2.31,<3")
print(requirement.name, sorted(str(spec) for spec in requirement.specifier))
for text in ["2.30.0", "2.31.0", "2.32.3", "3.0.0", "3.0.0rc1"]:
    print(text, Version(text) in requirement.specifier)
print(Version("1.0rc1") < Version("1.0"), Version("1.10") > Version("1.9"))`, out: `requests ['<3', '>=2.31']
2.30.0 False
2.31.0 True
2.32.3 True
3.0.0 False
3.0.0rc1 False
True True` },
  mistakes: ["Installing packages into the system Python.", "Committing the <code>.venv</code> folder.", "Unpinned dependencies in an application, so today's build differs from yesterday's.", "Comparing versions as strings (&quot;1.10&quot; &lt; &quot;1.9&quot;).", "Importing from the project root by accident instead of the installed package."],
  practices: ["One virtual environment per project.", "Use pyproject.toml for metadata and tool settings.", "Pin applications with a lock file; give libraries sensible ranges.", "Keep dev dependencies in an extra or dependency group."],
  interview: ["Why use a virtual environment?", "requirements.txt versus pyproject.toml?", "What does semantic versioning promise?", "What is a wheel?"],
  practiceQs: ["What does requests~=2.31 allow?", "Why compare versions with Version, not strings?", "What is the src layout for?", "How does python -m package work?"],
  revision: ["venv per project; pip install -e . for your own code.", "pyproject.toml describes, builds and configures.", "Applications pin; libraries use ranges.", "MAJOR.MINOR.PATCH."],
  hinglish: "Har project ka apna virtual environment banao aur pyproject.toml mein naam, version, dependencies aur tool settings likho. Application mein exact versions lock file se pin karo, library mein range do. python -m build se wheel banta hai aur PyPI ya private index par upload hota hai.",
  quiz: [
    mcq("Why use a virtual environment for each project?", ["It makes code faster", "It keeps each project's packages separate", "It is required to run Python", "It encrypts the code"], 1, "Different projects can need different versions of the same package."),
    mcq("Which specifier means \"2.31 or newer but below 3\"?", ["==2.31", "~=2.31", "<2.31", "!=3"], 1, "The compatible-release operator allows later 2.x versions."),
    mcq("What is the purpose of [project.scripts] in pyproject.toml?", ["Run tests", "Create a command-line program that calls a function", "Set the Python version", "List files"], 1, "Installing the package creates the named command."),
    mcq("Which statement about version comparison is correct?", ["\"1.10\" is greater than \"1.9\" as text", "Use packaging.version.Version to compare versions correctly", "Pre-releases sort after final releases", "Versions cannot be compared"], 1, "As text '1.10' < '1.9'; Version compares the numbers, and 1.0rc1 sorts before 1.0."),
    mcq("Which is best for an application deployed to production?", ["No version limits", "Exact pins from a lock file", "Always the newest versions at install time", "Copy site-packages by hand"], 1, "Pins make builds repeatable.")
  ],
  tasks: [task("Review a requirements file", "Read lines of a requirements file until the end of the input. Ignore blank lines and lines starting with #. For every other line print NAME: pinned VERSION when it uses == (the version after ==), or NAME: UNPINNED (SPEC) otherwise, where SPEC is the part after the name (or any when there is none). NAME is the text before the first of the characters = < > ~ ! or [ (an extras list such as [http2] is not part of the name or the spec).", "import re, sys\nfor line in sys.stdin.read().splitlines():\n    line = line.strip()\n    # skip comments, then report each requirement\n", `import re
import sys

for line in sys.stdin.read().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    match = re.match(r"([A-Za-z0-9_.-]+)(\\[[^\\]]*\\])?\\s*(.*)", line)
    name, spec = match.group(1), match.group(3)
    if spec.startswith("=="):
        print(f"{name}: pinned {spec[2:]}")
    else:
        print(f"{name}: UNPINNED ({spec or 'any'})")`, [["# web\nrequests==2.32.3\nflask>=3.0\n\nhttpx[http2]~=0.27", "requests: pinned 2.32.3\nflask: UNPINNED (>=3.0)\nhttpx: UNPINNED (~=0.27)"], ["pytest", "pytest: UNPINNED (any)"], ["numpy==2.1.0\npandas==2.2.2", "numpy: pinned 2.1.0\npandas: pinned 2.2.2"], ["flask>=3.0,<4\n# c\nrich", "flask: UNPINNED (>=3.0,<4)\nrich: UNPINNED (any)"]])],
});

// ---------------------------------------------------------------- 9
lessons.push({
  title: "Secure Coding in Python: Validation, Secrets and Safe Defaults",
  minutes: 60,
  learn: ["Validate and sanitise input and avoid injection (SQL, shell, code, path traversal)", "Store and compare secrets safely and generate secure random values", "Avoid dangerous functions such as eval, pickle on untrusted data and shell=True", "Keep dependencies and configuration safe"],
  why: "A single security mistake can leak user data and end a company's reputation. Most attacks use well-known weaknesses that careful coding prevents. Secure habits are expected from every developer, not only security specialists.",
  realWorld: "A file-download endpoint takes a filename from the user. Without a check, <code>../../etc/passwd</code> reads server files. With a safe path check, the request is refused and logged.",
  simple: "Treat <strong>all input as hostile</strong> until validated, give code the <strong>least privilege</strong> it needs, never build commands or queries by gluing strings together, and keep secrets out of code and logs.",
  detail: `<h3>Input handling</h3>
<ul><li><strong>Validate</strong> type, length, range and format at the boundary; reject by default (allow-lists beat block-lists).</li><li>Convert once to the right type; use parsers (<code>int</code>, <code>json</code>, <code>datetime</code>), not hand-made string checks.</li><li>Validation is not security by itself: also encode output (HTML escaping) and use safe APIs.</li></ul>
<h3>Injection and dangerous calls</h3>
${table(["Risk", "Unsafe", "Safe"], [["SQL injection", "<code>f&quot;... WHERE name = '{name}'&quot;</code>", "parameters: <code>cur.execute(&quot;... WHERE name = ?&quot;, (name,))</code>"], ["shell injection", "<code>os.system(&quot;convert &quot; + name)</code>, <code>shell=True</code>", "<code>subprocess.run([&quot;convert&quot;, name], check=True)</code>"], ["code execution", "<code>eval(user_text)</code>, <code>exec</code>", "<code>ast.literal_eval</code>, <code>json.loads</code>, or a real parser"], ["unsafe deserialisation", "<code>pickle.loads(data)</code>, <code>yaml.load</code>", "JSON, <code>yaml.safe_load</code>; never unpickle untrusted bytes"], ["path traversal", "<code>open(base + user_path)</code>", "resolve the path and check it is inside the base folder"], ["template injection / XSS", "building HTML with strings", "auto-escaping template engines"], ["server-side request forgery", "fetching any user-supplied URL", "allow-list hosts, block internal addresses"]])}
<h3>Secrets and cryptography</h3>
<ul><li>Use the <code>secrets</code> module for tokens and passwords (<code>secrets.token_urlsafe(16)</code>), <strong>not</strong> <code>random</code>.</li><li>Never store plain passwords: hash with a slow, salted function (<code>hashlib.scrypt</code>, <code>pbkdf2_hmac</code>, or a library such as <code>argon2-cffi</code> / <code>bcrypt</code>).</li><li>Compare secrets with <code>hmac.compare_digest</code> to avoid timing leaks.</li><li>Do not invent your own cryptography; use a maintained library (<code>cryptography</code>) and TLS (HTTPS).</li><li>Keep keys in environment variables or a secret manager; rotate them; never print or log them.</li></ul>
<h3>Safe defaults</h3>
<ul><li>Least privilege: database users with only the rights they need; run services as non-root.</li><li>Errors shown to users must not reveal stack traces, paths or SQL; log details privately.</li><li>Set timeouts on network calls; limit upload sizes and request rates.</li><li>Do not rely on <code>assert</code> for checks that must always run (they disappear with <code>-O</code>).</li><li>Temporary files: <code>tempfile.mkstemp</code> / <code>NamedTemporaryFile</code>, not predictable names.</li></ul>
<h3>Dependencies and process</h3>
<p>Most real incidents come from vulnerable or malicious packages. Pin and update dependencies, run <code>pip-audit</code> (or your platform's dependency scanner) in CI, install only packages you recognise (watch for look-alike names), and enable GitHub secret scanning. Review the OWASP Top 10 list (current edition) for the most common web weaknesses, and threat-model new features: who could misuse this, and how?</p>`,
  syntax: { code: `import ast, secrets, hmac, subprocess\nast.literal_eval(text)\nsecrets.token_urlsafe(16)\nhmac.compare_digest(a, b)\nsubprocess.run(["tool", arg], check=True)`, note: "Safe APIs: parameters, lists, literal_eval, secrets." },
  diagram: chain("Layers of defence", "Left to right: untrusted input is validated, handled by safe APIs with least privilege, and recorded in safe logs.",
    [{ k: "io", t: "untrusted\ninput" }, { k: "proc", t: "validate\n(allow-list)" }, { k: "proc", t: "safe APIs\n(parameters, lists)" }, { k: "proc", t: "least\nprivilege" }, { k: "term", t: "log without\nsecrets" }], { w: 140, gap: 28, hgt: 62 }),
  example: { code: `import ast
import hmac
import pathlib
import secrets
import subprocess
import sys
import tempfile

print(ast.literal_eval("[1, 2, {'a': 3}]"))
try:
    ast.literal_eval("__import__('os').getcwd()")
except ValueError:
    print("literal_eval refused to run code")

filename = "report.txt; echo hacked"
shown = subprocess.run([sys.executable, "-c", "import sys; print(sys.argv[1])", filename],
                       capture_output=True, text=True).stdout.strip()
print("argument stayed data:", shown)

BASE = pathlib.Path(tempfile.mkdtemp()).resolve()


def inside_base(user_path):
    candidate = (BASE / user_path).resolve()
    return candidate.is_relative_to(BASE)


for requested in ["docs/a.txt", "../secret.txt", "/etc/passwd", "docs/../docs/b.txt"]:
    print(requested, "->", "allowed" if inside_base(requested) else "blocked")

token = secrets.token_urlsafe(16)
print(len(token), hmac.compare_digest(token, token), hmac.compare_digest(token, "x" * len(token)))`, out: `[1, 2, {'a': 3}]
literal_eval refused to run code
argument stayed data: report.txt; echo hacked
docs/a.txt -> allowed
../secret.txt -> blocked
/etc/passwd -> blocked
docs/../docs/b.txt -> allowed
22 True False` },
  lineByLine: [["ast.literal_eval", "Parses only Python literals (numbers, strings, lists, dicts...). A function call is refused, unlike eval."], ["subprocess.run([... , filename])", "Arguments are passed as a list, so the shell never sees the semicolon and echo hacked is not run."], ["(BASE / user_path).resolve()", "Joins and normalises the path, resolving .. parts and symlinks."], ["is_relative_to(BASE)", "True only when the final path is still inside the allowed folder."], ["/etc/passwd", "An absolute user path replaces the base when joined; the check still blocks it."], ["secrets.token_urlsafe(16)", "16 random bytes encoded as 22 URL-safe characters, from the operating system's secure source."], ["hmac.compare_digest", "Compares in constant time, so an attacker cannot learn a secret by timing."]],
  dryRun: { intro: "Resolving the user path <code>../secret.txt</code> against the base folder B:", headers: ["Step", "Value"], rows: [["join", "B/../secret.txt"], ["resolve", "parent of B + /secret.txt"], ["is_relative_to(B)", "False, so the request is blocked"]] },
  realExample: { intro: "Redacting secrets before a line is written to a log.", code: `import re

SECRET = re.compile(r"(password|token|api_key)=([^&\\s]+)", re.IGNORECASE)


def redact(text):
    return SECRET.sub(lambda m: f"{m.group(1)}=***", text)


for line in ["login user=asha password=hunter2 ok", "GET /pay?api_key=ab12cd&amount=5", "nothing secret here"]:
    print(redact(line))`, out: `login user=asha password=*** ok
GET /pay?api_key=***&amount=5
nothing secret here` },
  mistakes: ["Building SQL, shell commands or HTML by string concatenation.", "Using <code>eval</code>, <code>exec</code> or <code>pickle</code> on data that users control.", "Using <code>random</code> for tokens and passwords.", "Storing plain or fast-hashed passwords.", "Showing stack traces to users and logging secrets."],
  practices: ["Validate at the boundary with allow-lists; use parameterised queries.", "Pass subprocess arguments as lists; avoid shell=True.", "Use secrets, slow salted hashes and compare_digest.", "Scan dependencies and secrets in CI."],
  interview: ["How do you prevent SQL injection?", "Why is eval dangerous?", "random versus secrets?", "How do you store passwords?"],
  practiceQs: ["What is path traversal?", "Why use hmac.compare_digest?", "Why avoid shell=True?", "What does pip-audit do?"],
  revision: ["Never trust input; validate with allow-lists.", "Parameters, argument lists, literal_eval, safe loaders.", "secrets, slow salted password hashes, constant-time compare.", "Least privilege; no secrets in code or logs; audit dependencies."],
  hinglish: "User ke input par kabhi bharosa mat karo: SQL ke liye parameters, shell ke liye argument list, aur eval ki jagah ast.literal_eval use karo. Token ke liye secrets module lo, password ko slow salted hash se store karo, aur secrets ko code ya logs mein mat daalo.",
  quiz: [
    mcq("Which is the safe way to run an external program with a user-supplied file name?", ["os.system(\"tool \" + name)", "subprocess.run([\"tool\", name], check=True)", "subprocess.run(\"tool \" + name, shell=True)", "eval(name)"], 1, "A list of arguments is never interpreted by a shell."),
    mcq("Which module should generate a password-reset token?", ["random", "secrets", "math", "time"], 1, "secrets uses the operating system's cryptographically secure source."),
    mcq("What attack does the user path ../../etc/passwd attempt?", ["SQL injection", "Path traversal", "Cross-site scripting", "Denial of service only"], 1, "It escapes the intended folder using .. segments."),
    mcq("Why should pickle.loads never be used on data from the internet?", ["It is slow", "Unpickling can execute arbitrary code", "It only works with ints", "It needs a licence"], 1, "A crafted pickle can run code while loading."),
    mcq("Why is hmac.compare_digest preferred for comparing tokens?", ["It is shorter", "It takes constant time, preventing timing attacks", "It hashes the strings", "It ignores case"], 1, "Ordinary == can stop at the first different character and leak information through timing.")
  ],
  tasks: [task("Safe download paths", "Read a base directory on the first line, then the number n, then n requested paths. A path is allowed when, after joining it to the base and normalising (use posixpath.join and posixpath.normpath), the result is the base itself or lies inside it. An absolute request path replaces the base when joined, so it is usually blocked. Print ALLOW followed by the normalised path, or DENY followed by the requested path.", "import posixpath\nbase = input()\nn = int(input())\n# check each requested path\n", `import posixpath

base = posixpath.normpath(input())
n = int(input())
for _ in range(n):
    requested = input()
    final = posixpath.normpath(posixpath.join(base, requested))
    if final == base or final.startswith(base + "/"):
        print("ALLOW", final)
    else:
        print("DENY", requested)`, [["/srv/files\n3\ndocs/a.txt\n../etc/passwd\n/etc/passwd", "ALLOW /srv/files/docs/a.txt\nDENY ../etc/passwd\nDENY /etc/passwd"], ["/srv/files\n2\ndocs/../docs/b.txt\n/srv/files/x.txt", "ALLOW /srv/files/docs/b.txt\nALLOW /srv/files/x.txt"], ["/data\n3\n.\n..\n../data2/f", "ALLOW /data\nDENY ..\nDENY ../data2/f"], ["/srv\n1\na/../../etc", "DENY a/../../etc"]])],
});

module.exports = { lessons };
