// Phase 7 / Module 23, lessons 4-7: find-the-error practice, code-completion practice, debugging challenges, and the interview simulation.
// Every buggy program is run to confirm its symptom, and every fix is run to confirm its output.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task, db, fi, setQuiz } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 4
{
  const set = [
    db("E", `print the numbers 1 to 3, one per line`, `for i in range(3):\n    print(i)`, `0\n1\n2`,
      [`range(3) starts at 0 and stops at 2, so the numbers printed are 0 to 2`, `print must be outside the loop`, `i must be converted to a string first`, `There is no bug`], 0,
      `for i in range(1, 4):\n    print(i)`, `1\n2\n3`, `range(n) counts from 0 to n - 1. Use range(1, 4) to count 1, 2, 3.`),
    db("E", `print the sum 5 of the numbers 2 and 3`, `a = "2"\nb = "3"\nprint(a + b)`, `23`,
      [`print cannot add numbers`, `a and b must be floats`, `The values are strings, so + joins them instead of adding`, `There is no bug`], 2,
      `a = "2"\nb = "3"\nprint(int(a) + int(b))`, `5`, `Strings are joined by +. Convert them with int() before adding (this is the usual bug when numbers come from input()).`),
    db("E", `print Total: 5`, `total = 5\nprint("Total: " + total)`, `!TypeError`,
      [`print needs two arguments`, `A string and an int cannot be joined with +; use a comma or an f-string`, `total is not defined`, `Strings cannot contain a colon`], 1,
      `total = 5\nprint("Total:", total)`, `Total: 5`, `Python does not convert an int to text automatically in +. Pass several arguments to print or use an f-string.`),
    db("E", `print five when x is 5`, `x = 5\nif x = 5:\n    print("five")`, `!SyntaxError`,
      [`if needs brackets`, `print must be capitalised`, `= assigns; a comparison needs ==`, `x must be a string`], 2,
      `x = 5\nif x == 5:\n    print("five")`, `five`, `A single = is assignment and is not allowed as a condition; use == to compare.`),
    db("E", `print Hi Sam`, `def greet(name):\nreturn "Hi " + name\n\nprint(greet("Sam"))`, `!IndentationError`,
      [`return cannot be used in functions`, `name must be a number`, `print is missing parentheses`, `The function body is not indented`], 3,
      `def greet(name):\n    return "Hi " + name\n\nprint(greet("Sam"))`, `Hi Sam`, `The body of a function must be indented under the def line.`),
    db("M", `print the sum 6 of the numbers in the list`, `total = 0\nfor x in [1, 2, 3]:\n    total = x\nprint(total)`, `3`,
      [`total = x replaces the total each time; it should be total += x`, `The list must be sorted`, `range must be used instead of a list`, `print is inside the loop`], 0,
      `total = 0\nfor x in [1, 2, 3]:\n    total += x\nprint(total)`, `6`, `Assignment overwrites the running total; += accumulates it.`),
    db("M", `remove the negative numbers from the list`, `nums = [1, -2, -3, 4]\nfor n in nums:\n    if n < 0:\n        nums.remove(n)\nprint(nums)`, `[1, -3, 4]`,
      [`remove only works on strings`, `n must be converted to int`, `The list is changed while it is being looped over, so an element is skipped`, `print must be inside the loop`], 2,
      `nums = [1, -2, -3, 4]\nnums = [n for n in nums if n >= 0]\nprint(nums)`, `[1, 4]`, `Removing items from a list during iteration shifts the positions and skips the next element. Build a new list instead.`),
    db("M", `print only the new item [2] after add(2)`, `def add(x, items=[]):\n    items.append(x)\n    return items\n\nadd(1)\nprint(add(2))`, `[1, 2]`,
      [`append returns None`, `add must not use return`, `The default list is created once and shared between calls`, `items is a reserved word`], 2,
      `def add(x, items=None):\n    if items is None:\n        items = []\n    items.append(x)\n    return items\n\nadd(1)\nprint(add(2))`, `[2]`, `A mutable default argument is created once when the function is defined and reused by every call.`),
    db("M", `print 0 for a key that is missing from the dictionary`, `d = {"a": 1}\nprint(d["b"])`, `!KeyError`,
      [`Dictionaries cannot use strings as keys`, `d must be a list`, `print cannot show dictionaries`, `Indexing a missing key raises KeyError; d.get("b", 0) gives a default`], 3,
      `d = {"a": 1}\nprint(d.get("b", 0))`, `0`, `d[key] raises KeyError for a missing key. d.get(key, default) returns the default instead.`),
    db("M", `print the words of "a b c" in reverse order`, `s = "a b c"\nprint(s.reverse())`, `!AttributeError`,
      [`reverse needs an argument`, `Strings have no reverse method; split the words and reverse the list`, `s must be a list of numbers`, `print cannot print strings`], 1,
      `s = "a b c"\nprint(" ".join(s.split()[::-1]))`, `c b a`, `Strings are immutable and have no reverse method. Split into words, reverse the list and join.`),
    db("M", `swap the values of a and b`, `a, b = 1, 2\na = b\nb = a\nprint(a, b)`, `2 2`,
      [`Swapping needs a third list`, `print reverses the order`, `Tuples cannot be unpacked`, `After a = b both names hold 2; use a, b = b, a`], 3,
      `a, b = 1, 2\na, b = b, a\nprint(a, b)`, `2 1`, `The first assignment loses the old value of a. Tuple assignment swaps both at once.`),
    db("M", `print the last square, 9`, `squares = [x * x for x in range(1, 4)]\nprint(squares[3])`, `!IndexError`,
      [`range must start at 0`, `The list has 3 items (indexes 0 to 2); the last item is squares[-1]`, `squares must be a tuple`, `print needs two arguments`], 1,
      `squares = [x * x for x in range(1, 4)]\nprint(squares[-1])`, `9`, `Indexes run from 0 to len - 1. Use [-1] for the last item.`),
    db("M", `print 3 factorial, 6`, `def fact(n):\n    return n * fact(n - 1)\n\nprint(fact(3))`, `!RecursionError`,
      [`fact cannot call itself`, `n must be a float`, `There is no base case, so the recursion never stops`, `print must be inside fact`], 2,
      `def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n\nprint(fact(3))`, `6`, `Every recursive function needs a base case that returns without recursing.`),
    db("M", `print the largest age, 100`, `ages = ["10", "9", "100"]\nprint(max(ages))`, `9`,
      [`The values are strings, which compare character by character; convert them to int`, `max only works on lists of lists`, `The list must be sorted first`, `print converts strings to numbers`], 0,
      `ages = ["10", "9", "100"]\nprint(max(map(int, ages)))`, `100`, `As text "9" is greater than "100" because the first characters are compared first.`),
    db("M", `print equal for 0.1 + 0.2 and 0.3`, `total = 0.1 + 0.2\nif total == 0.3:\n    print("equal")\nelse:\n    print("not equal")`, `not equal`,
      [`0.3 must be written as 3/10`, `if cannot compare floats`, `else needs a condition`, `Floating-point sums are inexact; compare with math.isclose`], 3,
      `import math\n\ntotal = 0.1 + 0.2\nif math.isclose(total, 0.3):\n    print("equal")\nelse:\n    print("not equal")`, `equal`, `0.1 + 0.2 is 0.30000000000000004. Use a tolerance when comparing floats.`),
    db("M", `count one call of inc as 1`, `class Counter:\n    def __init__(self):\n        count = 0\n\n    def inc(self):\n        self.count += 1\n\nc = Counter()\nc.inc()\nprint(c.count)`, `!AttributeError`,
      [`inc needs a return value`, `__init__ sets a local variable count instead of the attribute self.count`, `Counter is a reserved word`, `c.count cannot be printed`], 1,
      `class Counter:\n    def __init__(self):\n        self.count = 0\n\n    def inc(self):\n        self.count += 1\n\nc = Counter()\nc.inc()\nprint(c.count)`, `1`, `Without self., count is only a local variable that disappears when __init__ ends.`),
    db("M", `add 5 to the global total`, `total = 0\n\ndef add(n):\n    total += n\n\nadd(5)\nprint(total)`, `!UnboundLocalError`,
      [`add must be called twice`, `n must be a string`, `Assigning inside the function makes total local; declare it global or return the value`, `print must be inside add`], 2,
      `total = 0\n\ndef add(n):\n    global total\n    total += n\n\nadd(5)\nprint(total)`, `5`, `An assignment inside a function makes the name local to it. Declare global total (or, better, return the new value).`),
    db("H", `print the average 3.5 of 3 and 4`, `avg = (3 + 4) // 2\nprint(avg)`, `3`,
      [`The sum must be in a list`, `avg cannot be a float`, `Brackets change the operator`, `// is floor division and drops the fraction; use /`], 3,
      `avg = (3 + 4) / 2\nprint(avg)`, `3.5`, `// rounds down to an integer. Use / for true division.`),
    db("H", `leave the original list a unchanged`, `a = [[1], [2]]\nb = a[:]\nb[0].append(9)\nprint(a)`, `[[1, 9], [2]]`,
      [`append changes both lists because b = a[:] is the same as b = a`, `The slice is a shallow copy: the inner lists are shared; use copy.deepcopy`, `a must be a tuple`, `print shows b`], 1,
      `import copy\n\na = [[1], [2]]\nb = copy.deepcopy(a)\nb[0].append(9)\nprint(a)`, `[[1], [2]]`, `A slice copies only the outer list; the inner lists are the same objects. deepcopy copies them too.`),
    db("H", `print [0, 1, 2] from three small functions`, `funcs = []\nfor i in range(3):\n    funcs.append(lambda: i)\nprint([f() for f in funcs])`, `[2, 2, 2]`,
      [`lambda cannot be stored in a list`, `range must start at 1`, `funcs must be a tuple`, `The lambdas capture the variable i, not its value; bind the value with i=i`], 3,
      `funcs = []\nfor i in range(3):\n    funcs.append(lambda i=i: i)\nprint([f() for f in funcs])`, `[0, 1, 2]`, `Closures look up i when they are called, after the loop has finished. A default argument freezes the value.`),
  ];
  lessons.push({
    title: "Practice Set: Find the Error",
    minutes: 45,
    learn: ["Locate the cause of a bug from the program and its symptom", "Recognise the classic Python mistakes behind syntax errors, exceptions and wrong output", "Explain the fix, not just spot the problem"],
    why: "Find-the-error questions test whether you can read code the way a debugger would. In an interview you are expected to state the cause, not only the line.",
    set,
    revision: ["SyntaxError and IndentationError: read the line the message points to.", "TypeError, KeyError, IndexError, AttributeError: match the exception to the cause.", "Wrong output without an error: loops, accumulation, aliasing, mutable defaults, integer versus true division.", "Fix the cause (not the symptom) and rerun."],
    quiz: setQuiz(set),
    tasks: [task("Syntax Error Locator", "Read the lines of a Python program from standard input. If it compiles, print OK. If it has a syntax error (including a bad indentation), print SyntaxError on line N, where N is the line number reported by Python.", "import ast, sys\nsource = sys.stdin.read()\n# try to parse it\n", `import ast
import sys

source = sys.stdin.read()
try:
    ast.parse(source)
    print("OK")
except SyntaxError as error:
    print(f"SyntaxError on line {error.lineno}")`, [["print(1)\nx = 2", "OK"], ["x = 1\ny = = 2", "SyntaxError on line 2"], ["if True:\nprint(1)", "SyntaxError on line 2"], ["if x = 5:\n    pass", "SyntaxError on line 1"]])],
  });
}

// ---------------------------------------------------------------- 5
{
  const set = [
    fi("E", `Fill in the blank (one word or symbol) to print the length of the string.`, `print(___("hello"))`, `len`, `5`, `len returns the number of items in a sequence.`),
    fi("E", `Fill in the blank to print the list in ascending order without changing it.`, `nums = [3, 1, 2]\nprint(___(nums))`, `sorted`, `[1, 2, 3]`, `sorted returns a new sorted list; nums.sort() would change nums and return None.`),
    fi("E", `Fill in the blank to print 0 1 2.`, `for i in ___(3):\n    print(i, end=" ")`, `range`, `0 1 2`, `range(3) produces 0, 1 and 2.`),
    fi("E", `Fill in the method that splits the text at the commas.`, `text = "a,b,c"\nprint(text.___(","))`, `split`, `['a', 'b', 'c']`, `str.split breaks a string into a list at each separator.`),
    fi("E", `Fill in the method that joins the words with hyphens.`, `print("-".___(["x", "y", "z"]))`, `join`, `x-y-z`, `The separator string's join method glues an iterable of strings together.`),
    fi("E", `Fill in the dictionary method that returns 0 when the key is missing.`, `d = {"a": 1}\nprint(d.___("b", 0))`, `get`, `0`, `dict.get(key, default) never raises KeyError.`),
    fi("M", `Fill in the keyword to build the list of squares with a comprehension.`, `squares = [x * x ___ x in range(4)]\nprint(squares)`, `for`, `[0, 1, 4, 9]`, `A comprehension has the form [expression for item in iterable].`),
    fi("M", `Fill in the keyword so the function gives back the sum.`, `def add(a, b):\n    ___ a + b\n\nprint(add(2, 3))`, `return`, `5`, `Without return a function gives back None.`),
    fi("M", `Fill in the keyword that handles the error.`, `try:\n    int("x")\n___ ValueError:\n    print("bad")`, `except`, `bad`, `try is paired with except (and optionally else and finally).`),
    fi("M", `Fill in the class from collections that counts items.`, `from collections import Counter\nprint(___("aab").most_common(1))`, `Counter`, `[('a', 2)]`, `Counter counts the occurrences of each item; most_common(1) returns the top one.`),
    fi("M", `Fill in the function name used as the sort key to order the words by length.`, `words = ["bb", "a", "ccc"]\nprint(sorted(words, key=___))`, `len`, `['a', 'bb', 'ccc']`, `The key function is called on every item and the results are compared.`),
    fi("M", `Fill in the function that pairs the two lists item by item.`, `print(list(___(["a", "b"], [1, 2])))`, `zip`, `[('a', 1), ('b', 2)]`, `zip walks several iterables in step.`),
    fi("M", `Fill in the name of the special method that runs when an object is created.`, `class A:\n    def ___(self):\n        self.x = 1\n\nprint(A().x)`, `__init__`, `1`, `__init__ initialises a new instance.`),
    fi("M", `Fill in the comparison operator so that the program prints odd.`, `x = 7\nprint("odd" if x % 2 ___ 0 else "even")`, `!=`, `odd`, `An odd number leaves a remainder different from 0 when divided by 2.`),
    fi("M", `Fill in the slice that reverses the string.`, `s = "python"\nprint(s[___])`, `::-1`, `nohtyp`, `A step of -1 walks the string backwards.`),
    fi("M", `Fill in the math function that gives the square root.`, `import math\nprint(math.___(16))`, `sqrt`, `4.0`, `math.sqrt always returns a float.`),
    fi("M", `Fill in the list method that adds 4 at the end.`, `nums = [1, 2, 3]\nnums.___(4)\nprint(nums)`, `append`, `[1, 2, 3, 4]`, `append adds one item at the end in place.`),
    fi("H", `Fill in the keyword that makes this function a generator.`, `def gen():\n    for i in range(3):\n        ___ i\n\nprint(list(gen()))`, `yield`, `[0, 1, 2]`, `yield produces a value and pauses the function until the next value is requested.`),
    fi("H", `Fill in the functools function that folds the list into one value (used twice).`, `from functools import ___\nprint(___(lambda a, b: a + b, [1, 2, 3]))`, `reduce`, `6`, `reduce applies the function cumulatively: (1 + 2) + 3.`),
    fi("H", `Fill in the built-in that supplies the numbers 0 and 1 for the dictionary comprehension.`, `print({k: v for k, v in zip("ab", ___(2))})`, `range`, `{'a': 0, 'b': 1}`, `range(2) yields 0 and 1 to pair with the letters.`),
  ];
  lessons.push({
    title: "Practice Set: Complete the Code",
    minutes: 45,
    learn: ["Complete short programs by choosing the right keyword, function or operator", "Connect built-in names to what they do", "Answer fill-in-the-blank questions under time pressure"],
    why: "Code-completion questions test recall of exact names and syntax, the thing you need to write code quickly in a timed test. Each answer is a single word or symbol that is checked as text.",
    howTo: "Think of the single word or symbol that completes the program, then open the answer. In the graded quiz below, type the answer exactly (letters are not case-sensitive, spaces around the answer are ignored).",
    set,
    revision: ["Names to know cold: len, sorted, range, zip, enumerate, split, join, get, append, Counter, reduce.", "Keywords: for, in, return, yield, try, except, finally, with, lambda, def, class.", "Operators: ==, !=, //, %, **, :: slices.", "Special methods start and end with two underscores."],
    quiz: setQuiz(set),
    tasks: [task("Negative Marking Score", "Read the number of correct answers, wrong answers and skipped questions, then the marks for a correct answer and the penalty for a wrong one (both positive numbers, possibly with decimals). Print the final score with 2 decimals (a negative total is allowed), then a space, the word and, a space, and the percentage of the maximum possible score (every question correct) with 1 decimal. For example 17.50 and 43.8.", "right, wrong, skipped = map(int, input().split())\nmark, penalty = map(float, input().split())\n# compute the score and the percentage\n", `right, wrong, skipped = map(int, input().split())
mark, penalty = map(float, input().split())
score = right * mark - wrong * penalty
maximum = (right + wrong + skipped) * mark
print(f"{score:.2f} and {score / maximum * 100:.1f}")`, [["10 5 5\n2 0.5", "17.50 and 43.8"], ["20 0 0\n1 0.25", "20.00 and 100.0"], ["0 4 6\n2 1", "-4.00 and -20.0"], ["8 2 0\n1.5 0.5", "11.00 and 73.3"]])],
  });
}

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Debugging Challenges: Fix the Program",
  minutes: 75,
  learn: ["Debug a failing program systematically under time pressure", "Recognise the usual causes of wrong answers in judged problems", "Fix a buggy starter program until it passes the hidden test cases"],
  why: "In real work and in tests you will often receive code that almost works. Reading it, finding the single wrong idea and fixing it is faster than rewriting, and it is a skill interviewers like to test.",
  realWorld: "A teammate's script prints a wrong average, a judged submission fails two of ten hidden cases, or a nightly job crashes on an empty file. You reproduce the problem on a tiny input, find the cause and fix it without breaking the other cases.",
  simple: "Reproduce the problem with the smallest input that fails, look at what the program actually does (not what you think it does), change one thing, and rerun all your examples.",
  detail: `<h3>A debugging routine for judged problems</h3>
<ol><li><strong>Run the sample</strong> and compare the output with the expected output character by character.</li><li><strong>Make the smallest failing input</strong> (one or two items) and compute the expected answer by hand.</li><li><strong>Print the intermediate values</strong> (<code>print(f"{total=}")</code>) or use a debugger to see where reality and your expectation first differ.</li><li><strong>Form one hypothesis</strong> and change one thing.</li><li><strong>Rerun every example</strong>, including edge cases, then remove the debug prints.</li></ol>
<h3>The usual suspects</h3>
${table(["Symptom", "Likely cause"], [["TypeError mixing str and int", "values read with input() are strings: convert with int() or float()"], ["answer off by one", "range(1, n) instead of range(1, n + 1); < versus <=; index 0 versus 1"], ["wrong for negative numbers", "a maximum or minimum started at 0 instead of the first item"], ["wrong for repeated spaces or empty input", "split(\" \") instead of split(); no handling of an empty list"], ["integer where a decimal is expected", "// instead of /, or missing formatting such as :.2f"], ["items skipped or repeated", "changing a list while looping over it"], ["order of output is wrong", "set or sorted used where first-appearance order is needed"], ["works on samples, fails hidden cases", "an untested edge case: empty, one item, duplicates, largest input"]])}
<h3>Rules that save time</h3>
<ul><li>Never fix two things at once.</li><li>Do not trust a loop bound: test the first and last iteration by hand.</li><li>If the code is long, bisect it: print halfway to see whether the bug is before or after.</li><li>Keep the judge's exact output format in mind (spaces, decimals, line breaks).</li></ul>`,
  syntax: { code: `print(f"{total=} {i=}")   # prints names and values\nassert total >= 0, total  # stop when an assumption breaks\nimport pdb; pdb.set_trace()  # or breakpoint()`, note: "Look at real values instead of guessing." },
  diagram: chain("Fixing a failing program", "Left to right: reproduce with a tiny input, observe the real values, form one hypothesis, change one thing, and rerun every example.",
    [{ k: "proc", t: "reproduce with\ntiny input" }, { k: "proc", t: "observe real\nvalues" }, { k: "proc", t: "one\nhypothesis" }, { k: "proc", t: "change one\nthing" }, { k: "term", t: "rerun all\nexamples" }], { w: 130, gap: 28, hgt: 62 }),
  example: { code: `def average(values):
    return sum(values) / len(values)


def safe_average(values):
    if not values:
        return 0.0
    return sum(values) / len(values)


for data in ([2, 4, 9], []):
    try:
        print(average(data))
    except ZeroDivisionError as error:
        print("bug found:", error)
    print(safe_average(data))`, out: `5.0
5.0
bug found: division by zero
0.0` },
  lineByLine: [["average", "The original function: fine for [2, 4, 9] but divides by zero for an empty list."], ["try/except in the loop", "Reproduces the failure with the smallest input, an empty list, and shows the real error."], ["safe_average", "The fix handles the edge case explicitly and keeps the normal behaviour."], ["output", "5.0 twice for the normal data; for [] the bug and then the fixed answer 0.0."]],
  dryRun: { intro: "Tracing <code>average([])</code>:", headers: ["Step", "Value"], rows: [["sum([])", "0"], ["len([])", "0"], ["0 / 0", "ZeroDivisionError: division by zero"]] },
  realExample: { intro: "Making the state visible: f-string debugging and a mini test table for a function that returns the middle of three numbers.", code: `def middle(a, b, c):
    return sorted([a, b, c])[1]


tests = [((1, 2, 3), 2), ((3, 1, 2), 2), ((5, 5, 1), 5), ((9, 7, 8), 8)]
for args, expected in tests:
    got = middle(*args)
    print(f"{args=} {got=} {'ok' if got == expected else 'FAIL'}")`, out: `args=(1, 2, 3) got=2 ok
args=(3, 1, 2) got=2 ok
args=(5, 5, 1) got=5 ok
args=(9, 7, 8) got=8 ok` },
  mistakes: ["Changing several things at once.", "Rewriting the whole program instead of finding the bug.", "Testing only the sample input.", "Believing the code does what you meant, without printing the values.", "Leaving debug output in the final submission."],
  practices: ["Make a tiny failing input first.", "Print names and values with f\"{x=}\".", "Check boundaries by hand: first and last iteration.", "After the fix, rerun all examples and delete the debug prints."],
  interview: ["How do you debug a program that passes the sample but fails hidden tests?", "What do you do first when you see a traceback?", "How do you find which part of a long program is wrong?", "Why use assertions while debugging?"],
  practiceQs: ["What does f\"{x=}\" print?", "Why does a maximum that starts at 0 fail on negative inputs?", "What is wrong with split(\" \")?", "Why is changing a list while iterating dangerous?"],
  revision: ["Reproduce small, observe values, one hypothesis, one change, rerun everything.", "Common causes: str versus int, off by one, bad initial value, edge cases, // versus /.", "f\"{x=}\" and breakpoint() show real state.", "Remove debug output before submitting."],
  hinglish: "Buggy program ko theek karne ke liye pehle sabse chhota failing input banao, phir values print karke dekho ki asli mein kya ho raha hai, ek baar mein sirf ek cheez badlo aur saare examples dobara chalao. Zyadatar bug str/int ka farq, off-by-one aur edge cases hote hain.",
  quiz: [
    mcq("A program passes the sample but fails hidden tests. What is the best first step?", ["Rewrite it", "Think of edge cases (empty, one item, negatives, duplicates) and test them", "Submit again", "Remove the loop"], 1, "Hidden tests usually probe edge cases the sample does not."),
    mcq("What does print(f\"{n=}\") show when n is 5?", ["5", "n=5", "'n'", "Nothing"], 1, "The = specifier prints the expression text and its value."),
    mcq("Why does best = 0 fail when finding the maximum of -5, -2 and -9?", ["0 is not an int", "Every number is smaller than 0, so best is never updated", "max starts at the last item", "The loop skips negatives"], 1, "Start from the first element instead."),
    mcq("What does input().split(\" \") do differently from input().split() with the text \"a  b\"?", ["Nothing", "It keeps an empty string between the two spaces", "It raises an error", "It sorts the words"], 1, "split with an explicit separator does not collapse repeated spaces."),
    mcq("Why is it risky to remove items from a list while looping over it?", ["It is slow", "The positions shift, so some items are skipped", "It raises SyntaxError", "It sorts the list"], 1, "The loop index moves on while the items move down.")
  ],
  tasks: [
    { ...task("Fix the Average", "The starter program should read a line of integers and print their average with 2 decimals, but it crashes. Fix it.", "numbers = input().split()\nprint(sum(numbers) / len(numbers))\n", `numbers = list(map(int, input().split()))
print(f"{sum(numbers) / len(numbers):.2f}")`, [["1 2 3 4", "2.50"], ["10", "10.00"], ["5 5 6", "5.33"], ["-1 1", "0.00"]]) },
    task("Fix the Sum to N", "The starter program should print 1 + 2 + ... + n, but it gives the wrong total. Fix it.", "n = int(input())\ntotal = 0\nfor i in range(1, n):\n    total += i\nprint(total)\n", `n = int(input())
total = 0
for i in range(1, n + 1):
    total += i
print(total)`, [["5", "15"], ["1", "1"], ["10", "55"], ["100", "5050"]]),
    task("Fix the Duplicate Remover", "The starter program should print the words of the line with duplicates removed, keeping the order of first appearance, but it prints them in a different order. Fix it.", "words = input().split()\nprint(*sorted(set(words)))\n", `seen = set()
result = []
for word in input().split():
    if word not in seen:
        seen.add(word)
        result.append(word)
print(*result)`, [["pear apple pear fig apple", "pear apple fig"], ["a b c", "a b c"], ["z z z", "z"], ["fig pear fig apple", "fig pear apple"]]),
    task("Fix the Palindrome Check", "The starter program should print yes if the line is a palindrome when you ignore spaces and letter case, otherwise no. It only handles exact matches. Fix it.", "s = input()\nprint(\"yes\" if s == s[::-1] else \"no\")\n", `s = "".join(ch.lower() for ch in input() if ch != " ")
print("yes" if s == s[::-1] else "no")`, [["A man a plan a canal Panama", "yes"], ["Never odd or even", "yes"], ["hello", "no"], ["Racecar", "yes"]]),
    task("Fix the Percentage", "The starter program should read the marks obtained and the total marks and print the percentage with 1 decimal, but it prints a wrong integer. Fix it.", "got, total = map(int, input().split())\nprint(got // total * 100)\n", `got, total = map(int, input().split())
print(f"{got / total * 100:.1f}")`, [["45 60", "75.0"], ["1 3", "33.3"], ["0 10", "0.0"], ["7 7", "100.0"]]),
    task("Fix the Maximum", "The starter program should print the largest of the integers on the line, but it is wrong when all of them are negative. Fix it.", "best = 0\nfor x in map(int, input().split()):\n    if x > best:\n        best = x\nprint(best)\n", `numbers = list(map(int, input().split()))
best = numbers[0]
for x in numbers[1:]:
    if x > best:
        best = x
print(best)`, [["3 9 2", "9"], ["-5 -2 -9", "-2"], ["-7", "-7"], ["0 -1", "0"]]),
    task("Fix the Word Counter", "The starter program should print how many words the line has (words are separated by one or more spaces), but it counts empty pieces. Fix it.", "print(len(input().split(\" \")))\n", `print(len(input().split()))`, [["a  b c", "3"], ["hello", "1"], ["one two three four", "4"], ["x   y", "2"]]),
    task("Fix the Odd Filter", "The starter program should print the odd numbers of the line in their original order, but it skips some even numbers because it changes the list while looping. If there is no odd number it should print none. Fix it.", "nums = list(map(int, input().split()))\nfor x in nums:\n    if x % 2 == 0:\n        nums.remove(x)\nprint(*nums)\n", `nums = list(map(int, input().split()))
odds = [x for x in nums if x % 2 != 0]
print(*odds if odds else ["none"])`, [["1 2 4 5 6", "1 5"], ["1 3", "1 3"], ["2 4 6 8", "none"], ["7 2 2 9", "7 9"]]),
  ],
});

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Interview Simulation: Technical, Project and HR Rounds",
  minutes: 70,
  learn: ["Know the shape of a campus interview: technical, project and HR rounds", "Think aloud while solving a problem and explain trade-offs", "Describe a project honestly using a clear structure", "Prepare answers to common HR questions with the STAR method and plan the time in a test or interview"],
  why: "A job offer depends on the conversation as much as on the code. Candidates who explain clearly, ask good questions and are honest about what they know are remembered, and that is practised, not accidental.",
  realWorld: "A fresher is asked to introduce themselves, solve a small array problem aloud, explain the main project and answer why they want the job. The same candidate with a rehearsed structure sounds calm and credible.",
  simple: "Prepare a short introduction, two stories (a project, a challenge) told with the STAR method, a problem-solving routine you say aloud, and honest answers about what you do not know yet.",
  detail: `<h3>The three rounds</h3>
${table(["Round", "What is checked", "How to prepare"], [["technical", "problem solving, Python fundamentals, data structures, complexity", "practise the problem bank and interview questions; think aloud"], ["project", "what you built, your contribution, design choices, testing, what you would improve", "rehearse a 2-minute and a 5-minute explanation; know every line you claim"], ["HR / managerial", "motivation, teamwork, communication, goals, flexibility", "prepare honest answers; research the role; ask questions"]])}
<h3>Thinking aloud: a script for a coding question</h3>
<ol><li>&quot;Let me repeat the problem to make sure I understood it.&quot; Restate it and ask about constraints and edge cases.</li><li>&quot;An example: ...&quot; Work a small case by hand.</li><li>&quot;A simple approach is ... which takes O(n^2).&quot; State the brute force and its cost.</li><li>&quot;We repeat work here, so a dictionary could ...&quot; Explain the improvement and its trade-off.</li><li>Write clean code while narrating the key lines.</li><li>&quot;Let me test with the example and an empty input.&quot; Trace your own code and state the final complexity.</li></ol>
<h3>Explaining a project</h3>
<ul><li><strong>One sentence</strong>: what problem it solves and for whom.</li><li><strong>Your part</strong>: say &quot;I&quot; for what you did and &quot;we&quot; for the team.</li><li><strong>Design</strong>: the main components and why you chose them (language, database, framework).</li><li><strong>A hard problem</strong>: one bug or design decision, how you found it, what you learned.</li><li><strong>Quality</strong>: how you tested it; what you would improve next.</li></ul>
<p>Only describe what you can defend: interviewers dig into details, and a claim you cannot explain costs more than an honest &quot;I did not build that part&quot;.</p>
<h3>STAR for behavioural questions</h3>
<p><strong>S</strong>ituation (context in one sentence), <strong>T</strong>ask (your goal), <strong>A</strong>ction (what you did, step by step), <strong>R</strong>esult (the outcome, ideally with a number, and what you learned). Typical questions: tell me about yourself; a time you worked in a team; a time you failed; a time you learned something quickly; why this company; where do you see yourself in five years.</p>
<h3>Good habits</h3>
<ul><li>Be on time, test your camera and audio for online interviews, keep water and a pen nearby.</li><li>If you do not know, say so, then reason aloud from what you do know.</li><li>Ask clarifying questions; they show care, not weakness.</li><li>Prepare two or three questions of your own about the team and the work.</li><li>Be honest about your resume: never claim skills, projects or experience you do not have.</li></ul>`,
  syntax: { code: `weights = {"problem solving": 40, "communication": 30, "fundamentals": 30}\nscore = sum(weights[k] * rating[k] for k in weights) / 100`, note: "A rubric turns practice interviews into numbers you can track." },
  diagram: chain("A coding question, aloud", "Left to right: restate the problem, work an example, state the brute force, improve it, code while narrating, then test and state the complexity.",
    [{ k: "proc", t: "restate +\nask" }, { k: "proc", t: "example by\nhand" }, { k: "proc", t: "brute force\n+ cost" }, { k: "proc", t: "improve" }, { k: "proc", t: "code and\nnarrate" }, { k: "term", t: "test and\ncomplexity" }], { w: 112, gap: 24, hgt: 60 }),
  example: { code: `weights = {"problem solving": 40, "communication": 30, "fundamentals": 30}
rounds = {
    "mock 1": {"problem solving": 3, "communication": 4, "fundamentals": 4},
    "mock 2": {"problem solving": 4, "communication": 4, "fundamentals": 5},
}
for name, rating in rounds.items():
    score = sum(weights[k] * rating[k] for k in weights) / 100
    verdict = "strong" if score >= 4.0 else "borderline" if score >= 3.0 else "needs work"
    print(f"{name}: {score:.2f} out of 5 - {verdict}")`, out: `mock 1: 3.60 out of 5 - borderline
mock 2: 4.30 out of 5 - strong` },
  lineByLine: [["weights", "How much each skill counts; they add up to 100."], ["rounds", "Self-ratings from 1 to 5 for two practice interviews."], ["sum(weights[k] * rating[k]) / 100", "A weighted average: mock 1 is (40 x 3 + 30 x 4 + 30 x 4) / 100 = 3.6."], ["verdict", "A simple scale, 4.0 or more strong, 3.0 or more borderline."]],
  dryRun: { intro: "Mock 2 step by step:", headers: ["Skill", "Weight", "Rating", "Weight x rating"], rows: [["problem solving", "40", "4", "160"], ["communication", "30", "4", "120"], ["fundamentals", "30", "5", "150"], ["total / 100", "", "", "4.30"]] },
  realExample: { intro: "Planning a 45-minute technical interview so that no part is forgotten.", code: `plan = [("introduction", 10), ("coding problem", 55), ("fundamentals", 20), ("your questions", 15)]
total = 45
elapsed = 0
for name, percent in plan:
    minutes = total * percent // 100
    print(f"{name}: minutes {elapsed}-{elapsed + minutes}")
    elapsed += minutes
print(f"unused: {total - elapsed} min")`, out: `introduction: minutes 0-4
coding problem: minutes 4-28
fundamentals: minutes 28-37
your questions: minutes 37-43
unused: 2 min` },
  mistakes: ["Memorising answers word for word.", "Claiming a project or skill you cannot explain.", "Going silent while thinking.", "Criticising a former team or teacher.", "Not preparing any questions to ask."],
  practices: ["Rehearse aloud with a friend or a recording.", "Prepare two STAR stories and a two-minute project explanation.", "Practise saying the brute force first.", "Review the job description and match your examples to it."],
  interview: ["Tell me about yourself.", "Explain your best project and your contribution.", "Tell me about a failure and what you learned.", "Why should we hire you, and what do you want to learn?"],
  practiceQs: ["What does STAR stand for?", "What are the first two things you do when given a coding problem?", "How do you answer something you do not know?", "Which questions will you ask the interviewer?"],
  revision: ["Three rounds: technical, project, HR.", "Think aloud: restate, example, brute force, improve, code, test.", "STAR: situation, task, action, result.", "Be honest; say I for your work and we for the team's."],
  hinglish: "Interview mein pehle sawal dohrao, example haath se karo, brute force batao, phir behtar tareeka socho aur bolte hue code likho. Project ko ek vaakya mein samjhao, apna kaam 'maine' aur team ka kaam 'humne' kehkar batao, aur jo nahi aata use imaandari se bolo.",
  quiz: [
    mcq("What is the first thing to do when given a coding problem in an interview?", ["Start typing", "Restate the problem and ask about constraints", "Say it is too hard", "Draw a flowchart for an hour"], 1, "Clarifying avoids solving the wrong problem."),
    mcq("What does the R in STAR stand for?", ["Reason", "Result", "Review", "Role"], 1, "Situation, Task, Action, Result."),
    mcq("An interviewer asks about a library you listed on your resume but have not used much. What should you do?", ["Pretend to know it", "Be honest about your level and explain what you do know", "Change the subject", "Say it is outdated"], 1, "Honesty builds trust; overstated claims are quickly exposed."),
    mcq("In a team project, how should you describe your work?", ["Say we for everything", "Say I for what you did and we for what the team did", "Say I for everything", "Do not mention the team"], 1, "It makes your contribution clear without taking credit for others' work."),
    mcq("Why state the brute-force solution first?", ["To waste time", "It shows a correct baseline and makes the improvement easy to explain", "Interviewers prefer slow code", "It is required by Python"], 1, "A correct simple solution is better than silence.")
  ],
  tasks: [
    task("Interview Rubric Score", "Read n and then n lines of the form skill weight rating, where weight is a positive integer (the weights add up to 100) and rating is from 1 to 5. Print the weighted score out of 5 with 2 decimals, then a space, a dash, a space and a verdict: strong if the score is at least 4.0, borderline if it is at least 3.0, otherwise needs work. For example 3.60 - borderline.", "n = int(input())\nrows = [input().split() for _ in range(n)]\n# weighted average and verdict\n", `n = int(input())
rows = [input().split() for _ in range(n)]
score = sum(int(weight) * int(rating) for _, weight, rating in rows) / 100
verdict = "strong" if score >= 4.0 else "borderline" if score >= 3.0 else "needs work"
print(f"{score:.2f} - {verdict}")`, [["3\nproblem 40 3\ncommunication 30 4\nfundamentals 30 4", "3.60 - borderline"], ["2\nA 50 5\nB 50 4", "4.50 - strong"], ["2\nA 60 2\nB 40 2", "2.00 - needs work"], ["1\nall 100 3", "3.00 - borderline"]]),
    task("Test Time Planner", "Read the total minutes of a test, then n and n lines of problem name and marks. Reserve total // 10 minutes for review. Share the remaining minutes among the problems in proportion to their marks, each rounded down to a whole number of minutes. Print one line per problem as name: M min, and finally review: R min, where R is the total minus the minutes given to problems (so the rounding leftovers go to review).", "total = int(input())\nn = int(input())\nproblems = [input().split() for _ in range(n)]\n# split the time in proportion to the marks\n", `total = int(input())
n = int(input())
problems = [input().split() for _ in range(n)]
remaining = total - total // 10
marks_sum = sum(int(m) for _, m in problems)
given = 0
for name, marks in problems:
    minutes = remaining * int(marks) // marks_sum
    given += minutes
    print(f"{name}: {minutes} min")
print(f"review: {total - given} min")`, [["60\n3\nA 20\nB 30\nC 50", "A: 10 min\nB: 16 min\nC: 27 min\nreview: 7 min"], ["90\n2\nX 1\nY 1", "X: 40 min\nY: 40 min\nreview: 10 min"], ["30\n1\nonly 100", "only: 27 min\nreview: 3 min"], ["45\n3\na 10\nb 10\nc 10", "a: 13 min\nb: 13 min\nc: 13 min\nreview: 6 min"]]),
  ],
});

module.exports = { lessons };
