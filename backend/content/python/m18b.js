// Phase 4 / Module 18, lessons 4-6: pytest, test-driven development with mocks, and code quality tools.
// Examples need pytest, ruff and black (installed in the course's virtual environment). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Testing with pytest: Assertions, Fixtures and Parametrization",
  minutes: 60,
  learn: ["Write and run tests with pytest and read its failure reports", "Use fixtures, parametrize, pytest.raises and pytest.approx", "Use tmp_path, monkeypatch and capsys to test files, environment and output", "Organise tests and choose what to test"],
  why: "Automated tests let you change code without fear. Employers expect new developers to write tests, and a failing test in CI is how teams stop bugs from reaching users.",
  realWorld: "Every pull request in a healthy project runs hundreds of tests in a few minutes. A change that breaks the grade calculator fails the build before anyone reviews it.",
  simple: "A test is a small function that calls your code and uses <code>assert</code> to say what the result must be. pytest finds files called <code>test_*.py</code>, runs every <code>test_*</code> function and prints a clear report.",
  detail: `<p><strong>Install:</strong> <code>python -m pip install pytest</code>. Run all tests with <code>pytest</code> (or <code>python -m pytest</code>).</p>
<h3>Anatomy of a test</h3>
<ul><li><strong>Arrange</strong> the data, <strong>Act</strong> by calling the code, <strong>Assert</strong> the result.</li><li>Plain <code>assert</code> is enough: on failure pytest shows both sides of the comparison.</li><li>One behaviour per test; a descriptive name such as <code>test_grade_below_40_fails</code>.</li></ul>
${table(["Feature", "Example", "Use it for"], [["parametrize", "<code>@pytest.mark.parametrize(\"marks, expected\", [(40, \"pass\"), (39, \"fail\")])</code>", "one test, many inputs (boundaries!)"], ["raises", "<code>with pytest.raises(ValueError, match=\"between\"):</code>", "expected exceptions"], ["approx", "<code>assert 0.1 + 0.2 == pytest.approx(0.3)</code>", "floating-point comparisons"], ["fixture", "<code>@pytest.fixture</code> def scores(): ...", "shared set-up and clean-up"], ["tmp_path", "<code>def test_x(tmp_path):</code>", "a fresh temporary folder per test"], ["monkeypatch", "<code>monkeypatch.setenv(\"MODE\", \"test\")</code>", "temporarily change env, attributes, dictionaries"], ["capsys", "<code>capsys.readouterr().out</code>", "capture what was printed"], ["skip / xfail", "<code>@pytest.mark.skip(reason=...)</code>, <code>@pytest.mark.xfail</code>", "known gaps and known bugs"]])}
<h3>Useful options</h3>
<p><code>-v</code> verbose names, <code>-q</code> quiet, <code>-x</code> stop at the first failure, <code>-k grade</code> run tests whose name contains &quot;grade&quot;, <code>--lf</code> re-run last failures, <code>-s</code> show prints, <code>--maxfail=3</code>, <code>-m slow</code> run a marker. <code>conftest.py</code> holds fixtures shared by a folder. Measure coverage with the <code>pytest-cov</code> plugin (<code>pytest --cov=mypackage</code>), but remember coverage shows what was <em>run</em>, not what was <em>checked</em>.</p>
<h3>What to test</h3>
<ul><li>Normal cases, <strong>boundaries</strong> (0, 1, limits, empty), and error cases.</li><li>Pure logic heavily; thin glue code lightly.</li><li>Test the public behaviour, not private details, so refactoring does not break tests.</li><li>Keep tests fast, independent (any order) and deterministic (no real time, network or randomness without control).</li></ul>
<h3>unittest versus pytest</h3>
<p><code>unittest</code> is in the standard library and uses classes with <code>self.assertEqual</code>. pytest runs unittest tests too, and most new projects choose pytest for its shorter syntax and fixtures.</p>`,
  syntax: { code: `# test_grades.py\nimport pytest\n\ndef test_pass():\n    assert grade(75) == "pass"\n\n@pytest.mark.parametrize("m, e", [(40, "pass"), (39, "fail")])\ndef test_edges(m, e):\n    assert grade(m) == e`, note: "File test_*.py, functions test_*, plain assert." },
  diagram: chain("Arrange, Act, Assert", "Left to right: arrange the data and fixtures, act by calling the code, assert the result; the test passes or fails.",
    [{ k: "proc", t: "Arrange\nfixtures, data" }, { k: "proc", t: "Act\ncall the code" }, { k: "dec", t: "Assert\nas expected?" }, { k: "term", t: "pass or\nfail report" }], { w: 150, gap: 34, hgt: 62 }),
  example: { code: `import pathlib, re, shutil, subprocess, sys, tempfile

TESTS = '''import pytest


def grade(marks):
    if not 0 <= marks <= 100:
        raise ValueError("marks must be between 0 and 100")
    return "pass" if marks >= 40 else "fail"


def test_pass():
    assert grade(75) == "pass"


@pytest.mark.parametrize("marks, expected", [(40, "pass"), (39, "fail"), (0, "fail"), (100, "pass")])
def test_boundaries(marks, expected):
    assert grade(marks) == expected


def test_invalid_marks():
    with pytest.raises(ValueError, match="between 0 and 100"):
        grade(101)


@pytest.fixture
def scores():
    return [10, 50, 90]


def test_fixture(scores):
    assert [grade(s) for s in scores] == ["fail", "pass", "pass"]


def test_float():
    assert 0.1 + 0.2 == pytest.approx(0.3)
'''

FAILING = '''def test_total():
    cart = [120, 80, 50]
    assert sum(cart) == 260
'''

folder = pathlib.Path(tempfile.mkdtemp())


def run_pytest(name, source, *flags):
    (folder / name).write_text(source)
    return subprocess.run([sys.executable, "-m", "pytest", "-p", "no:cacheprovider", *flags, name],
                          cwd=folder, capture_output=True, text=True)


def summary(done):
    return re.search(r"\\d+ (passed|failed)", done.stdout.strip().splitlines()[-1]).group(0)


done = run_pytest("test_grades.py", TESTS, "-v")
for match in re.finditer(r"^\\S+::(\\S+) (PASSED|FAILED)", done.stdout, re.M):
    print(match.group(2), match.group(1))
print(summary(done), "| exit code", done.returncode)

done = run_pytest("test_cart.py", FAILING, "-q")
errors = [line for line in done.stdout.splitlines() if line.startswith("E")]
print(errors[0].split(None, 1)[1])
print(summary(done), "| exit code", done.returncode)
shutil.rmtree(folder, ignore_errors=True)`, out: `PASSED test_pass
PASSED test_boundaries[40-pass]
PASSED test_boundaries[39-fail]
PASSED test_boundaries[0-fail]
PASSED test_boundaries[100-pass]
PASSED test_invalid_marks
PASSED test_fixture
PASSED test_float
8 passed | exit code 0
assert 250 == 260
1 failed | exit code 1` },
  lineByLine: [["TESTS = '''...'''", "The test file is kept as text here so the example is one program. In a real project it is simply test_grades.py."], ["@pytest.mark.parametrize", "One function runs four times; each input pair becomes its own test with an id such as test_boundaries[40-pass]."], ["pytest.raises(ValueError, match=...)", "Passes only if the code raises that exception and the message matches."], ["@pytest.fixture / test_fixture(scores)", "pytest sees the argument name scores and passes in the fixture's return value."], ["pytest.approx(0.3)", "0.1 + 0.2 is 0.30000000000000004, so exact equality would fail; approx allows a tiny tolerance."], ["subprocess.run([... \"-m\", \"pytest\" ...])", "Runs pytest exactly as you would on the command line and captures its report."], ["errors[0]", "pytest prints the failing assert on a line starting with E, showing 250 on the left and 260 on the right."], ["exit code", "0 when all tests pass and 1 when any fails; CI uses this to pass or fail the build."]],
  dryRun: { intro: "What pytest does with test_boundaries:", headers: ["Step", "Action"], rows: [["1", "collect: find test_boundaries and read the four parameter pairs"], ["2", "build four test items with ids 40-pass, 39-fail, 0-fail, 100-pass"], ["3", "call grade(marks) for each and run the assert"], ["4", "report 4 passed (or show which pair failed)"]] },
  realExample: { intro: "Built-in fixtures for files, environment and printed output, plus skip and xfail markers.", code: `import pathlib, re, shutil, subprocess, sys, tempfile

TESTS = r'''import os
import pytest


def save_report(folder, text):
    path = folder / "report.txt"
    path.write_text(text)
    return path


def test_tmp_path(tmp_path):
    path = save_report(tmp_path, "ok")
    assert path.read_text() == "ok"


def test_monkeypatch(monkeypatch):
    monkeypatch.setenv("APP_MODE", "test")
    assert os.environ["APP_MODE"] == "test"


def test_capsys(capsys):
    print("hello")
    assert capsys.readouterr().out == "hello\\n"


@pytest.mark.skip(reason="needs the network")
def test_online():
    assert False


@pytest.mark.xfail(reason="known bug")
def test_known_bug():
    assert 1 + 1 == 3
'''

folder = pathlib.Path(tempfile.mkdtemp())
(folder / "test_tools.py").write_text(TESTS)
done = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_tools.py"],
                      cwd=folder, capture_output=True, text=True)
print(re.sub(r" in [\\d.]+s", "", done.stdout.strip().splitlines()[-1]))
shutil.rmtree(folder, ignore_errors=True)`, out: `3 passed, 1 skipped, 1 xfailed` },
  mistakes: ["Tests that depend on each other or on the order they run.", "Testing only the happy path and never the boundaries.", "Comparing floats with <code>==</code>.", "Real network, clock or randomness inside unit tests, making them flaky.", "Chasing 100% coverage with tests that assert nothing."],
  practices: ["Name tests after the behaviour they check.", "Parametrize boundaries and typical values.", "Keep fixtures small and in <code>conftest.py</code> when shared.", "Run the whole suite in CI on every pull request."],
  interview: ["What is a fixture?", "How do you test that a function raises an exception?", "What is the difference between unit and integration tests?", "How do you test code that uses the current time?"],
  practiceQs: ["What file names does pytest collect by default?", "How do you run one test by name?", "Why use pytest.approx?", "What does exit code 1 from pytest mean?"],
  revision: ["Files test_*.py, functions test_*, plain assert.", "parametrize, raises, approx, fixtures.", "tmp_path, monkeypatch, capsys.", "Exit code 0 means all passed."],
  hinglish: "pytest mein test_ se shuru hone wale functions mein assert likhte hain. parametrize se ek test kai inputs par chalta hai, fixture se common set-up milta hai aur raises se error check hota hai. Float compare karne ke liye approx use karo.",
  quiz: [
    mcq("Which file name will pytest collect automatically?", ["grades_test_file.txt", "test_grades.py", "grades.py", "check.py"], 1, "pytest collects files named test_*.py or *_test.py."),
    mcq("Which tool lets one test function run with many input pairs?", ["@pytest.fixture", "@pytest.mark.parametrize", "monkeypatch", "capsys"], 1, "parametrize creates one test per parameter set."),
    mcq("Why does 0.1 + 0.2 == 0.3 fail in a test?", ["pytest has a bug", "Floating-point numbers are stored approximately", "Python cannot add decimals", "assert is broken"], 1, "0.1 + 0.2 is 0.30000000000000004; use pytest.approx."),
    mcq("What does the pytest exit code 0 tell CI?", ["Nothing ran", "All collected tests passed", "A test was skipped", "pytest crashed"], 1, "CI treats exit code 0 as success."),
    mcq("Which built-in fixture gives each test its own empty temporary folder?", ["tmp_path", "capsys", "request", "pytestconfig"], 0, "tmp_path is unique per test and cleaned up automatically.")
  ],
  tasks: [task("Mini test runner", "Read lines of the form NAME ACTUAL EXPECTED (numbers). A check passes when abs(actual - expected) <= max(1e-6 * abs(expected), 1e-12), the idea behind pytest.approx. Print PASSED NAME or FAILED NAME for each line, then a summary line such as 2 passed, 1 failed.", "import sys\npassed = failed = 0\nfor line in sys.stdin.read().splitlines():\n    name, actual, expected = line.split()\n    # compare with a tolerance and print PASSED or FAILED\n", `import sys
passed = failed = 0
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    name, actual, expected = line.split()
    actual, expected = float(actual), float(expected)
    if abs(actual - expected) <= max(1e-6 * abs(expected), 1e-12):
        passed += 1
        print("PASSED", name)
    else:
        failed += 1
        print("FAILED", name)
print(f"{passed} passed, {failed} failed")`, [["add 5 5\nfloat_sum 0.30000000000000004 0.3\nwrong 2 3", "PASSED add\nPASSED float_sum\nFAILED wrong\n2 passed, 1 failed"], ["close 1.0000001 1.0\nzero 0.0000001 0", "PASSED close\nFAILED zero\n1 passed, 1 failed"], ["a 1 1", "PASSED a\n1 passed, 0 failed"], ["big 1000000 1000001\nneg -2.5 -2.5\nsmall 1e-13 0", "PASSED big\nPASSED neg\nPASSED small\n3 passed, 0 failed"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Test-Driven Development, Mocks and Test Design",
  minutes: 55,
  learn: ["Follow the red, green, refactor cycle", "Explain stubs, fakes, mocks and spies and when each is useful", "Use unittest.mock: Mock, return_value, side_effect, assert_called_with and patch", "Design tests that are fast, isolated and meaningful"],
  why: "TDD turns requirements into executable examples before you write code, which leads to simpler designs and fewer bugs. Mocks let you test code that talks to slow or unreliable things such as payment gateways, email or the clock.",
  realWorld: "A checkout function calls a payment gateway. In tests you cannot charge real cards, so you replace the gateway with a mock that returns success, failure or a timeout, and check that the checkout code reacts correctly each time.",
  simple: "<strong>TDD</strong>: write a failing test (red), write the simplest code that passes (green), then clean up while the tests stay green (refactor). A <strong>mock</strong> is a stand-in object that pretends to be a real dependency and records how it was used.",
  detail: `<h3>The cycle</h3>
<ol><li><strong>Red</strong>: write one small test for the next behaviour; watch it fail for the right reason.</li><li><strong>Green</strong>: write the simplest code that makes it pass (even a hard-coded value).</li><li><strong>Refactor</strong>: improve names and structure; run the tests after every small step.</li></ol>
<p>TDD is a tool, not a religion: it shines for logic with clear rules (parsers, calculators, validators) and is less useful for exploratory or purely visual work.</p>
<h3>Test doubles</h3>
${table(["Double", "What it does", "Example"], [["dummy", "fills an argument that is never used", "<code>None</code> or <code>object()</code>"], ["stub", "returns fixed answers", "a gateway that always says &quot;ok&quot;"], ["fake", "a simple working version", "an in-memory dictionary instead of a database"], ["mock", "records calls so you can assert on them", "<code>Mock().charge.assert_called_once_with(...)</code>"], ["spy", "wraps the real thing and records calls", "<code>Mock(wraps=real_object)</code>"]])}
<h3>unittest.mock cheat sheet</h3>
<ul><li><code>m = Mock()</code>; any attribute or call works: <code>m.charge(amount=5)</code>.</li><li><code>m.charge.return_value = {...}</code> chooses the result; <code>side_effect = TimeoutError(&quot;slow&quot;)</code> makes it raise (or give a list of results in turn).</li><li><code>assert_called_once_with(...)</code>, <code>call_count</code>, <code>call_args</code>, <code>call_args_list</code>.</li><li><code>patch(&quot;module.name&quot;)</code> swaps a name for the duration of a <code>with</code> block or decorated test. <strong>Patch where the name is looked up</strong>, not where it was defined: if <code>shop.py</code> does <code>from time import sleep</code>, patch <code>shop.sleep</code>.</li><li><code>MagicMock</code> also supports magic methods; <code>create_autospec(cls)</code> keeps the real signature so wrong calls fail.</li></ul>
<h3>Designing for testability</h3>
<p>Pass dependencies in (gateway, clock, random generator) instead of creating them inside the function. Separate pure logic from input and output. Over-mocking makes tests that only repeat the implementation, so prefer fakes and real objects when they are fast, and mock only the edges of your system (network, time, email).</p>
<h3>The test pyramid</h3>
<p>Many fast <strong>unit</strong> tests, fewer <strong>integration</strong> tests (real database or API), very few slow <strong>end-to-end</strong> tests. Flaky tests (sometimes pass, sometimes fail) destroy trust: fix or delete them.</p>`,
  syntax: { code: `from unittest.mock import Mock, patch\n\ngateway = Mock()\ngateway.charge.return_value = {"status": "ok"}\ngateway.charge.assert_called_once_with(amount=499)\nwith patch("shop.time.sleep"):\n    ...`, note: "Patch the name where it is used." },
  diagram: graph("The TDD cycle", "Three boxes in a triangle: red, write a failing test; green, make it pass; refactor, clean up. Arrows run red to green to refactor and back to red for the next behaviour.", 700, 250,
    [{ id: "r", k: "proc", t: "RED\nwrite a failing test", x: 140, y: 60, w: 220, h: 56 }, { id: "g", k: "proc", t: "GREEN\nsimplest code that passes", x: 560, y: 60, w: 230, h: 56 }, { id: "f", k: "proc", t: "REFACTOR\nclean up, tests stay green", x: 350, y: 190, w: 250, h: 56 }],
    [{ from: "r", to: "g", label: "implement" }, { from: "g", to: "f", label: "improve" }, { from: "f", to: "r", label: "next behaviour" }]),
  example: { code: `import io
import re
import unittest


def make_tests(slugify):
    class SlugTests(unittest.TestCase):
        def test_lowercases(self):
            self.assertEqual(slugify("Hello World"), "hello-world")

        def test_strips_punctuation(self):
            self.assertEqual(slugify("Python, 3.15!"), "python-3-15")

        def test_trims_dashes(self):
            self.assertEqual(slugify("  --Hi--  "), "hi")

    return SlugTests


def run(slugify):
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(make_tests(slugify))
    result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
    return f"ran {result.testsRun}, failures {len(result.failures)}, errors {len(result.errors)}"


def red(text):
    raise NotImplementedError


def green(text):
    return text.lower().replace(" ", "-")


def refactored(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


print("red:     ", run(red))
print("green:   ", run(green))
print("refactor:", run(refactored))`, out: `red:      ran 3, failures 0, errors 3
green:    ran 3, failures 2, errors 0
refactor: ran 3, failures 0, errors 0` },
  lineByLine: [["make_tests(slugify)", "Builds the test class for whichever implementation we pass in, so one set of tests judges three versions of the code."], ["assertEqual", "unittest's version of assert; a mismatch is a failure."], ["red raises NotImplementedError", "The function does not exist yet in spirit: all three tests error out. That is the red step."], ["green: lower + replace", "The simplest code that handles the first example; the other two tests still fail (2 failures)."], ["refactored: re.sub then strip", "Collapses every run of non-alphanumeric characters to one dash and trims dashes at the ends. All tests pass."], ["failures versus errors", "A failure is a wrong answer (assert failed); an error is an exception in the code or test."]],
  dryRun: { intro: "How the second test treats the green version:", headers: ["Input", "green() result", "Expected", "Verdict"], rows: [["Hello World", "hello-world", "hello-world", "pass"], ["Python, 3.15!", "python,-3.15!", "python-3-15", "failure"], ["  --Hi--  ", "----hi---- (every space became a dash)", "hi", "failure"]] },
  realExample: { intro: "Testing a checkout function with a mocked payment gateway and a patched clock.", code: `import time
from unittest.mock import Mock, patch


def checkout(cart_total, gateway):
    response = gateway.charge(amount=cart_total, currency="INR")
    return "paid" if response["status"] == "ok" else "declined"


gateway = Mock()
gateway.charge.return_value = {"status": "ok"}
print(checkout(499, gateway))
gateway.charge.assert_called_once_with(amount=499, currency="INR")

gateway.charge.return_value = {"status": "failed"}
print(checkout(10, gateway))
print(gateway.charge.call_count, gateway.charge.call_args)

gateway.charge.side_effect = TimeoutError("gateway slow")
try:
    checkout(1, gateway)
except TimeoutError as error:
    print("raised:", error)

with patch("time.time", return_value=1000.0):
    print(time.time())`, out: `paid
declined
2 call(amount=10, currency='INR')
raised: gateway slow
1000.0` },
  mistakes: ["Writing all the code first and the tests afterwards, then only testing what the code already does.", "Patching where a name is defined instead of where it is used.", "Mocking everything so the test only repeats the implementation.", "Tests that need the real network, clock or random numbers.", "Large tests that check many behaviours and fail for unclear reasons."],
  practices: ["Take small steps: one failing test at a time.", "Inject dependencies so they can be replaced.", "Mock the edges of the system only.", "Delete or fix flaky tests immediately."],
  interview: ["Describe red, green, refactor.", "Mock versus stub versus fake?", "Where do you patch an imported function?", "How would you test code that depends on the current time?"],
  practiceQs: ["What does side_effect do on a Mock?", "Why must a TDD test fail first?", "What is a flaky test?", "Which kind of tests should be the most numerous?"],
  revision: ["Red, green, refactor in small steps.", "Stub returns, fake works simply, mock records calls.", "patch(name where it is used).", "Many unit tests, few end-to-end tests."],
  hinglish: "TDD mein pehle fail hone wala test likhte hain (red), phir sabse aasaan code jo use pass kare (green), phir code saaf karte hain (refactor). Mock asli gateway ya clock ki jagah ek nakli object hota hai jo yaad rakhta hai ki use kaise bulaya gaya.",
  quiz: [
    mcq("In TDD, what should you do right after a new test fails for the right reason?", ["Delete the test", "Write the simplest code that makes it pass", "Refactor the whole project", "Push to main"], 1, "That is the green step."),
    mcq("Which test double records how it was called so you can assert on it?", ["dummy", "mock", "constant", "fixture"], 1, "A mock records calls; a stub only returns answers."),
    mcq("shop.py has from time import sleep. Where do you patch sleep?", ["time.sleep only", "shop.sleep", "builtins.sleep", "nowhere"], 1, "The name must be replaced where the code under test looks it up."),
    mcq("What does Mock.side_effect = TimeoutError(\"x\") do?", ["Makes the mock raise TimeoutError when called", "Returns TimeoutError as a value", "Deletes the mock", "Counts calls"], 0, "An exception instance as side_effect is raised on each call."),
    mcq("Which statement about the test pyramid is correct?", ["Most tests should be slow end-to-end tests", "Most tests should be fast unit tests", "Unit tests are not needed", "Integration tests replace all others"], 1, "Fast unit tests give quick feedback and form the wide base.")
  ],
  tasks: [task("Mock call checker", "Standard input has lines: CALL NAME ARGS... records a call to a function, and EXPECT NAME ARGS... checks the most recent call to that function. For each EXPECT print OK NAME when the arguments match, FAIL NAME: not called when there was no call, or FAIL NAME: expected (A) but got (B) with arguments joined by a comma and a space inside the brackets.", "import sys\nlast = {}\nfor line in sys.stdin.read().splitlines():\n    command, name, *args = line.split()\n    # record calls and check expectations\n", `import sys
last = {}


def show(args):
    return "(" + ", ".join(args) + ")"


for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    command, name, *args = line.split()
    if command == "CALL":
        last[name] = args
    elif name not in last:
        print(f"FAIL {name}: not called")
    elif last[name] == args:
        print(f"OK {name}")
    else:
        print(f"FAIL {name}: expected {show(args)} but got {show(last[name])}")`, [["CALL charge 499 INR\nEXPECT charge 499 INR\nEXPECT refund\nCALL charge 10 INR\nEXPECT charge 499 INR", "OK charge\nFAIL refund: not called\nFAIL charge: expected (499, INR) but got (10, INR)"], ["CALL ping\nEXPECT ping", "OK ping"], ["EXPECT x 1", "FAIL x: not called"], ["CALL a 1 2\nCALL b\nEXPECT a 1\nEXPECT b\nEXPECT a 1 2", "FAIL a: expected (1) but got (1, 2)\nOK b\nOK a"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Code Quality: PEP 8, Type Hints, Docstrings, Ruff and Black",
  minutes: 60,
  learn: ["Apply PEP 8 naming, layout and import rules", "Add type hints and docstrings that help readers and tools", "Format with Black and lint with Ruff, configured in pyproject.toml", "Automate checks with pre-commit and CI"],
  why: "Code is read far more often than it is written. A consistent style removes pointless arguments in code review, linters catch bugs before tests run, and clean code is the first thing a reviewer or interviewer notices.",
  realWorld: "On every pull request the team's CI runs <code>ruff check</code>, <code>ruff format --check</code> (or <code>black --check</code>) and the tests. Style problems are fixed by the tools, not debated by people.",
  simple: "<strong>PEP 8</strong> is Python's style guide. A <strong>formatter</strong> (Black) rewrites layout for you; a <strong>linter</strong> (Ruff) reports likely bugs and bad habits; <strong>type hints</strong> and <strong>docstrings</strong> document what the code expects and returns.",
  detail: `<h3>PEP 8 essentials</h3>
${table(["Topic", "Rule"], [["indentation", "4 spaces, never tabs mixed with spaces"], ["line length", "79 characters in PEP 8; Black defaults to 88 and Ruff to 88 (configurable)"], ["functions, variables, modules", "<code>snake_case</code>"], ["classes", "<code>PascalCase</code>"], ["constants", "<code>UPPER_CASE</code>"], ["imports", "one per line, at the top, grouped: standard library, third party, your own; avoid <code>import *</code>"], ["whitespace", "<code>a = b + c</code>, <code>f(x, y)</code>; no spaces inside brackets; two blank lines between top-level functions"], ["comparisons", "<code>x is None</code>, <code>if items:</code> instead of <code>== None</code> or <code>len(items) &gt; 0</code>"], ["comments", "explain <em>why</em>, not what; keep them up to date"]])}
<h3>Type hints</h3>
<p><code>def mean(values: list[float]) -> float:</code>. Hints are not enforced at run time; checkers such as <code>mypy</code> and <code>pyright</code> (and editors) use them to find mistakes early. Use <code>X | None</code> for optional values, <code>dict[str, int]</code> for containers, and add hints first to public functions.</p>
<h3>Docstrings</h3>
<p>The first statement of a module, class or function. One summary line, then details: arguments, return value, exceptions, an example. Pick one style (Google or NumPy) and keep it. <code>doctest</code> can run the <code>&gt;&gt;&gt;</code> examples inside a docstring. A <code>README.md</code> (what it is, how to install and run, how to test) is the most important document of any project.</p>
<h3>The tools</h3>
${table(["Tool", "Job", "Command"], [["Black", "opinionated formatter (the code layout is decided for you)", "<code>black .</code> / <code>black --check .</code>"], ["Ruff", "very fast linter (replaces flake8, isort and many plugins) and a Black-compatible formatter", "<code>ruff check --fix .</code> / <code>ruff format .</code>"], ["mypy / pyright", "static type checking", "<code>mypy src</code>"], ["pre-commit", "runs checks automatically before each commit", "<code>pre-commit install</code>"], ["EditorConfig, IDE", "same indentation and line endings for everyone", "-"]])}
<p>Configure Ruff and Black in <code>pyproject.toml</code> (<code>[tool.ruff]</code>, <code>[tool.ruff.lint]</code>, <code>[tool.black]</code>) so that everyone and CI use the same rules. Choose the rule families deliberately (for example errors <code>E</code>, pyflakes <code>F</code>, imports <code>I</code>, bugbear <code>B</code>, upgrades <code>UP</code>) and fix, do not silence, warnings; if you must ignore a rule, add a short reason.</p>
<h3>Code smells to remove</h3>
<ul><li>Functions longer than a screen or with many parameters.</li><li>Deep nesting (use early returns).</li><li>Duplicated code (extract a function).</li><li>Magic numbers (name them as constants).</li><li>Mutable default arguments (<code>def f(x=[])</code>).</li><li>Bare <code>except:</code> and swallowed errors.</li></ul>`,
  syntax: { code: `ruff check --fix .\nruff format .\nblack --check .\n# pyproject.toml\n[tool.ruff]\nline-length = 88`, note: "Format, lint, then test, locally and in CI." },
  diagram: chain("A quality pipeline", "Left to right: write code, format it, lint it, check types, run tests, then commit.",
    [{ k: "proc", t: "write\ncode" }, { k: "proc", t: "format\n(Black)" }, { k: "proc", t: "lint\n(Ruff)" }, { k: "proc", t: "types\n(mypy)" }, { k: "proc", t: "test\n(pytest)" }, { k: "term", t: "commit" }], { w: 110, gap: 30, hgt: 62 }),
  example: { code: `import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

import black

folder = pathlib.Path(tempfile.mkdtemp())
(folder / "bad.py").write_text("import os\\nimport sys\\n\\n\\ndef f(x):\\n    unused = 1\\n    return x == None\\n")


def ruff(*args):
    return subprocess.run([sys.executable, "-m", "ruff", "check", "--isolated", "--no-cache", *args, "bad.py"],
                          cwd=folder, capture_output=True, text=True)


found = ruff("--select", "E,F", "--output-format", "json")
print("ruff exit code:", found.returncode)
for item in sorted(json.loads(found.stdout), key=lambda i: (i["location"]["row"], i["code"])):
    print(item["location"]["row"], item["code"])

ruff("--select", "F401", "--fix")
print("after --fix:", (folder / "bad.py").read_text().strip().splitlines()[0])

ugly = "def add( a,b ):\\n  return a+b\\nx = {  'name':'Asha',\\n 'marks':[1,2,3] }\\n"
print(black.format_str(ugly, mode=black.Mode()), end="")
shutil.rmtree(folder, ignore_errors=True)`, out: `ruff exit code: 1
1 F401
2 F401
6 F841
7 E711
after --fix: def f(x):
def add(a, b):
    return a + b


x = {"name": "Asha", "marks": [1, 2, 3]}` },
  lineByLine: [["bad.py", "A small file with an unused import, another unused import, an unused variable and a comparison to None using ==."], ["ruff check --select E,F --output-format json", "Runs only the pycodestyle-error (E) and pyflakes (F) rules and prints the findings as JSON that a script can read."], ["--isolated --no-cache", "Ignore any project configuration and do not write a cache, so the result depends only on this file."], ["F401 / F841 / E711", "Unused import, unused local variable, comparison to None with ==. The number is the line."], ["exit code 1", "Ruff exits with 1 when it finds problems; CI uses that to fail the build."], ["--select F401 --fix", "Applies the safe automatic fix for unused imports: both import lines disappear."], ["black.format_str", "Black as a library: spaces after commas, double quotes, 4-space indent, two blank lines before a top-level statement after a function."]],
  dryRun: { intro: "What Black changed in the dictionary:", headers: ["Before", "After"], rows: [["<code>{  'name':'Asha',</code>", "<code>{\"name\": \"Asha\",</code>"], ["<code> 'marks':[1,2,3] }</code>", "<code>\"marks\": [1, 2, 3]}</code>"], ["two lines", "one line, because it fits within 88 characters"]] },
  realExample: { intro: "Type hints and a docstring with examples; doctest runs the examples as tests.", code: `import doctest


def mean(values: list[float]) -> float:
    """Return the average of a non-empty list.

    >>> mean([2, 4, 6])
    4.0
    >>> mean([5])
    5.0
    """
    return sum(values) / len(values)


print(doctest.testmod())
print(mean.__doc__.splitlines()[0])
print(mean.__annotations__)`, out: `TestResults(failed=0, attempted=2)
Return the average of a non-empty list.
{'values': list[float], 'return': <class 'float'>}` },
  mistakes: ["Arguing about style by hand instead of letting a formatter decide.", "Silencing linter warnings without understanding them.", "Type hints that are wrong or out of date.", "Comments that repeat the code, or docstrings that lie.", "Letting generated or vendored code fail the linter instead of excluding it."],
  practices: ["Format on save and check in CI.", "Fix lint errors at the source; keep ignores rare and explained.", "Add type hints and docstrings to public functions first.", "Keep configuration in <code>pyproject.toml</code>."],
  interview: ["What is PEP 8?", "Linter versus formatter?", "Do type hints change how Python runs your code?", "Why use pre-commit hooks?"],
  practiceQs: ["Which naming style is used for classes?", "What does x is None check?", "What does ruff check --fix do?", "Where do you configure Black and Ruff?"],
  revision: ["snake_case functions, PascalCase classes, UPPER_CASE constants.", "Black formats, Ruff lints and formats.", "Type hints are checked by mypy or pyright, not by Python.", "Automate in pre-commit and CI."],
  hinglish: "PEP 8 Python ki style guide hai: functions snake_case mein, classes PascalCase mein. Black code ka layout khud theek karta hai, Ruff galtiyan aur bure tareeke pakadta hai. Type hints aur docstrings code ko samajhne mein madad karte hain, aur sab kuch CI mein automatic chalao.",
  quiz: [
    mcq("Which name follows PEP 8 for a class?", ["student_record", "StudentRecord", "STUDENT_RECORD", "studentRecord"], 1, "Classes use PascalCase."),
    mcq("What is the main difference between Black and Ruff's linter?", ["Black formats code; Ruff's linter reports problems", "They are identical", "Black runs tests", "Ruff compiles Python"], 0, "A formatter rewrites layout; a linter reports likely bugs and bad habits."),
    mcq("Do type hints stop a program from running when the types are wrong?", ["Yes, Python enforces them", "No, tools such as mypy check them separately", "Only in functions", "Only in classes"], 1, "Python ignores hints at run time."),
    mcq("What is the best way to compare with None?", ["x == None", "x is None", "not x == None", "None in x"], 1, "None is a singleton, so use identity."),
    mcq("Why is def add_item(item, items=[]) a code smell?", ["The list is created once and shared between calls", "Lists cannot be defaults", "It is slower", "It is a syntax error"], 0, "A mutable default is evaluated once at definition time.")
  ],
  tasks: [task("Mini linter", "Read source lines from standard input. Report, in this order for each line: N:W191 indentation contains tabs (a tab in the leading whitespace), N:E231 missing whitespace after ',' (a comma directly followed by a character that is not a space), and N:E501 line too long (L > 79) when the line is longer than 79 characters. N is the line number starting at 1. Finish with found K issue(s), or no issues when nothing was reported.", "import re, sys\nlines = sys.stdin.read().split(\"\\n\")\n# check every line\n", `import re
import sys

lines = sys.stdin.read().split("\\n")
count = 0
for number, line in enumerate(lines, 1):
    indent = line[: len(line) - len(line.lstrip())]
    if "\\t" in indent:
        print(f"{number}:W191 indentation contains tabs")
        count += 1
    if re.search(r",\\S", line):
        print(f"{number}:E231 missing whitespace after ','")
        count += 1
    if len(line) > 79:
        print(f"{number}:E501 line too long ({len(line)} > 79)")
        count += 1
print(f"found {count} issue(s)" if count else "no issues")`, [["x = [1,2, 3]\n\tprint(x)\ny = '" + "a".repeat(80) + "'", "1:E231 missing whitespace after ','\n2:W191 indentation contains tabs\n3:E501 line too long (86 > 79)\nfound 3 issue(s)"], ["def f(a, b):\n    return a + b", "no issues"], ["a".repeat(79) + "\n" + "a".repeat(80), "2:E501 line too long (80 > 79)\nfound 1 issue(s)"], ["\tprint(1,2)\nitems = [1, 2,\n 3]", "1:W191 indentation contains tabs\n1:E231 missing whitespace after ','\nfound 2 issue(s)"]])],
});

module.exports = { lessons };
