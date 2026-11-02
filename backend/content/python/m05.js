// Phase 1 / Module 5: Conditional Statements.
"use strict";
const { chain, graph, table } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "if, if-else and if-elif-else",
  minutes: 40,
  learn: ["Write one-way, two-way and multi-way decisions", "Explain how elif chains are evaluated top to bottom", "Choose the right order for conditions", "Trace a decision with a dry run"],
  why: "Without decisions a program does the same thing every time. Conditions are how software reacts to input: pass or fail, valid or invalid, discount or none.",
  realWorld: "A result portal turns marks into a grade; a bank app allows a withdrawal only if the balance is enough; a form rejects an empty name.",
  simple: "<code>if</code> asks a yes/no question. If the answer is yes, the indented lines below it run. <code>else</code> says what to do otherwise. <code>elif</code> (else if) lets you ask another question when the first answer was no.",
  detail: `<h3>The three shapes</h3>
${table(["Shape", "Meaning"], [["<code>if</code>", "Run the block only when the condition is true"], ["<code>if ... else</code>", "Exactly one of two blocks runs"], ["<code>if ... elif ... else</code>", "Exactly one of many blocks runs: the <strong>first</strong> true condition wins; <code>else</code> is the fallback"]])}
<h3>Rules</h3>
<ul><li>The condition is followed by a <strong>colon</strong>; the block is <strong>indented</strong> (4 spaces).</li><li>Conditions are tested <strong>from top to bottom</strong> and the rest of the chain is skipped after a match.</li><li><code>else</code> has no condition and must come last. <code>elif</code> may appear any number of times.</li><li>Python has no <code>switch</code> statement in this form; use an elif chain (or <code>match</code>, Module 11).</li></ul>
<h3>Order matters</h3>
<p>For grades, test the <em>highest</em> threshold first. If you test <code>marks &gt;= 40</code> first, a score of 95 gets the lowest passing grade, because the first true condition ends the chain.</p>
<h3>Writing the condition</h3>
<p>Any expression that gives a truth value works: comparisons, <code>in</code>, <code>and</code>/<code>or</code>/<code>not</code>, or a boolean variable such as <code>if is_member:</code> (never write <code>== True</code>).</p>`,
  syntax: { code: `if condition:\n    block\nelif other_condition:\n    block\nelse:\n    block`, note: "Each block is indented under its line." },
  diagram: graph("if-elif-else flow", "Flow: start, test condition 1; if true run block A; else test condition 2; if true run block B; else run block C; all paths join at the end.", 620, 330,
    [{ id: "s", k: "term", t: "Start", x: 110, y: 28, w: 100, h: 36 }, { id: "c1", k: "dec", t: "marks >= 90?", x: 110, y: 100, w: 170, h: 64 }, { id: "a", k: "io", t: "print A", x: 400, y: 100, w: 110, h: 40 }, { id: "c2", k: "dec", t: "marks >= 75?", x: 110, y: 200, w: 170, h: 64 }, { id: "b", k: "io", t: "print B", x: 400, y: 200, w: 110, h: 40 }, { id: "c", k: "io", t: "else: print C", x: 110, y: 295, w: 150, h: 40 }, { id: "e", k: "term", t: "End", x: 520, y: 295, w: 90, h: 36 }],
    [{ from: "s", to: "c1" }, { from: "c1", to: "a", label: "yes" }, { from: "c1", to: "c2", label: "no" }, { from: "c2", to: "b", label: "yes" }, { from: "c2", to: "c", label: "no" }, { from: "c", to: "e" }, { from: "b", to: "e" }, { from: "a", to: "e" }]),
  example: { code: `marks = int(input())\nif marks >= 90:\n    grade = "A"\nelif marks >= 75:\n    grade = "B"\nelif marks >= 60:\n    grade = "C"\nelif marks >= 40:\n    grade = "D"\nelse:\n    grade = "F"\nprint(grade)`, out: `B`, stdin: "82" },
  lineByLine: [["marks = int(input())", "Reads 82 and converts it to an integer."], ["if marks >= 90:", "82 >= 90 is False, so the block is skipped."], ["elif marks >= 75:", "82 >= 75 is True: <code>grade</code> becomes &quot;B&quot;."], ["elif ... / else", "Never examined: the chain ended at the first true condition."], ["print(grade)", "Runs after the chain, at the outer indentation."]],
  dryRun: { intro: "Input 82:", headers: ["Test", "Result", "Action"], rows: [["marks >= 90", "False", "skip"], ["marks >= 75", "True", "grade = \"B\", leave the chain"], ["print(grade)", "-", "B"]] },
  realExample: { intro: "Can this withdrawal go through? Two-way decision with a message either way. Input: balance 5000, amount 7000.", code: `balance = int(input())\namount = int(input())\nif amount <= balance:\n    balance -= amount\n    print("Withdrawn:", amount)\nelse:\n    print("Insufficient balance")\nprint("Balance:", balance)`, out: `Insufficient balance\nBalance: 5000`, stdin: "5000\n7000" },
  mistakes: ["Forgetting the colon.", "Writing <code>if x = 5</code> instead of <code>==</code>.", "Testing the lowest threshold first in a grade chain.", "Using several separate <code>if</code>s when only one branch should run (all true ones run).", "Writing <code>elif</code> without a preceding <code>if</code>, or <code>else</code> with a condition.", "Indenting the final <code>print</code> by mistake so it only runs in one branch."],
  practices: ["Order conditions from most specific or highest to lowest.", "Keep each branch short; move big work into functions (Module 8).", "Give boolean variables names that read well in an <code>if</code>: <code>if is_valid:</code>.", "Always include an <code>else</code> when &quot;none of the above&quot; needs handling."],
  interview: ["What is the difference between a chain of ifs and an if-elif chain?", "Does Python have a switch statement?", "In what order are elif conditions evaluated?", "Why should you not write <code>if flag == True</code>?"],
  practiceQs: ["Predict the output for marks 90, 89, 40 and 39 in the grade program.", "Rewrite a grade chain that tests the lowest threshold first and show a failing input.", "Write an if-else that prints \"even\" or \"odd\".", "What happens if no condition matches and there is no else?"],
  revision: ["if / elif / else decide by the first true condition.", "Colon and indentation form the block.", "Order from the strictest condition to the loosest.", "Use if flag:, not if flag == True:."],
  hinglish: "if ke baad condition aur colon likhte hain, phir andar wala code 4 spaces se. elif upar se neeche check hota hai aur pehli sachchi condition ka block chalta hai, baaki skip ho jaate hain. Grade wale sawaal mein sabse bada threshold pehle likho.",
  quiz: [
    mcq("What does this print?\n\nx = 7\nif x > 10:\n    print(\"A\")\nelif x > 5:\n    print(\"B\")\nelse:\n    print(\"C\")", ["A", "B", "C", "B and C"], 1, "x > 10 is False, x > 5 is True, so B.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nx = 20\nif x > 5:\n    print(\"one\")\nif x > 10:\n    print(\"two\")", ["one", "two", "one then two", "nothing"], 2, "Two separate ifs: both conditions are true.", "OUTPUT_PREDICTION"),
    mcq("Where must else appear?", ["First", "Last, with no condition", "Anywhere", "Before elif"], 1, "else is the final fallback."),
    mcq("Find the bug:\n\nmarks = 95\nif marks >= 40:\n    print(\"D\")\nelif marks >= 90:\n    print(\"A\")", ["Prints D for 95: wrong order", "Missing else", "marks must be a string", "No bug"], 0, "The first true condition wins, so the higher threshold must be tested first.", "DEBUG"),
    mcq("Which line is a syntax error?", ["if x > 3:", "elif x > 1:", "else x > 0:", "else:"], 2, "else takes no condition."),
  ],
  tasks: [task("Grade calculator", "Read the marks (integer 0 to 100). Print the grade: 90 or more A, 75 or more B, 60 or more C, 40 or more D, otherwise F.", "marks = int(input())\n# print the grade\n", `marks = int(input())\nif marks >= 90:\n    print("A")\nelif marks >= 75:\n    print("B")\nelif marks >= 60:\n    print("C")\nelif marks >= 40:\n    print("D")\nelse:\n    print("F")`, [["82", "B"], ["95", "A"]], [["82", "B"], ["95", "A"], ["90", "A"], ["89", "B"], ["75", "B"], ["60", "C"], ["59", "D"], ["40", "D"], ["39", "F"], ["0", "F"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Nested Conditions and Decision Trees",
  minutes: 40,
  learn: ["Place an if inside another if", "Draw a decision tree before coding", "Flatten nested logic with and/or when it helps", "Avoid deeply nested code"],
  why: "Real rules depend on several facts at once: age <em>and</em> membership <em>and</em> day of the week. A tree on paper turns such rules into code without mistakes.",
  realWorld: "A cinema ticket price depends on age first, then on whether you are a member. A loan check looks at income, then at credit history.",
  simple: "A <strong>nested</strong> if is an if inside the block of another if. The inner question is asked only when the outer answer allows it. Draw the questions as a tree: each question splits into branches, each leaf is a result.",
  detail: `<h3>Plan with a tree</h3>
<p>Write the first question at the top. Under each answer write the next question or the result. The tree becomes the code: each question is an <code>if</code>, each branch an indented block.</p>
<h3>Example rules (ticket price)</h3>
${table(["Age", "Price"], [["under 5", "0 (free)"], ["5 to 12", "100"], ["13 to 59", "300; 250 for members"], ["60 and over", "150"]])}
<h3>Nested vs flat</h3>
<p>Some nesting can be flattened. These two behave the same:</p>
<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px"><code>if age &gt;= 18:\n    if has_id:\n        print("enter")\n\nif age &gt;= 18 and has_id:\n    print("enter")</code></pre>
<p>Prefer the flat version when both questions lead to the same action. Keep nesting when each answer needs its <em>own</em> follow-up.</p>
<h3>Readability limit</h3>
<p>More than about three levels of indentation is a warning sign. Use <code>and</code>/<code>or</code>, early checks for invalid input, or functions to flatten the logic.</p>`,
  syntax: { code: `if first_condition:\n    if second_condition:\n        block\n    else:\n        block\nelse:\n    block`, note: "Each level adds 4 spaces." },
  diagram: graph("Decision tree for a ticket price", "Tree: ask age. Under 5: free. 5 to 12: 100. 13 to 59: ask member, yes 250, no 300. 60 or more: 150.", 640, 300,
    [{ id: "a", k: "dec", t: "age?", x: 320, y: 40, w: 110, h: 56 }, { id: "f", k: "io", t: "< 5: 0", x: 70, y: 170, w: 100, h: 40 }, { id: "c", k: "io", t: "5-12: 100", x: 200, y: 170, w: 110, h: 40 }, { id: "m", k: "dec", t: "member?", x: 380, y: 170, w: 120, h: 56 }, { id: "s", k: "io", t: ">= 60: 150", x: 570, y: 170, w: 120, h: 40 }, { id: "y", k: "io", t: "yes: 250", x: 320, y: 270, w: 110, h: 40 }, { id: "n", k: "io", t: "no: 300", x: 460, y: 270, w: 110, h: 40 }],
    [{ from: "a", to: "f" }, { from: "a", to: "c" }, { from: "a", to: "m", label: "13-59", dx: 6 }, { from: "a", to: "s" }, { from: "m", to: "y", label: "yes", dx: -34 }, { from: "m", to: "n", label: "no", dx: 4 }]),
  example: { code: `age = int(input())\nmember = input() == "yes"\nif age < 5:\n    price = 0\nelif age <= 12:\n    price = 100\nelif age < 60:\n    if member:\n        price = 250\n    else:\n        price = 300\nelse:\n    price = 150\nprint(price)`, out: `250`, stdin: "30\nyes" },
  lineByLine: [["member = input() == \"yes\"", "Compares the typed text with \"yes\" and stores True or False."], ["if age < 5 / elif age <= 12", "The two simple branches of the tree."], ["elif age < 60:", "True for 13 to 59, because younger ages were already handled above."], ["if member: ... else: ...", "The nested question, asked only for ages 13 to 59."], ["else: price = 150", "Everything left: 60 and over."]],
  dryRun: { intro: "Input age 30, member yes:", headers: ["Question", "Answer", "Next"], rows: [["age < 5", "False", "next branch"], ["age <= 12", "False", "next branch"], ["age < 60", "True", "enter block"], ["member", "True", "price = 250"]] },
  realExample: { intro: "Flattening with and/or: a gym offer applies to students under 25 or any senior, but only on weekdays. Input: age 22, student yes, weekday yes.", code: `age = int(input())\nstudent = input() == "yes"\nweekday = input() == "yes"\nif weekday and ((student and age < 25) or age >= 60):\n    print("Offer applies")\nelse:\n    print("No offer")`, out: `Offer applies`, stdin: "22\nyes\nyes" },
  mistakes: ["Wrong indentation: an <code>else</code> lined up with the wrong <code>if</code> (the dangling else).", "Re-testing a condition already known from above (<code>elif age &gt;= 5 and age &lt;= 12</code> when <code>age &lt; 5</code> was handled).", "Nesting five levels deep instead of using <code>and</code> or functions.", "Not covering one branch, so a variable is never assigned (NameError).", "Mixing <code>and</code>/<code>or</code> without brackets."],
  practices: ["Sketch the tree before typing.", "Handle invalid or exceptional cases first and exit early (<em>guard clauses</em> once you know functions).", "Use brackets to make <code>and</code>/<code>or</code> grouping obvious.", "Test every leaf of the tree at least once."],
  interview: ["How do you decide between nested ifs and one if with <code>and</code>?", "What is the dangling else problem?", "How do you test every branch of a decision?"],
  practiceQs: ["Convert the ticket tree into a table of test inputs, one per leaf.", "Flatten: if a: if b: if c: ...", "Draw a tree for \"login allowed if user exists, then password correct, then account not locked\"."],
  revision: ["Draw the tree, then code it.", "Nested if = follow-up question inside a branch.", "Flat conditions with and/or when the action is the same.", "Test each leaf."],
  hinglish: "Pehle kaagaz par decision tree banao, phir code likho. Ek if ke andar doosra if nested if kehlata hai. Agar dono sawaal ka nateeja ek hi hai to and se ek hi if mein likh do.",
  quiz: [
    mcq("A nested if is:", ["An if inside another block", "Two ifs in a row", "An if without a colon", "An else with a condition"], 0, "The inner if sits in the outer if's block."),
    mcq("What does this print?\n\nage = 30\nmember = False\nif age < 60:\n    if member:\n        print(250)\n    else:\n        print(300)\nelse:\n    print(150)", ["250", "300", "150", "Nothing"], 1, "age < 60 is True, member is False, so else of the inner if.", "OUTPUT_PREDICTION"),
    mcq("Which is equivalent to: if a: if b: print('x')", ["if a and b: print('x')", "if a or b: print('x')", "if a: print('x')", "if b: print('x')"], 0, "Both conditions must be true."),
    mcq("What is the value of (not True) or (3 > 2 and 2 > 1)?", ["True", "False", "Error", "None"], 0, "not True is False; the and-part is True; False or True is True.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Ticket price", "Read the age and then \"yes\" or \"no\" for membership. Price: under 5 is 0; 5 to 12 is 100; 13 to 59 is 300 (250 for members); 60 and over is 150. Print the price.", "age = int(input())\nmember = input() == \"yes\"\n# print the price\n", `age = int(input())\nmember = input() == "yes"\nif age < 5:\n    print(0)\nelif age <= 12:\n    print(100)\nelif age < 60:\n    print(250 if member else 300)\nelse:\n    print(150)`, [["30\nyes", "250"], ["4\nno", "0"]], [["30\nyes", "250"], ["4\nno", "0"], ["10\nno", "100"], ["30\nno", "300"], ["65\nyes", "150"], ["60\nno", "150"], ["59\nyes", "250"], ["5\nyes", "100"], ["13\nno", "300"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Truthy and Falsy Values and the Conditional Expression",
  minutes: 35,
  learn: ["List the falsy values in Python", "Write conditions without explicit comparisons", "Use the one-line conditional expression", "Know when short-hand hurts readability"],
  why: "Idiomatic Python tests emptiness and None directly. The conditional expression produces a value in one line, widely used in assignments and f-strings.",
  realWorld: "<code>if name:</code> checks that a form field is not empty. <code>label = \"Pass\" if marks &gt;= 40 else \"Fail\"</code> fills a report cell.",
  simple: "In an <code>if</code>, Python does not need <code>True</code> or <code>False</code>. Any value is converted: &quot;empty or zero&quot; counts as false, everything else as true.",
  detail: `<h3>Falsy values (everything else is truthy)</h3>
${table(["Type", "Falsy values"], [["bool / None", "<code>False</code>, <code>None</code>"], ["numbers", "<code>0</code>, <code>0.0</code>, <code>0j</code>"], ["text", "<code>\"\"</code> (empty string)"], ["collections", "<code>[]</code>, <code>()</code>, <code>{}</code>, <code>set()</code>, <code>range(0)</code>"]])}
<p>Note that <code>"0"</code> and <code>"False"</code> (non-empty strings) and <code>[0]</code> (a non-empty list) are <strong>truthy</strong>. <code>bool(x)</code> shows the result.</p>
<h3>Idioms</h3>
<ul><li><code>if items:</code> instead of <code>if len(items) &gt; 0:</code></li><li><code>if not name:</code> for an empty name</li><li><code>if x is None:</code> when 0 or empty are valid values and only <em>missing</em> should be detected</li></ul>
<h3>The conditional expression (ternary)</h3>
<p><code>value_if_true if condition else value_if_false</code>. It is an <em>expression</em>, so it can sit inside an assignment, a function call or an f-string. Use it for simple choices; keep chained ones in a normal if-elif.</p>
<h3>and / or return operands</h3>
<p><code>name or "Guest"</code> gives <code>name</code> if it is truthy, else <code>"Guest"</code>, a common default idiom. But it also replaces a legitimate 0 or empty string: use an explicit <code>is None</code> test when those are valid.</p>`,
  syntax: { code: `if value:            # truthy test\nif not value:        # falsy test\nresult = a if condition else b\nname = given or "Guest"`, note: "The conditional expression has the condition in the middle." },
  diagram: chain("How if decides", "Left to right: any value, converted by bool(), becomes True or False, which selects the branch.",
    [{ k: "io", t: "any value\n(0, \"a\", [])" }, { k: "proc", t: "bool(value)" }, { k: "dec", t: "True or\nFalse?" }, { k: "proc", t: "choose\nbranch" }], { w: 130, gap: 32, hgt: 58 }),
  example: { code: `for value in [0, 1, "", "0", [], [0], None]:\n    print(repr(value), bool(value))\nmarks = 55\nlabel = "Pass" if marks >= 40 else "Fail"\nprint(label)\nname = ""\nprint(name or "Guest")`, out: `0 False\n1 True\n'' False\n'0' True\n[] False\n[0] True\nNone False\nPass\nGuest` },
  lineByLine: [["for value in [...]:", "Visits each item in turn (loops come in Module 6)."], ["bool(value)", "Shows how Python judges the value in a condition."], ["\"Pass\" if marks >= 40 else \"Fail\"", "Picks one of two values, like an if-else squeezed into one line."], ["name or \"Guest\"", "The empty string is falsy, so the default is used."]],
  dryRun: { intro: "Evaluating <code>\"Pass\" if marks >= 40 else \"Fail\"</code> for marks = 55:", headers: ["Step", "Value"], rows: [["condition marks >= 40", "True"], ["result", "the first value, \"Pass\""]] },
  realExample: { intro: "Only a missing score is reported as missing; a real 0 is still a score.", code: `scores = [72, 0, None]\nfor score in scores:\n    if score is None:\n        print("missing")\n    else:\n        print("score", score)`, out: `score 72\nscore 0\nmissing` },
  mistakes: ["Treating the string <code>\"0\"</code> or <code>\"False\"</code> as false.", "Using <code>if x:</code> when 0 is a valid value (use <code>is None</code>).", "Chaining many conditional expressions until nobody can read them.", "Writing <code>if x == True</code> or <code>if x == None</code>.", "Using <code>x or default</code> when x may legitimately be 0."],
  practices: ["Use truthiness for emptiness checks; <code>is None</code> for missing.", "Use a conditional expression for one simple choice only.", "Convert text input explicitly before testing it as a number: <code>if int(text):</code> not <code>if text:</code>."],
  interview: ["Name five falsy values.", "Is \"False\" truthy?", "What does <code>x or y</code> return?", "Difference between <code>if x:</code> and <code>if x is not None:</code>?"],
  practiceQs: ["Predict bool(\" \"), bool(0.0), bool([[]]).", "Rewrite if marks >= 40: result = 'Pass' else: result = 'Fail' as one line.", "When is name or \"Guest\" wrong?"],
  revision: ["Falsy: False, None, 0, 0.0, \"\", [], (), {}, set().", "Everything else is truthy.", "a if cond else b.", "or/and return operands."],
  hinglish: "Python mein 0, khali string, khali list aur None false maane jaate hain, baaki sab true. Ek line ka if-else aise likhte hain: result = \"Pass\" if marks >= 40 else \"Fail\". Missing value ke liye is None use karo.",
  quiz: [
    mcq("Which value is truthy?", ["0", "\"\"", "[0]", "None"], 2, "A non-empty list is truthy, even if it holds 0."),
    mcq("What is bool(\"False\")?", ["False", "True", "Error", "None"], 1, "Any non-empty string is truthy.", "OUTPUT_PREDICTION"),
    mcq("What does print(0 or \"x\") show?", ["0", "x", "True", "False"], 1, "0 is falsy so or returns the second operand.", "OUTPUT_PREDICTION"),
    mcq("What does this print?\n\nx = 7\nprint(\"even\" if x % 2 == 0 else \"odd\")", ["even", "odd", "7", "Error"], 1, "7 % 2 is 1, so the else value.", "OUTPUT_PREDICTION"),
    mcq("Which is the best test for a missing value?", ["if x == None", "if x is None", "if not x", "if x == 0"], 1, "is None distinguishes missing from 0 or empty."),
  ],
  tasks: [task("Even or odd", "Read an integer. Print even or odd using a conditional expression in a single print statement.", "n = int(input())\n# one print, one conditional expression\n", `n = int(input())\nprint("even" if n % 2 == 0 else "odd")`, [["7", "odd"], ["10", "even"]], [["7", "odd"], ["10", "even"], ["0", "even"], ["-3", "odd"], ["-4", "even"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Logical Decision-Making: Leap Years, Ranges and Validation",
  minutes: 40,
  learn: ["Turn a written rule into a correct condition", "Combine conditions with and, or, not safely", "Test boundary values", "Validate input before using it"],
  why: "Most bugs in decision code sit at the boundaries (exactly 40, exactly 100) and in rules combined wrongly. A systematic method removes them.",
  realWorld: "Leap-year logic is in every calendar library; range checks guard every form field.",
  simple: "Write the rule in plain words, list the exact cases (including the edges), then translate each into a condition and test them all.",
  detail: `<h3>Method</h3>
<ol><li>Write the rule in a sentence.</li><li>Identify the pieces: each comparison and how they join (all of / any of).</li><li>Make a <strong>boundary table</strong>: values just below, on and just above each limit.</li><li>Code it; check every row of the table.</li></ol>
<h3>The leap-year rule</h3>
<p>A year is a leap year if it is divisible by 4, <em>except</em> century years, which must be divisible by 400. So 2024 and 2000 are leap years; 1900 and 2100 are not.</p>
<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px"><code>leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)</code></pre>
<h3>De Morgan's laws</h3>
<p><code>not (a and b)</code> equals <code>(not a) or (not b)</code>; <code>not (a or b)</code> equals <code>(not a) and (not b)</code>. They help you simplify or invert a condition without mistakes.</p>
<h3>Validation first</h3>
<p>Check that input is acceptable <em>before</em> using it: a mark outside 0 to 100, a negative age, a missing field. Print an error message and skip the real work.</p>
${table(["Rule", "Condition"], [["mark is valid", "<code>0 &lt;= mark &lt;= 100</code>"], ["x is outside 1..10", "<code>x &lt; 1 or x &gt; 10</code>"], ["x is not 5", "<code>x != 5</code>"], ["letter is a vowel", "<code>ch in \"aeiou\"</code>"]])}`,
  syntax: { code: `if low <= x <= high:\nif x < low or x > high:\nif not (a and b):   # same as: not a or not b`, note: "Prefer chained comparisons for ranges." },
  diagram: graph("Leap year decision", "Flow: divisible by 400? yes leap. no: divisible by 100? yes not leap. no: divisible by 4? yes leap, no not leap.", 700, 320,
    [{ id: "a", k: "dec", t: "year % 400 == 0?", x: 150, y: 40, w: 200, h: 60 }, { id: "l1", k: "io", t: "Leap year", x: 470, y: 40, w: 120, h: 38 }, { id: "b", k: "dec", t: "year % 100 == 0?", x: 150, y: 140, w: 200, h: 60 }, { id: "n1", k: "io", t: "Not a leap year", x: 470, y: 140, w: 150, h: 38 }, { id: "c", k: "dec", t: "year % 4 == 0?", x: 150, y: 240, w: 180, h: 60 }, { id: "l2", k: "io", t: "Leap year", x: 400, y: 240, w: 120, h: 38 }, { id: "n2", k: "io", t: "Not a leap year", x: 570, y: 285, w: 130, h: 36 }],
    [{ from: "a", to: "l1", label: "yes" }, { from: "a", to: "b", label: "no" }, { from: "b", to: "n1", label: "yes" }, { from: "b", to: "c", label: "no" }, { from: "c", to: "l2", label: "yes" }, { from: "c", to: "n2", label: "no" }]),
  example: { code: `year = int(input())\nif year % 4 == 0 and (year % 100 != 0 or year % 400 == 0):\n    print("Leap year")\nelse:\n    print("Not a leap year")`, out: `Leap year`, stdin: "2000" },
  lineByLine: [["year % 4 == 0", "Divisible by 4: the basic rule."], ["(year % 100 != 0 or year % 400 == 0)", "Not a century year, or a century year divisible by 400."], ["and", "Both parts must hold."]],
  dryRun: { intro: "Checking several years:", headers: ["Year", "% 4 == 0", "% 100 != 0", "% 400 == 0", "Result"], rows: [["2000", "True", "False", "True", "Leap"], ["1900", "True", "False", "False", "Not leap"], ["2024", "True", "True", "-", "Leap"], ["2023", "False", "-", "-", "Not leap"]] },
  realExample: { intro: "Validate a mark before grading it. Input: 105.", code: `marks = int(input())\nif marks < 0 or marks > 100:\n    print("Invalid marks")\nelif marks >= 40:\n    print("Pass")\nelse:\n    print("Fail")`, out: `Invalid marks`, stdin: "105" },
  mistakes: ["Forgetting the century exception in the leap-year rule.", "Using <code>and</code> where the rule says &quot;or&quot; (<code>x &lt; 1 and x &gt; 10</code> can never be true).", "Off-by-one on the boundary (<code>&gt;</code> instead of <code>&gt;=</code>).", "Validating after the calculation instead of before.", "Skipping boundary tests."],
  practices: ["Always test just below, on and just above each limit.", "Write the validity check first and finish it with a clear message.", "Put brackets around mixed <code>and</code>/<code>or</code>."],
  interview: ["Write the leap-year condition.", "State De Morgan's laws.", "How would you test a function that checks 18 <= age <= 60?"],
  practiceQs: ["Which of 1600, 1700, 1800, 2012 and 2022 are leap years?", "Invert: <code>x &gt; 5 and y &lt; 3</code>.", "List the boundary tests for a rule \"discount if bill &gt;= 500\"."],
  revision: ["Rule in words → pieces → boundary table → code → test.", "Leap: %4 and (%100 != 0 or %400 == 0).", "Validate first.", "De Morgan flips and/or when you negate."],
  hinglish: "Pehle rule ko seedhe shabdon mein likho, phir boundary values (just neeche, bilkul barabar, just upar) ki table banao. Leap year: 4 se divisible, lekin century wale saal sirf 400 se divisible hone par. Input ko use karne se pehle validate karo.",
  quiz: [
    mcq("Is 1900 a leap year?", ["Yes", "No", "Only in February", "Depends on the country"], 1, "It is divisible by 100 but not by 400."),
    mcq("Which condition means x is outside 1 to 10?", ["x < 1 and x > 10", "x < 1 or x > 10", "1 < x < 10", "x != 1 and x != 10"], 1, "Outside means below the low end or above the high end."),
    mcq("By De Morgan, not (a and b) equals:", ["not a and not b", "not a or not b", "a or b", "a and not b"], 1, "Negating and gives or of the negations."),
    mcq("What does this print for 2100?\n\nyear = 2100\nprint(year % 4 == 0 and (year % 100 != 0 or year % 400 == 0))", ["True", "False", "2100", "Error"], 1, "2100 is a century year not divisible by 400.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Leap year", "Read a year. Print Leap year or Not a leap year.", "year = int(input())\n# print the result\n", `year = int(input())\nif year % 4 == 0 and (year % 100 != 0 or year % 400 == 0):\n    print("Leap year")\nelse:\n    print("Not a leap year")`, [["2000", "Leap year"], ["1900", "Not a leap year"]], [["2000", "Leap year"], ["1900", "Not a leap year"], ["2024", "Leap year"], ["2023", "Not a leap year"], ["2100", "Not a leap year"], ["1600", "Leap year"], ["2400", "Leap year"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Decision Programs: Triangle, Calculator and Login Check",
  minutes: 45,
  learn: ["Combine everything in Module 5 in complete programs", "Handle invalid cases with clear messages", "Compare strings in conditions", "Design test inputs for each branch"],
  why: "Short complete programs are how you practise. They are also the pattern behind coding-test questions that start with input, make decisions and print one answer.",
  realWorld: "A calculator, a triangle classifier in a geometry tool and a login screen all follow: read, validate, decide, print.",
  simple: "Read the input, reject what is invalid, choose the branch, print one clear result. Then test each branch with its own input.",
  detail: `<h3>Triangle classifier</h3>
<p>Three sides form a triangle only if each side is smaller than the sum of the other two (the triangle inequality). Then: all equal is equilateral, exactly two equal is isosceles, otherwise scalene.</p>
<h3>Menu-style calculator</h3>
<p>Read two numbers and an operator symbol, then decide with an elif chain. Dividing by zero must be handled before dividing.</p>
<h3>Login check</h3>
<p>Comparing text uses <code>==</code>. Normalise the username (<code>.strip().lower()</code>) but compare the password exactly. Never print the real password and never store passwords in code in real projects (Module 18 covers hashing and secrets).</p>
<h3>Testing branches</h3>
${table(["Program", "Inputs to try"], [["Triangle", "3 3 3, 3 3 5, 3 4 5, 1 2 3 (degenerate), 5 5 10"], ["Calculator", "each operator, division by zero, unknown operator"], ["Login", "right user and password, right user wrong password, wrong user, extra spaces or capitals in the username"]])}`,
  syntax: { code: `if a + b > c and a + c > b and b + c > a:\n    ...\nelif op == "+":\n    ...`, note: "Check validity first." },
  diagram: graph("Triangle classification", "Decision tree: is it a triangle? no: Not a triangle. yes: all sides equal? yes equilateral. no: any two equal? yes isosceles, no scalene.", 640, 330,
    [{ id: "v", k: "dec", t: "valid\ntriangle?", x: 120, y: 50, w: 150, h: 64 }, { id: "nt", k: "io", t: "Not a triangle", x: 420, y: 50, w: 150, h: 38 }, { id: "e", k: "dec", t: "all three\nequal?", x: 120, y: 160, w: 150, h: 64 }, { id: "eq", k: "io", t: "Equilateral", x: 420, y: 160, w: 120, h: 38 }, { id: "i", k: "dec", t: "any two\nequal?", x: 120, y: 260, w: 150, h: 60 }, { id: "is", k: "io", t: "Isosceles", x: 340, y: 240, w: 110, h: 36 }, { id: "sc", k: "io", t: "Scalene", x: 340, y: 300, w: 110, h: 30 }],
    [{ from: "v", to: "nt", label: "no" }, { from: "v", to: "e", label: "yes" }, { from: "e", to: "eq", label: "yes" }, { from: "e", to: "i", label: "no" }, { from: "i", to: "is", label: "yes" }, { from: "i", to: "sc", label: "no" }]),
  example: { code: `a = int(input())\nb = int(input())\nc = int(input())\nif a + b <= c or a + c <= b or b + c <= a:\n    print("Not a triangle")\nelif a == b == c:\n    print("Equilateral")\nelif a == b or b == c or a == c:\n    print("Isosceles")\nelse:\n    print("Scalene")`, out: `Scalene`, stdin: "3\n4\n5" },
  lineByLine: [["a + b <= c or ...", "If any side is not smaller than the sum of the other two, no triangle exists."], ["a == b == c", "A chained comparison: all three are equal."], ["a == b or b == c or a == c", "At least two equal (and not all three, because that case came first)."], ["else", "All sides different."]],
  dryRun: { intro: "Sides 3, 4, 5:", headers: ["Test", "Result"], rows: [["3 + 4 <= 5", "False"], ["3 + 5 <= 4", "False"], ["4 + 5 <= 3", "False"], ["3 == 4 == 5", "False"], ["any two equal", "False"], ["else", "Scalene"]] },
  realExample: { intro: "A small calculator with division-by-zero protection. Input: 8, 0, /.", code: `a = float(input())\nb = float(input())\nop = input()\nif op == "+":\n    print(a + b)\nelif op == "-":\n    print(a - b)\nelif op == "*":\n    print(a * b)\nelif op == "/":\n    if b == 0:\n        print("Cannot divide by zero")\n    else:\n        print(a / b)\nelse:\n    print("Unknown operator")`, out: `Cannot divide by zero`, stdin: "8\n0\n/" },
  mistakes: ["Classifying before checking that a triangle exists.", "Putting isosceles before equilateral: an equilateral triangle also has two equal sides.", "Dividing before checking for zero.", "Comparing the operator with <code>is</code>.", "Using <code>=</code> in a condition."],
  practices: ["Order from the most specific case (equilateral) to the general.", "Print a clear message for every invalid case.", "Write down the test inputs before running the program."],
  interview: ["Why check equilateral before isosceles?", "What is the triangle inequality?", "How do you avoid ZeroDivisionError without try/except?"],
  practiceQs: ["Which output for sides 2, 2, 4?", "Add % and ** operators to the calculator.", "Which test inputs cover every branch of the login check?"],
  revision: ["Validate, classify, print.", "Specific before general.", "Guard division by zero.", "Test each branch."],
  hinglish: "Pehle check karo ki triangle ban sakta hai ya nahi (do bhujaon ka jod teesri se bada). Phir equilateral, isosceles, scalene ki order mein check karo. Divide karne se pehle zero check zaroor karo.",
  quiz: [
    mcq("Which sides cannot form a triangle?", ["3, 4, 5", "2, 2, 3", "1, 2, 3", "5, 5, 5"], 2, "1 + 2 is not greater than 3."),
    mcq("An equilateral triangle is also:", ["Scalene", "Isosceles (by the two-equal definition)", "Right-angled", "Not a triangle"], 1, "That is why equilateral must be tested first."),
    mcq("What does this print?\n\na, b, c = 5, 5, 8\nprint(a == b == c)", ["True", "False", "5", "Error"], 1, "Chained comparison: 5 == 5 is True but 5 == 8 is False.", "OUTPUT_PREDICTION"),
    mcq("What should happen before computing a / b?", ["Nothing", "Check b != 0", "Convert b to str", "Round b"], 1, "Dividing by zero raises ZeroDivisionError."),
  ],
  tasks: [task("Classify the triangle", "Read three integers (one per line). Print Not a triangle, Equilateral, Isosceles or Scalene.", "a = int(input())\nb = int(input())\nc = int(input())\n# classify\n", `a = int(input())\nb = int(input())\nc = int(input())\nif a + b <= c or a + c <= b or b + c <= a:\n    print("Not a triangle")\nelif a == b == c:\n    print("Equilateral")\nelif a == b or b == c or a == c:\n    print("Isosceles")\nelse:\n    print("Scalene")`, [["3\n4\n5", "Scalene"], ["3\n3\n3", "Equilateral"]], [["3\n4\n5", "Scalene"], ["3\n3\n3", "Equilateral"], ["3\n3\n5", "Isosceles"], ["5\n3\n3", "Isosceles"], ["1\n2\n3", "Not a triangle"], ["5\n5\n10", "Not a triangle"], ["7\n10\n5", "Scalene"]])],
});

module.exports = {
  module: {
    title: "Phase 1 - Module 5: Conditional Statements",
    description: "if, if-else, if-elif-else, nested decisions, truthy and falsy values, the conditional expression, boundary testing and complete decision programs, with decision-tree diagrams.",
    chapters: [{ title: "Conditional Statements", description: "Making programs choose.", lessons }],
    assessment: {
      title: "Module 5 Assessment: Conditional Statements",
      description: "Decision-making problems.",
      questions: [
        task("FizzBuzz for one number", "Read an integer n. Print FizzBuzz if it is divisible by both 3 and 5, Fizz if only by 3, Buzz if only by 5, otherwise the number itself.", "", `n = int(input())\nif n % 15 == 0:\n    print("FizzBuzz")\nelif n % 3 == 0:\n    print("Fizz")\nelif n % 5 == 0:\n    print("Buzz")\nelse:\n    print(n)`, [["15", "FizzBuzz"], ["9", "Fizz"]], [["15", "FizzBuzz"], ["9", "Fizz"], ["10", "Buzz"], ["7", "7"], ["0", "FizzBuzz"], ["30", "FizzBuzz"]]),
        task("Largest of three", "Read three integers (one per line). Print the largest without using max().", "", `a = int(input())\nb = int(input())\nc = int(input())\nif a >= b and a >= c:\n    print(a)\nelif b >= c:\n    print(b)\nelse:\n    print(c)`, [["3\n9\n5", "9"], ["10\n2\n7", "10"]], [["3\n9\n5", "9"], ["10\n2\n7", "10"], ["4\n4\n4", "4"], ["-1\n-5\n-3", "-1"], ["1\n2\n3", "3"]]),
        task("Vowel or consonant", "Read one letter (a to z, any case). Print Vowel or Consonant.", "", `ch = input().lower()\nprint("Vowel" if ch in "aeiou" else "Consonant")`, [["a", "Vowel"], ["k", "Consonant"]], [["a", "Vowel"], ["k", "Consonant"], ["E", "Vowel"], ["Z", "Consonant"], ["u", "Vowel"]]),
        task("Electricity bill", "Read the units consumed. The first 100 units cost 5 each, the next 100 cost 7 each, and every unit above 200 costs 10. Print the total bill as an integer.", "", `units = int(input())\nif units <= 100:\n    print(units * 5)\nelif units <= 200:\n    print(100 * 5 + (units - 100) * 7)\nelse:\n    print(100 * 5 + 100 * 7 + (units - 200) * 10)`, [["150", "850"], ["250", "1700"]], [["150", "850"], ["250", "1700"], ["50", "250"], ["100", "500"], ["200", "1200"], ["201", "1210"]]),
      ],
    },
  },
};
