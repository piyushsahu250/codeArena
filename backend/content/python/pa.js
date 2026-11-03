// Phase 6, mini projects 1-5: Calculator, Number Guessing Game, Password Generator, Student Grade Management, ATM Simulation.
// Each project is a complete, tested program. The validator writes the files to a folder, runs the sample and runs the unit tests.
"use strict";
const { chain, flow } = require("./render");
const { task, rubric } = require("./lib");

const judged = (title, statement, starter, solution, cases, hints) => ({ ...task(title, statement, starter, solution, cases), hints });
const manual = (title, instructions, hints) => ({ title, instructions, hints });
const lessons = [];

// ---------------------------------------------------------------- 1 Calculator
{
  const calculator = `"""A calculator that evaluates arithmetic expressions without using eval()."""
import ast
import operator

BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
UNARY = {ast.USub: operator.neg, ast.UAdd: operator.pos}
MAX_EXPONENT = 1000


def _evaluate(node):
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in BINARY:
        left, right = _evaluate(node.left), _evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > MAX_EXPONENT:
            raise ValueError("exponent too large")
        return BINARY[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in UNARY:
        return UNARY[type(node.op)](_evaluate(node.operand))
    raise ValueError("invalid expression")


def calculate(text):
    """Return the value of an arithmetic expression, or raise ValueError or ZeroDivisionError."""
    try:
        tree = ast.parse(text.strip(), mode="eval")
    except SyntaxError:
        raise ValueError("invalid expression") from None
    return _evaluate(tree.body)


def main():
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip().lower() == "quit":
            break
        if not line.strip():
            continue
        try:
            print(calculate(line))
        except ZeroDivisionError:
            print("Error: division by zero")
        except ValueError as error:
            print(f"Error: {error}")


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest

from calculator import calculate


class CalculatorTests(unittest.TestCase):
    def test_precedence(self):
        self.assertEqual(calculate("2 + 3 * 4"), 14)

    def test_brackets(self):
        self.assertEqual(calculate("(1 + 2) ** 3"), 27)

    def test_power_is_right_associative(self):
        self.assertEqual(calculate("2 ** 3 ** 2"), 512)

    def test_unary_minus_and_floor_division(self):
        self.assertEqual(calculate("-7 // 2"), -4)

    def test_true_division(self):
        self.assertEqual(calculate("10 / 4"), 2.5)

    def test_division_by_zero(self):
        with self.assertRaises(ZeroDivisionError):
            calculate("1 / 0")

    def test_rejects_names_and_calls(self):
        for text in ("abc", "__import__('os')", "'a' * 3"):
            with self.assertRaises(ValueError):
                calculate(text)

    def test_rejects_syntax_errors_and_huge_exponents(self):
        for text in ("2 +", "2 ** 5000"):
            with self.assertRaises(ValueError):
                calculate(text)


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "2 + 3 * 4\n(1 + 2) ** 3\n10 / 4\n-7 // 2\n1 / 0\n2 +\nhello\n2 ** 5000\nquit\n";
  lessons.push({
    title: "Mini Project 1: Calculator",
    minutes: 60,
    project: {
      id: "calculator", kind: "MINI", difficulty: "EASY", minutes: 60, packages: [],
      problem: "Build a command-line calculator that reads arithmetic expressions such as 2 + 3 * 4 or (1 + 2) ** 3 and prints the result. It must never crash on bad input and must not use eval().",
      scenario: "A small business owner wants a quick calculator in the terminal that follows normal maths precedence, handles brackets and powers, and reports mistakes politely. Using eval() would let a typed expression run any Python code, so the calculator has to parse the text itself.",
      objectives: ["Parse and evaluate expressions with Python's ast module instead of eval()", "Separate calculation logic (a pure function) from input and output", "Handle errors with exceptions and clear messages", "Write unit tests that cover normal cases, edge cases and bad input"],
      prerequisites: ["Functions, loops and conditionals", "Exceptions and try/except", "Dictionaries", "Basic unittest usage"],
      requirements: ["Support + - * / // % ** with correct precedence and brackets", "Support unary minus and plus", "Read one expression per line until the word quit", "Print the result, or Error: followed by a short message", "Reject names, function calls and other unsafe syntax", "Refuse absurdly large exponents"],
      architecture: chain("Calculator architecture", "Input lines go to the main loop, which calls the calculate function; calculate parses the text into a syntax tree and evaluates it safely; results or errors are printed.",
        [{ k: "io", t: "input lines" }, { k: "proc", t: "main loop" }, { k: "proc", t: "calculate()\nast.parse" }, { k: "proc", t: "_evaluate()\nsafe tree walk" }, { k: "io", t: "result or\nError: ..." }], { w: 135, gap: 28, hgt: 62 }),
      flowchart: flow("Calculator flowchart", "Read a line, stop on quit, parse it, evaluate it, print the result or an error, and repeat.", ["start", "read a line", "quit?", "calculate(line)", "print result\nor error", "next line"], { loop: true }),
      schema: null,
      steps: [["Plan the pieces.", "A pure function calculate(text) that returns a number or raises an error, and a small main() loop that does the input and output."], ["Parse safely.", "ast.parse(text, mode=\"eval\") turns the text into a tree without running anything. A SyntaxError becomes ValueError(\"invalid expression\")."], ["Whitelist the nodes.", "Allow only numeric constants, binary operators from a dictionary and unary plus or minus. Any other node (a name, a call, a string) is rejected."], ["Map operators to functions.", "A dictionary from ast.Add to operator.add and so on removes long if/elif chains."], ["Guard against abuse.", "Refuse exponents larger than 1000 so that 2 ** 5000000 cannot freeze the program."], ["Write the loop.", "Read lines until quit or end of input, skip blank lines, print the value, and turn ZeroDivisionError and ValueError into Error: messages."], ["Test.", "Write unit tests for precedence, brackets, powers, unary minus, division by zero and rejected input before you trust the code."]],
      files: { "calculator.py": calculator, "test_calculator.py": tests },
      run: "calculator.py", test: "test_calculator.py", stdin, sample: { out: "14\n27\n2.5\n-4\nError: division by zero\nError: invalid expression\nError: invalid expression\nError: exponent too large\n" },
      explain: [["BINARY / UNARY", "Dictionaries that map syntax-tree operator classes to the real functions. They also act as the whitelist of what is allowed."], ["_evaluate", "A recursive walk over the tree. Each rule handles one kind of node and calls itself on the children."], ["calculate", "The public function: parse, evaluate, convert parser errors to ValueError. It is easy to unit test because it has no input or output."], ["MAX_EXPONENT", "A limit that stops denial-of-service by huge powers."], ["main", "The only place that reads and prints. It turns exceptions into friendly lines."]],
      testing: ["Run the sample: python calculator.py < input.txt (or type the lines yourself and finish with quit).", "Run the unit tests: python -m unittest test_calculator -v", "Try these by hand: 0.1 + 0.2, 2 ** -1, 7 % 0, (((1))), 3 3.", "Check that nothing you type can run a function: __import__('os') must give Error: invalid expression."],
      bugs: [["NameError or code runs when you type a word", "You are using eval(). Replace it with ast.parse and a whitelist."], ["2 ** 3 ** 2 gives 64", "You evaluated left to right with your own parser. Python's ast already gives the right associativity; use it."], ["-7 // 2 gives -3", "You truncated instead of using floor division; use operator.floordiv."], ["Program crashes on an empty line", "Skip blank lines before calculating."], ["Float results like 0.30000000000000004", "That is normal floating-point behaviour; round for display or use decimal for money."]],
      extensions: ["Add functions such as sqrt, sin and abs through a whitelist of math functions.", "Support variables (x = 5, then x * 2) and a history command.", "Add a graphical or web front end that reuses calculate().", "Support decimal arithmetic with the decimal module and a chosen precision."],
      interview: ["Why is eval() dangerous, and what did you use instead?", "How does an abstract syntax tree represent 2 + 3 * 4?", "Why keep calculate() separate from input and output?", "How does your program handle division by zero?", "How would you add the sqrt function safely?"],
      rubric: rubric("All operators, brackets and unary signs give the right answers; quit works; the sample output matches exactly", "No eval; node whitelist; exponent limit; pure calculate() function"),
      tasks: [
        judged("Calculator: evaluate expressions", "Build the calculator. Read one arithmetic expression per line until the line quit (or the end of input). Support + - * / // % ** with correct precedence, brackets and unary minus. Print the value, or Error: division by zero, Error: invalid expression or Error: exponent too large (exponents beyond 1000). Never use eval().", "# Write your calculator here\n", calculator, [[stdin, "14\n27\n2.5\n-4\nError: division by zero\nError: invalid expression\nError: invalid expression\nError: exponent too large"], ["1 + 1\nquit\n", "2"], ["2 ** 3 ** 2\n10 % 4\nquit\n", "512\n2"], ["--5\n(2 + 3) * -2\n7 / 2\nquit\n", "5\n-10\n3.5"]],
          ["Use ast.parse(text, mode=\"eval\") and walk tree.body.", "Allow only ast.BinOp, ast.UnaryOp and numeric ast.Constant nodes.", "Map ast.Add, ast.Sub and so on to operator.add, operator.sub and so on.", "Catch SyntaxError from ast.parse and ZeroDivisionError from the arithmetic."]),
        manual("Calculator: write the unit tests", "Create test_calculator.py with tests for precedence, brackets, right-associative powers, unary minus, floor division, division by zero, rejected input and the exponent limit. Run python -m unittest and make sure every test passes.", ["Test the pure function calculate(), not the input loop.", "Use self.assertRaises as a context manager for the error cases."]),
        manual("Calculator: publish it", "Create the GitHub repository, add .gitignore and README.md (use the template in the guide), commit in small steps and push. Submit the repository link to your instructor.", ["Commit after each working feature.", "Run the tests before every push."]),
      ],
    },
  });
}

// ---------------------------------------------------------------- 2 Number Guessing Game
{
  const game = `"""A number guessing game with a limited number of attempts."""
import random
import sys


def judge(secret, guess):
    """Return 'low', 'high' or 'correct' for a guess."""
    if guess < secret:
        return "low"
    if guess > secret:
        return "high"
    return "correct"


def play(secret, guesses, max_attempts=7, low=1, high=100, out=print):
    """Play one game with guesses from an iterable of text; return True if the player wins."""
    attempts = 0
    for raw in guesses:
        try:
            guess = int(raw)
        except ValueError:
            out("Please type a whole number.")
            continue
        if not low <= guess <= high:
            out(f"Choose a number between {low} and {high}.")
            continue
        attempts += 1
        result = judge(secret, guess)
        if result == "correct":
            out(f"Correct! You needed {attempts} attempt{'s' if attempts != 1 else ''}.")
            return True
        out(f"Too {result}. {max_attempts - attempts} attempt(s) left.")
        if attempts == max_attempts:
            break
    out(f"Game over. The number was {secret}.")
    return False


def main(argv):
    secret = int(argv[1]) if len(argv) > 1 else random.randint(1, 100)
    play(secret, (line.strip() for line in sys.stdin))


if __name__ == "__main__":
    main(sys.argv)
`;
  const tests = `import unittest

from guessing_game import judge, play


class GuessingGameTests(unittest.TestCase):
    def run_game(self, secret, guesses, **kwargs):
        lines = []
        won = play(secret, guesses, out=lines.append, **kwargs)
        return won, lines

    def test_judge(self):
        self.assertEqual(judge(42, 10), "low")
        self.assertEqual(judge(42, 99), "high")
        self.assertEqual(judge(42, 42), "correct")

    def test_win_on_first_try_uses_singular(self):
        won, lines = self.run_game(7, ["7"])
        self.assertTrue(won)
        self.assertEqual(lines, ["Correct! You needed 1 attempt."])

    def test_invalid_input_does_not_use_an_attempt(self):
        won, lines = self.run_game(5, ["x", "500", "5"], max_attempts=1)
        self.assertTrue(won)
        self.assertEqual(lines[:2], ["Please type a whole number.", "Choose a number between 1 and 100."])

    def test_game_over_after_max_attempts(self):
        won, lines = self.run_game(50, ["1", "2", "3"], max_attempts=3)
        self.assertFalse(won)
        self.assertEqual(lines[-1], "Game over. The number was 50.")

    def test_running_out_of_input_ends_the_game(self):
        won, lines = self.run_game(50, [])
        self.assertFalse(won)


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "50\nabc\n150\n25\n42\n";
  lessons.push({
    title: "Mini Project 2: Number Guessing Game",
    minutes: 60,
    project: {
      id: "number-guessing-game", kind: "MINI", difficulty: "EASY", minutes: 60, packages: [],
      problem: "Build a game in which the computer picks a secret number from 1 to 100 and the player has seven attempts to guess it, getting a hint after every wrong guess.",
      scenario: "A school computer club wants a simple game to teach loops and conditions. The game must cope with typing mistakes (letters, numbers out of range) without punishing the player or crashing.",
      objectives: ["Use loops, conditions and counters to control a game", "Validate user input and recover from mistakes", "Make a program testable by passing the input source and output function as parameters", "Use the random module and understand how to fix the secret for testing"],
      prerequisites: ["while/for loops and if statements", "int() and exceptions (ValueError)", "Functions with default arguments", "random.randint"],
      requirements: ["Pick a secret number between 1 and 100 (or take it from the command line for testing)", "Allow at most seven valid guesses", "Say Too low or Too high and how many attempts are left", "Ignore non-numbers and numbers outside 1-100 without using up an attempt", "Announce a win with the number of attempts, or reveal the number when the game is over"],
      architecture: chain("Guessing game architecture", "Command-line argument or random choice sets the secret; play() reads guesses from standard input, asks judge() to compare, and writes messages through an output function.",
        [{ k: "io", t: "secret\n(argument or random)" }, { k: "proc", t: "play()\nattempt counter" }, { k: "proc", t: "judge()\nlow / high / correct" }, { k: "io", t: "messages\n(out function)" }], { w: 160, gap: 32, hgt: 62 }),
      flowchart: flow("Guessing game flowchart", "Read a guess, check that it is a valid number, compare it with the secret, then either end the game or give a hint and ask again.", ["start with a secret", "read a guess", "valid number?", "compare with secret", "correct or no\nattempts left?", "show hint\nand repeat"], { loop: true }),
      schema: null,
      steps: [["Write judge().", "A tiny function that returns low, high or correct. It is easy to test on its own."], ["Write play().", "Loop over the guesses. Count only valid guesses. Return True on a win and False when the attempts run out."], ["Validate input.", "Use try/except around int(); check the range; print a message and continue without counting."], ["Make it testable.", "Pass the guesses and the output function in as parameters instead of calling input() and print() directly."], ["Add the command line.", "main() reads an optional secret from sys.argv, otherwise uses random.randint(1, 100)."], ["Test.", "Check a win, a loss, bad input and the singular/plural message."]],
      files: { "guessing_game.py": game, "test_guessing_game.py": tests },
      run: "guessing_game.py", args: "42", test: "test_guessing_game.py", stdin, sample: { out: "Too high. 6 attempt(s) left.\nPlease type a whole number.\nChoose a number between 1 and 100.\nToo low. 5 attempt(s) left.\nCorrect! You needed 3 attempts.\n" },
      explain: [["judge", "Compares one guess with the secret. Keeping it separate makes the rules obvious and testable."], ["play", "The game loop. It takes guesses from any iterable of text and sends messages to any function, so tests do not need a keyboard or a screen."], ["main", "Connects the real world: the command line, the random module and standard input."], ["max_attempts / low / high", "Default parameters that make the rules easy to change."]],
      testing: ["Run python guessing_game.py 42 and type guesses; then run it without the number to play for real.", "Run python -m unittest test_guessing_game -v", "Try: letters, 0, 101, negative numbers and an empty line.", "Check that seven wrong guesses end the game and reveal the number."],
      bugs: [["The player loses an attempt when typing letters", "Count the attempt only after the input has been validated."], ["Crash with ValueError", "int() raises ValueError for text; wrap it in try/except."], ["The game never ends", "You are not checking attempts == max_attempts."], ["Tests need a person at the keyboard", "Pass the guesses and the output function as parameters."], ["Same secret every run", "You seeded the random generator; do not do that for real play."]],
      extensions: ["Let the player choose the range and the number of attempts.", "Keep a high-score file with the fewest attempts.", "Add a hint when the guess is within 5 of the secret.", "Let the computer guess your number with binary search and report how many steps it needs."],
      interview: ["How would the best strategy for this game work, and how many guesses does it need at most?", "Why pass the input and output as parameters?", "What is the difference between random.randint and random.choice?", "How do you test code that uses randomness?", "How would you store a high score safely?"],
      rubric: rubric("Hints are correct, attempts are counted correctly, win and loss messages appear, the sample matches", "Bad input never costs an attempt; output and input are injectable for testing"),
      tasks: [
        judged("Guessing game: play a round", "Read the secret number on the first line and then the player's guesses, one per line. Follow the rules: only whole numbers from 1 to 100 count as guesses (anything else prints Please type a whole number. or Choose a number between 1 and 100. and does not use an attempt), at most 7 guesses, a wrong guess prints Too low. or Too high. followed by N attempt(s) left., a correct guess prints Correct! You needed N attempt. (attempts when N is not 1) and stops, and running out of guesses or input prints Game over. The number was S.", "# Write your game here\n", `import sys

secret = int(input())
attempts = 0
won = False
for raw in sys.stdin:
    raw = raw.strip()
    try:
        guess = int(raw)
    except ValueError:
        print("Please type a whole number.")
        continue
    if not 1 <= guess <= 100:
        print("Choose a number between 1 and 100.")
        continue
    attempts += 1
    if guess == secret:
        print(f"Correct! You needed {attempts} attempt{'s' if attempts != 1 else ''}.")
        won = True
        break
    print(f"Too {'low' if guess < secret else 'high'}. {7 - attempts} attempt(s) left.")
    if attempts == 7:
        break
if not won:
    print(f"Game over. The number was {secret}.")`, [["42\n50\nabc\n150\n25\n42\n", "Too high. 6 attempt(s) left.\nPlease type a whole number.\nChoose a number between 1 and 100.\nToo low. 5 attempt(s) left.\nCorrect! You needed 3 attempts."], ["7\n7\n", "Correct! You needed 1 attempt."], ["50\n1\n2\n3\n4\n5\n6\n7\n", "Too low. 6 attempt(s) left.\nToo low. 5 attempt(s) left.\nToo low. 4 attempt(s) left.\nToo low. 3 attempt(s) left.\nToo low. 2 attempt(s) left.\nToo low. 1 attempt(s) left.\nToo low. 0 attempt(s) left.\nGame over. The number was 50."], ["10\n", "Game over. The number was 10."]],
          ["Keep two counters or one: only valid guesses count.", "Use try/except around int().", "Stop the loop with break after a win or after the seventh valid guess.", "Decide at the end whether to print the Game over line."]),
        manual("Guessing game: write the unit tests", "Move the logic into judge() and play() with injectable input and output, then write tests for a win, a loss, bad input and the singular and plural wording.", ["play(secret, guesses, out=print) makes testing easy.", "Collect messages with out=lines.append."]),
        manual("Guessing game: publish it", "Create the repository with a README that explains the rules and shows a sample game. Commit in small steps and push. Submit the link.", ["Include the sample run in the README."]),
      ],
    },
  });
}

// ---------------------------------------------------------------- 3 Password Generator
{
  const passwords = `"""Generate strong random passwords and check the strength of a given one."""
import math
import secrets
import string
import sys

CLASSES = {
    "lower": string.ascii_lowercase,
    "upper": string.ascii_uppercase,
    "digit": string.digits,
    "symbol": "!@#$%^&*()-_=+[]{}",
}


def generate(length=16, classes=("lower", "upper", "digit", "symbol"), rng=None):
    """Return a random password with at least one character from every chosen class."""
    rng = rng or secrets.SystemRandom()
    if not classes or any(c not in CLASSES for c in classes):
        raise ValueError("choose at least one valid character class")
    if length < len(classes):
        raise ValueError("length is too short for the chosen classes")
    chars = [rng.choice(CLASSES[c]) for c in classes]
    pool = "".join(CLASSES[c] for c in classes)
    chars += [rng.choice(pool) for _ in range(length - len(chars))]
    rng.shuffle(chars)
    return "".join(chars)


def classes_in(password):
    return [name for name, chars in CLASSES.items() if any(ch in chars for ch in password)]


def entropy_bits(password):
    """A rough strength estimate: length x log2(size of the character pool the password draws on)."""
    pool = sum(len(CLASSES[c]) for c in classes_in(password))
    return round(len(password) * math.log2(pool)) if pool else 0


def rating(bits):
    return "weak" if bits < 40 else "fair" if bits < 60 else "strong"


def describe(password):
    found = ", ".join(classes_in(password)) or "none"
    bits = entropy_bits(password)
    return f"{password}: {len(password)} characters, classes: {found}, about {bits} bits ({rating(bits)})"


def main():
    for line in sys.stdin:
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "check" and len(parts) == 2:
            print(describe(parts[1]))
        elif parts[0] == "generate" and len(parts) == 2 and parts[1].isdigit():
            try:
                print(generate(int(parts[1])))
            except ValueError as error:
                print(f"Error: {error}")
        else:
            print("Commands: check PASSWORD | generate LENGTH")


if __name__ == "__main__":
    main()
`;
  const tests = `import random
import unittest

from passwords import CLASSES, classes_in, entropy_bits, generate, rating


class PasswordTests(unittest.TestCase):
    def test_length_and_every_class_present(self):
        for seed in range(20):
            password = generate(12, rng=random.Random(seed))
            self.assertEqual(len(password), 12)
            self.assertEqual(classes_in(password), ["lower", "upper", "digit", "symbol"])

    def test_only_chosen_classes_are_used(self):
        password = generate(10, classes=("digit",), rng=random.Random(1))
        self.assertTrue(all(ch in CLASSES["digit"] for ch in password))

    def test_rejects_bad_requests(self):
        with self.assertRaises(ValueError):
            generate(3)
        with self.assertRaises(ValueError):
            generate(8, classes=("emoji",))
        with self.assertRaises(ValueError):
            generate(8, classes=())

    def test_entropy_and_rating(self):
        self.assertEqual(entropy_bits("password"), 38)
        self.assertEqual(entropy_bits(""), 0)
        self.assertEqual((rating(39), rating(40), rating(59), rating(60)), ("weak", "fair", "fair", "strong"))

    def test_default_generator_is_random(self):
        self.assertNotEqual(generate(20), generate(20))


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "check password\\ncheck Tr0ub4dor&3\\ncheck correcthorsebattery\\ngenerate 2\\nhelp\\n".replace(/\\n/g, "\n");
  lessons.push({
    title: "Mini Project 3: Password Generator",
    minutes: 60,
    project: {
      id: "password-generator", kind: "MINI", difficulty: "EASY", minutes: 60, packages: [],
      problem: "Build a tool that generates random passwords of a chosen length that contain every selected kind of character, and that estimates the strength of any password you give it.",
      scenario: "People reuse short passwords because strong ones are hard to invent. A small generator that guarantees lower case, upper case, digits and symbols, together with a simple strength check, helps people see why length matters.",
      objectives: ["Use the secrets module for security-sensitive randomness instead of random", "Guarantee constraints (one character of each class) and still be random", "Compute and explain a simple entropy estimate", "Test random code by injecting a seeded generator"],
      prerequisites: ["Strings and lists", "Functions and default arguments", "The math and string modules", "Exceptions"],
      requirements: ["generate(length, classes) returns a password of exactly that length", "Every chosen class (lower, upper, digit, symbol) appears at least once", "Invalid requests (too short, unknown class) raise ValueError", "check PASSWORD prints length, classes, an entropy estimate and a rating", "Use secrets, not random, for real passwords"],
      architecture: chain("Password tool architecture", "Commands from the user go to either generate, which draws characters from the chosen classes using a random source, or describe, which measures classes and entropy.",
        [{ k: "io", t: "commands\n(stdin)" }, { k: "proc", t: "main()\nparse command" }, { k: "proc", t: "generate()\nsecrets random" }, { k: "proc", t: "describe()\nclasses, entropy" }, { k: "io", t: "output" }], { w: 130, gap: 28, hgt: 62 }),
      flowchart: flow("Password tool flowchart", "Read a command, then either generate a password or analyse one, print the result and repeat until the input ends.", ["start", "read a command", "generate\nor check?", "build password /\ncompute strength", "print result", "next command"], { loop: true }),
      schema: null,
      steps: [["Define the character classes.", "A dictionary from class name to the characters of that class, built from the string module."], ["Pick one character from each class first.", "That guarantees every requirement before the rest is random."], ["Fill the remaining length from the combined pool.", "Choose each extra character from all selected classes together."], ["Shuffle.", "Without shuffling the first characters would always be lower case, upper case, digit, symbol in that order."], ["Use a secure random source.", "secrets.SystemRandom() draws from the operating system; the random module is predictable and unsuitable for passwords."], ["Estimate strength.", "entropy = length x log2(pool size). It is only a rough guide: real attackers use dictionaries."], ["Test with a seeded random.Random.", "Inject the generator so the tests are repeatable."]],
      files: { "passwords.py": passwords, "test_passwords.py": tests },
      run: "passwords.py", test: "test_passwords.py", stdin, sample: { out: "password: 8 characters, classes: lower, about 38 bits (weak)\nTr0ub4dor&3: 11 characters, classes: lower, upper, digit, symbol, about 70 bits (strong)\ncorrecthorsebattery: 19 characters, classes: lower, about 89 bits (strong)\nError: length is too short for the chosen classes\nCommands: check PASSWORD | generate LENGTH\n" },
      explain: [["CLASSES", "The alphabet of each kind of character."], ["generate", "Guarantees one character per class, fills the rest from the pool and shuffles. The random source is a parameter so tests can fix it."], ["entropy_bits", "Pool size comes from the classes actually present; bits = length x log2(pool)."], ["rating", "Thresholds of 40 and 60 bits are a teaching simplification."], ["main", "A small command interpreter. generate prints a fresh random password, so the sample avoids it."]],
      testing: ["Run the sample, then try: generate 16, generate 100, generate 3, check abc.", "Run python -m unittest test_passwords -v", "Generate 1000 passwords in a loop and assert that each contains all classes.", "Check that two calls to generate(20) differ."],
      bugs: [["Passwords always start with a lower-case letter", "You forgot to shuffle after placing the guaranteed characters."], ["Some passwords miss a class", "Choosing all characters from the pool does not guarantee a class; place one of each first."], ["Tests fail randomly", "Inject random.Random(seed) so results repeat."], ["Using random.choice for real passwords", "random is not secure; use secrets."], ["Entropy is 0 for a password with spaces", "Characters outside the classes are not counted; document it or add a class."]],
      extensions: ["Add a passphrase mode that picks words from a word list.", "Check passwords against a list of the most common passwords.", "Avoid look-alike characters such as O, 0, l and 1 as an option.", "Copy the password to the clipboard and clear it after 30 seconds."],
      interview: ["Why is the random module not suitable for passwords?", "What does entropy measure, and what does it miss?", "How do you guarantee one character of each class and still stay random?", "How would you test a function that uses randomness?", "Why shuffle at the end?"],
      rubric: rubric("Passwords have the right length and classes; check output matches the sample; errors are reported", "Uses secrets; guaranteed classes; injectable random source"),
      tasks: [
        judged("Password tool: strength checker", "Build the strength checker. Read commands, one per line: check PASSWORD prints PASSWORD: N characters, classes: LIST, about B bits (RATING). Classes are lower, upper, digit and symbol (the symbols are !@#$%^&*()-_=+[]{}), listed in that order and separated by a comma and a space, or none. B is round(N x log2(pool)) where pool is the total size of the classes present (26, 26, 10 and 18 characters; 0 bits if none). RATING is weak below 40 bits, fair below 60, otherwise strong.", "# Write your checker here\n", `import math
import string
import sys

CLASSES = {"lower": string.ascii_lowercase, "upper": string.ascii_uppercase, "digit": string.digits, "symbol": "!@#$%^&*()-_=+[]{}"}
for line in sys.stdin:
    parts = line.split()
    if len(parts) == 2 and parts[0] == "check":
        password = parts[1]
        found = [name for name, chars in CLASSES.items() if any(ch in chars for ch in password)]
        pool = sum(len(CLASSES[c]) for c in found)
        bits = round(len(password) * math.log2(pool)) if pool else 0
        rating = "weak" if bits < 40 else "fair" if bits < 60 else "strong"
        print(f"{password}: {len(password)} characters, classes: {', '.join(found) or 'none'}, about {bits} bits ({rating})")`, [["check password\ncheck Tr0ub4dor&3\ncheck correcthorsebattery\n", "password: 8 characters, classes: lower, about 38 bits (weak)\nTr0ub4dor&3: 11 characters, classes: lower, upper, digit, symbol, about 70 bits (strong)\ncorrecthorsebattery: 19 characters, classes: lower, about 89 bits (strong)"], ["check 12345678\n", "12345678: 8 characters, classes: digit, about 27 bits (weak)"], ["check ....\n", "....: 4 characters, classes: none, about 0 bits (weak)"], ["check Abcdef12\n", "Abcdef12: 8 characters, classes: lower, upper, digit, about 48 bits (fair)"]],
          ["Build the class dictionary from the string module.", "any(ch in chars for ch in password) tells whether a class is present.", "math.log2 gives the bits per character.", "Round the final estimate once."]),
        manual("Password tool: build the generator", "Write generate(length, classes, rng) that returns a password with at least one character from each chosen class, raises ValueError for bad requests, and uses secrets.SystemRandom() by default. Test it with a seeded random.Random.", ["Pick one character per class, then fill the rest, then shuffle.", "Make the random source a parameter."]),
        manual("Password tool: publish it", "Create the repository, add the README (explain why secrets is used) and push. Submit the link.", ["Never commit real passwords."]),
      ],
    },
  });
}

// ---------------------------------------------------------------- 4 Student Grade Management
{
  const grades = `"""Record marks for students and report averages and grades."""
import sys
from statistics import mean

GRADE_BANDS = [(90, "A+"), (80, "A"), (70, "B"), (60, "C"), (50, "D"), (0, "F")]


def grade_for(average):
    for minimum, grade in GRADE_BANDS:
        if average >= minimum:
            return grade


class GradeBook:
    def __init__(self):
        self.marks = {}

    @staticmethod
    def _key(name):
        key = name.strip().title()
        if not key:
            raise ValueError("name is required")
        return key

    def add_student(self, name):
        key = self._key(name)
        if key in self.marks:
            raise ValueError(f"{key} already exists")
        self.marks[key] = {}

    def record(self, name, subject, score):
        key = self._key(name)
        if key not in self.marks:
            raise KeyError(f"unknown student {key}")
        if not 0 <= score <= 100:
            raise ValueError("score must be between 0 and 100")
        self.marks[key][subject.lower()] = score

    def average(self, name):
        scores = self.marks[self._key(name)].values()
        return mean(scores) if scores else None

    def report(self):
        rows = [(name, self.average(name)) for name in self.marks]
        rows = [(name, avg, grade_for(avg)) for name, avg in rows if avg is not None]
        return sorted(rows, key=lambda row: (-row[1], row[0]))

    def class_average(self):
        averages = [avg for _, avg, _ in self.report()]
        return mean(averages) if averages else None


def main():
    book = GradeBook()
    for line in sys.stdin:
        parts = line.split()
        if not parts:
            continue
        try:
            if parts[0] == "add" and len(parts) == 2:
                book.add_student(parts[1])
            elif parts[0] == "mark" and len(parts) == 4:
                book.record(parts[1], parts[2], float(parts[3]))
            elif parts[0] == "report":
                for name, avg, grade in book.report():
                    print(f"{name:<8}{avg:>6.1f}  {grade}")
                if book.class_average() is not None:
                    print(f"Class average: {book.class_average():.1f}")
            else:
                print("Commands: add NAME | mark NAME SUBJECT SCORE | report")
        except (KeyError, ValueError) as error:
            print(f"Error: {error.args[0]}")


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest

from grades import GradeBook, grade_for


class GradeTests(unittest.TestCase):
    def setUp(self):
        self.book = GradeBook()
        self.book.add_student("asha")
        self.book.add_student("ravi")

    def test_grade_bands_include_the_boundaries(self):
        self.assertEqual([grade_for(x) for x in (95, 90, 89.9, 80, 70, 60, 50, 49.9)], ["A+", "A+", "A", "A", "B", "C", "D", "F"])

    def test_average_and_report_order(self):
        self.book.record("asha", "maths", 90)
        self.book.record("asha", "art", 70)
        self.book.record("ravi", "maths", 95)
        report = self.book.report()
        self.assertEqual([row[0] for row in report], ["Ravi", "Asha"])
        self.assertEqual(report[1][1], 80)

    def test_names_are_normalised(self):
        self.book.record("  ASHA ", "Maths", 50)
        self.assertEqual(self.book.average("asha"), 50)

    def test_errors(self):
        with self.assertRaises(ValueError):
            self.book.add_student("Asha")
        with self.assertRaises(ValueError):
            self.book.record("asha", "maths", 101)
        with self.assertRaises(KeyError):
            self.book.record("zoya", "maths", 50)
        with self.assertRaises(ValueError):
            self.book.add_student("   ")

    def test_students_without_marks_are_left_out(self):
        self.assertEqual(self.book.report(), [])
        self.assertIsNone(self.book.class_average())


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "add asha\nadd ravi\nmark asha maths 92\nmark asha science 85\nmark ravi maths 67\nmark ravi science 74\nmark kabir maths 50\nmark asha art 101\nreport\n";
  lessons.push({
    title: "Mini Project 4: Student Grade Management",
    minutes: 75,
    project: {
      id: "student-grade-management", kind: "MINI", difficulty: "EASY", minutes: 75, packages: [],
      problem: "Build a grade book that stores marks per student and subject, validates scores, calculates averages and letter grades, and prints a ranked report with the class average.",
      scenario: "A teacher keeps marks in a notebook and spends hours on averages and rankings. A small program that checks every entry and produces the report removes arithmetic mistakes and shows who needs help.",
      objectives: ["Model data with a class and a dictionary of dictionaries", "Use the statistics module and sort with a compound key", "Validate input and report errors with exceptions", "Format a table of results with f-string alignment"],
      prerequisites: ["Dictionaries and lists", "Classes and methods", "Sorting with key functions", "Exceptions"],
      requirements: ["add NAME creates a student (names are stored in title case, duplicates are rejected)", "mark NAME SUBJECT SCORE stores a score from 0 to 100", "report lists students by average (highest first, ties by name) with grade bands A+ (90), A (80), B (70), C (60), D (50), F", "Print the class average", "Students with no marks are not listed", "Show a helpful error for unknown students and invalid scores"],
      architecture: chain("Grade book architecture", "Commands are parsed by main, which calls the GradeBook class; GradeBook stores marks in a dictionary and computes averages, ranks and grades.",
        [{ k: "io", t: "commands" }, { k: "proc", t: "main()\nparse + errors" }, { k: "proc", t: "GradeBook\nmarks dict" }, { k: "proc", t: "report()\nsort + grade_for" }, { k: "io", t: "table" }], { w: 130, gap: 28, hgt: 62 }),
      flowchart: flow("Grade book flowchart", "For each command: add a student, record a mark or print the report; any error is caught and shown.", ["start", "read a command", "which command?", "update the\nGradeBook", "error?", "print result\nor message"], { loop: true }),
      schema: null,
      steps: [["Design the data.", "marks = {student: {subject: score}}. A dictionary of dictionaries makes lookups by name and subject direct."], ["Write grade_for().", "Walk through the bands from the highest minimum down and return the first band that fits."], ["Write add_student() and record().", "Normalise the name once in a helper, then validate: unique name, known student, score between 0 and 100."], ["Write average() and report().", "Use statistics.mean and sort by (-average, name) so that the best student is first and ties are alphabetical."], ["Write main().", "Parse each line, call the right method and print errors from exceptions."], ["Format the table.", "f\"{name:<8}{avg:>6.1f}  {grade}\" left-aligns names and right-aligns numbers."], ["Test.", "Cover the grade boundaries, normalised names, ranking and every error."]],
      files: { "grades.py": grades, "test_grades.py": tests },
      run: "grades.py", test: "test_grades.py", stdin, sample: { out: "Error: unknown student Kabir\nError: score must be between 0 and 100\nAsha      88.5  A\nRavi      70.5  B\nClass average: 79.5\n" },
      explain: [["GRADE_BANDS", "A list of (minimum, grade) pairs from high to low; changing the policy means editing data, not code."], ["GradeBook._key", "Normalises names so that asha, ASHA and ' Asha ' are the same student."], ["record / add_student", "Validate first, change state second, so a bad call leaves the book unchanged."], ["report", "Returns rows rather than printing, so it can be tested and reused (for example by a web page)."], ["main", "Turns KeyError and ValueError into one-line messages; error.args[0] avoids the extra quotes KeyError adds."]],
      testing: ["Run the sample and compare every line.", "Run python -m unittest test_grades -v", "Try: duplicate student, score -1, score abc, a student with no marks, two students with equal averages.", "Check the boundaries 89.9, 90, 49.9 and 50."],
      bugs: [["Report order is wrong for ties", "Sort by (-average, name), not by average alone."], ["A grade is missing for 100", "Check the highest band first, or use >= with ordered bands."], ["ValueError: could not convert string to float", "The score text must be converted with float() and bad text reported."], ["Quotes around the error text", "str(KeyError) adds quotes; use error.args[0]."], ["Division by zero in the average", "Handle students with no marks before calculating."]],
      extensions: ["Save and load the grade book as JSON.", "Add credit weights per subject.", "Show the best and worst subject per student.", "Export the report to CSV and draw a bar chart."],
      interview: ["Why did you choose a dictionary of dictionaries?", "How does sorting with a compound key work?", "Why does report() return data instead of printing?", "How would you store this in a database?", "How do you avoid floating-point surprises in averages?"],
      rubric: rubric("Marks, averages, grades, ranking and class average are right; the sample matches", "Name normalisation; band boundaries; students without marks handled"),
      tasks: [
        judged("Grade book: report", "Build the grade book. Commands (one per line): add NAME, mark NAME SUBJECT SCORE and report. Names are stored in title case. Errors print Error: unknown student NAME, Error: score must be between 0 and 100 or Error: NAME already exists. report prints one line per student who has marks, ordered by average (highest first, then name), formatted as the name left-aligned in 8 characters, the average right-aligned in 6 characters with 1 decimal, two spaces and the grade (A+ at 90, A at 80, B at 70, C at 60, D at 50, otherwise F), and then Class average: X.X (the mean of the student averages).", "# Write your grade book here\n", grades, [[stdin, "Error: unknown student Kabir\nError: score must be between 0 and 100\nAsha      88.5  A\nRavi      70.5  B\nClass average: 79.5"], ["add zoya\nmark zoya maths 95\nmark zoya art 85\nreport\n", "Zoya      90.0  A+\nClass average: 90.0"], ["add a\nadd A\n", "Error: A already exists"], ["add x\nmark x m 49.9\nreport\n", "X         49.9  F\nClass average: 49.9"]],
          ["Keep marks in a dictionary of dictionaries.", "Sort by (-average, name).", "f\"{name:<8}{avg:>6.1f}  {grade}\"", "Use error.args[0] to print KeyError text without quotes."]),
        manual("Grade book: write the unit tests", "Test grade_for() at every boundary, the ranking with a tie, name normalisation and every error. Use setUp to create a fresh GradeBook for each test.", ["unittest.TestCase.setUp runs before every test."]),
        manual("Grade book: publish it", "Create the repository with README and tests, commit in small steps and push. Submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 5 ATM Simulation
{
  const atm = `"""An ATM simulation with PIN checking, limits and a transaction history."""
import hmac
import sys


class ATM:
    DAILY_LIMIT = 10000
    MAX_PIN_ATTEMPTS = 3

    def __init__(self, pin, balance=0):
        self._pin = str(pin)
        self.balance = balance
        self.history = []
        self.withdrawn_today = 0
        self.failed_attempts = 0
        self.locked = False
        self.logged_in = False

    def login(self, pin):
        if self.locked:
            raise PermissionError("Card is locked.")
        if hmac.compare_digest(str(pin), self._pin):
            self.failed_attempts = 0
            self.logged_in = True
            return
        self.failed_attempts += 1
        if self.failed_attempts >= self.MAX_PIN_ATTEMPTS:
            self.locked = True
            raise PermissionError("Card locked after 3 wrong PINs.")
        raise PermissionError(f"Wrong PIN ({self.MAX_PIN_ATTEMPTS - self.failed_attempts} attempts left).")

    def logout(self):
        self.logged_in = False

    def _require_login(self):
        if not self.logged_in:
            raise PermissionError("Please log in first.")

    def deposit(self, amount):
        self._require_login()
        if amount <= 0:
            raise ValueError("Amount must be positive.")
        self.balance += amount
        self.history.append(f"deposit {amount}")

    def withdraw(self, amount):
        self._require_login()
        if amount <= 0 or amount % 100:
            raise ValueError("Amounts must be multiples of 100.")
        if amount > self.balance:
            raise ValueError("Insufficient funds.")
        if self.withdrawn_today + amount > self.DAILY_LIMIT:
            raise ValueError("Daily limit exceeded.")
        self.balance -= amount
        self.withdrawn_today += amount
        self.history.append(f"withdraw {amount}")

    def check_balance(self):
        self._require_login()
        return self.balance


def main():
    atm = ATM(pin="1234", balance=5000)
    for line in sys.stdin:
        parts = line.split()
        if not parts or parts[0] == "quit":
            if parts:
                break
            continue
        command, args = parts[0], parts[1:]
        try:
            if command == "login" and len(args) == 1:
                atm.login(args[0])
                print("Welcome.")
            elif command == "logout":
                atm.logout()
                print("Goodbye.")
            elif command == "balance":
                print(f"Balance: {atm.check_balance()}")
            elif command == "deposit" and len(args) == 1:
                atm.deposit(int(args[0]))
                print(f"Deposited {args[0]}. Balance: {atm.balance}")
            elif command == "withdraw" and len(args) == 1:
                atm.withdraw(int(args[0]))
                print(f"Please take your cash: {args[0]}")
            elif command == "history":
                atm._require_login()
                for number, entry in enumerate(atm.history, 1):
                    print(f"{number}. {entry}")
            else:
                print("Commands: login PIN | balance | deposit X | withdraw X | history | logout | quit")
        except (PermissionError, ValueError) as error:
            print(error)


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest

from atm import ATM


class ATMTests(unittest.TestCase):
    def setUp(self):
        self.atm = ATM(pin="1234", balance=5000)

    def test_requires_login(self):
        for action in (self.atm.check_balance, lambda: self.atm.withdraw(100), lambda: self.atm.deposit(100)):
            with self.assertRaises(PermissionError):
                action()

    def test_wrong_pins_lock_the_card(self):
        for left in (2, 1):
            with self.assertRaises(PermissionError) as ctx:
                self.atm.login("0000")
            self.assertIn(f"({left} attempts left)", str(ctx.exception))
        with self.assertRaises(PermissionError):
            self.atm.login("0000")
        with self.assertRaises(PermissionError) as ctx:
            self.atm.login("1234")
        self.assertEqual(str(ctx.exception), "Card is locked.")

    def test_correct_pin_resets_the_counter(self):
        with self.assertRaises(PermissionError):
            self.atm.login("0000")
        self.atm.login("1234")
        self.assertEqual(self.atm.failed_attempts, 0)

    def test_withdraw_rules(self):
        self.atm.login("1234")
        self.atm.withdraw(1000)
        self.assertEqual(self.atm.check_balance(), 4000)
        for amount, message in ((150, "multiples"), (0, "multiples"), (9000, "Insufficient")):
            with self.assertRaises(ValueError) as ctx:
                self.atm.withdraw(amount)
            self.assertIn(message, str(ctx.exception))

    def test_daily_limit(self):
        rich = ATM(pin="1", balance=50000)
        rich.login("1")
        rich.withdraw(10000)
        with self.assertRaises(ValueError) as ctx:
            rich.withdraw(100)
        self.assertEqual(str(ctx.exception), "Daily limit exceeded.")

    def test_history_records_only_successful_operations(self):
        self.atm.login("1234")
        self.atm.deposit(200)
        with self.assertRaises(ValueError):
            self.atm.withdraw(999999)
        self.assertEqual(self.atm.history, ["deposit 200"])


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "balance\nlogin 0000\nlogin 1234\nbalance\nwithdraw 1250\nwithdraw 1000\ndeposit 2500\nwithdraw 20000\nhistory\nlogout\nbalance\nquit\n";
  lessons.push({
    title: "Mini Project 5: ATM Simulation",
    minutes: 75,
    project: {
      id: "atm-simulation", kind: "MINI", difficulty: "MEDIUM", minutes: 75, packages: [],
      problem: "Simulate an ATM: a customer logs in with a PIN (the card locks after three wrong attempts), checks the balance, deposits and withdraws cash under the bank's rules, and reviews the transaction history.",
      scenario: "Banks must apply the same rules every time: nobody may act before logging in, withdrawals come in multiples of the note size, balances must never go negative and the daily limit protects customers from fraud. Modelling this as a class makes the rules explicit and testable.",
      objectives: ["Model state and rules with a class (balance, login state, limits, history)", "Raise specific exceptions for rule violations and handle them at the edge", "Compare secrets safely with hmac.compare_digest", "Write tests for state machines and error paths"],
      prerequisites: ["Classes, attributes and methods", "Exceptions and custom messages", "Lists and f-strings", "Command parsing with split()"],
      requirements: ["login PIN, logout, balance, deposit X, withdraw X, history, quit", "No operation except login before a successful login", "Lock the card after three wrong PINs in a row", "Withdrawals: positive multiples of 100, not more than the balance, not more than 10000 per day", "Record only successful transactions in the history", "Print clear messages for every refusal"],
      architecture: chain("ATM architecture", "The command loop sends each command to the ATM object; the ATM checks login state and rules, updates the balance and history, and raises exceptions that the loop turns into messages.",
        [{ k: "io", t: "customer\ncommands" }, { k: "proc", t: "main()\ncommand loop" }, { k: "proc", t: "ATM class\nrules + state" }, { k: "io", t: "messages\nbalance, history" }], { w: 150, gap: 36, hgt: 62 }),
      flowchart: flow("ATM withdraw flowchart", "A withdrawal checks login, the note multiple, the balance and the daily limit before changing anything.", ["withdraw X", "logged in?", "multiple of 100?", "enough balance?", "within daily limit?", "pay cash and\nrecord history"], { loop: false }),
      schema: null,
      steps: [["List the rules.", "Write every rule as a sentence before coding: login required, PIN attempts, note multiples, balance, daily limit."], ["Create the ATM class.", "State: PIN, balance, history, withdrawn_today, failed_attempts, locked, logged_in."], ["Write login().", "Compare PINs with hmac.compare_digest, count failures, lock on the third and reset the counter after a success."], ["Write a login guard.", "A private _require_login() used at the start of every protected operation avoids repeated code."], ["Write deposit() and withdraw().", "Validate first, then change state and history, so a refused operation changes nothing."], ["Write main().", "Parse commands, call the object and print the message of any PermissionError or ValueError."], ["Test every rule, including the lock and the daily limit.", "Use a fresh ATM in setUp and a richer account for the limit."]],
      files: { "atm.py": atm, "test_atm.py": tests },
      run: "atm.py", test: "test_atm.py", stdin, sample: { out: "Please log in first.\nWrong PIN (2 attempts left).\nWelcome.\nBalance: 5000\nAmounts must be multiples of 100.\nPlease take your cash: 1000\nDeposited 2500. Balance: 6500\nInsufficient funds.\n1. withdraw 1000\n2. deposit 2500\nGoodbye.\nPlease log in first.\n" },
      explain: [["ATM.login", "Counts wrong attempts and locks the card; compare_digest avoids leaking information through timing."], ["_require_login", "One place that enforces the rule 'log in first'."], ["withdraw", "The rules in order: positive multiple of 100, enough money, within the daily limit. Each failure raises ValueError with its own message."], ["history", "Only operations that succeeded are appended."], ["main", "Maps exceptions to the messages a customer sees."]],
      testing: ["Run the sample and check each line.", "Run python -m unittest test_atm -v", "Try three wrong PINs, then the right one; withdraw 0, -100, 150, 10100; withdraw 10000 twice.", "Check that a refused withdrawal does not change the balance or the history."],
      bugs: [["Balance changes even when the withdrawal is refused", "Validate everything before you change state."], ["Card never locks", "Increase the counter on every wrong PIN and compare with the maximum."], ["Counter keeps old failures after a good login", "Reset failed_attempts to 0 on success."], ["Negative or zero amounts accepted", "Reject amount <= 0 explicitly."], ["Anyone can check the balance before login", "Call _require_login in every protected method."]],
      extensions: ["Hash the PIN with a salt (hashlib.scrypt) instead of storing it.", "Save accounts in a JSON or SQLite file and support several customers.", "Add transfers between accounts with atomic updates.", "Add a daily reset based on the date and a receipt printer."],
      interview: ["Why use exceptions for rule violations?", "Why validate before changing state?", "Why compare the PIN with compare_digest, and why should a real PIN never be stored as plain text?", "How would you make deposits and withdrawals safe with several users at once?", "How would you test the lock-out rule?"],
      rubric: rubric("All commands follow the rules; sample matches; history and limits correct", "Rules enforced in the class (not only in the command loop); card lock; no state change on failure"),
      tasks: [
        judged("ATM: command session", "Build the ATM session. The account has PIN 1234 and balance 5000. Commands (one per line, stopping at quit): login PIN prints Welcome. or Wrong PIN (N attempts left). (the card locks after 3 wrong PINs in a row and then prints Card is locked. for any login); logout prints Goodbye.; balance prints Balance: B; deposit X prints Deposited X. Balance: B; withdraw X prints Please take your cash: X; history prints N. withdraw X or N. deposit X for the successful transactions. Everything except login needs a login first (Please log in first.). Withdrawals must be positive multiples of 100 (Amounts must be multiples of 100.), not more than the balance (Insufficient funds.) and at most 10000 in total per session (Daily limit exceeded.).", "# Write your ATM here\n", atm, [[stdin, "Please log in first.\nWrong PIN (2 attempts left).\nWelcome.\nBalance: 5000\nAmounts must be multiples of 100.\nPlease take your cash: 1000\nDeposited 2500. Balance: 6500\nInsufficient funds.\n1. withdraw 1000\n2. deposit 2500\nGoodbye.\nPlease log in first."], ["login 1\nlogin 2\nlogin 3\nlogin 1234\n", "Wrong PIN (2 attempts left).\nWrong PIN (1 attempts left).\nCard locked after 3 wrong PINs.\nCard is locked."], ["login 1234\ndeposit 20000\nwithdraw 10000\nwithdraw 100\nbalance\n", "Welcome.\nDeposited 20000. Balance: 25000\nPlease take your cash: 10000\nDaily limit exceeded.\nBalance: 15000"], ["login 1234\nwithdraw 0\ndeposit -5\nhistory\n", "Welcome.\nAmounts must be multiples of 100.\nAmount must be positive."]],
          ["Put the rules inside an ATM class and raise exceptions.", "Count wrong PINs and reset the count after a success.", "Validate before changing the balance.", "Print the exception message in the command loop."]),
        manual("ATM: write the unit tests", "Write tests for login required, the three-strikes lock, the PIN counter reset, each withdrawal rule, the daily limit and the history.", ["Use assertRaises as a context manager and check the message with str(ctx.exception)."]),
        manual("ATM: publish it", "Create the repository with README and tests; commit and push; submit the link.", []),
      ],
    },
  });
}

module.exports = { lessons };
