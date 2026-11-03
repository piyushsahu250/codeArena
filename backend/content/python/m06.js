// Phase 1 / Module 6: Loops and Iterations.
"use strict";
const { chain, graph, table } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];
const tableLines = (n) => Array.from({ length: 10 }, (_, i) => `${n} x ${i + 1} = ${n * (i + 1)}`).join("\n");

// ---------------------------------------------------------------- 1
lessons.push({
  title: "The for Loop and range()",
  minutes: 40,
  learn: ["Repeat work with for over sequences and over range()", "Use start, stop and step in range()", "Accumulate a total or a count in a loop", "Draw and trace the flow of a for loop"],
  why: "Computers are good at repetition. Any time you handle many items (marks of 60 students, characters of a string, rows of a file) you need a loop.",
  realWorld: "Printing every student's result, adding up a month of expenses, checking every character of a password.",
  simple: "<code>for item in collection:</code> takes the items one at a time, runs the indented block for each, and stops after the last. <code>range(n)</code> makes the numbers 0 to n-1 for counting.",
  detail: `<h3>Looping over things</h3>
<p>You can loop over a string (characters), a list (items), a dictionary (keys), a file (lines) and any other <em>iterable</em>. The loop variable takes each value in turn.</p>
<h3>range()</h3>
${table(["Call", "Numbers produced"], [["range(5)", "0, 1, 2, 3, 4"], ["range(2, 6)", "2, 3, 4, 5"], ["range(0, 10, 3)", "0, 3, 6, 9"], ["range(5, 0, -1)", "5, 4, 3, 2, 1"], ["range(0)", "nothing"]])}
<p>The <strong>stop value is excluded</strong>. <code>range</code> does not build a list: it produces numbers on demand, so <code>range(10**9)</code> uses almost no memory. Use <code>list(range(5))</code> only when you need to see the numbers.</p>
<h3>The accumulator pattern</h3>
<p>Start a variable before the loop (<code>total = 0</code>), update it inside, use it after the loop. The same shape counts things (<code>count += 1</code>), finds products and builds strings.</p>
<h3>The loop variable</h3>
<p>It remains after the loop ends, holding the last value. Do not change it inside the body to &quot;skip ahead&quot;; use <code>continue</code> or a <code>while</code> loop instead.</p>`,
  syntax: { code: `for item in iterable:\n    block\nfor i in range(start, stop, step):\n    block`, note: "stop is not included." },
  diagram: graph("Flow of a for loop", "Flow: start, are there items left? yes: run the body, take the next item, ask again. no: end.", 560, 250,
    [{ id: "s", k: "term", t: "Start", x: 130, y: 28, w: 100, h: 36 }, { id: "d", k: "dec", t: "items left?", x: 130, y: 100, w: 150, h: 60 }, { id: "b", k: "proc", t: "run the body", x: 400, y: 100, w: 150, h: 44 }, { id: "n", k: "proc", t: "take next item", x: 400, y: 190, w: 160, h: 44 }, { id: "e", k: "term", t: "End", x: 130, y: 205, w: 100, h: 36 }],
    [{ from: "s", to: "d" }, { from: "d", to: "b", label: "yes" }, { from: "b", to: "n" }, { from: "n", to: "d" }, { from: "d", to: "e", label: "no", dx: 8 }]),
  example: { code: `for ch in "PY":\n    print(ch)\nfor i in range(1, 4):\n    print("i =", i)\ntotal = 0\nfor n in range(1, 6):\n    total += n\nprint("sum:", total)\nprint(list(range(10, 0, -3)))`, out: `P\nY\ni = 1\ni = 2\ni = 3\nsum: 15\n[10, 7, 4, 1]` },
  lineByLine: [["for ch in \"PY\":", "Takes the characters P and Y in turn."], ["for i in range(1, 4):", "i is 1, then 2, then 3: the stop 4 is excluded."], ["total = 0 ... total += n", "The accumulator starts at 0 and grows by each n."], ["range(10, 0, -3)", "Counts down by 3 and stops before reaching 0."]],
  dryRun: { intro: "Tracing the sum loop:", headers: ["n", "total before", "total after"], rows: [["1", "0", "1"], ["2", "1", "3"], ["3", "3", "6"], ["4", "6", "10"], ["5", "10", "15"]] },
  realExample: { intro: "Average of the marks of three students entered one per line. Input: 70, 85, 90.", code: `total = 0\nfor _ in range(3):\n    total += int(input())\nprint(round(total / 3, 2))`, out: `81.67`, stdin: "70\n85\n90" },
  mistakes: ["Expecting <code>range(5)</code> to include 5.", "Forgetting to initialise the accumulator before the loop.", "Resetting the accumulator inside the loop.", "Using <code>range(len(x))</code> when you do not need the index.", "Modifying a list while looping over it."],
  practices: ["Loop over the items directly (<code>for name in names</code>) rather than over indexes.", "Use <code>_</code> as the name when the value is not needed.", "Pick meaningful loop names: <code>for student in students</code>."],
  interview: ["What does range(1, 10, 2) produce?", "Is range a list?", "How do you loop in reverse?", "What is the loop variable's value after the loop ends?"],
  practiceQs: ["Print the squares of 1 to 5.", "Print the even numbers from 2 to 20.", "Count how many letters 'a' are in \"banana\" with a loop.", "Predict list(range(5, 0, -2))."],
  revision: ["for x in iterable.", "range(start, stop, step), stop excluded.", "Accumulator: init, update, use.", "range is lazy."],
  hinglish: "for loop collection ke har item ke liye ek baar block chalata hai. range(1, 4) mein 1, 2, 3 aate hain, 4 nahi. Total jodne ke liye pehle total = 0 likho, loop mein += karo.",
  quiz: [
    mcq("What does list(range(2, 8, 2)) give?", ["[2, 4, 6, 8]", "[2, 4, 6]", "[2, 8]", "[4, 6]"], 1, "Stop 8 is excluded.", "OUTPUT_PREDICTION"),
    mcq("How many times does for i in range(5): run?", ["4", "5", "6", "Forever"], 1, "i takes 0, 1, 2, 3, 4."),
    mcq("What is printed?\n\ns = 0\nfor i in range(3):\n    s += i\nprint(s)", ["3", "6", "0", "2"], 0, "0 + 1 + 2 = 3.", "OUTPUT_PREDICTION"),
    mcq("What does range(0) produce?", ["[0]", "Nothing", "An error", "[]0"], 1, "An empty sequence: the loop body never runs."),
    mcq("What is wrong?\n\nfor i in range(3):\n    total = 0\n    total += i\nprint(total)", ["The accumulator is reset on every pass", "range is invalid", "print is indented", "Nothing"], 0, "total = 0 must be placed before the loop.", "DEBUG"),
  ],
  tasks: [
    task("Sum of first n numbers", "Read n. Print the sum 1 + 2 + ... + n using a loop.", "n = int(input())\ntotal = 0\n# add 1..n\n", `n = int(input())\ntotal = 0\nfor i in range(1, n + 1):\n    total += i\nprint(total)`, [["5", "15"], ["10", "55"]], [["5", "15"], ["10", "55"], ["1", "1"], ["0", "0"], ["100", "5050"]]),
    task("Multiplication table", "Read n. Print its table from 1 to 10, one line each, in the form: 3 x 1 = 3", "n = int(input())\n# print 10 lines\n", `n = int(input())\nfor i in range(1, 11):\n    print(f"{n} x {i} = {n * i}")`, [["3", tableLines(3)], ["12", tableLines(12)]], [["3", tableLines(3)], ["12", tableLines(12)], ["1", tableLines(1)], ["7", tableLines(7)]]),
  ],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "The while Loop and Infinite Loops",
  minutes: 40,
  learn: ["Repeat while a condition holds", "Choose between for and while", "Avoid and fix infinite loops", "Use a sentinel value or a counter to stop"],
  why: "When you do not know in advance how many repetitions are needed (read until the user types stop, keep guessing, halve a number until it is 1), <code>while</code> is the right tool.",
  realWorld: "A game loop runs until the player quits; a program retries a network call until it succeeds; a menu repeats until &quot;Exit&quot;.",
  simple: "<code>while condition:</code> checks the condition, runs the block, checks again, and stops the first time the condition is false. Something inside the block <strong>must change</strong> so that it can become false.",
  detail: `<h3>for versus while</h3>
${table(["Use for when", "Use while when"], [["you have a collection or a known count", "you repeat until something happens"], ["for item in items", "while balance > 0"], ["for i in range(10)", "while not done"]])}
<h3>The three parts of a safe while loop</h3>
<ol><li><strong>Initialise</strong> the variable the condition uses.</li><li><strong>Test</strong> it in the condition.</li><li><strong>Update</strong> it in the body, in a way that moves toward stopping.</li></ol>
<h3>Infinite loops</h3>
<p>Forgetting the update gives a loop that never ends. In a terminal press <strong>Ctrl+C</strong> to stop it. <code>while True:</code> is a deliberate infinite loop that must contain a <code>break</code>; it is common for menus and input validation.</p>
<h3>Digit loops</h3>
<p>Repeating <code>n % 10</code> (take the last digit) and <code>n //= 10</code> (drop it) while <code>n &gt; 0</code> processes every digit of a number: sum, count, reverse.</p>
<h3>Sentinel value</h3>
<p>A special input meaning &quot;stop&quot; (for example <code>0</code> or <code>"done"</code>) ends a read-until loop.</p>`,
  syntax: { code: `while condition:\n    block   # must change something the condition depends on\nwhile True:\n    ...\n    if stop:\n        break`, note: "Ctrl+C interrupts a runaway loop." },
  diagram: graph("Flow of a while loop", "Flow: start, test the condition; true: run the body (which updates something) and test again; false: end.", 520, 200,
    [{ id: "s", k: "term", t: "Start", x: 110, y: 28, w: 100, h: 36 }, { id: "c", k: "dec", t: "condition\ntrue?", x: 110, y: 110, w: 150, h: 64 }, { id: "b", k: "proc", t: "body +\nupdate", x: 380, y: 110, w: 130, h: 54 }, { id: "e", k: "term", t: "End", x: 110, y: 180, w: 100, h: 34 }],
    [{ from: "s", to: "c" }, { from: "c", to: "b", label: "yes" }, { from: "b", to: "s", label: "again", dx: -50 }, { from: "c", to: "e", label: "no" }]),
  example: { code: `n = int(input())\ntotal = 0\ncount = 0\nwhile n > 0:\n    total += n % 10\n    count += 1\n    n //= 10\nprint(total, count)`, out: `10 4`, stdin: "1234" },
  lineByLine: [["while n > 0:", "Continue while digits remain."], ["total += n % 10", "Adds the last digit."], ["n //= 10", "Removes the last digit: the update that guarantees the loop ends."], ["print(total, count)", "Sum of digits and number of digits."]],
  dryRun: { intro: "Input 1234:", headers: ["n at test", "n > 0", "digit n % 10", "total", "count", "n after"], rows: [["1234", "True", "4", "4", "1", "123"], ["123", "True", "3", "7", "2", "12"], ["12", "True", "2", "9", "3", "1"], ["1", "True", "1", "10", "4", "0"], ["0", "False", "-", "10", "4", "stop"]] },
  realExample: { intro: "Read numbers until 0 is typed and report their sum (the 0 is the sentinel). Input: 5, 12, 3, 0.", code: `total = 0\nnumber = int(input())\nwhile number != 0:\n    total += number\n    number = int(input())\nprint("Total:", total)`, out: `Total: 20`, stdin: "5\n12\n3\n0" },
  mistakes: ["Forgetting the update, creating an infinite loop.", "Updating in the wrong direction (<code>i -= 1</code> while the condition is <code>i &lt; 10</code>).", "Off-by-one: <code>&lt;</code> versus <code>&lt;=</code>.", "Reading the next value before the first test (the sentinel pattern needs one read before the loop and one at the end of the body).", "Using while where a simple for over a collection is clearer."],
  practices: ["Write the condition, the initialisation and the update together when you start.", "Put a temporary counter or print inside when debugging a loop.", "Prefer <code>for</code> when iterating a collection."],
  interview: ["Difference between for and while?", "How do you avoid an infinite loop?", "How do you extract the digits of a number?", "What does while True do?"],
  practiceQs: ["Count the digits of 90210 with a while loop.", "Print 10, 8, 6, 4, 2 using while.", "How can you tell an infinite loop in the output?", "Rewrite the sum-until-0 loop with while True and break."],
  revision: ["while condition: body.", "Initialise, test, update.", "Ctrl+C stops a runaway loop.", "n % 10 last digit, n // 10 drop it."],
  hinglish: "while tab tak chalta hai jab tak condition true ho. Body mein condition ko badalne wali cheez zaroor honi chahiye, warna loop kabhi nahi rukta. Number ke digits ke liye n % 10 aur n //= 10 use karo.",
  quiz: [
    mcq("What happens if the loop body never changes the variable in the condition?", ["The loop ends at once", "Possible infinite loop", "SyntaxError", "The loop runs once"], 1, "The condition never becomes false."),
    mcq("What does this print?\n\ni = 3\nwhile i > 0:\n    print(i)\n    i -= 1", ["3 2 1 (one per line)", "1 2 3", "3 2 1 0", "Nothing"], 0, "It counts down while i is positive.", "OUTPUT_PREDICTION"),
    mcq("What is n // 10 for n = 457?", ["45", "7", "457", "4"], 0, "Floor division drops the last digit.", "OUTPUT_PREDICTION"),
    mcq("Which key interrupts a runaway program in the terminal?", ["Ctrl+C", "Ctrl+S", "Esc", "Tab"], 0, "Ctrl+C sends KeyboardInterrupt."),
    mcq("Find the bug:\n\ni = 0\nwhile i < 5:\n    print(i)", ["i never changes: infinite loop", "print is wrong", "i should be a string", "No bug"], 0, "There is no update step.", "DEBUG"),
  ],
  tasks: [task("Digit sum", "Read a non-negative integer. Print the sum of its digits using a while loop.", "n = int(input())\n# sum the digits\n", `n = int(input())\ntotal = 0\nwhile n > 0:\n    total += n % 10\n    n //= 10\nprint(total)`, [["1234", "10"], ["9", "9"]], [["1234", "10"], ["9", "9"], ["100", "1"], ["999", "27"], ["0", "0"], ["90210", "12"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Nested Loops and Pattern Printing",
  minutes: 45,
  learn: ["Place one loop inside another", "Predict how many times the inner body runs", "Print triangles, squares and number patterns", "Use end= and string repetition for patterns"],
  why: "Tables, grids, pairs and matrices all need two nested levels. Pattern problems are standard warm-up questions in tests and build exactly this skill.",
  realWorld: "A seating chart (rows and seats), a timetable (days and periods), comparing every pair of items.",
  simple: "For each step of the <strong>outer</strong> loop, the <strong>inner</strong> loop runs completely. If the outer loop runs 3 times and the inner 4 times, the inner body runs 12 times in total.",
  detail: `<h3>Counting repetitions</h3>
${table(["Outer", "Inner", "Inner body runs"], [["3 times", "4 times each", "3 &times; 4 = 12"], ["n times", "i times on round i", "1 + 2 + ... + n = n(n+1)/2"], ["n times", "n times", "n&sup2;"]])}
<h3>Printing patterns</h3>
<ul><li>Rows come from the <strong>outer</strong> loop; columns from the <strong>inner</strong> loop.</li><li>Print a whole row with <code>print("*" * i)</code> or build it with <code>print("*", end="")</code> in the inner loop and an empty <code>print()</code> to finish the row.</li><li>Spaces for pyramids: <code>" " * (n - i) + "*" * (2 * i - 1)</code>.</li></ul>
<h3>Two variables, two names</h3>
<p>Use different loop variables (<code>i</code>, <code>j</code>, or better <code>row</code>, <code>col</code>). Reusing one name in both loops is a bug.</p>`,
  syntax: { code: `for row in range(rows):\n    for col in range(cols):\n        ...\n    print()   # end of row`, note: "The inner loop finishes before the outer loop moves on." },
  diagram: chain("Nested loop order", "Vertical flow: outer loop picks a row; inner loop runs through every column of that row; then a new line; then the next row.",
    [{ k: "proc", t: "outer: next row" }, { k: "proc", t: "inner: every column of the row" }, { k: "io", t: "print()  (end the row)" }, { k: "dec", t: "more rows?" }], { vertical: true, w: 250, hgt: 40, gap: 22 }),
  example: { code: `for row in range(1, 4):\n    for col in range(1, row + 1):\n        print(col, end="")\n    print()\nfor row in range(1, 4):\n    print(" " * (3 - row) + "*" * (2 * row - 1))`, out: `1\n12\n123\n  *\n ***\n*****` },
  lineByLine: [["for row in range(1, 4):", "Rows 1, 2, 3."], ["for col in range(1, row + 1):", "Row r prints r numbers: the inner range depends on the outer variable."], ["print(col, end=\"\")", "Stays on the same line."], ["print()", "Moves to the next line after each row."], ["\" \" * (3 - row) + \"*\" * (2 * row - 1)", "Leading spaces shrink while the stars grow by 2 per row: a pyramid."]],
  dryRun: { intro: "The number triangle:", headers: ["row", "inner col values", "line printed"], rows: [["1", "1", "1"], ["2", "1, 2", "12"], ["3", "1, 2, 3", "123"]] },
  realExample: { intro: "A 3 by 4 multiplication grid, columns aligned.", code: `for r in range(1, 4):\n    for c in range(1, 5):\n        print(f"{r * c:3}", end="")\n    print()`, out: `  1  2  3  4\n  2  4  6  8\n  3  6  9 12` },
  mistakes: ["Using the same loop variable name in both loops.", "Forgetting the empty <code>print()</code> that ends a row.", "Wrong inner bound: <code>range(row)</code> instead of <code>range(row + 1)</code>.", "Indenting <code>print()</code> inside the inner loop, which prints a newline after each item.", "Writing O(n&sup2;) code on large data without noticing."],
  practices: ["Sketch the pattern on paper with row and column numbers first.", "Name the variables <code>row</code> and <code>col</code>.", "Use string repetition for simple patterns instead of an inner loop."],
  interview: ["How many times does the inner body run in two nested loops of n?", "Print a number pyramid.", "What is the time complexity of nested loops over the same list?"],
  practiceQs: ["Print a 4x4 square of stars.", "Print an inverted right triangle of height 4.", "How many times does print run in: for i in range(5): for j in range(i): print()?", "Print the pattern 1, 22, 333, 4444."],
  revision: ["Inner loop completes per outer step.", "rows = outer, columns = inner.", "end=\"\" keeps the line; print() ends it.", "Total runs = product (or a sum like 1+2+...+n)."],
  hinglish: "Nested loop mein outer loop ke har step par inner loop poora chalta hai. Pattern mein rows outer loop se aur columns inner loop se aate hain. Row khatam hone par khali print() likhna mat bhoolo.",
  quiz: [
    mcq("How many times does print run?\n\nfor i in range(3):\n    for j in range(4):\n        print(i, j)", ["7", "12", "3", "4"], 1, "3 x 4 = 12.", "OUTPUT_PREDICTION"),
    mcq("What does print(\"*\" * 3) output?", ["***", "* * *", "3*", "Error"], 0, "String repetition.", "OUTPUT_PREDICTION"),
    mcq("What does an empty print() do?", ["Prints nothing, not even a newline", "Prints a blank line (a newline)", "Raises an error", "Prints None"], 1, "It outputs just the newline."),
    mcq("For n = 4, how many stars are printed by: for i in range(1, n+1): print('*' * i)?", ["4", "10", "16", "8"], 1, "1 + 2 + 3 + 4 = 10.", "OUTPUT_PREDICTION"),
    mcq("What is wrong?\n\nfor i in range(3):\n    for i in range(3):\n        print(i)", ["Inner loop reuses the name i", "range is wrong", "print is wrong", "Nothing"], 0, "The inner loop overwrites the outer variable.", "DEBUG"),
  ],
  tasks: [task("Number triangle", "Read n. Print n rows: row i contains the numbers 1 to i written together with no spaces (for example 1, 12, 123 ...).", "n = int(input())\n# print the triangle\n", `n = int(input())\nfor row in range(1, n + 1):\n    for col in range(1, row + 1):\n        print(col, end="")\n    print()`, [["3", "1\n12\n123"], ["4", "1\n12\n123\n1234"]], [["3", "1\n12\n123"], ["4", "1\n12\n123\n1234"], ["1", "1"], ["5", "1\n12\n123\n1234\n12345"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "break, continue, pass and Loop else",
  minutes: 40,
  learn: ["Leave a loop early with break", "Skip one pass with continue", "Use pass as a placeholder", "Use the loop else clause to detect &quot;not found&quot;"],
  why: "Searching and validation often need to stop as soon as the answer is known. These four keywords give precise control over loops.",
  realWorld: "Stop reading as soon as a matching record is found; skip blank lines in a file; stub out a function you will write later.",
  simple: "<code>break</code> leaves the loop. <code>continue</code> jumps to the next pass. <code>pass</code> does nothing (a placeholder). A loop's <code>else</code> runs only if the loop finished <em>without</em> hitting <code>break</code>.",
  detail: `${table(["Keyword", "Effect", "Typical use"], [["break", "Exit the nearest loop immediately", "Found it; stop searching"], ["continue", "Skip the rest of this pass; go to the next", "Ignore invalid items"], ["pass", "Do nothing", "Empty block that must exist"], ["loop else", "Runs when the loop ends normally (no break)", "&quot;Not found&quot; and &quot;is prime&quot; logic"]])}
<h3>The for-else pattern</h3>
<p>Think of <code>else</code> as <em>no break</em>: &quot;if the loop never broke out, do this&quot;. It replaces the usual flag variable. A prime test is the classic example: if no divisor is found (no break), the number is prime.</p>
<h3>Only the nearest loop</h3>
<p><code>break</code> and <code>continue</code> affect only the innermost loop they are in. To leave nested loops, put them in a function and <code>return</code> (Module 8) or use a flag.</p>
<h3>Optimisation: stop early</h3>
<p>A prime test only needs to check divisors up to the square root of n. If n has a divisor larger than its square root, it also has one smaller, so checking beyond is wasted work.</p>`,
  syntax: { code: `for x in items:\n    if bad(x):\n        continue\n    if found(x):\n        break\nelse:\n    print("not found")\nclass Empty:\n    pass`, note: "else belongs to the loop, not to the if." },
  diagram: graph("break and continue", "Flow: take next item; found? yes: break out of the loop; no: skip? yes: continue to the next item; otherwise do the rest of the body, then take the next item.", 640, 260,
    [{ id: "n", k: "proc", t: "next item", x: 100, y: 130, w: 120, h: 44 }, { id: "f", k: "dec", t: "found?", x: 280, y: 60, w: 110, h: 56 }, { id: "br", k: "io", t: "break: leave loop", x: 520, y: 60, w: 170, h: 40 }, { id: "k", k: "dec", t: "skip it?", x: 280, y: 150, w: 120, h: 56 }, { id: "r", k: "proc", t: "rest of body", x: 280, y: 232, w: 130, h: 40 }, { id: "c", k: "io", t: "continue: next pass", x: 520, y: 150, w: 170, h: 40 }],
    [{ from: "n", to: "f" }, { from: "f", to: "br", label: "yes" }, { from: "f", to: "k", label: "no" }, { from: "k", to: "c", label: "yes" }, { from: "k", to: "r", label: "no" }]),
  example: { code: `for n in range(1, 8):\n    if n == 3:\n        continue\n    if n == 6:\n        break\n    print(n)\nfor n in [4, 6, 8]:\n    if n % 2 == 1:\n        print("found odd", n)\n        break\nelse:\n    print("no odd number")`, out: `1\n2\n4\n5\nno odd number` },
  lineByLine: [["if n == 3: continue", "3 is skipped; the loop carries on with 4."], ["if n == 6: break", "At 6 the loop ends, so 6 and 7 are never printed."], ["for ... else:", "The list has no odd number, the loop never broke, so the else block runs."]],
  dryRun: { intro: "First loop:", headers: ["n", "n == 3", "n == 6", "printed"], rows: [["1", "F", "F", "1"], ["2", "F", "F", "2"], ["3", "T (continue)", "-", "-"], ["4", "F", "F", "4"], ["5", "F", "F", "5"], ["6", "F", "T (break)", "-"]] },
  realExample: { intro: "Prime test with for-else, checking divisors only up to the square root. Input: 97.", code: `n = int(input())\nif n < 2:\n    print("Not prime")\nelse:\n    d = 2\n    while d * d <= n:\n        if n % d == 0:\n            print("Not prime")\n            break\n        d += 1\n    else:\n        print("Prime")`, out: `Prime`, stdin: "97" },
  mistakes: ["Thinking the loop <code>else</code> belongs to the nearest <code>if</code>.", "Expecting <code>break</code> to leave all nested loops.", "Using <code>continue</code> in a <code>while</code> before the update, creating an infinite loop.", "Forgetting that 1 is not prime and 2 is.", "Leaving <code>pass</code> in finished code."],
  practices: ["Use for-else instead of a flag variable when it reads clearly; add a comment because many people do not know it.", "In <code>while</code> loops, make sure <code>continue</code> cannot skip the update.", "Stop early when the answer is known."],
  interview: ["What does the else of a for loop mean?", "Difference between break and continue?", "Write a prime check; why stop at the square root?", "What is pass for?"],
  practiceQs: ["Print numbers 1 to 10 but skip multiples of 3.", "Find the first number divisible by 7 after 50 and stop.", "Why does the prime check with while d * d <= n need the else attached to the while?", "Which numbers does range(10) print if you break at 4?"],
  revision: ["break leaves; continue skips; pass does nothing.", "Loop else = no break happened.", "Only the innermost loop is affected.", "Primes: test up to sqrt(n)."],
  hinglish: "break loop ko turant rok deta hai, continue current round chhod kar agle round par jata hai, pass kuch nahi karta. Loop ka else tab chalta hai jab loop bina break ke poora khatam ho.",
  quiz: [
    mcq("What does continue do?", ["Leaves the loop", "Skips to the next pass", "Restarts the program", "Does nothing"], 1, "It jumps to the next iteration."),
    mcq("When does a for loop's else block run?", ["Always", "Only if the loop did not break", "Only if the loop broke", "Never"], 1, "else = no break."),
    mcq("What is printed?\n\nfor i in range(5):\n    if i == 2:\n        break\n    print(i)", ["0 1", "0 1 2", "2", "0 1 2 3 4"], 0, "The loop stops at 2 before printing it.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nfor i in range(4):\n    if i % 2 == 0:\n        continue\n    print(i)", ["1 3", "0 2", "0 1 2 3", "2"], 0, "Even numbers are skipped.", "OUTPUT_PREDICTION"),
    mcq("Is 1 a prime number?", ["Yes", "No", "Only in Python", "Depends"], 1, "Primes have exactly two divisors; 1 has one."),
  ],
  tasks: [task("Prime or not", "Read an integer n. Print Prime if it is a prime number, otherwise Not prime. Numbers below 2 are not prime.", "n = int(input())\n# print Prime or Not prime\n", `n = int(input())\nif n < 2:\n    print("Not prime")\nelse:\n    d = 2\n    while d * d <= n:\n        if n % d == 0:\n            print("Not prime")\n            break\n        d += 1\n    else:\n        print("Prime")`, [["97", "Prime"], ["100", "Not prime"]], [["97", "Prime"], ["100", "Not prime"], ["2", "Prime"], ["1", "Not prime"], ["0", "Not prime"], ["49", "Not prime"], ["3", "Prime"], ["7919", "Prime"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Iteration Patterns: Count, Total, Max/Min, Search and Flags",
  minutes: 40,
  learn: ["Recognise the five standard loop patterns", "Find the largest and smallest value without max/min", "Search for a value and report its position", "Use enumerate to get index and value together"],
  why: "Nearly every loop you will ever write is a variation of five patterns. Seeing them by name makes problems quicker and fewer bugs.",
  realWorld: "Reports compute totals and averages; leaderboards find the maximum; a search box looks for a match.",
  simple: "Counter: how many? Accumulator: what is the total? Extreme: which is largest or smallest? Search: is it there and where? Flag: did something happen?",
  detail: `${table(["Pattern", "Start with", "Update inside"], [["Counter", "<code>count = 0</code>", "<code>if condition: count += 1</code>"], ["Accumulator", "<code>total = 0</code>", "<code>total += value</code>"], ["Maximum", "the first value (not 0!)", "<code>if value &gt; best: best = value</code>"], ["Minimum", "the first value", "<code>if value &lt; best: best = value</code>"], ["Search", "<code>position = -1</code>", "<code>if value == target: position = index; break</code>"], ["Flag", "<code>found = False</code>", "<code>found = True</code>"]])}
<h3>Why start max with the first value?</h3>
<p>If every number is negative, starting at 0 would wrongly report 0 as the largest. Start from the first real value.</p>
<h3>enumerate</h3>
<p><code>for index, value in enumerate(values):</code> gives both the position and the item without managing a counter. <code>enumerate(values, start=1)</code> numbers from 1.</p>
<h3>Reading n values</h3>
<p>Many problems give n first and then n lines: read n, then loop <code>range(n)</code> reading with <code>input()</code>. When all values are on one line use <code>list(map(int, input().split()))</code>.</p>`,
  syntax: { code: `for i, value in enumerate(values, start=1):\n    ...\nbest = values[0]\nfor v in values:\n    if v > best:\n        best = v`, note: "Initialise from the data, not from a guess." },
  diagram: chain("Finding the maximum", "Four steps left to right: start best as the first value, look at the next value, if larger replace best, repeat until the end.",
    [{ k: "proc", t: "best = first\nvalue" }, { k: "proc", t: "look at\nnext value" }, { k: "dec", t: "larger than\nbest?" }, { k: "proc", t: "best = value" }], { w: 130, gap: 30, hgt: 60 }),
  example: { code: `values = [4, -2, 9, 7]\nbest = values[0]\nsmallest = values[0]\ntotal = 0\nevens = 0\nfor v in values:\n    total += v\n    if v > best:\n        best = v\n    if v < smallest:\n        smallest = v\n    if v % 2 == 0:\n        evens += 1\nprint(best, smallest, total, evens)\nfor i, v in enumerate(values, start=1):\n    if v == 9:\n        print("9 is item", i)\n        break`, out: `9 -2 18 2\n9 is item 3` },
  lineByLine: [["best = values[0]", "Start with the first value, so negatives work."], ["total += v", "Accumulator."], ["if v % 2 == 0: evens += 1", "Counter with a condition."], ["enumerate(values, start=1)", "Gives the position counted from 1."]],
  dryRun: { intro: "Tracking the maximum and total:", headers: ["v", "best", "smallest", "total", "evens"], rows: [["4", "4", "4", "4", "1"], ["-2", "4", "-2", "2", "2"], ["9", "9", "-2", "11", "2"], ["7", "9", "-2", "18", "2"]] },
  realExample: { intro: "Read n then n marks. Print the highest, the lowest and the average. Input: 3 then 70, 55, 90.", code: `n = int(input())\nhighest = lowest = None\ntotal = 0\nfor _ in range(n):\n    mark = int(input())\n    if highest is None or mark > highest:\n        highest = mark\n    if lowest is None or mark < lowest:\n        lowest = mark\n    total += mark\nprint(highest, lowest, round(total / n, 2))`, out: `90 55 71.67`, stdin: "3\n70\n55\n90" },
  mistakes: ["Initialising the maximum to 0.", "Initialising the minimum to a made-up large number such as 9999 that data may exceed.", "Calling <code>break</code> in a search and then reading the position after an unrelated update.", "Dividing by <code>n</code> when n can be 0.", "Using <code>range(len(values))</code> and then <code>values[i]</code> when <code>enumerate</code> is cleaner."],
  practices: ["Name patterns in comments: <code># counter</code>.", "Use <code>max()</code>, <code>min()</code> and <code>sum()</code> in real code; write the loop version when asked in interviews.", "Handle the empty case explicitly."],
  interview: ["Find the second largest element in one pass.", "Why not initialise max to 0?", "What does enumerate return?"],
  practiceQs: ["Count the vowels in a string with a loop.", "Find the index of the first negative number.", "Find the longest word in a list without max().", "Compute the average of positive numbers only."],
  revision: ["Counter, accumulator, extreme, search, flag.", "Start max/min from the first element.", "enumerate gives (index, value).", "Guard against empty input."],
  hinglish: "Zyada tar loops paanch pattern ke hote hain: gina, jodna, sabse bada/chhota, dhoondhna aur flag. Maximum nikalte waqt shuruaat pehli value se karo, 0 se nahi.",
  quiz: [
    mcq("Why should the maximum start with the first value?", ["Speed", "Negative numbers would break a start of 0", "Python requires it", "No reason"], 1, "If all values are negative, 0 would be reported as the maximum."),
    mcq("What does enumerate([\"a\", \"b\"], start=1) yield first?", ["(0, 'a')", "(1, 'a')", "('a', 1)", "(1, 'b')"], 1, "Counting starts at 1.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\ncount = 0\nfor c in \"banana\":\n    if c == \"a\":\n        count += 1\nprint(count)", ["1", "2", "3", "6"], 2, "Three letter a.", "OUTPUT_PREDICTION"),
    mcq("What is the standard start value for a counter?", ["1", "0", "None", "-1"], 1, "A counter starts at zero."),
    mcq("Find the bug:\n\nbest = 0\nfor v in [-5, -2, -9]:\n    if v > best:\n        best = v\nprint(best)", ["It prints 0, not -2", "It prints -2", "It crashes", "No bug"], 0, "Starting at 0 hides the negatives.", "DEBUG"),
  ],
  tasks: [task("Max, min and average", "Read n, then n integers (one per line). Print the largest, the smallest and the average (rounded to 2 decimals), separated by spaces. Do not use max() or min().", "n = int(input())\n# read the numbers and find max, min and average\n", `n = int(input())\nbest = smallest = None\ntotal = 0\nfor _ in range(n):\n    v = int(input())\n    total += v\n    if best is None or v > best:\n        best = v\n    if smallest is None or v < smallest:\n        smallest = v\nprint(best, smallest, round(total / n, 2))`, [["3\n4\n9\n2", "9 2 5.0"], ["4\n1\n2\n3\n4", "4 1 2.5"]], [["3\n4\n9\n2", "9 2 5.0"], ["4\n1\n2\n3\n4", "4 1 2.5"], ["3\n-5\n-2\n-9", "-2 -9 -5.33"], ["1\n7", "7 7 7.0"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Time Complexity Basics and Loop Optimisation",
  minutes: 40,
  learn: ["Count how much work a loop does as the input grows", "Read O(1), O(n), O(n squared) and O(log n)", "Replace a loop with a formula or a better structure", "Avoid common performance mistakes"],
  why: "A program that is fine for 100 items can take hours for a million. Thinking about growth tells you early which solution will survive real data.",
  realWorld: "A search over 10 lakh records must not compare every pair; a report that rebuilds a string in a loop can crawl.",
  simple: "Time complexity says <em>how the number of steps grows when the input grows</em>, ignoring exact speed. Doubling the input doubles the work of an O(n) loop but quadruples the work of an O(n&sup2;) one.",
  detail: `${table(["Notation", "Name", "Example", "Work for n = 1,000,000"], [["O(1)", "constant", "index a list, dictionary lookup (average)", "1"], ["O(log n)", "logarithmic", "binary search, halving n until 1", "about 20"], ["O(n)", "linear", "one loop over the data", "1,000,000"], ["O(n log n)", "linearithmic", "good sorting", "about 20,000,000"], ["O(n&sup2;)", "quadratic", "two nested loops over the data", "1,000,000,000,000"]])}
<h3>Counting loops</h3>
<p>One loop of n steps is O(n). Two loops one after another are O(n) + O(n) = O(n). A loop inside a loop, both over n items, is O(n&sup2;). A loop that halves n each time (<code>while n &gt; 1: n //= 2</code>) is O(log n).</p>
<h3>Optimisation ideas</h3>
<ul><li><strong>Use a formula</strong>: <code>1 + 2 + ... + n</code> is <code>n * (n + 1) // 2</code>, O(1) instead of O(n).</li><li><strong>Stop early</strong> with <code>break</code>, or test only to the square root.</li><li><strong>Do not repeat work</strong> inside a loop: compute <code>len(items)</code> or a constant once, before it.</li><li><strong>Choose the right structure</strong>: membership in a <code>set</code> or <code>dict</code> is O(1) on average; in a list it is O(n).</li><li><strong>Build strings with join</strong>: repeated <code>s += piece</code> can create many temporary strings; collect pieces in a list and use <code>"".join(pieces)</code>.</li><li><strong>Prefer built-ins</strong> (<code>sum</code>, <code>min</code>, <code>sorted</code>): they run in optimised C code.</li></ul>
<p>Measure before optimising: the <code>timeit</code> module and profilers (Module 12) show where time really goes.</p>`,
  syntax: { code: `n * (n + 1) // 2        # O(1) sum of 1..n\nwhile n > 1: n //= 2      # O(log n)\nitem in a_set             # O(1) average`, note: "Big O describes growth, not seconds." },
  diagram: chain("Growth from slow to fast-growing", "Left to right: O(1), O(log n), O(n), O(n log n), O(n squared), from least work to most work as the input grows.",
    [{ k: "term", t: "O(1)" }, { k: "proc", t: "O(log n)" }, { k: "proc", t: "O(n)" }, { k: "proc", t: "O(n log n)" }, { k: "term", t: "O(n²)" }], { w: 110, gap: 24, hgt: 44 }),
  example: { code: `n = 100000\nslow = 0\nfor i in range(1, n + 1):\n    slow += i\nfast = n * (n + 1) // 2\nprint(slow == fast, fast)\nsteps = 0\nm = 1000000\nwhile m > 1:\n    m //= 2\n    steps += 1\nprint(steps)`, out: `True 5000050000\n19` },
  lineByLine: [["for i in range(1, n + 1): slow += i", "100,000 additions: O(n)."], ["n * (n + 1) // 2", "One calculation: O(1), same answer."], ["while m > 1: m //= 2", "Halving 1,000,000 reaches 1 after 19 steps: O(log n)."]],
  dryRun: { intro: "Halving a small number, m = 20:", headers: ["m before", "m after", "steps"], rows: [["20", "10", "1"], ["10", "5", "2"], ["5", "2", "3"], ["2", "1", "4"]] },
  realExample: { intro: "Sum of all multiples of 3 or 5 below n, a classic exercise (Project Euler problem 1). The loop version is O(n). Input: 1000.", code: `n = int(input())\ntotal = 0\nfor i in range(n):\n    if i % 3 == 0 or i % 5 == 0:\n        total += i\nprint(total)`, out: `233168`, stdin: "1000" },
  mistakes: ["Assuming a faster computer fixes a bad algorithm.", "Hiding a second loop inside a method call (<code>x in list</code> inside a loop is O(n&sup2;)).", "Optimising before measuring.", "Saying O(2n) or O(n + 5): constants are dropped, it is O(n).", "Confusing O(log n) with O(n)."],
  practices: ["State the complexity of every solution in interviews.", "Check the input limits in the problem: n up to 10^5 rules out O(n&sup2;).", "Keep the clear solution unless performance requires more."],
  interview: ["What is the time complexity of nested loops of n and m?", "How many steps does halving n until 1 take?", "Why is membership in a set faster than in a list?", "What does Big O ignore?"],
  practiceQs: ["What is the complexity of: for i in range(n): for j in range(i): ...?", "Compute 1 + 2 + ... + 1000 with a formula.", "How many times can 1024 be halved before reaching 1?", "Why does 'item in list' inside a loop slow the program?"],
  revision: ["Big O = growth of work with input size.", "Loop = O(n); nested = O(n²); halving = O(log n).", "Use formulas, early exits, sets, join.", "Measure before optimising."],
  hinglish: "Time complexity batati hai ki input badhne par kaam kitna badhta hai. Ek loop O(n), loop ke andar loop O(n²), aur har baar aadha karne wala loop O(log n) hota hai. Jahan ho sake formula, set aur built-in functions use karo.",
  quiz: [
    mcq("What is the complexity of one loop over n items?", ["O(1)", "O(n)", "O(n²)", "O(log n)"], 1, "The work grows in step with n."),
    mcq("What is the complexity of two nested loops over n items each?", ["O(n)", "O(2n)", "O(n²)", "O(log n)"], 2, "n times n."),
    mcq("How many halvings take 16 down to 1?", ["16", "4", "8", "2"], 1, "16, 8, 4, 2, 1: four halvings.", "OUTPUT_PREDICTION"),
    mcq("Which is O(1) on average?", ["x in a list", "x in a set", "sorting a list", "summing a list"], 1, "Hash-based lookup."),
    mcq("What is the better way to build a long string from many pieces?", ["s += piece in a loop always", "\"\".join(pieces)", "Use recursion", "Use input()"], 1, "join builds the result once."),
  ],
  tasks: [task("Multiples of 3 or 5", "Read n. Print the sum of all natural numbers below n that are multiples of 3 or 5.", "n = int(input())\n# sum multiples of 3 or 5 below n\n", `n = int(input())\ntotal = 0\nfor i in range(n):\n    if i % 3 == 0 or i % 5 == 0:\n        total += i\nprint(total)`, [["10", "23"], ["1000", "233168"]], [["10", "23"], ["1000", "233168"], ["0", "0"], ["1", "0"], ["16", "60"], ["100000", "2333316668"]])],
});

module.exports = {
  module: {
    title: "Phase 1 - Loops and Iterations",
    description: "for and while loops, range, nested loops and patterns, break, continue, pass and loop else, standard iteration patterns, and an introduction to time complexity and loop optimisation, with a flowchart for every loop form.",
    chapters: [{ title: "Loops and Iterations", description: "Repeating work correctly and efficiently.", lessons }],
    assessment: {
      title: "Module 6 Assessment: Loops and Iterations",
      description: "Loop problems: factorial, Fibonacci, digit reversal, Armstrong numbers and Collatz.",
      questions: [
        task("Factorial", "Read n (0 or more). Print n factorial.", "", `n = int(input())\nresult = 1\nfor i in range(2, n + 1):\n    result *= i\nprint(result)`, [["5", "120"], ["0", "1"]], [["5", "120"], ["0", "1"], ["1", "1"], ["10", "3628800"], ["20", "2432902008176640000"]]),
        task("Fibonacci terms", "Read n (at least 1). Print the first n Fibonacci numbers starting 0, 1 on one line separated by spaces.", "", `n = int(input())\na, b = 0, 1\nterms = []\nfor _ in range(n):\n    terms.append(str(a))\n    a, b = b, a + b\nprint(" ".join(terms))`, [["7", "0 1 1 2 3 5 8"], ["1", "0"]], [["7", "0 1 1 2 3 5 8"], ["1", "0"], ["2", "0 1"], ["10", "0 1 1 2 3 5 8 13 21 34"]]),
        task("Reverse the digits", "Read a non-negative integer. Print the number formed by reversing its digits (leading zeros of the result are dropped, so 1200 becomes 21).", "", `n = int(input())\nrev = 0\nwhile n > 0:\n    rev = rev * 10 + n % 10\n    n //= 10\nprint(rev)`, [["1234", "4321"], ["1200", "21"]], [["1234", "4321"], ["1200", "21"], ["7", "7"], ["0", "0"], ["100", "1"], ["9876543210", "123456789"]]),
        task("Armstrong number", "Read a positive integer. Print True if it equals the sum of its digits each raised to the power of the number of digits (for example 153 = 1^3 + 5^3 + 3^3), otherwise False.", "", `n = int(input())\ndigits = str(n)\ntotal = 0\nfor d in digits:\n    total += int(d) ** len(digits)\nprint(total == n)`, [["153", "True"], ["123", "False"]], [["153", "True"], ["123", "False"], ["9474", "True"], ["9", "True"], ["10", "False"], ["370", "True"], ["371", "True"], ["100", "False"]]),
        task("Collatz steps", "Read a positive integer n. While n is not 1, replace it by n / 2 if even or 3n + 1 if odd. Print how many steps it takes to reach 1.", "", `n = int(input())\nsteps = 0\nwhile n != 1:\n    n = n // 2 if n % 2 == 0 else 3 * n + 1\n    steps += 1\nprint(steps)`, [["6", "8"], ["1", "0"]], [["6", "8"], ["1", "0"], ["27", "111"], ["2", "1"], ["7", "16"], ["97", "118"]]),
      ],
    },
  },
};
