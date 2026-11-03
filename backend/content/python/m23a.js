// Phase 7 / Module 23, lessons 1-3: placement assessment strategy, a multiple-choice practice set, and an output-prediction practice set.
// "Style" wording describes the kind of test practised; nothing here is claimed to come from any company's test.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task, iq, mc, setQuiz } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "Placement Online Assessments: Formats, Strategy and Time Management",
  minutes: 60,
  learn: ["Recognise the usual sections of a placement test: aptitude, technical multiple choice, coding", "Plan your time and order of attack", "Read input and output formats correctly and use a reliable program template", "Use partial credit, testing and review to protect your score"],
  why: "Most campus hiring begins with an online assessment. The same skills can be solved in very different amounts of time depending on strategy: reading carefully, doing the easy marks first and testing before you submit are worth as many marks as raw coding speed.",
  realWorld: "A typical campus test has a timed aptitude section, a technical multiple-choice section on programming fundamentals, and two or three coding problems judged against hidden test cases. Scores are the sum of passed cases, sometimes with negative marking.",
  simple: "Treat the test like a project with a deadline: skim everything, bank the easy marks, then spend the remaining time on the problems where you can gain the most, and always leave a few minutes to test and review.",
  detail: `<h3>What a placement test usually contains</h3>
${table(["Section", "What is tested", "Typical approach"], [["aptitude and reasoning", "arithmetic, percentages, series, logic puzzles", "practise speed; skip and return to slow questions"], ["technical multiple choice", "programming concepts, output prediction, complexity, SQL, OS, networks", "answer what you know first; eliminate wrong options"], ["coding", "2 to 4 problems of easy, medium and sometimes hard level", "partial credit: passing some test cases still earns marks"], ["interview rounds", "technical, project and HR conversations", "see the interview simulation lesson"]])}
<p>The exact mix, duration and marking scheme differ from test to test: read the instructions page and any sample paper you are given. The practice sets and mock tests in this module use the <em>style</em> of such assessments, but none of them is claimed to be a real company's test.</p>
<h3>A time plan</h3>
<ol><li><strong>Minutes 0-5</strong>: read every problem statement and constraints; rank them by how sure you are.</li><li><strong>Easy problems first</strong>: finish them cleanly with a quick test.</li><li><strong>Medium problems</strong>: write the brute force first; improve only if the constraints demand it.</li><li><strong>Hard problems</strong>: aim for partial credit (small cases pass with brute force) rather than leaving it empty.</li><li><strong>Last 10 minutes</strong>: re-run samples, check edge cases, remove debug prints, submit.</li></ol>
<h3>Reading the problem</h3>
<ul><li>Underline the input format (how many lines, in what order), the output format (spaces or lines, rounding) and the constraints (they tell you the allowed complexity).</li><li>Check what to print when there is no answer (-1, none, an empty line?).</li><li>Mentally run the sample input and compare it with the sample output <em>exactly</em>: judges compare text, including spaces and decimal places.</li></ul>
<h3>Input and output in Python</h3>
<ul><li>Use <code>input()</code> for small inputs; for large inputs use <code>sys.stdin.read().split()</code> and an index.</li><li>Print once with <code>print("\\n".join(lines))</code> or <code>print(*items)</code> for big outputs.</li><li>Format decimals with <code>f"{x:.2f}"</code>; do not print extra text such as prompts.</li><li>Many tests contain several cases: read <code>t</code> first and loop.</li></ul>
<h3>Partial credit and negative marking</h3>
<p>With partial credit, a correct brute force that passes the small cases beats an unfinished clever solution. With negative marking, answer a multiple-choice question only if you can rule out at least one option, or if the penalty is small compared with the reward.</p>
<h3>Test integrity</h3>
<p>Online tests are monitored and often check for copying. Do your own work, do not look up answers during a proctored test and follow the rules you accept at the start. Keeping your practice honest is the best preparation.</p>`,
  syntax: { code: `import sys\ndata = sys.stdin.read().split()\nt = int(data[0])\npos = 1\nfor _ in range(t):\n    n = int(data[pos]); pos += 1\n    values = list(map(int, data[pos:pos + n])); pos += n\n    ...`, note: "A reliable template for tests with several cases." },
  diagram: chain("The attack plan", "Left to right: skim all problems, solve the easy ones, write brute force for the medium ones, go for partial credit on the hard ones, then test, review and submit.",
    [{ k: "proc", t: "skim and\nrank" }, { k: "proc", t: "bank the\neasy marks" }, { k: "proc", t: "brute force\nfor medium" }, { k: "proc", t: "partial credit\non hard" }, { k: "term", t: "test, review,\nsubmit" }], { w: 130, gap: 28, hgt: 62 }),
  example: { code: `import sys


def average(values):
    return sum(values) / len(values)


data = sys.stdin.read().split()
t = int(data[0])
pos = 1
out = []
for _ in range(t):
    n = int(data[pos])
    pos += 1
    values = list(map(int, data[pos:pos + n]))
    pos += n
    out.append(f"{average(values):.2f}")
print("\\n".join(out))`, stdin: "2\n3\n1 2 4\n2\n10 20", out: `2.33
15.00` },
  lineByLine: [["data = sys.stdin.read().split()", "Reads every token of the input at once, which works whatever the line breaks are."], ["t = int(data[0]); pos = 1", "The first token is the number of test cases; pos is a moving read position."], ["n = int(data[pos]); pos += 1", "Each case starts with its size; read it and advance."], ["values = list(map(int, data[pos:pos + n]))", "Take the next n tokens as integers and advance by n."], ["f\"{average(values):.2f}\"", "Exactly two decimals: 7/3 prints as 2.33 and 30/2 as 15.00."], ["print(\"\\n\".join(out))", "One print call for all answers, one answer per line."]],
  dryRun: { intro: "A 60-minute test with one easy, one medium and one hard problem:", headers: ["Minutes", "Activity"], rows: [["0 - 5", "read all three statements, rank them"], ["5 - 15", "easy problem: solve, test the sample and one edge case"], ["15 - 40", "medium problem: brute force, then optimise if needed"], ["40 - 52", "hard problem: brute force for partial credit"], ["52 - 60", "recheck samples, remove debug output, submit"]] },
  realExample: { intro: "Partial credit in numbers: each problem is worth some marks and earns marks in proportion to the hidden cases it passes.", code: `problems = [
    ("easy", 20, 10, 10),
    ("medium", 30, 7, 10),
    ("hard", 50, 3, 10),
]
earned = 0.0
for name, marks, passed, total in problems:
    gained = marks * passed / total
    earned += gained
    print(f"{name}: {gained:.1f} of {marks}")
print(f"total {earned:.1f} of {sum(p[1] for p in problems)}")`, out: `easy: 20.0 of 20
medium: 21.0 of 30
hard: 15.0 of 50
total 56.0 of 100` },
  mistakes: ["Starting to code before reading all the problems.", "Spending half the time on one hard problem.", "Printing extra text or the wrong number of decimals.", "Not testing the sample input before submitting.", "Leaving a problem blank instead of attempting partial credit."],
  practices: ["Practise under a timer.", "Keep a personal template for input and output.", "Write down edge cases (empty, one, largest) before submitting.", "Review wrong answers and note the cause."],
  interview: ["How do you decide the order in which to solve problems?", "What do you do when a problem seems too hard?", "How do you avoid wrong-answer verdicts on correct logic?", "How do you prepare for negative marking?"],
  practiceQs: ["What does the constraint n <= 10^5 tell you?", "Why read input with sys.stdin.read().split()?", "When is an unfinished optimal solution worse than a finished brute force?", "What should you do in the last ten minutes?"],
  revision: ["Skim, rank, bank easy marks, partial credit on hard problems.", "Match the output format exactly.", "Use the constraints to choose the complexity.", "Test samples and edge cases; leave time to review."],
  hinglish: "Placement test mein pehle saare sawal padho, aasaan sawalon ke marks pehle lo, medium mein brute force likho aur mushkil sawal mein partial credit lo. Output format bilkul sahi rakho (decimals aur spaces), aur aakhri das minute testing aur review ke liye bachao.",
  quiz: [
    mcq("A coding problem is worth 30 marks and your program passes 7 of its 10 hidden cases. How many marks do you get with proportional partial credit?", ["7", "21", "30", "0"], 1, "30 x 7 / 10 = 21."),
    mcq("What do the constraints (for example n up to 10^5) mainly tell you?", ["The programming language", "The time complexity you need", "The number of test cases", "The marks"], 1, "10^5 items rules out O(n^2) and points to O(n log n) or O(n)."),
    mcq("Which is the best first step in a timed test?", ["Start the hardest problem", "Skim all problems and rank them", "Submit blank", "Optimise the first solution"], 1, "A quick scan lets you bank easy marks first."),
    mcq("The expected output is 2.33 and your program prints 2.3333. What is the likely verdict?", ["Accepted", "Wrong answer", "Compile error", "Time limit exceeded"], 1, "Judges compare text exactly unless the problem allows a tolerance."),
    mcq("With negative marking, when should you answer a multiple-choice question?", ["Always", "Never", "When you can eliminate options so that the chance of being right outweighs the penalty", "Only the last one"], 2, "Guess only when the expected value is positive.")
  ],
  tasks: [task("Partial Credit Score", "Read n and then n lines of the form marks passed total: a problem worth marks that passed passed of total hidden cases. Marks are earned in proportion to the cases passed. Print the total earned with 1 decimal, then a space, the word of, a space, and the maximum possible marks (an integer), for example 56.0 of 100.", "n = int(input())\nproblems = [tuple(map(int, input().split())) for _ in range(n)]\n# add up the proportional marks\n", `n = int(input())
problems = [tuple(map(int, input().split())) for _ in range(n)]
earned = sum(marks * passed / total for marks, passed, total in problems)
print(f"{earned:.1f} of {sum(p[0] for p in problems)}")`, [["3\n20 10 10\n30 7 10\n50 3 10", "56.0 of 100"], ["1\n10 0 5", "0.0 of 10"], ["2\n25 5 5\n25 5 5", "50.0 of 50"], ["2\n40 1 3\n60 2 3", "53.3 of 100"]])],
});

// ---------------------------------------------------------------- 2
{
  const set = [
    mc("E", "Which of these Python types is immutable?", ["list", "dict", "tuple", "set"], 2, "A tuple cannot be changed after it is created; lists, dictionaries and sets are mutable."),
    mc("E", "Which operator performs floor division?", ["/", "//", "%", "**"], 1, "// divides and rounds down; / is true division, % the remainder and ** the power."),
    mc("E", "What is the average time complexity of looking up a key in a dictionary?", ["O(1)", "O(log n)", "O(n)", "O(n log n)"], 0, "Hash tables find a key in constant time on average."),
    mc("E", "Which keyword turns a function into a generator function?", ["return", "yield", "lambda", "async"], 1, "A function containing yield returns a generator when called."),
    mc("E", "Which statement opens a file so that it is closed automatically?", ["open(path)", "with open(path) as f:", "file(path)", "read(path)"], 1, "The with statement calls the file's close method on exit, even after an error."),
    mc("E", "Which exception is raised by d['x'] when the key x is missing from the dictionary d?", ["IndexError", "KeyError", "ValueError", "AttributeError"], 1, "Missing dictionary keys raise KeyError; IndexError is for sequence positions."),
    mc("E", "What does PEP 8 describe?", ["A package index", "The Python style guide", "The GIL", "A test framework"], 1, "PEP 8 is the style guide for Python code."),
    mc("E", "Which module do you import to work with regular expressions?", ["regex", "re", "pattern", "string"], 1, "The standard library module is re."),
    mc("E", "Which of these is a valid Python variable name?", ["2count", "my-var", "_count2", "class"], 2, "Names cannot start with a digit, contain a hyphen, or be a keyword such as class."),
    mc("E", "What does len([1, [2, 3], 4]) return?", ["3", "4", "2", "5"], 0, "The list has three elements; the inner list counts as one element."),
    mc("M", "Which data structure follows last-in, first-out order?", ["Queue", "Stack", "Heap", "Set"], 1, "A stack returns the most recently added item first."),
    mc("M", "What is the time complexity of binary search on a sorted list of n items?", ["O(n)", "O(log n)", "O(n log n)", "O(1)"], 1, "The search range halves at every step."),
    mc("M", "What does the self parameter of an instance method refer to?", ["The class", "The current instance", "The module", "The parent class"], 1, "self is the object the method was called on."),
    mc("M", "What does the GIL do in CPython?", ["Lets many threads run Python bytecode at the same time", "Allows only one thread to run Python bytecode at a time", "Compiles Python to machine code", "Manages imports"], 1, "The global interpreter lock serialises bytecode execution, so CPU-bound threads do not run in parallel."),
    mc("M", "Which sorting algorithm does Python's sorted() use?", ["Quicksort", "Timsort", "Heap sort", "Bubble sort"], 1, "Timsort is a stable hybrid of merge sort and insertion sort."),
    mc("M", "What is a virtual environment used for?", ["Making code faster", "Isolating a project's dependencies", "Encrypting files", "Running Python in a browser"], 1, "Each project gets its own packages and versions."),
    mc("M", "Which statement about is and == is correct?", ["is compares values and == compares identity", "is compares identity and == compares values", "They are identical", "is only works with numbers"], 1, "is checks whether two names refer to the same object; == checks equality of value."),
    mc("M", "Which HTTP status code means that the requested resource was not found?", ["200", "301", "404", "500"], 2, "404 is Not Found."),
    mc("M", "In SQL, which clause filters the groups produced by GROUP BY?", ["WHERE", "HAVING", "ORDER BY", "LIMIT"], 1, "WHERE filters rows before grouping; HAVING filters groups after it."),
    mc("M", "Which SQL statement removes rows from a table but keeps the table itself?", ["DROP TABLE", "DELETE FROM", "DROP DATABASE", "ALTER TABLE"], 1, "DELETE FROM removes rows; DROP TABLE removes the table."),
    mc("M", "Which Git command creates a new branch and switches to it?", ["git branch -d x", "git switch -c x", "git merge x", "git stash x"], 1, "git switch -c x creates x and moves to it (git checkout -b x does the same)."),
    mc("M", "Which tool automatically formats Python code in a consistent style?", ["pytest", "black", "pip", "venv"], 1, "Black is an opinionated formatter."),
    mc("M", "What is the amortised time complexity of list.append?", ["O(1)", "O(n)", "O(log n)", "O(n^2)"], 0, "Occasional resizing is spread over many appends, so each costs constant time on average."),
    mc("M", "What does a decorator written as @d above def f do?", ["Calls f once", "Replaces f with d(f)", "Deletes f", "Makes f private"], 1, "The decorator syntax is shorthand for f = d(f)."),
    mc("M", "Which block always runs, whether or not an exception occurs?", ["except", "else", "finally", "try"], 2, "finally runs on every exit from the try statement."),
    mc("M", "Which approach avoids the mutable default argument bug?", ["def f(x, items=[])", "def f(x, items=None) and create the list inside the function", "def f(x, items=list)", "Use a global variable"], 1, "A default is evaluated once; None plus creation inside the function gives a fresh list each call."),
    mc("M", "What must every correct recursive function have?", ["A loop", "A base case", "A global variable", "A decorator"], 1, "Without a base case the recursion never stops."),
    mc("M", "Which statement about Python integers is true?", ["They overflow at 2**31", "They have arbitrary precision", "They are always 64-bit", "They cannot be negative"], 1, "Python integers grow as large as memory allows."),
    mc("H", "Which data structure gives O(log n) insertion and O(1) access to the smallest item?", ["Sorted list", "Binary heap", "Dictionary", "Stack"], 1, "A min-heap keeps the smallest item at the root; heapq implements it."),
    mc("H", "A function has two nested loops that each run n times over the same data. What is its time complexity?", ["O(n)", "O(n log n)", "O(n^2)", "O(2^n)"], 2, "n iterations of an inner loop of n iterations make n x n steps."),
  ];
  lessons.push({
    title: "Practice Set: Python Concepts and Computer Science Fundamentals (Multiple Choice)",
    minutes: 45,
    learn: ["Answer the standard technical multiple-choice questions asked in placement tests", "Review Python, data-structure, complexity, SQL, Git and web basics", "Practise eliminating wrong options and managing time"],
    why: "Technical multiple-choice sections reward broad, accurate fundamentals and speed. This set covers the topics that appear most often, with the reason for every answer.",
    set,
    revision: ["Immutable: int, float, str, tuple, frozenset, bytes.", "Dictionary and set lookups are O(1) on average; binary search is O(log n).", "is compares identity, == compares value.", "finally always runs; a base case ends recursion.", "WHERE filters rows, HAVING filters groups."],
    quiz: setQuiz(set),
    tasks: [task("Identifier Validator", "Read a line of words. For each word print the word and then valid if it is a legal Python variable name (letters, digits and underscores, not starting with a digit, and not a Python keyword) or invalid otherwise. One line per word.", "import keyword\nfor word in input().split():\n    # decide whether word is a valid identifier\n", `import keyword

for word in input().split():
    ok = word.isidentifier() and not keyword.iskeyword(word)
    print(word, "valid" if ok else "invalid")`, [["my_var 2fast class _ok for-me", "my_var valid\n2fast invalid\nclass invalid\n_ok valid\nfor-me invalid"], ["x", "x valid"], ["None True lambda", "None invalid\nTrue invalid\nlambda invalid"], ["a1 _ __x__", "a1 valid\n_ valid\n__x__ valid"]])],
  });
}

// ---------------------------------------------------------------- 3
{
  const set = [
    iq("E", `What does this print?`, `for i in range(3):\n    pass\nprint(i)`, `2`, [`3`, `0`, `Raises NameError`], `A for loop does not create a new scope; the loop variable keeps the last value it took.`, `The loop variable disappears after the loop, or equals the stop value.`, [`What if the range is empty?`, `The variable is never assigned, so using it raises NameError.`]),
    iq("E", `What does this print?`, `print("abc"[::-1], "abc"[1:], "abc"[-1], len("abc"[5:]))`, `cba bc c 0`, [`cba bc c Raises IndexError`, `abc bc c 0`, `cba abc c 3`], `A negative step reverses; a slice starting past the end is empty (no error), but a single out-of-range index would raise.`, `Any out-of-range slice raises IndexError.`, [`What does "abc"[5] do?`, `Raises IndexError.`]),
    iq("E", `What does this print?`, `x = 5\nx += x * 2\nprint(x)`, `15`, [`10`, `20`, `25`], `The right side x * 2 is 10 and is added to x: 5 + 10.`, `x += x * 2 doubles x.`, [`What is x *= 2 + 1?`, `x = x * 3, because the whole right side is evaluated first.`]),
    iq("E", `What does this print?`, `print(10 % 3, 10 // 3, 10 / 4, 2 ** -1)`, `1 3 2.5 0.5`, [`3 1 2.5 0.5`, `1 3 2 0.5`, `1 3 2.5 -2`], `% is the remainder, // floors, / is true division, and a negative exponent gives a fraction.`, `2 ** -1 equals -2.`, [`What type is 2 ** -1?`, `float.`]),
    iq("E", `What does this print?`, `s = "hello world"\nprint(s.title(), s.count("o"), s.find("z"), s.replace("l", "L", 2))`, `Hello World 2 -1 heLLo world`, [`Hello world 2 -1 heLLo world`, `Hello World 2 Raises ValueError heLLo world`, `Hello World 2 -1 heLLo worLd`], `title capitalises each word, find returns -1 when absent, and replace with a count of 2 changes only the first two matches.`, `replace changes the original string, or find raises on a missing substring.`, [`Which method raises when absent?`, `index.`]),
    iq("E", `What does this print?`, `a = [1, 2, 3]\na.insert(1, 9)\na.remove(3)\nprint(a, a.pop(), a.index(9))`, `[1, 9] 2 1`, [`[1, 9, 2] 2 1`, `[1, 9, 2] 2 2`, `[1, 9] 2 2`], `The arguments are evaluated left to right, but the first one is the list object itself, which pop() shortens before print runs, so it shows [1, 9].`, `print shows the list as it was when the first argument was evaluated.`, [`How do you print a snapshot?`, `Pass a copy: print(list(a), ...).`]),
    iq("M", `What does this print?`, `total = 0\nfor i in range(1, 6):\n    if i % 2 == 0:\n        continue\n    total += i\nelse:\n    total += 100\nprint(total)`, `109`, [`9`, `106`, `115`], `continue skips the even numbers (1 + 3 + 5 = 9), and the else block of a for loop runs when the loop ends without break, adding 100.`, `else on a loop runs only when the loop did not run at all, or only after break.`, [`When is the else skipped?`, `When the loop is left by break.`]),
    iq("M", `What does this print?`, `i = 0\nwhile i < 5:\n    i += 1\n    if i == 3:\n        break\nelse:\n    i = 99\nprint(i)`, `3`, [`99`, `5`, `4`], `break leaves the loop and skips the else block, so i stays 3.`, `while-else always runs the else.`, [`When does while-else run?`, `When the condition becomes false without a break.`]),
    iq("M", `What does this print?`, `count = 0\nfor i in range(3):\n    for j in range(i):\n        count += 1\nprint(count)`, `3`, [`6`, `9`, `2`], `The inner loop runs 0, 1 and 2 times: 0 + 1 + 2 = 3.`, `A nested loop always multiplies the two ranges (3 x 3).`, [`What is the complexity of this nested loop pattern?`, `O(n^2): n(n-1)/2 steps.`]),
    iq("M", `What does this print?`, `def f(n):\n    if n <= 1:\n        return 1\n    return n * f(n - 1)\n\nprint(f(5), f(1))`, `120 1`, [`24 1`, `120 0`, `15 1`], `f(5) is the factorial 5 x 4 x 3 x 2 x 1 and the base case f(1) is 1.`, `The base case returns 0.`, [`What happens for f(-3)?`, `The base case n <= 1 returns 1, so it stops, though a factorial of a negative number is undefined.`]),
    iq("M", `What does this print?`, `x = [1, 2, 3]\ny = x\nx = x + [4]\nprint(x, y)`, `[1, 2, 3, 4] [1, 2, 3]`, [`[1, 2, 3, 4] [1, 2, 3, 4]`, `[1, 2, 3] [1, 2, 3]`, `[1, 2, 3, 4] [4]`], `x + [4] builds a new list and rebinds x; y still refers to the old list.`, `+ always mutates the left list.`, [`How does += differ?`, `For lists += extends in place, so both names see the change.`]),
    iq("M", `What does this print?`, `x = [1, 2, 3]\ny = x\nx += [4]\nprint(x, y)`, `[1, 2, 3, 4] [1, 2, 3, 4]`, [`[1, 2, 3, 4] [1, 2, 3]`, `[1, 2, 3] [1, 2, 3, 4]`, `[4] [1, 2, 3, 4]`], `For lists, += calls the in-place extend, so the shared list changes.`, `x += y is always the same as x = x + y.`, [`Is that true for tuples?`, `No, tuples have no in-place +=, so a new tuple is created.`]),
    iq("M", `What does this print?`, `print("a" "b" * 2, ("a" "b") * 2)`, `abab abab`, [`ab abab`, `abb abab`, `abab ab`], `Adjacent string literals are joined at compile time into "ab" before the * is applied, so both expressions repeat "ab".`, `Multiplication binds tighter than literal joining, giving "a" + "bb".`, [`Where is adjacent-literal joining useful?`, `Splitting long messages over several lines inside brackets.`]),
    iq("M", `What does this print?`, `s = "Python"\nprint(s[1:4], s[:2] + s[-2:], s[::2], s.upper().lower() == s.lower())`, `yth Pyon Pto True`, [`yth Pyth Pto True`, `ytho Pyon Pto True`, `yth Pyon yhn True`], `s[1:4] is "yth"; the first two plus the last two letters are "Py" and "on"; every second letter from the start is P, t, o.`, `Slices include the stop index.`, [`What is s[::-2]?`, `"nhy": from the end, every second letter.`]),
    iq("M", `What does this print?`, `data = {"a": 1, "b": 2}\nfor k, v in data.items():\n    data[k] = v * 10\nprint(data)`, `{'a': 10, 'b': 20}`, [`Raises RuntimeError`, `{'a': 1, 'b': 2}`, `{'a': 10, 'b': 2}`], `Changing the values of existing keys while iterating is allowed; adding or removing keys is not.`, `Any change to a dictionary during iteration raises RuntimeError.`, [`What would data["c"] = 0 inside the loop do?`, `Raise RuntimeError: dictionary changed size during iteration.`]),
    iq("M", `What does this print?`, `print([i * j for i in range(1, 3) for j in range(1, 3)])`, `[1, 2, 2, 4]`, [`[1, 4]`, `[[1, 2], [2, 4]]`, `[1, 2, 4]`], `The first for is the outer loop: i = 1 gives 1 and 2, then i = 2 gives 2 and 4.`, `Nested comprehension clauses build a list of lists.`, [`How do you build a list of lists?`, `[[i * j for j in range(1, 3)] for i in range(1, 3)].`]),
    iq("M", `What does this print?`, `print(list(map(lambda p: p[0] + p[1], zip([1, 2], [10, 20]))))`, `[11, 22]`, [`[1, 10, 2, 20]`, `[11, 22, 33]`, `[(1, 10), (2, 20)]`], `zip pairs the items, and the lambda adds the two numbers of each pair.`, `zip concatenates the lists.`, [`What does zip do with lists of unequal length?`, `It stops at the shortest one.`]),
    iq("M", `What does this print?`, `def f(x, acc=[]):\n    acc.append(x)\n    return len(acc)\n\nprint(f(1), f(2), f(3, []))`, `1 2 1`, [`1 1 1`, `1 2 3`, `1 2 2`], `The first two calls share the default list; the third passes its own new list.`, `Each call gets a fresh default list.`, [`What is the fix?`, `acc=None and create the list inside.`]),
    iq("M", `What does this print?`, `names = ["bo", "al", "cy"]\nnames.sort(key=lambda s: s[1])\nprint(names, max(names), min(names, key=len))`, `['al', 'bo', 'cy'] cy al`, [`['bo', 'al', 'cy'] cy bo`, `['al', 'bo', 'cy'] bo al`, `['cy', 'bo', 'al'] cy al`], `The key is the second letter (l, o, y), which orders the list al, bo, cy. max compares whole strings and picks cy; min by length returns the first of equal lengths.`, `max and min with no key use the order of the list.`, [`Is min stable for ties?`, `It returns the first minimal item it meets.`]),
    iq("H", `What does this print?`, `print(bool("False"), bool(0.0), bool([[]]), bool(None), bool(()))`, `True False True False False`, [`False False True False False`, `True False False False False`, `True True True False False`], `A non-empty string is truthy whatever it says; 0.0, None and empty containers are falsy; a list holding an empty list is non-empty.`, `bool("False") is False, or [[]] is falsy.`, [`How do you convert the text "False" to a bool?`, `Compare it: s.lower() == "true".`]),
    iq("H", `What does this print?`, `a = b = [0]\na.append(1)\nb = b + [2]\nprint(a, b)`, `[0, 1] [0, 1, 2]`, [`[0, 1] [0, 1]`, `[0] [0, 2]`, `[0, 1, 2] [0, 1, 2]`], `Both names start on one list. append changes it; b + [2] creates a new list for b only.`, `a and b stay linked forever.`, [`What does a is b give at the end?`, `False.`]),
    iq("H", `What does this print?`, `x = 10\n\ndef f():\n    x = 20\n\n    def g():\n        nonlocal x\n        x += 1\n        return x\n\n    return g()\n\nprint(f(), x)`, `21 10`, [`21 21`, `11 10`, `20 10`], `nonlocal x in g refers to the x of f (20), not the global one, so g returns 21 and the global stays 10.`, `nonlocal changes the global variable.`, [`Which keyword changes the global?`, `global.`]),
    iq("H", `What does this print?`, `print(sum(i for i in range(10) if i % 3 == 0), sum([[1, 2], [3]], []))`, `18 [1, 2, 3]`, [`18 6`, `12 [1, 2, 3]`, `18 Raises TypeError`], `The multiples of 3 below 10 are 0, 3, 6, 9 (sum 18). sum with a list as the start value concatenates the lists (it works but is quadratic).`, `sum only works on numbers.`, [`What is a faster way to flatten?`, `itertools.chain.from_iterable or a nested comprehension.`]),
    iq("H", `What does this print?`, `s = {1, 2, 3}\nt = {3, 4}\nprint(s | t, s & t, s - t, s ^ t)`, `{1, 2, 3, 4} {3} {1, 2} {1, 2, 4}`, [`{1, 2, 3, 4} {3} {1, 2} {1, 2, 3, 4}`, `{1, 2, 3, 3, 4} {3} {1, 2} {1, 2, 4}`, `{1, 2, 3, 4} {3, 4} {1, 2} {1, 2, 4}`], `| is union, & intersection, - difference and ^ the symmetric difference (in exactly one of the sets).`, `^ means power for sets as for numbers.`, [`What is the complexity of s & t?`, `O(min(len(s), len(t))).`]),
  ];
  lessons.push({
    title: "Practice Set: Output Prediction for Placement Tests",
    minutes: 45,
    learn: ["Trace short programs accurately, as in placement test output questions", "Spot the classic traps: loop variables, aliasing, default arguments, chained slicing", "Work quickly without running code"],
    why: "Output-prediction questions are in nearly every technical multiple-choice round. They reward careful, systematic tracing, and each wrong option is a mistake you can learn to avoid.",
    set,
    revision: ["A for loop variable survives the loop; loop-else runs only without break.", "+ makes a new list, += changes it in place.", "Defaults are evaluated once.", "Slices never raise for out-of-range bounds; indexes do.", "Arguments of print are evaluated left to right, but mutable objects print their final state."],
    quiz: setQuiz(set),
    tasks: [task("Operator Precedence Evaluator", "Read an arithmetic expression made of integers and the operators + - * // % ** (spaces between tokens, no brackets; unary minus only at the start of a number such as -7). Print its value using Python's precedence rules, where ** binds tightest and is right-associative, then * // %, then + and -.", "import ast\nexpression = input()\n# evaluate it with Python precedence, without eval\n", `import ast
import operator

OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
}


def evaluate(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -evaluate(node.operand)
    if isinstance(node, ast.BinOp):
        return OPS[type(node.op)](evaluate(node.left), evaluate(node.right))
    raise ValueError("unsupported")


print(evaluate(ast.parse(input(), mode="eval").body))`, [["2 ** 3 ** 2", "512"], ["-7 // 2 + 7 % 3", "-3"], ["2 + 3 * 4", "14"], ["10 - 2 - 3", "5"]])],
  });
}

module.exports = { lessons };
