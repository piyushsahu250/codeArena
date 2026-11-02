// Phase 1 / Module 3: Python Syntax and Basic Concepts.
"use strict";
const { chain, graph, table, terminal } = require("./render");

const mcq = (prompt, options, answer, explanation, type = "MCQ") => ({ type, prompt, options, correctAnswer: answer, explanation });
const task = (title, statement, starter, solution, cases, hiddenCases = cases) => ({
  title, statement, starter, solution,
  testCases: [...cases.slice(0, 2).map(([input, expected]) => ({ input, expected, isHidden: false })), ...hiddenCases.map(([input, expected]) => ({ input, expected, isHidden: true }))],
});

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "Syntax, Indentation, Comments, Keywords and Identifiers",
  minutes: 35,
  learn: ["Describe Python's structure: statements, lines and indentation blocks", "Write comments and docstrings", "Recognise keywords and choose valid identifiers", "Read an IndentationError and fix it"],
  why: "Python uses indentation to show structure. Getting this wrong is the most common beginner error, and every later topic (if, loops, functions, classes) depends on it.",
  realWorld: "Code reviews in every Python team check naming and readability first. A clear name and one good comment save more time than clever tricks.",
  simple: "One instruction per line. Lines that belong together (a block) are pushed to the right by <strong>4 spaces</strong>. Comments start with <code>#</code>. Names you invent are called <strong>identifiers</strong>; reserved words such as <code>for</code> and <code>class</code> are <strong>keywords</strong> and cannot be used as names.",
  detail: `<h3>Statements and lines</h3>
<p>A <strong>statement</strong> is one instruction, normally on one line. Python needs no semicolons. To split a long statement, put it inside brackets or end the line with a backslash.</p>
<h3>Indentation</h3>
<p>Blocks begin after a line ending in a colon (<code>:</code>) and the block's lines are indented by the same amount. Use <strong>4 spaces</strong> (PEP 8). Do not mix tabs and spaces. Inconsistent indentation causes <code>IndentationError</code>.</p>
${terminal("Correct vs incorrect", `if True:\n    print("inside the block")      # 4 spaces: OK\nprint("outside the block")\n\nif True:\nprint("oops")                    # IndentationError: expected an indented block`)}
<h3>Comments and docstrings</h3>
<ul><li><code># ...</code> is a <strong>comment</strong>: ignored by Python, written for humans. Explain <em>why</em>, not the obvious <em>what</em>.</li><li>A <strong>docstring</strong> is a triple-quoted string placed first inside a module, function or class. Tools and <code>help()</code> read it through <code>__doc__</code>.</li></ul>
<h3>Keywords and identifiers</h3>
<p><strong>Keywords</strong> have fixed meaning: <code>if</code>, <code>else</code>, <code>for</code>, <code>while</code>, <code>def</code>, <code>class</code>, <code>return</code>, <code>import</code>, <code>True</code>, <code>False</code>, <code>None</code> and more. The exact list depends on the Python version, so ask Python: <code>keyword.kwlist</code>. A few words such as <code>match</code> and <code>case</code> are <em>soft</em> keywords that are reserved only in a particular syntax.</p>
<p>An <strong>identifier</strong> is a name you choose for a variable, function or class. Rules: letters, digits and underscore only; cannot start with a digit; no spaces; case-sensitive (<code>age</code> and <code>Age</code> differ); cannot be a keyword.</p>
${table(["Name", "Valid?", "Why"], [["student_name", "Yes", "snake_case, the Python convention"], ["_count", "Yes", "may start with an underscore"], ["2nd_year", "No", "starts with a digit"], ["total marks", "No", "contains a space"], ["class", "No", "keyword"], ["Class", "Yes", "legal, but confusing; avoid"]])}`,
  syntax: { code: `# a comment\nif condition:\n    statement_1     # 4 spaces\n    statement_2\n\ndef name():\n    """Docstring: one line saying what this does."""`, note: "A colon opens a block; the indented lines below it form the block." },
  diagram: graph("Indentation defines blocks", "Code outline: an if line ending with a colon, followed by two indented lines forming its block, then an unindented line outside the block.", 600, 230,
    [{ id: "a", k: "proc", t: "if age >= 18:", x: 150, y: 36, w: 220 }, { id: "b", k: "proc", t: "    print(\"adult\")", x: 190, y: 90, w: 250 }, { id: "c", k: "proc", t: "    print(\"can vote\")", x: 190, y: 144, w: 250 }, { id: "d", k: "proc", t: "print(\"done\")   (outside)", x: 150, y: 190, w: 260, h: 36 }, { id: "n", k: "io", t: "inside the block\n(indented 4 spaces)", x: 490, y: 117, w: 170, h: 60 }],
    [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "n", to: "b" }]),
  example: { code: `import keyword\n\n# Which of these names are Python keywords?\nfor word in ["for", "student", "class", "age"]:\n    print(word, keyword.iskeyword(word))`, out: `for True\nstudent False\nclass True\nage False` },
  lineByLine: [["import keyword", "Loads the standard <code>keyword</code> module."], ["# Which of these...", "A comment: ignored when running."], ["for word in [...]:", "Repeats the indented block once per word (loops come in Module 6). The colon opens the block."], ["print(word, keyword.iskeyword(word))", "Indented 4 spaces: part of the loop. Prints the word and True/False."]],
  dryRun: { intro: "The loop body runs once for every item:", headers: ["word", "keyword.iskeyword(word)", "Printed"], rows: [["for", "True", "for True"], ["student", "False", "student False"], ["class", "True", "class True"], ["age", "False", "age False"]] },
  realExample: { intro: "A documented function. The docstring explains the purpose and can be read back with <code>__doc__</code>. (Functions are covered in Module 8.)", code: `def area(length, breadth):\n    """Return the area of a rectangle."""\n    return length * breadth\n\nprint(area(4, 5))\nprint(area.__doc__)`, out: `20\nReturn the area of a rectangle.` },
  mistakes: ["Mixing tabs and spaces in one block.", "Forgetting the colon after <code>if</code>, <code>for</code>, <code>def</code>.", "Indenting a line that should not be indented (<em>unexpected indent</em>).", "Using a keyword or a built-in name such as <code>list</code> or <code>print</code> as a variable.", "Over-commenting obvious lines, or writing comments that no longer match the code."],
  practices: ["4 spaces per level; set your editor to insert spaces for Tab.", "Names in <code>snake_case</code>; meaningful, not <code>x1</code>, <code>temp2</code>.", "Comment the <em>why</em>; write a docstring for each function.", "Keep lines under about 79 characters (PEP 8) and break long statements inside brackets."],
  interview: ["How does Python mark a block of code?", "What is the difference between a keyword and an identifier?", "Can an identifier start with a digit? Why not?", "What is a docstring and how is it different from a comment?"],
  practiceQs: ["Which are valid identifiers: total_1, 1_total, total-1, _total, Total?", "Fix: a line after <code>if x > 3:</code> that is not indented.", "Write a docstring for a function that returns the square of a number.", "Use <code>keyword.kwlist</code> to find how many keywords your Python has."],
  revision: ["Blocks start after a colon and are indented (4 spaces).", "# comments; \"\"\"docstrings\"\"\" via __doc__.", "Keywords are reserved; identifiers are names you choose.", "Identifiers: letters, digits, _; not starting with a digit; case-sensitive."],
  hinglish: "Python mein block indentation se bante hain, aur colon (:) ke baad ka code 4 spaces andar likhte hain. # se comment likhte hain. Keywords reserved words hote hain, unko variable name nahi bana sakte.",
  quiz: [
    mcq("How many spaces does PEP 8 recommend per indentation level?", ["1", "2", "4", "8"], 2, "PEP 8 recommends 4 spaces."),
    mcq("Which is NOT a valid identifier?", ["total_marks", "_x", "2nd_year", "Name1"], 2, "Identifiers cannot start with a digit."),
    mcq("What starts a comment in Python?", ["//", "#", "--", "/*"], 1, "# starts a comment that runs to the end of the line."),
    mcq("What does this print?\n\nimport keyword\nprint(keyword.iskeyword(\"while\"))", ["True", "False", "while", "Error"], 0, "while is a keyword.", "OUTPUT_PREDICTION"),
    mcq("What is wrong?\n\nif 5 > 3:\nprint(\"yes\")", ["Missing colon", "The print line is not indented", "5 > 3 is invalid", "Nothing"], 1, "A block needs an indented line, otherwise IndentationError.", "DEBUG"),
  ],
  tasks: [task("Keyword counter", "The list words = [\"for\", \"hello\", \"class\", \"while\", \"student\"] is given. Print how many of them are Python keywords, using keyword.iskeyword.", "import keyword\nwords = [\"for\", \"hello\", \"class\", \"while\", \"student\"]\n# print how many are keywords\n", `import keyword\nwords = ["for", "hello", "class", "while", "student"]\ncount = 0\nfor word in words:\n    if keyword.iskeyword(word):\n        count += 1\nprint(count)`, [["", "3"], ["", "3"]], [["", "3"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Variables, Naming Conventions and Dynamic Typing",
  minutes: 40,
  learn: ["Create variables and explain what a variable really is", "Use multiple assignment, swapping and constants by convention", "Choose good names with PEP 8 conventions", "Use type() and id(), and explain dynamic typing"],
  why: "Variables are how a program remembers anything. Understanding that a name points to an object explains many surprising behaviours later (copying lists, function arguments, mutability).",
  realWorld: "A shopping app stores the cart total, the user's name and the discount in variables; changing them changes what the user sees.",
  simple: "A variable is a <strong>name tag</strong> attached to a value. <code>age = 20</code> sticks the tag <code>age</code> on the value 20. You can later move the tag to another value, even one of a different type.",
  detail: `<h3>Assignment</h3>
<p><code>name = value</code> evaluates the right side first, then binds the name to the resulting object. Python does not need a declaration or a type.</p>
<h3>Multiple assignment</h3>
<ul><li><code>a = b = 0</code> gives both names the value 0.</li><li><code>x, y = 1, 2</code> assigns by position (tuple unpacking).</li><li><code>a, b = b, a</code> swaps two values without a temporary variable.</li></ul>
<h3>Dynamic typing</h3>
<p>Names have no type; <em>values</em> do. <code>x = 5</code> then <code>x = "five"</code> is legal: the tag moved to a different object. Use <code>type(x)</code> to ask what kind of value it points to. Python is also <em>strongly</em> typed: it will not silently add a number to text.</p>
<h3>Object identity</h3>
<p>Every object has an identity number returned by <code>id()</code>. It is unique while the object lives and its exact value changes from run to run, so never print it in an expected output. Two names may point to the very same object (<code>b = a</code>).</p>
<h3>Constants</h3>
<p>Python has no enforced constants. By convention a name in <code>UPPER_CASE</code> means &quot;do not change this&quot;: <code>TAX_RATE = 0.18</code>.</p>
<h3>Naming conventions (PEP 8)</h3>
${table(["Kind", "Style", "Example"], [["Variable, function", "snake_case", "student_name, total_marks"], ["Constant", "UPPER_SNAKE_CASE", "MAX_ATTEMPTS"], ["Class", "CapWords", "StudentRecord"], ["Private by convention", "leading underscore", "_cache"]])}
<p>Avoid names that hide built-ins: <code>list</code>, <code>str</code>, <code>sum</code>, <code>max</code>, <code>input</code>.</p>`,
  syntax: { code: `name = expression\na = b = 0\nx, y = 1, 2\na, b = b, a\nTYPE_CONSTANT = 100`, note: "The right-hand side is evaluated first." },
  diagram: graph("Names point to objects", "Two name tags a and b both pointing to the same list object, and a separate tag c pointing to an equal but different list.", 600, 230,
    [{ id: "a", k: "term", t: "a", x: 80, y: 50, w: 70, h: 40 }, { id: "b", k: "term", t: "b", x: 80, y: 120, w: 70, h: 40 }, { id: "c", k: "term", t: "c", x: 80, y: 180, w: 70, h: 36 }, { id: "o1", k: "proc", t: "list object\n[1, 2, 3]", x: 340, y: 85, w: 170, h: 60 }, { id: "o2", k: "proc", t: "another list object\n[1, 2, 3]", x: 340, y: 180, w: 190, h: 50 }],
    [{ from: "a", to: "o1" }, { from: "b", to: "o1" }, { from: "c", to: "o2" }]),
  example: { code: `age = 20\nprint(age, type(age))\nage = "twenty"\nprint(age, type(age))\n\na = 3\nb = 7\na, b = b, a\nprint(a, b)\n\nTAX_RATE = 0.18\nprint(TAX_RATE)`, out: `20 <class 'int'>\ntwenty <class 'str'>\n7 3\n0.18` },
  lineByLine: [["age = 20", "Creates the name <code>age</code> and points it at the integer 20."], ["print(age, type(age))", "<code>type()</code> reports the class of the value: <code>int</code>."], ["age = \"twenty\"", "The same name now points to a string: dynamic typing."], ["a, b = b, a", "The right side becomes (7, 3) first; then a=7 and b=3: a swap."], ["TAX_RATE = 0.18", "UPPER_CASE signals a constant by convention."]],
  dryRun: { intro: "Swapping with a, b = b, a:", headers: ["Step", "a", "b", "Note"], rows: [["start", "3", "7", ""], ["evaluate right side", "3", "7", "builds the pair (7, 3)"], ["assign", "7", "3", "a gets 7, b gets 3"]] },
  realExample: { intro: "Two names for one list: changing it through one name shows in the other. This is the foundation for understanding mutability (Module 7 and 12).", code: `a = [1, 2, 3]\nb = a\nc = [1, 2, 3]\nb.append(4)\nprint(a)\nprint(a is b)\nprint(a is c)\nprint(c)`, out: `[1, 2, 3, 4]\nTrue\nFalse\n[1, 2, 3]` },
  mistakes: ["Using a variable before giving it a value (NameError).", "Spelling the name differently on two lines (<code>total</code> vs <code>Total</code>).", "Thinking <code>b = a</code> copies a list. It copies only the tag.", "Reusing built-in names such as <code>list</code>, <code>sum</code> or <code>str</code> for your variables.", "Writing numbers with quotes and then being surprised that <code>\"5\" + \"5\"</code> is <code>\"55\"</code>."],
  practices: ["Name by meaning: <code>total_marks</code>, not <code>tm</code>.", "Use UPPER_CASE for fixed values and keep them near the top of the file.", "Initialise a variable before using it.", "Do not rely on specific <code>id()</code> numbers; use them only to compare identity."],
  interview: ["Is Python statically or dynamically typed? Strongly or weakly?", "What does <code>a, b = b, a</code> do?", "What is the difference between <code>==</code> and <code>is</code>? (preview)", "Does Python have constants?"],
  practiceQs: ["Write the output: x = 5; y = x; x = 10; print(y).", "Swap two variables without using a third.", "Which names break PEP 8: StudentName, total_marks, MAXMARKS, 3rdYear?", "What does type(3.0) return?"],
  revision: ["Variable = name tag pointing to an object.", "Types belong to values, not names.", "a, b = b, a swaps.", "UPPER_CASE = constant by convention; snake_case for the rest."],
  hinglish: "Variable ek naam hota hai jo kisi value ya object ki taraf point karta hai. Python mein type value ka hota hai, naam ka nahi, isliye x pehle number aur baad mein text ho sakta hai. a, b = b, a se do values swap hoti hain.",
  quiz: [
    mcq("What is printed?\n\nx = 5\ny = x\nx = 10\nprint(y)", ["5", "10", "15", "Error"], 0, "y still points to 5; reassigning x moves only the x tag.", "OUTPUT_PREDICTION"),
    mcq("Which is the PEP 8 style for a variable name?", ["StudentName", "student_name", "STUDENTNAME", "student-name"], 1, "Variables use snake_case; hyphens are not allowed."),
    mcq("What does this print?\n\nx = \"5\"\nprint(type(x))", ["<class 'int'>", "<class 'str'>", "<class 'float'>", "5"], 1, "The quotes make it a string.", "OUTPUT_PREDICTION"),
    mcq("After a, b = 1, 2 and a, b = b, a, what is a?", ["1", "2", "3", "Error"], 1, "The values were swapped, so a is 2."),
    mcq("What is the output?\n\na = [1]\nb = a\nb.append(2)\nprint(a)", ["[1]", "[1, 2]", "[2]", "Error"], 1, "a and b are the same list object.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Swap two numbers", "Given a = 3 and b = 7, swap them and print the result as: a b (separated by a space), i.e. 7 3.", "a = 3\nb = 7\n# swap, then print\n", `a = 3\nb = 7\na, b = b, a\nprint(a, b)`, [["", "7 3"], ["", "7 3"]], [["", "7 3"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Input, Output and Type Conversion",
  minutes: 40,
  learn: ["Read text from the keyboard with input()", "Convert between str, int, float and bool", "Format output with f-strings", "Handle the most common conversion errors"],
  why: "Almost every useful program reads data, changes its type and shows a result. Mixing up text and numbers is the number-one source of beginner bugs.",
  realWorld: "A billing screen reads quantity and price as text from a form, converts them to numbers, multiplies and displays the total.",
  simple: "<code>input()</code> always gives you <strong>text</strong>, even if the user types digits. Convert it with <code>int()</code> or <code>float()</code> before doing arithmetic.",
  detail: `<h3>Reading input</h3>
<p><code>input(prompt)</code> shows an optional prompt, waits for Enter and returns what the user typed as a <code>str</code> (without the newline).</p>
<h3>Type conversion (casting)</h3>
${table(["Function", "Example", "Result", "Notes"], [["int()", "int(\"42\")", "42", "int(\"3.5\") is a ValueError; int(3.9) truncates to 3"], ["float()", "float(\"3.5\")", "3.5", "float(2) is 2.0"], ["str()", "str(25)", "'25'", "any object has a text form"], ["bool()", "bool(\"\")", "False", "empty/zero values are False; others True"], ["round()", "round(2.675, 2)", "2.67", "float storage makes some results surprising; round(2.5) is 2 (rounds half to even)"]])}
<p>Python is strongly typed: <code>"5" + 3</code> raises <code>TypeError</code>. Convert one side: <code>int("5") + 3</code> or <code>"5" + str(3)</code>.</p>
<h3>Formatting output</h3>
<p>f-strings put values inside text: <code>f"Total: {total}"</code>. Add a format after a colon: <code>{value:.2f}</code> two decimals, <code>{value:,}</code> thousands separators, <code>{value:>8}</code> right-align in 8 characters. Full string formatting is covered in Module 4.</p>
<h3>Reading several values on one line</h3>
<p><code>a, b = input().split()</code> splits the line on spaces. Convert each: <code>a, b = map(int, input().split())</code>.</p>
<h3>Errors to expect</h3>
<ul><li><code>ValueError</code>: the text cannot be converted (<code>int("abc")</code>).</li><li><code>TypeError</code>: mixing incompatible types (<code>"5" + 3</code>).</li><li><code>EOFError</code>: <code>input()</code> was called but no more input exists.</li></ul>
<p>Exception handling (Module 9) shows how to deal with bad input gracefully.</p>`,
  syntax: { code: `text = input("Prompt: ")\nn = int(text)\nx = float(text)\nprint(f"Value: {x:.2f}")`, note: "input() returns str; convert before arithmetic." },
  diagram: chain("Input to output", "Four boxes: input returns text, convert to a number, calculate, print the result.",
    [{ k: "io", t: "input()\n(text \"25\")" }, { k: "proc", t: "int(...)\n(number 25)" }, { k: "proc", t: "calculate\n25 + 1" }, { k: "io", t: "print()\n26" }], { w: 135, gap: 28, hgt: 58 }),
  example: { code: `text = input()\nage = int(text)\nprint(type(text))\nprint(type(age))\nprint(age + 1)`, out: `<class 'str'>\n<class 'int'>\n21`, stdin: "20" },
  lineByLine: [["text = input()", "Reads the line the user typed. With the input 20 it is the <em>string</em> \"20\"."], ["age = int(text)", "Converts the text to the integer 20."], ["print(type(text))", "Shows <code>str</code>."], ["print(age + 1)", "Integer arithmetic: 21."]],
  dryRun: { intro: "Input line: 20", headers: ["After line", "text", "age", "Output"], rows: [["1", "\"20\"", "-", ""], ["2", "\"20\"", "20", ""], ["3", "\"20\"", "20", "&lt;class 'str'&gt;"], ["4", "\"20\"", "20", "&lt;class 'int'&gt;"], ["5", "\"20\"", "20", "21"]] },
  realExample: { intro: "A bill: two numbers read as text, converted, multiplied and shown with two decimals. Input lines: <code>3</code> and <code>45.5</code>.", code: `quantity = int(input())\nprice = float(input())\ntotal = quantity * price\nprint(f"Total: {total:.2f}")`, out: `Total: 136.50`, stdin: "3\n45.5" },
  mistakes: ["Forgetting that input() returns text: <code>input() + 1</code> is a TypeError, and <code>input() + input()</code> joins text.", "Calling <code>int()</code> on text like \"3.5\" or \"abc\" (ValueError).", "Using <code>int()</code> when you need decimals; use <code>float()</code>.", "Printing a number joined to text with <code>+</code>: <code>\"Age: \" + 20</code> is a TypeError; use an f-string.", "Expecting <code>round(2.5)</code> to be 3 (it is 2)."],
  practices: ["Convert immediately after reading.", "Show a clear prompt: <code>input(\"Enter marks: \")</code> (omit prompts in judged programs unless asked, because extra text counts as output).", "Use f-strings instead of string concatenation.", "Validate input before relying on it (Module 9)."],
  interview: ["What type does input() return?", "Why does <code>\"5\" + 3</code> fail but <code>\"5\" * 3</code> work?", "Difference between int(3.9) and round(3.9)?", "What does bool(\"False\") return?"],
  practiceQs: ["Predict: print(int(\"7\") + int(\"8\")) and print(\"7\" + \"8\").", "Why does int(\"2.5\") fail? How can you get 2 from \"2.5\"?", "Read two numbers on one line and print their sum.", "What is bool(0), bool(\"0\"), bool([])?"],
  revision: ["input() &rarr; str.", "int(), float(), str(), bool() convert.", "f\"{x:.2f}\" for two decimals.", "ValueError = bad text; TypeError = wrong mix of types."],
  hinglish: "input() hamesha text (str) deta hai, chahe user number hi type kare. Calculation se pehle int() ya float() se convert karo. Output ke liye f-string sabse aasaan hai.",
  quiz: [
    mcq("What type does input() always return?", ["int", "float", "str", "bool"], 2, "input() returns a string."),
    mcq("What is the result of int(\"3.5\")?", ["3", "4", "3.5", "ValueError"], 3, "int() cannot parse a decimal string; use int(float(\"3.5\"))."),
    mcq("What is printed?\n\nprint(\"5\" * 3)", ["15", "555", "Error", "5 5 5"], 1, "Repeating a string joins copies.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nprint(bool(\"\"), bool(\"a\"))", ["True True", "False True", "False False", "True False"], 1, "The empty string is falsy; non-empty is truthy.", "OUTPUT_PREDICTION"),
    mcq("Find the bug:\n\nage = input()\nprint(age + 1)", ["Nothing", "age is text; convert with int()", "print needs brackets", "1 must be text"], 1, "Text plus a number raises TypeError.", "DEBUG"),
    mcq("What does round(2.5) return in Python 3?", ["3", "2", "2.5", "Error"], 1, "Python rounds half to even, so round(2.5) is 2."),
  ],
  tasks: [
    task("Next year's age", "Read the name on the first line and the age on the second line. Print: <name> will be <age+1> next year.", "name = input()\n# read the age, then print the message\n", `name = input()\nage = int(input())\nprint(f"{name} will be {age + 1} next year.")`, [["Asha\n20", "Asha will be 21 next year."], ["Ravi\n17", "Ravi will be 18 next year."]], [["Asha\n20", "Asha will be 21 next year."], ["Zoya\n0", "Zoya will be 1 next year."], ["Kiran\n99", "Kiran will be 100 next year."]]),
    task("Bill total", "Read the quantity (an integer) and the unit price (a decimal) on two lines. Print the total with exactly 2 decimal places.", "# read quantity and price\n", `quantity = int(input())\nprice = float(input())\nprint(f"{quantity * price:.2f}")`, [["3\n45.5", "136.50"], ["2\n10", "20.00"]], [["3\n45.5", "136.50"], ["1\n99.99", "99.99"], ["10\n0.1", "1.00"]]),
  ],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Arithmetic Operators",
  minutes: 35,
  learn: ["Use + - * / // % ** correctly", "Explain the difference between / and //", "Use divmod, abs, round and pow", "Understand floating-point surprises"],
  why: "Calculations are in every program. // and % in particular power digit tricks, even/odd checks, clock arithmetic and many interview problems.",
  realWorld: "Converting 130 minutes to hours and minutes is divmod(130, 60). Splitting a bill, computing GST and paging through search results all use these operators.",
  simple: "Python is a calculator: + - * work as usual, <code>/</code> always gives a decimal, <code>//</code> gives the whole-number part of a division, <code>%</code> gives the remainder, <code>**</code> is power.",
  detail: `${table(["Operator", "Meaning", "Example", "Result"], [["+", "add", "7 + 3", "10"], ["-", "subtract", "7 - 3", "4"], ["*", "multiply", "7 * 3", "21"], ["/", "true division (always float)", "7 / 2", "3.5"], ["//", "floor division", "7 // 2", "3"], ["%", "remainder (modulo)", "7 % 2", "1"], ["**", "power", "2 ** 10", "1024"]])}
<h3>Floor division and modulo with negatives</h3>
<p><code>//</code> rounds <em>down</em> (toward negative infinity), so <code>-7 // 2</code> is <code>-4</code>, not -3. The identity <code>a == (a // b) * b + a % b</code> always holds, which is why <code>-7 % 3</code> is <code>2</code>. The result of <code>%</code> has the sign of the divisor.</p>
<h3>Useful built-ins</h3>
<ul><li><code>divmod(a, b)</code> returns <code>(a // b, a % b)</code> together.</li><li><code>abs(x)</code> absolute value; <code>pow(a, b)</code> same as <code>a ** b</code>; <code>round(x, n)</code> rounds to n decimals.</li></ul>
<h3>Floating-point numbers</h3>
<p>Computers store decimals in binary, so some decimals are only approximations: <code>0.1 + 0.2</code> is <code>0.30000000000000004</code>. This is true in every language, not a Python bug. Round for display (<code>round(x, 2)</code> or <code>f"{x:.2f}"</code>) and never compare floats with <code>==</code>; use <code>math.isclose()</code>. Integers have unlimited size in Python: <code>2 ** 100</code> works.</p>
<p>Division by zero (<code>5 / 0</code>, <code>5 // 0</code>, <code>5 % 0</code>) raises <code>ZeroDivisionError</code>.</p>`,
  syntax: { code: `a + b   a - b   a * b\na / b    # float\na // b   # floor\na % b    # remainder\na ** b   # power\ndivmod(a, b)`, note: "Operators work on numbers; + and * also work on text and lists." },
  diagram: graph("Division, floor division and remainder of 17 and 5", "Seventeen split into three groups of five with two left over: 17 / 5 is 3.4, 17 // 5 is 3, 17 % 5 is 2.", 600, 170,
    [{ id: "a", k: "term", t: "17 ÷ 5", x: 90, y: 85, w: 110 }, { id: "b", k: "proc", t: "17 / 5 = 3.4", x: 330, y: 35, w: 170, h: 40 }, { id: "c", k: "proc", t: "17 // 5 = 3  (whole groups)", x: 330, y: 85, w: 230, h: 40 }, { id: "d", k: "proc", t: "17 % 5 = 2  (left over)", x: 330, y: 135, w: 230, h: 40 }],
    [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "a", to: "d" }]),
  example: { code: `print(17 / 5)\nprint(17 // 5)\nprint(17 % 5)\nprint(2 ** 10)\nprint(divmod(17, 5))\nprint(-7 // 2, -7 % 3)\nprint(0.1 + 0.2)\nprint(round(0.1 + 0.2, 2))`, out: `3.4\n3\n2\n1024\n(3, 2)\n-4 2\n0.30000000000000004\n0.3` },
  lineByLine: [["17 / 5", "True division: always a float, 3.4."], ["17 // 5", "How many whole 5s fit into 17: 3."], ["17 % 5", "What is left after taking those 3 fives: 2."], ["2 ** 10", "2 multiplied by itself 10 times."], ["-7 // 2, -7 % 3", "Floor division rounds toward negative infinity (-4); the remainder takes the divisor's sign (2)."], ["round(0.1 + 0.2, 2)", "Rounds the float noise away for display."]],
  dryRun: { intro: "Checking the identity for -7 and 3: -7 == (-7 // 3) * 3 + (-7 % 3)", headers: ["Part", "Value"], rows: [["-7 // 3", "-3"], ["(-7 // 3) * 3", "-9"], ["-7 % 3", "2"], ["-9 + 2", "-7  (identity holds)"]] },
  realExample: { intro: "Convert a duration in minutes to hours and minutes, and a number to its last digit.", code: `minutes = 130\nhours, mins = divmod(minutes, 60)\nprint(f"{hours} h {mins} min")\nnumber = 4821\nprint(number % 10)\nprint(number // 10)`, out: `2 h 10 min\n1\n482` },
  mistakes: ["Expecting <code>7 / 2</code> to be 3.", "Using <code>^</code> for power (it is XOR in Python): use <code>**</code>.", "Comparing floats with <code>==</code>.", "Forgetting that <code>//</code> floors negatives.", "Dividing by zero without checking."],
  practices: ["Use <code>//</code> and <code>%</code> for integer work; <code>/</code> only when you want a decimal.", "Round only for display, not during calculations.", "For money use integers (paise) or the <code>decimal</code> module."],
  interview: ["Difference between / and //?", "What is -7 // 2 and why?", "How do you get the last digit and remove it from a number?", "Why is 0.1 + 0.2 != 0.3?"],
  practiceQs: ["Compute 100 // 7, 100 % 7 and divmod(100, 7).", "Write an expression that gives the sum of the digits of a two-digit number n.", "What is 2 ** 3 ** 2?", "What is 10 % 3 * 2?"],
  revision: ["/ float, // floor, % remainder, ** power.", "divmod gives both.", "Negative floor division rounds down.", "Floats are approximate; round for display."],
  hinglish: "/ hamesha decimal deta hai, // sirf poora hissa, % remainder aur ** power. Last digit nikalne ke liye n % 10 aur last digit hatane ke liye n // 10 use karte hain.",
  quiz: [
    mcq("What is 17 // 5?", ["3.4", "3", "2", "4"], 1, "Floor division returns the whole number of times 5 fits in 17."),
    mcq("What is 17 % 5?", ["3", "2", "5", "0.4"], 1, "The remainder is 2."),
    mcq("What is 2 ** 3 ** 2?", ["64", "512", "36", "Error"], 1, "** is right-associative: 3 ** 2 = 9, then 2 ** 9 = 512.", "OUTPUT_PREDICTION"),
    mcq("What is the output?\n\nprint(-7 // 2)", ["-3", "-4", "3", "-3.5"], 1, "Floor division rounds down toward negative infinity.", "OUTPUT_PREDICTION"),
    mcq("Which operator raises to a power?", ["^", "**", "pow only", "//"], 1, "** is power; ^ is bitwise XOR."),
  ],
  tasks: [task("Quotient and remainder", "Read two integers a and b (one per line, b is not zero). Print the quotient (a // b) and the remainder (a % b) separated by a space.", "a = int(input())\nb = int(input())\n# print quotient and remainder\n", `a = int(input())\nb = int(input())\nprint(a // b, a % b)`, [["17\n5", "3 2"], ["100\n7", "14 2"]], [["17\n5", "3 2"], ["9\n3", "3 0"], ["5\n9", "0 5"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Comparison, Logical and Assignment Operators",
  minutes: 35,
  learn: ["Compare values with == != < > <= >=", "Combine conditions with and, or, not", "Use chained comparisons", "Use augmented assignment such as +="],
  why: "Decisions (Module 5) and loops (Module 6) are built from comparisons and logical operators.",
  realWorld: "A login check is: username matches AND password matches. An offer applies if the bill is above 500 OR the customer is a member.",
  simple: "A comparison asks a yes/no question and answers <code>True</code> or <code>False</code>. <code>and</code>, <code>or</code> and <code>not</code> combine such answers. <code>x += 1</code> is a short way to write <code>x = x + 1</code>.",
  detail: `<h3>Comparison operators</h3>
${table(["Operator", "Meaning", "Example", "Result"], [["==", "equal to", "5 == 5", "True"], ["!=", "not equal", "5 != 3", "True"], ["<  >", "less / greater", "3 < 5", "True"], ["<=  >=", "less-or-equal / greater-or-equal", "5 >= 6", "False"]])}
<p>Do not confuse <code>=</code> (assign) with <code>==</code> (compare). Python allows <strong>chained comparisons</strong>: <code>1 &lt; x &lt; 10</code> means <code>1 &lt; x and x &lt; 10</code>.</p>
<h3>Logical operators</h3>
${table(["a", "b", "a and b", "a or b", "not a"], [["True", "True", "True", "True", "False"], ["True", "False", "False", "True", "False"], ["False", "True", "False", "True", "True"], ["False", "False", "False", "False", "True"]])}
<p><strong>Short-circuit evaluation:</strong> <code>and</code> stops at the first false operand and <code>or</code> stops at the first true one; the rest is not evaluated. They return one of their operands, not necessarily <code>True</code>/<code>False</code>: <code>0 or "default"</code> is <code>"default"</code>.</p>
<h3>Assignment operators</h3>
<p><code>+=  -=  *=  /=  //=  %=  **=</code> update a variable using its own value: <code>total += 5</code>.</p>`,
  syntax: { code: `a == b    a != b    a < b    a <= b\nlow <= x <= high\ncond1 and cond2\ncond1 or cond2\nnot cond\nx += 1`, note: "Comparisons give True or False." },
  diagram: graph("Truth of a and b", "Two inputs a and b feed an AND box and an OR box; AND is true only if both are true, OR if at least one is true.", 600, 170,
    [{ id: "a", k: "term", t: "a", x: 70, y: 50, w: 80, h: 40 }, { id: "b", k: "term", t: "b", x: 70, y: 120, w: 80, h: 40 }, { id: "and", k: "proc", t: "a and b\ntrue only if both", x: 340, y: 50, w: 210, h: 56 }, { id: "or", k: "proc", t: "a or b\ntrue if either", x: 340, y: 125, w: 210, h: 56 }],
    [{ from: "a", to: "and" }, { from: "b", to: "and" }, { from: "a", to: "or" }, { from: "b", to: "or" }]),
  example: { code: `age = 20\nprint(age >= 18)\nprint(1 < age < 10)\nprint(age > 18 and age < 30)\nprint(not age == 20)\nprint(0 or "default")\n\ntotal = 10\ntotal += 5\ntotal *= 2\nprint(total)`, out: `True\nFalse\nTrue\nFalse\ndefault\n30` },
  lineByLine: [["age >= 18", "True because 20 is at least 18."], ["1 < age < 10", "Chained: 1 < 20 is True but 20 < 10 is False, so the whole is False."], ["age > 18 and age < 30", "Both parts are True."], ["not age == 20", "<code>age == 20</code> is True, <code>not</code> flips it to False."], ["0 or \"default\"", "0 is falsy, so <code>or</code> returns the second value."], ["total += 5", "total becomes 15; then <code>*= 2</code> makes it 30."]],
  dryRun: { intro: "Tracing the augmented assignments:", headers: ["Statement", "total"], rows: [["total = 10", "10"], ["total += 5", "15"], ["total *= 2", "30"]] },
  realExample: { intro: "Is a student eligible? Marks must be at least 40 in every subject, or the student holds a special approval.", code: `maths = 45\nscience = 38\nspecial_approval = True\npassed_all = maths >= 40 and science >= 40\neligible = passed_all or special_approval\nprint(passed_all)\nprint(eligible)`, out: `False\nTrue` },
  mistakes: ["Writing <code>if x = 5</code> (assignment) instead of <code>==</code>.", "Writing <code>x == 1 or 2</code> and expecting &quot;x is 1 or 2&quot;; write <code>x == 1 or x == 2</code> or <code>x in (1, 2)</code>.", "Comparing text with numbers: <code>\"10\" &lt; 5</code> is a TypeError.", "Comparing floats with ==.", "Forgetting that <code>and</code> binds tighter than <code>or</code>."],
  practices: ["Name boolean variables as questions: <code>is_valid</code>, <code>has_discount</code>.", "Use brackets in long conditions to make the grouping obvious.", "Prefer chained comparisons for ranges: <code>0 &lt;= x &lt;= 100</code>."],
  interview: ["What is short-circuit evaluation?", "What does <code>0 or \"x\"</code> return?", "Difference between = and ==?", "Is <code>1 &lt; x &lt; 5</code> valid in Python? In C?"],
  practiceQs: ["Write one expression that is True when n is between 10 and 20 inclusive.", "Evaluate: True or False and False.", "Rewrite x = x * 3 using an augmented operator.", "What is not (5 > 3)?"],
  revision: ["== != < > <= >= give True/False.", "and, or, not combine; short-circuit.", "Chained comparisons: 1 < x < 10.", "+= -= *= update in place."],
  hinglish: "Comparison ka jawab hamesha True ya False hota hai. and tab True jab dono True ho, or tab True jab koi ek True ho, not ulta kar deta hai. total += 5 ka matlab total = total + 5.",
  quiz: [
    mcq("What is 5 == 5.0?", ["True", "False", "Error", "None"], 0, "Python compares numeric values; 5 equals 5.0."),
    mcq("Which expression checks that x is between 1 and 10 inclusive?", ["1 <= x <= 10", "1 <= x or x <= 10", "x == 1 to 10", "1 < x > 10"], 0, "Chained comparison."),
    mcq("What is the value of True or False and False?", ["True", "False", "Error", "None"], 0, "and binds tighter: False and False is False, then True or False is True.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nx = 4\nx += 3\nx *= 2\nprint(x)", ["14", "10", "11", "24"], 0, "x becomes 7, then 14.", "OUTPUT_PREDICTION"),
    mcq("What does this print?\n\nprint(0 or \"hi\")", ["0", "hi", "True", "False"], 1, "or returns the first truthy operand.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Valid marks", "Read an integer mark. Print True if it is between 0 and 100 inclusive, otherwise print False.", "marks = int(input())\n# print whether marks is between 0 and 100\n", `marks = int(input())\nprint(0 <= marks <= 100)`, [["55", "True"], ["101", "False"]], [["55", "True"], ["0", "True"], ["100", "True"], ["-1", "False"], ["101", "False"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Bitwise, Membership and Identity Operators",
  minutes: 35,
  learn: ["Use & | ^ ~ << >> on integers", "Test membership with in and not in", "Understand is versus ==", "Recognise where bit operations appear in practice"],
  why: "Membership tests are used constantly; bitwise operators appear in permissions, flags, compression and interview puzzles; <code>is</code> vs <code>==</code> is a classic interview question.",
  realWorld: "File permissions (read/write/execute) are stored as bits; a username check is a membership test against a list or set.",
  simple: "<code>in</code> asks &quot;is this item inside that collection?&quot;. <code>==</code> asks &quot;do these have the same value?&quot; while <code>is</code> asks &quot;are these the very same object?&quot;. Bitwise operators work on the 0s and 1s of whole numbers.",
  detail: `<h3>Bitwise operators</h3>
${table(["Operator", "Name", "5 and 3 (101 and 011)", "Result"], [["&", "AND", "5 & 3", "1  (001)"], ["|", "OR", "5 | 3", "7  (111)"], ["^", "XOR", "5 ^ 3", "6  (110)"], ["~", "NOT", "~5", "-6  (~x equals -x - 1)"], ["<<", "left shift", "5 << 1", "10  (doubles)"], [">>", "right shift", "5 >> 1", "2  (halves, floor)"]])}
<p>Handy facts: <code>n &amp; 1</code> is 1 for odd numbers; <code>n &lt;&lt; k</code> equals <code>n * 2**k</code>; <code>a ^ a</code> is 0.</p>
<h3>Membership operators</h3>
<p><code>x in collection</code> and <code>x not in collection</code> work with strings (substring test), lists, tuples, sets and dictionaries (keys). On a set or dict the test is fast; on a list Python checks items one by one.</p>
<h3>Identity operators</h3>
<p><code>a is b</code> is True only if both names point to the <em>same object</em> (<code>id(a) == id(b)</code>). <code>a == b</code> compares values. Use <code>is</code> mainly for <code>None</code>: <code>if x is None</code>. Do not use <code>is</code> to compare numbers or strings: small objects may be shared by an implementation detail, and the result can differ between Python versions.</p>`,
  syntax: { code: `a & b   a | b   a ^ b   ~a   a << n   a >> n\nitem in collection\nitem not in collection\na is b      a is not b`, note: "Bitwise operators need integers." },
  diagram: graph("Bitwise AND, OR and XOR of 5 and 3", "Three result rows from the bit patterns 101 and 011: AND gives 001, OR gives 111 and XOR gives 110.", 600, 190,
    [{ id: "i", k: "io", t: "5 = 101\n3 = 011", x: 100, y: 95, w: 150, h: 60 }, { id: "a", k: "proc", t: "AND  &  -> 001 = 1", x: 400, y: 35, w: 250, h: 38 }, { id: "o", k: "proc", t: "OR   |  -> 111 = 7", x: 400, y: 95, w: 250, h: 38 }, { id: "x", k: "proc", t: "XOR  ^  -> 110 = 6", x: 400, y: 155, w: 250, h: 38 }],
    [{ from: "i", to: "a" }, { from: "i", to: "o" }, { from: "i", to: "x" }]),
  example: { code: `print(5 & 3, 5 | 3, 5 ^ 3)\nprint(~5, 5 << 1, 5 >> 1)\nprint("a" in "cat", 3 not in [1, 2, 4])\nx = [1, 2]\ny = [1, 2]\nz = x\nprint(x == y, x is y, x is z)\nprint(7 & 1)`, out: `1 7 6\n-6 10 2\nTrue True\nTrue False True\n1` },
  lineByLine: [["5 & 3, 5 | 3, 5 ^ 3", "Bit by bit: 101 and 011 give 001, 111 and 110."], ["~5, 5 << 1, 5 >> 1", "NOT is -6; shifting left once doubles to 10; right once gives 2."], ["\"a\" in \"cat\"", "Substring test: True."], ["x == y, x is y, x is z", "Equal values (True), different objects (False), same object (True)."], ["7 & 1", "The lowest bit of 7 is 1: odd."]],
  dryRun: { intro: "Computing 5 ^ 3 bit by bit:", headers: ["bit position", "5", "3", "XOR"], rows: [["4s", "1", "0", "1"], ["2s", "0", "1", "1"], ["1s", "1", "1", "0"], ["result", "", "", "110 = 6"]] },
  realExample: { intro: "Permission flags: read=4, write=2, execute=1, stored as bits in one number.", code: `READ, WRITE, EXECUTE = 4, 2, 1\npermissions = READ | WRITE\nprint(permissions)\nprint(bool(permissions & WRITE))\nprint(bool(permissions & EXECUTE))`, out: `6\nTrue\nFalse` },
  mistakes: ["Using <code>^</code> for power.", "Using <code>is</code> to compare numbers or strings.", "Using <code>and</code>/<code>or</code> where you need <code>&amp;</code>/<code>|</code> on bits (and the reverse).", "Applying bitwise operators to floats (TypeError).", "Forgetting that <code>in</code> on a dictionary checks keys, not values."],
  practices: ["Use <code>is None</code> / <code>is not None</code> for None checks.", "Use <code>in</code> with sets for fast lookups.", "Name flag constants and combine them with <code>|</code> instead of using magic numbers."],
  interview: ["How do you check if a number is odd using bits?", "Difference between == and is?", "What does ~5 return and why?", "How fast is <code>x in my_list</code> compared with <code>x in my_set</code>?"],
  practiceQs: ["Evaluate 12 & 10, 12 | 10, 12 ^ 10.", "Without a loop, how can you test if n is a power of two? (hint: n & (n - 1))", "What is 1 << 4?", "Predict: \"ab\" in \"cab\"."],
  revision: ["& | ^ ~ << >> work on bits.", "in / not in test membership.", "is = same object; == = same value.", "Use is only with None."],
  hinglish: "Bitwise operators numbers ke bits par kaam karte hain. in se pata chalta hai item collection mein hai ya nahi. == value compare karta hai aur is dekhta hai ki dono naam ek hi object ko point karte hain ya nahi.",
  quiz: [
    mcq("What is 5 & 3?", ["1", "7", "6", "8"], 0, "101 AND 011 is 001."),
    mcq("What is 1 << 3?", ["3", "6", "8", "4"], 2, "Shifting left 3 times multiplies by 8."),
    mcq("What does this print?\n\nprint(\"py\" in \"python\")", ["True", "False", "py", "Error"], 0, "A substring test.", "OUTPUT_PREDICTION"),
    mcq("Which is the correct way to test for None?", ["x == None only", "x is None", "x = None", "None in x"], 1, "Use the identity test with None."),
    mcq("What is printed?\n\na = [1]\nb = [1]\nprint(a == b, a is b)", ["True True", "True False", "False True", "False False"], 1, "Equal values, different objects.", "OUTPUT_PREDICTION"),
  ],
  tasks: [
    task("Odd or even bit", "Read an integer n and print its lowest bit (n & 1): 1 for odd numbers and 0 for even numbers.", "n = int(input())\n# print the lowest bit\n", `n = int(input())\nprint(n & 1)`, [["7", "1"], ["8", "0"]], [["7", "1"], ["8", "0"], ["0", "0"], ["1001", "1"]]),
    task("Vowel check", "Read a single lowercase letter and print True if it is one of a, e, i, o, u, otherwise False. Use the in operator.", "ch = input()\n# print whether ch is a vowel\n", `ch = input()\nprint(ch in "aeiou")`, [["e", "True"], ["k", "False"]], [["e", "True"], ["k", "False"], ["a", "True"], ["z", "False"]]),
  ],
});

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Operator Precedence and Expressions",
  minutes: 30,
  learn: ["State the order in which Python evaluates operators", "Use brackets to make intent clear", "Trace a complex expression step by step", "Spot and fix precedence bugs"],
  why: "Two programmers can read <code>a + b * c</code> differently; Python follows fixed rules. Knowing them (and adding brackets when in doubt) prevents silent logic errors.",
  realWorld: "A discount calculation like <code>price - price * discount / 100</code> returns the wrong amount if precedence is misread.",
  simple: "Maths rules apply: power first, then multiply/divide, then add/subtract, then comparisons, then <code>not</code>, <code>and</code>, <code>or</code>. When unsure, add brackets.",
  detail: `<h3>Precedence from highest to lowest</h3>
${table(["Level", "Operators"], [["1 (first)", "( ) brackets"], ["2", "** (power; right-to-left)"], ["3", "+x  -x  ~x (unary)"], ["4", "*  /  //  %"], ["5", "+  -"], ["6", "<<  >>"], ["7", "&"], ["8", "^"], ["9", "|"], ["10", "== != < > <= >= in not in is is not (comparisons, chainable)"], ["11", "not"], ["12", "and"], ["13 (last)", "or"], ["after all", "assignment ="]])}
<h3>Associativity</h3>
<p>Operators of the same level are evaluated left-to-right (<code>10 - 4 - 3</code> is <code>3</code>), except <code>**</code> which goes right-to-left (<code>2 ** 3 ** 2</code> is 512).</p>
<h3>A famous trap</h3>
<p><code>-2 ** 2</code> is <code>-4</code>: power binds tighter than unary minus, so it means <code>-(2 ** 2)</code>. Write <code>(-2) ** 2</code> for 4.</p>
<h3>Expression vs statement</h3>
<p>An <strong>expression</strong> produces a value (<code>3 + 4</code>); a <strong>statement</strong> does something (<code>x = 3 + 4</code>, <code>print(x)</code>).</p>`,
  syntax: { code: `result = (a + b) * c ** 2 > limit and not flag`, note: "Brackets override precedence." },
  diagram: chain("Evaluating 2 + 3 * 4 ** 2", "Vertical steps: power first (4 ** 2 = 16), multiplication next (3 * 16 = 48), addition last (2 + 48 = 50).",
    [{ k: "term", t: "2 + 3 * 4 ** 2" }, { k: "proc", t: "4 ** 2 = 16" }, { k: "proc", t: "3 * 16 = 48" }, { k: "proc", t: "2 + 48 = 50" }], { vertical: true, w: 210, hgt: 40, gap: 22 }),
  example: { code: `print(2 + 3 * 4 ** 2)\nprint((2 + 3) * 4)\nprint(-2 ** 2, (-2) ** 2)\nprint(10 - 4 - 3)\nprint(True or False and False)\nprint(not 3 > 5)\nprint(10 % 3 * 2)`, out: `50\n20\n-4 4\n3\nTrue\nTrue\n2` },
  lineByLine: [["2 + 3 * 4 ** 2", "Power (16), then multiply (48), then add (50)."], ["(2 + 3) * 4", "Brackets first: 5 * 4."], ["-2 ** 2, (-2) ** 2", "Power before unary minus gives -4; with brackets, 4."], ["10 - 4 - 3", "Left to right: (10 - 4) - 3."], ["True or False and False", "and first (False), then or (True)."], ["not 3 > 5", "Comparison first (False), then not (True)."], ["10 % 3 * 2", "Same level, left to right: (10 % 3) * 2 = 1 * 2."]],
  dryRun: { intro: "Tracing 10 % 3 * 2 and 2 + 3 * 4 ** 2:", headers: ["Expression", "Step 1", "Step 2", "Step 3", "Result"], rows: [["10 % 3 * 2", "10 % 3 = 1", "1 * 2 = 2", "", "2"], ["2 + 3 * 4 ** 2", "4 ** 2 = 16", "3 * 16 = 48", "2 + 48 = 50", "50"]] },
  realExample: { intro: "Discount: 20% off a price of 500, computed two ways. One of them is a bug.", code: `price = 500\ndiscount = 20\nwrong = price - price * discount / 100 + 0\nright = price - (price * discount / 100)\nprint(wrong)\nprint(right)\nprint(price * (100 - discount) / 100)`, out: `400.0\n400.0\n400.0` },
  mistakes: ["Reading <code>a + b / 2</code> as <code>(a + b) / 2</code>.", "Writing <code>-x ** 2</code> and expecting a positive result.", "Long unbracketed conditions mixing and/or.", "Assuming all operators go left to right (** does not).", "Relying on precedence tables from other languages (C's precedence is not identical)."],
  practices: ["Add brackets whenever a reader could hesitate.", "Split long expressions into named steps.", "Test tricky expressions in the shell."],
  interview: ["Evaluate: 2 + 3 * 4 ** 2.", "Why is -3 ** 2 equal to -9?", "Which binds tighter: and or or?", "Which operator is right-associative?"],
  practiceQs: ["Evaluate 100 / 10 * 2 and 100 / (10 * 2).", "Add brackets to make a + b * c mean (a + b) * c.", "Evaluate not True or True.", "Evaluate 2 * 3 ** 2."],
  revision: ["Brackets > ** > unary > * / // % > + - > comparisons > not > and > or.", "Same level: left to right, except **.", "-2 ** 2 is -4.", "When unsure: brackets."],
  hinglish: "Pehle bracket, phir power (**), phir * / // %, phir + -, phir comparison, phir not, and, or. Shak ho to bracket laga do. -2 ** 2 ka answer -4 aata hai kyunki power pehle hota hai.",
  quiz: [
    mcq("What is 2 + 3 * 4?", ["20", "14", "24", "9"], 1, "Multiplication first: 3 * 4 = 12, then 2 + 12."),
    mcq("What is -2 ** 2?", ["4", "-4", "2", "Error"], 1, "Power binds tighter than the unary minus.", "OUTPUT_PREDICTION"),
    mcq("What is 100 / 10 * 2?", ["5.0", "20.0", "0.5", "2.0"], 1, "Left to right: 100 / 10 = 10.0, then * 2 = 20.0.", "OUTPUT_PREDICTION"),
    mcq("Which has the lowest precedence?", ["and", "or", "not", "=="], 1, "or is evaluated last of these."),
    mcq("What is 2 * 3 ** 2?", ["36", "18", "81", "12"], 1, "Power first: 3 ** 2 = 9, then 2 * 9 = 18.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Average of three", "Read three numbers (one per line). Print their average rounded to 2 decimal places. Mind the precedence.", "a = float(input())\nb = float(input())\nc = float(input())\n# print the average rounded to 2 decimals\n", `a = float(input())\nb = float(input())\nc = float(input())\nprint(round((a + b + c) / 3, 2))`, [["1\n2\n4", "2.33"], ["10\n20\n30", "20.0"]], [["1\n2\n4", "2.33"], ["10\n20\n30", "20.0"], ["0\n0\n1", "0.33"], ["5\n5\n5", "5.0"]])],
});

module.exports = {
  module: {
    title: "Phase 1 - Module 3: Python Syntax and Basic Concepts",
    description: "Syntax and indentation, comments, keywords and identifiers, variables, input and output, type conversion and every operator family with precedence.",
    chapters: [{ title: "Python Syntax and Basic Concepts", description: "From the first valid line of Python to confident use of expressions.", lessons }],
    assessment: {
      title: "Module 3 Assessment: Syntax, Variables and Operators",
      description: "Input, conversion and operator problems covering Module 3.",
      questions: [
        task("Sum and product", "Read two integers (one per line). Print their sum on the first line and their product on the second line.", "", `a = int(input())\nb = int(input())\nprint(a + b)\nprint(a * b)`, [["3\n4", "7\n12"], ["10\n-2", "8\n-20"]], [["3\n4", "7\n12"], ["0\n9", "9\n0"], ["-5\n-5", "-10\n25"]]),
        task("Celsius to Fahrenheit", "Read a temperature in Celsius (may be a decimal). Print the Fahrenheit value using F = C * 9 / 5 + 32, rounded to 1 decimal place with round().", "", `c = float(input())\nprint(round(c * 9 / 5 + 32, 1))`, [["100", "212.0"], ["37", "98.6"]], [["100", "212.0"], ["37", "98.6"], ["0", "32.0"], ["-40", "-40.0"]]),
        task("Even check", "Read an integer. Print True if it is even, otherwise False.", "", `n = int(input())\nprint(n % 2 == 0)`, [["10", "True"], ["7", "False"]], [["10", "True"], ["7", "False"], ["0", "True"], ["-3", "False"]]),
        task("Digit sum of a two-digit number", "Read a two-digit positive integer (10 to 99). Print the sum of its two digits using // and %.", "", `n = int(input())\nprint(n // 10 + n % 10)`, [["47", "11"], ["90", "9"]], [["47", "11"], ["90", "9"], ["10", "1"], ["99", "18"]]),
      ],
    },
  },
};
