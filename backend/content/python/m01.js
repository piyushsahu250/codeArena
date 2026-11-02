// Phase 0 / Module 1: Introduction to Programming. Every `code`/`out` pair here is executed by
// scripts/validatePythonContent.js against a real python3 before the course is seeded.
"use strict";
const { chain, graph, table } = require("./render");

const mcq = (prompt, options, answer, explanation, type = "MCQ") => ({ type, prompt, options, correctAnswer: answer, explanation });
const task = (title, statement, starter, solution, cases, hiddenCases = cases) => ({
  title, statement, starter, solution,
  testCases: [...cases.slice(0, 2).map(([input, expected]) => ({ input, expected, isHidden: false })), ...hiddenCases.map(([input, expected]) => ({ input, expected, isHidden: true }))],
});

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "What is Programming? Languages and Python",
  minutes: 25,
  learn: ["Explain what a program and programming are in plain words", "Say why computers need programming languages", "Describe what Python is and who it is for", "Recognise source code, execution and output"],
  why: "Every app, website, game and bank transaction is a program. Understanding that a program is only a precise list of instructions removes the fear of coding: you are not learning magic, you are learning to give clear instructions.",
  realWorld: "A recipe is a program for a cook. A UPI payment is a program: check balance, deduct amount, add to the receiver, send a confirmation. The same idea, written for a computer.",
  simple: "A computer does exactly what it is told, nothing more. <strong>Programming</strong> is writing those instructions step by step. A <strong>programming language</strong> is the vocabulary and grammar we use to write them. <strong>Python</strong> is a popular language whose instructions read almost like English.",
  detail: `<p>A computer's processor only understands machine code (patterns of 0s and 1s). Writing that by hand is slow and error-prone, so people created <strong>programming languages</strong>: readable text that a tool translates for the machine.</p>
<ul><li><strong>Source code</strong> &mdash; the text you write, saved in a file such as <code>hello.py</code>.</li><li><strong>Execution</strong> &mdash; the computer carrying out your instructions, from the first line downwards.</li><li><strong>Output</strong> &mdash; what the program shows or produces (text on screen, a file, a number).</li></ul>
<p><strong>Python</strong> is a general-purpose, high-level language. <em>General-purpose</em> means it is used for many kinds of work (web, data, automation, AI). <em>High-level</em> means you think about the problem, not about memory and processor registers.</p>
<p>Two ideas to remember from day one: (1) a computer follows instructions <em>in order</em>; (2) it is <em>literal</em> &mdash; a missing quote or a wrong word is an error, not a suggestion.</p>`,
  diagram: chain("From idea to result", "Four boxes joined by arrows: your idea, source code, Python runs it, output appears.",
    [{ k: "term", t: "Your idea" }, { k: "proc", t: "Source code\n(hello.py)" }, { k: "proc", t: "Python\nruns it" }, { k: "io", t: "Output" }], { w: 130, gap: 30 }),
  example: { code: `# A program is a list of instructions run in order\nprint("Step 1: wake up")\nprint("Step 2: brush teeth")\nprint("Step 3: go to college")`, out: `Step 1: wake up\nStep 2: brush teeth\nStep 3: go to college` },
  lineByLine: [["# A program is...", "A comment. Python ignores everything after <code>#</code>; it is a note for humans."], ["print(\"Step 1: wake up\")", "Calls the built-in <code>print()</code> function to show the text between the quotes."], ["print(\"Step 2...\")", "Runs only after line 2 has finished."], ["print(\"Step 3...\")", "Last instruction. The program ends after it."]],
  dryRun: { intro: "Python reads the file from the top, one statement at a time.", headers: ["Step", "Line executed", "Screen so far"], rows: [["1", "print(\"Step 1: wake up\")", "Step 1: wake up"], ["2", "print(\"Step 2: brush teeth\")", "Step 1: wake up<br>Step 2: brush teeth"], ["3", "print(\"Step 3: go to college\")", "all three lines"]] },
  realExample: { intro: "A tiny billing program: the same instructions work for any price.", code: `price = 120\nquantity = 3\ntotal = price * quantity\nprint("Total bill:", total)`, out: `Total bill: 360` },
  mistakes: ["Thinking the computer will \"understand what you meant\". It only does what you wrote.", "Writing instructions in the wrong order; order changes the result.", "Mixing up <em>learning to code</em> with <em>memorising syntax</em>. Understanding the steps matters more."],
  practices: ["Say the steps in words before you write code.", "Run small programs often instead of writing 50 lines and then testing.", "Write comments that explain <em>why</em>, not what is obvious."],
  interview: ["Define a program, a programming language and an interpreter in one sentence each.", "Is Python a high-level or low-level language? Why?", "What is the difference between source code and output?"],
  practiceQs: ["Write the steps (in English) to make a cup of tea. Which steps depend on order?", "List three programs you used today. What was the input and the output of each?", "Change the example to print your own three-step morning routine."],
  revision: ["Program = ordered instructions.", "Language = how we write instructions; Python = readable, general-purpose.", "Source code &rarr; execution &rarr; output.", "The computer is literal and fast, never guessing."],
  hinglish: "Program matlab computer ko diye gaye steps ka list, jo upar se neeche order mein chalte hain. Python ek aisi language hai jo English jaisi padhne mein aasaan hai. Computer khud se kuch nahi samajhta - jo likhoge wahi karega.",
  quiz: [
    mcq("What is a program?", ["A physical part of the computer", "An ordered list of instructions for a computer", "A website", "Another name for the internet"], 1, "A program is a set of instructions the computer follows in order."),
    mcq("What is the text you write in a .py file called?", ["Output", "Source code", "Bytecode", "Hardware"], 1, "Source code is the human-readable text you write."),
    mcq("Which lines does Python execute first?", ["The last line", "A random line", "From the top, one after another", "Only lines with print"], 2, "Execution proceeds from the first statement downwards unless control flow changes it."),
    mcq("What does this print?\n\nprint(\"A\")\nprint(\"B\")", ["AB on one line", "A then B on separate lines", "Only B", "An error"], 1, "Each print() ends with a newline by default.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Morning routine", "Write a program that prints exactly these three lines:\n\nWake up\nStudy Python\nPractice coding", "# Print the three lines here\n", `print("Wake up")\nprint("Study Python")\nprint("Practice coding")`, [["", "Wake up\nStudy Python\nPractice coding"], ["", "Wake up\nStudy Python\nPractice coding"]], [["", "Wake up\nStudy Python\nPractice coding"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Python: History, Popularity and Where It Is Used",
  minutes: 30,
  learn: ["Place Python in a short timeline", "Explain why Python is so widely used", "Name the main application areas and the libraries behind them", "Compare Python fairly with C, C++, Java and JavaScript"],
  why: "Knowing where Python is strong (and where it is not) helps you choose the right tool and speak confidently in interviews.",
  realWorld: "A data analyst cleans a spreadsheet with pandas, a backend developer serves an API with FastAPI or Django, a tester automates a browser, a researcher trains a model. All write Python.",
  simple: "Python was designed to be easy to read and quick to write. That is why beginners start with it and why professionals use it to get work done fast. It is not the fastest language, but it is often fast <em>enough</em> and always fast to <em>develop</em> in.",
  detail: `<h3>A short timeline</h3>
${table(["Year", "Event"], [["1989&ndash;1991", "Guido van Rossum starts Python as a hobby project in December 1989; the first public release (0.9.0) appears in February 1991."], ["2000", "Python 2.0 adds list comprehensions and garbage collection of reference cycles."], ["2008", "Python 3.0 is released. It fixed design problems and was <em>not</em> backward compatible."], ["2020", "Python 2 reached end of life on 1 January 2020. Use Python 3 only."], ["Today", "Python 3 is released once a year (October). Each version is supported for about five years."]])}
<p>The name comes from the comedy group <em>Monty Python</em>, not the snake.</p>
<h3>Why Python is popular</h3>
<ul><li><strong>Readable syntax</strong> &mdash; indentation shows structure, little punctuation.</li><li><strong>Huge standard library</strong> &mdash; "batteries included" for files, dates, JSON, networking and more.</li><li><strong>Huge ecosystem</strong> &mdash; the Python Package Index (PyPI) has libraries for almost everything.</li><li><strong>Productive</strong> &mdash; fewer lines than many languages for the same job.</li><li><strong>Community and jobs</strong> &mdash; strong documentation, learning material and employer demand.</li></ul>
<h3>Applications</h3>
${table(["Area", "Typical tools"], [["Web back-ends and APIs", "Django, Flask, FastAPI"], ["Data analysis", "NumPy, pandas, Matplotlib"], ["AI and machine learning", "scikit-learn, PyTorch, TensorFlow"], ["Automation and scripting", "os, pathlib, subprocess, Selenium"], ["Testing", "pytest, unittest"], ["Education and prototyping", "IDLE, Jupyter"]])}
<h3>Python compared with other languages</h3>
${table(["", "Python", "C / C++", "Java", "JavaScript"], [["Typing", "Dynamic", "Static", "Static", "Dynamic"], ["How it runs", "Compiled to bytecode, then interpreted by a virtual machine (CPython)", "Compiled to machine code", "Compiled to bytecode, run on the JVM (with JIT)", "Interpreted/JIT inside the browser or Node.js"], ["Raw speed", "Slower for tight loops", "Fastest", "Fast", "Fast (JIT)"], ["Typical use", "Data, AI, automation, back-ends", "Systems, games, embedded", "Enterprise, Android back-ends", "Web front-ends, Node back-ends"], ["Learning curve", "Gentle", "Steep", "Medium", "Gentle but quirky"]])}
<p><strong>Companies:</strong> publicly documented examples include Instagram running its back-end on Django, and Dropbox using Python widely in its server code and desktop client (both described in the companies' own engineering posts). Check current engineering blogs rather than relying on lists, because stacks change.</p>`,
  diagram: chain("Python application areas", "A central box labelled Python pointing to four boxes: Web, Data, AI and ML, Automation.",
    [{ k: "term", t: "Python" }, { k: "proc", t: "Web & APIs" }, { k: "proc", t: "Data analysis" }, { k: "proc", t: "AI / ML" }, { k: "proc", t: "Automation" }], { w: 120, gap: 22, hgt: 50 }),
  example: { code: `# Sum of 1..10 in one readable line\nprint(sum(range(1, 11)))`, out: `55` },
  lineByLine: [["range(1, 11)", "Produces 1, 2, ... 10. The end value (11) is <em>excluded</em>."], ["sum(...)", "Adds all the numbers it receives."], ["print(...)", "Shows the result."]],
  dryRun: { intro: "What sum(range(1, 11)) works out:", headers: ["Item", "Running total"], rows: [["1", "1"], ["2", "3"], ["3", "6"], ["4", "10"], ["...", "..."], ["10", "55"]] },
  realExample: { intro: "Counting the words in a sentence: a job that takes real code in many languages.", code: `text = "python is simple and powerful"\nprint(len(text.split()))`, out: `5` },
  mistakes: ["Believing Python is slow so it is \"bad\". Choose by the job: heavy number work uses optimised libraries written in C.", "Using Python 2 tutorials. They teach <code>print \"hi\"</code>, which is invalid in Python 3.", "Assuming one language is best for everything."],
  practices: ["Read the official docs at docs.python.org; they are accurate and current.", "Prefer actively maintained libraries and check their release dates.", "Learn the standard library before installing a package for a small job."],
  interview: ["Why is Python popular? Give three reasons.", "Compiled vs interpreted: where does Python sit?", "Is Python suitable for high-frequency trading or an OS kernel? Why or why not?", "What changed from Python 2 to Python 3?"],
  practiceQs: ["Name two areas where Python is a good choice and one where it is not. Justify each.", "Find the latest stable Python version on python.org and write its release date.", "List three libraries you might use for data analysis."],
  revision: ["Created by Guido van Rossum; first release 1991; Python 3 since 2008.", "Strengths: readability, ecosystem, productivity.", "Weaker at raw CPU speed and mobile apps.", "Always use Python 3."],
  hinglish: "Python 1991 mein aayi, Guido van Rossum ne banayi. Isse web, data, AI aur automation sab mein use karte hain. Speed C se kam hai, lekin likhna bahut tez hai, isliye industry mein bahut popular hai.",
  quiz: [
    mcq("Who created Python?", ["Dennis Ritchie", "Guido van Rossum", "James Gosling", "Bjarne Stroustrup"], 1, "Guido van Rossum started Python in 1989."),
    mcq("Which Python major version should new programs use?", ["Python 1", "Python 2", "Python 3", "Any of them"], 2, "Python 2 reached end of life on 1 January 2020."),
    mcq("Which library is mainly used for data analysis?", ["pandas", "Flask", "pytest", "Selenium"], 0, "pandas provides DataFrames for tabular data analysis."),
    mcq("What does this print?\n\nprint(sum(range(1, 4)))", ["3", "6", "10", "1"], 1, "range(1, 4) gives 1, 2, 3 and their sum is 6.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Count the words", "Write a program that prints the number of words in the sentence \"learning python is fun\" (use len and split). Print only the number.", "text = \"learning python is fun\"\n# print the number of words\n", `text = "learning python is fun"\nprint(len(text.split()))`, [["", "4"], ["", "4"]], [["", "4"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "How Python Runs Your Program",
  minutes: 30,
  learn: ["Tell compiled and interpreted languages apart", "Describe what CPython does with your source file", "Explain bytecode and the Python virtual machine", "Know that Python has several implementations"],
  why: "When an error appears or a program is slow, knowing what happens between pressing Run and seeing output tells you where to look.",
  realWorld: "A translator reading a speech aloud (interpreter) versus translating the whole book first (compiler). Python mixes both ideas.",
  simple: "You write <code>.py</code> source. The Python program (called the <strong>interpreter</strong>) first translates it into a compact internal form called <strong>bytecode</strong>, then a <strong>virtual machine</strong> runs that bytecode, one instruction at a time.",
  detail: `<p><strong>Compiled languages</strong> (C, C++) translate the whole program to machine code <em>before</em> it runs; you ship the resulting executable. <strong>Interpreted languages</strong> translate and run as they go. Real languages are usually a mix, and Python is a good example.</p>
<h3>What CPython does</h3>
<ol><li><strong>Read and parse</strong> the source; a <em>SyntaxError</em> stops everything here, before any line runs.</li><li><strong>Compile to bytecode</strong> (low-level instructions for the Python virtual machine). CPython caches this in <code>__pycache__/*.pyc</code> for imported modules so they start faster next time.</li><li><strong>Run the bytecode</strong> in the Python Virtual Machine (PVM). Runtime errors such as <code>ZeroDivisionError</code> appear here, after earlier lines have already executed.</li></ol>
<h3>Implementations</h3>
<p><strong>CPython</strong> is the reference implementation (written in C) from python.org; it is what you install and what this course uses. Others exist for special needs: <strong>PyPy</strong> (faster for long-running programs through JIT compilation), <strong>MicroPython</strong> (microcontrollers), and Jython/IronPython (older, tied to the JVM and .NET). The language rules are the same; behaviour in edge cases and speed can differ.</p>
<p>Because the type of a value is checked while the program runs, Python is <strong>dynamically typed</strong>. You will see what this means in Module 3.</p>`,
  diagram: chain("Python execution pipeline", "Vertical flow: source file, parser checks syntax, compiler produces bytecode, virtual machine runs it, output.",
    [{ k: "term", t: "hello.py (source)" }, { k: "proc", t: "Parse & check syntax" }, { k: "proc", t: "Compile to bytecode" }, { k: "proc", t: "Python Virtual Machine" }, { k: "io", t: "Output" }], { vertical: true, w: 210, hgt: 44, gap: 26 }),
  example: { code: `import sys\nprint(sys.implementation.name)\nprint(type(3 + 4))`, out: `cpython\n<class 'int'>` },
  lineByLine: [["import sys", "Loads the built-in <code>sys</code> module, which describes the running interpreter."], ["sys.implementation.name", "The implementation's name; <code>cpython</code> for the standard interpreter."], ["type(3 + 4)", "Asks Python for the type of the value <code>7</code>; the result is <code>int</code>."]],
  dryRun: { intro: "Execution of a file with a runtime error on line 2:", headers: ["Stage", "What happens", "Result"], rows: [["Parse", "No syntax problem found", "continue"], ["Compile", "Bytecode created", "continue"], ["Run line 1", "prints before", "before"], ["Run line 2", "10 / 0 impossible", "ZeroDivisionError, program stops"]] },
  realExample: { intro: "A runtime error does not stop earlier lines from running. This program prints, then fails:", code: `print("before")\nprint(10 / 0)`, out: `before`, expectError: "ZeroDivisionError" },
  mistakes: ["Thinking a syntax error and a runtime error are the same. Syntax errors prevent any line from running; runtime errors happen mid-way.", "Calling Python \"only interpreted\". CPython compiles to bytecode first.", "Naming your own file <code>random.py</code> or <code>sys.py</code>; it shadows the standard module."],
  practices: ["Read the traceback from the bottom up: the last line names the error.", "Keep your Python version in mind: run <code>python --version</code> when something behaves oddly.", "Do not rely on speed folklore; measure with a profiler when it matters."],
  interview: ["Is Python compiled or interpreted?", "What is bytecode and where is it stored?", "What is CPython? Name another implementation.", "When is a SyntaxError raised compared with a ZeroDivisionError?"],
  practiceQs: ["Create a file with a deliberate typo and one with a division by zero. Which prints anything before failing?", "Print sys.version in your installation. Which implementation and version is it?", "Explain the pipeline in the diagram in your own words."],
  revision: ["Source &rarr; bytecode &rarr; PVM.", "CPython = reference implementation.", "Syntax errors: before running. Runtime errors: during running.", ".pyc files are cached bytecode of imported modules."],
  hinglish: "Python pehle aapka code bytecode mein badalti hai, phir Python Virtual Machine usse chalati hai. Syntax error program shuru hone se pehle pakdi jaati hai; runtime error beech mein aati hai jab tak pehle wali lines chal chuki hoti hain.",
  quiz: [
    mcq("What does CPython do first with your source file?", ["Runs it line by line without checking", "Parses it and compiles it to bytecode", "Converts it to a .exe", "Uploads it to PyPI"], 1, "It parses and compiles the source to bytecode, then the PVM runs it."),
    mcq("Where are cached bytecode files of imported modules stored?", ["__pycache__", "site-packages only", "The desktop", "They are not stored"], 0, "CPython writes .pyc files into __pycache__."),
    mcq("Which implementation of Python is the reference one?", ["PyPy", "Jython", "CPython", "MicroPython"], 2, "CPython, written in C, is the reference implementation."),
    mcq("What is the output?\n\nprint(\"one\")\nprint(1 / 0)\nprint(\"two\")", ["one two", "one then an error, \"two\" never prints", "An error and nothing printed", "one and two"], 1, "The first print runs, then the division fails and stops the program.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Which implementation?", "Print the name of the Python implementation running your code, using the sys module. The expected output is the word cpython.", "import sys\n# print the implementation name\n", `import sys\nprint(sys.implementation.name)`, [["", "cpython"], ["", "cpython"]], [["", "cpython"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Your First Program: Hello World and print()",
  minutes: 35,
  learn: ["Write, save and run your first Python program", "Use print() with text, numbers and several values", "Change separators and line endings with sep and end", "Understand strings, quotes and escape characters"],
  why: "print() is how you see what your program is doing. You will use it for output and for debugging every day.",
  realWorld: "Every console tool, log message and script report you ever read began as a print or logging call.",
  simple: "<code>print()</code> shows whatever you put between its brackets. Text goes in quotes (<code>\"Hello\"</code>), numbers do not (<code>42</code>).",
  detail: `<p><code>print()</code> is a <strong>built-in function</strong>: Python provides it, you only <em>call</em> it using round brackets. The values inside the brackets are its <strong>arguments</strong>.</p>
<ul><li>Text is a <strong>string</strong>, written with single or double quotes: <code>'Hi'</code> or <code>"Hi"</code>.</li><li>Several values separated by commas are printed with a space between them (<code>sep=" "</code>).</li><li>After printing, Python moves to a new line (<code>end="\\n"</code>). Change <code>end</code> to stay on the same line.</li><li>Special characters need an <strong>escape sequence</strong>: <code>\\n</code> new line, <code>\\t</code> tab, <code>\\"</code> a quote inside a double-quoted string.</li></ul>
<p>Triple quotes <code>"""..."""</code> let a string span several lines.</p>`,
  syntax: { code: `print(value1, value2, ..., sep=" ", end="\\n")`, note: "<code>sep</code> and <code>end</code> are optional keyword arguments." },
  diagram: graph("What happens when print runs", "Flow: your code calls print, Python converts values to text, writes them to the screen, then adds a newline.", 600, 120,
    [{ id: "a", k: "term", t: "print(\"Hi\", 5)", x: 80, y: 60, w: 130 }, { id: "b", k: "proc", t: "Convert each\nvalue to text", x: 245, y: 60, w: 130 }, { id: "c", k: "proc", t: "Join with\nsep (space)", x: 400, y: 60, w: 120 }, { id: "d", k: "io", t: "Screen +\nend (newline)", x: 520, y: 60, w: 100 }],
    [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }]),
  example: { code: `print("Hello, World!")\nprint("Python", 3, "is fun")\nprint("A", "B", "C", sep="-")\nprint("No newline", end=" | ")\nprint("same line")\nprint("Tab:\\tdone")`, out: `Hello, World!\nPython 3 is fun\nA-B-C\nNo newline | same line\nTab:\tdone` },
  lineByLine: [["print(\"Hello, World!\")", "The traditional first program: one string argument."], ["print(\"Python\", 3, \"is fun\")", "Three arguments; the number 3 is converted to text; spaces are inserted."], ["print(\"A\", \"B\", \"C\", sep=\"-\")", "<code>sep</code> replaces the default space."], ["print(\"No newline\", end=\" | \")", "<code>end</code> replaces the newline, so the next print continues on the same line."], ["print(\"Tab:\\tdone\")", "<code>\\t</code> inserts a tab character."]],
  dryRun: { intro: "Tracing the third and fourth statements:", headers: ["Statement", "Arguments", "sep", "end", "Screen result"], rows: [["print(\"A\",\"B\",\"C\",sep=\"-\")", "A, B, C", "-", "newline", "A-B-C&#9166;"], ["print(\"No newline\", end=\" | \")", "No newline", "space", "\" | \"", "No newline | (cursor stays)"], ["print(\"same line\")", "same line", "space", "newline", "same line&#9166;"]] },
  realExample: { intro: "A receipt line built from several values:", code: `item = "Notebook"\nqty = 3\nprice = 45\nprint("Item:", item, "| Qty:", qty, "| Total:", qty * price)`, out: `Item: Notebook | Qty: 3 | Total: 135` },
  mistakes: ["Forgetting the quotes: <code>print(Hello)</code> looks for a variable called Hello (NameError).", "Mismatched quotes: <code>print(\"Hi')</code> (SyntaxError).", "Capital P: <code>Print(\"Hi\")</code> is a NameError because Python is case-sensitive.", "Leaving out brackets, as in old Python 2: <code>print \"Hi\"</code> is a SyntaxError.", "Starting a line with a stray space: IndentationError."],
  practices: ["Pick one quote style per project and stay consistent.", "Use sep and end instead of gluing strings by hand where possible.", "Remove debug prints before finishing; use the logging module for permanent messages (Module 11)."],
  interview: ["Is print a keyword or a function?", "How do you print without a trailing newline?", "What is the difference between 'it\\'s' and \"it's\"?", "What does print() with no arguments do?"],
  practiceQs: ["Print your name, then your city on the next line.", "Print the numbers 1 to 5 on one line separated by commas.", "Print the text: She said \"Hello\" (with the quotes).", "Predict: print(\"a\", \"b\", sep=\"\", end=\"!\")."],
  revision: ["print() is a built-in function.", "Strings need quotes; numbers do not.", "sep controls the gap; end controls what comes after.", "Python is case-sensitive: print, not Print."],
  hinglish: "print() screen par output dikhata hai. Text ko quotes mein likhte hain, number ko bina quotes ke. sep do values ke beech ka separator hai aur end last mein kya aayega wo tay karta hai.",
  quiz: [
    mcq("Which line prints Hello?", ["Print(\"Hello\")", "print Hello", "print(\"Hello\")", "echo(\"Hello\")"], 2, "The function name is lowercase print and needs brackets."),
    mcq("What is printed?\n\nprint(\"A\", \"B\", sep=\"\")", ["A B", "AB", "A,B", "A\\nB"], 1, "sep=\"\" removes the space between values.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nprint(\"x\", end=\"\")\nprint(\"y\")", ["x\\ny", "xy", "x y", "y"], 1, "end=\"\" keeps the cursor on the same line.", "OUTPUT_PREDICTION"),
    mcq("What is wrong with this code?\n\nprint(\"Hello)", ["Nothing", "The closing quote is missing", "print must be capital", "Brackets not needed"], 1, "The string is never closed, which causes a SyntaxError.", "DEBUG"),
    { type: "FILL_BLANK", prompt: "Complete: the escape sequence for a new line inside a string is backslash followed by the letter ____", correctAnswer: "n", explanation: "\\n is the newline escape sequence." },
  ],
  tasks: [
    task("Hello, CodeArena", "Print exactly: Hello, CodeArena!", "# Write your program here\n", `print("Hello, CodeArena!")`, [["", "Hello, CodeArena!"], ["", "Hello, CodeArena!"]], [["", "Hello, CodeArena!"]]),
    task("Dashes", "Using sep, print the three words Python, is, fun separated by a single dash so the output is: Python-is-fun", "# use sep\n", `print("Python", "is", "fun", sep="-")`, [["", "Python-is-fun"], ["", "Python-is-fun"]], [["", "Python-is-fun"]]),
  ],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Common Beginner Mistakes and How to Read Errors",
  minutes: 30,
  learn: ["Recognise SyntaxError, NameError, IndentationError and ZeroDivisionError", "Read a traceback from the bottom up", "Separate syntax, runtime and logic errors", "Follow a simple debugging routine"],
  why: "Everyone writes bugs. The difference between a beginner and a developer is a calm, repeatable way to find and fix them.",
  realWorld: "Professional developers spend a large part of their day reading error messages and logs. Reading them well is a core job skill.",
  simple: "An error message is a clue, not a punishment. It tells you the <strong>type</strong> of problem, the <strong>line</strong>, and often a hint.",
  detail: `<h3>Three kinds of errors</h3>
${table(["Kind", "When found", "Example", "Does Python tell you?"], [["Syntax error", "Before the program runs", "missing quote or bracket", "Yes: SyntaxError / IndentationError"], ["Runtime error (exception)", "While running", "10 / 0, using an undefined name", "Yes: ZeroDivisionError, NameError, ..."], ["Logic error", "When you check the result", "using + where you meant *", "No. The program runs but the answer is wrong"]])}
<h3>Reading a traceback</h3>
<p>Read from the <strong>last line upward</strong>. The last line says <code>ErrorType: message</code>. The line above shows the offending code and the file and line number.</p>
<h3>A five-step debugging routine</h3>
<ol><li>Read the last line of the message.</li><li>Go to the reported line (the real mistake can be on the line above).</li><li>Check spelling, case, quotes, brackets and indentation.</li><li>Add a temporary <code>print()</code> to see actual values.</li><li>Change one thing, run again. Never change five things at once.</li></ol>`,
  diagram: graph("Debugging routine", "Loop: run, see an error, read the last line, fix one thing, run again until it works.", 560, 190,
    [{ id: "r", k: "term", t: "Run program", x: 90, y: 40, w: 130 }, { id: "e", k: "dec", t: "Error?", x: 280, y: 40, w: 110, h: 60 }, { id: "d", k: "term", t: "Done", x: 480, y: 40, w: 100 }, { id: "l", k: "proc", t: "Read last line\nof message", x: 280, y: 150, w: 150 }, { id: "f", k: "proc", t: "Fix one thing", x: 90, y: 150, w: 130 }],
    [{ from: "r", to: "e" }, { from: "e", to: "d", label: "no" }, { from: "e", to: "l", label: "yes", dx: 8 }, { from: "l", to: "f" }, { from: "f", to: "r" }]),
  example: { code: `# Each broken line below is shown as a comment with its error\n# print("Hi)        -> SyntaxError: unterminated string literal\n# Print("Hi")       -> NameError: name 'Print' is not defined\n#   print("Hi")     -> IndentationError: unexpected indent\nprint("Fixed version")`, out: `Fixed version` },
  lineByLine: [["# print(\"Hi)", "The closing quote is missing; Python cannot find where the text ends."], ["# Print(\"Hi\")", "Python is case-sensitive; only lowercase <code>print</code> exists."], ["#   print(\"Hi\")", "A statement may not start with extra spaces unless it is inside a block."], ["print(\"Fixed version\")", "The corrected line runs normally."]],
  dryRun: { intro: "Tracing a logic error. Goal: average of 10 and 20.", headers: ["Statement", "Value", "Problem"], rows: [["a = 10", "10", "-"], ["b = 20", "20", "-"], ["avg = a + b / 2", "10 + 10.0 = 20.0", "Wrong: / binds tighter than +"], ["avg = (a + b) / 2", "30 / 2 = 15.0", "Correct"]] },
  realExample: { intro: "The logic error above, fixed with brackets. Both results are printed so you can compare.", code: `a = 10\nb = 20\nprint("wrong:", a + b / 2)\nprint("right:", (a + b) / 2)`, out: `wrong: 20.0\nright: 15.0` },
  mistakes: ["Fixing the line number shown only: the cause can be one line earlier (an unclosed bracket).", "Mixing tabs and spaces. Use 4 spaces for each level.", "Copy-pasting code with curly \"smart quotes\" from a document.", "Changing many things at once, then not knowing what fixed it.", "Ignoring the error text and guessing."],
  practices: ["Run your code after every few lines.", "Use a code editor that highlights errors (VS Code).", "Search the exact error message, then read the official docs first.", "Explain the bug aloud (\"rubber-duck debugging\")."],
  interview: ["Name three types of errors in Python.", "What is the difference between SyntaxError and a runtime exception?", "A program runs but gives the wrong answer. What type of error is it and how do you debug it?", "How do you read a traceback?"],
  practiceQs: ["Create one example of each: SyntaxError, NameError, ZeroDivisionError. Record the exact message.", "Why does 10 + 20 / 2 equal 20.0 and not 15.0?", "Fix: print('Welcome\")"],
  revision: ["Syntax: found before running. Runtime: found while running. Logic: the answer is wrong.", "Read tracebacks from the bottom.", "Check case, quotes, brackets, indentation.", "Change one thing at a time."],
  hinglish: "Error message dushman nahi hai, hint hai. Hamesha last line se padhna shuru karo. Ek baar mein ek hi cheez badlo aur dobara run karo.",
  quiz: [
    mcq("Which error is raised for print(\"Hi) ?", ["NameError", "SyntaxError", "ZeroDivisionError", "TypeError"], 1, "An unterminated string is a syntax error."),
    mcq("Which error is raised by Print(\"Hi\") ?", ["SyntaxError", "NameError", "IndentationError", "ValueError"], 1, "Print (capital P) is an unknown name."),
    mcq("Which is a logic error?", ["Missing colon", "Using + when you meant *", "Dividing by zero", "Misspelling print"], 1, "The program runs without any error message but gives the wrong answer."),
    mcq("What is printed?\n\nprint(10 + 20 / 2)", ["15.0", "20.0", "15", "20"], 1, "20 / 2 = 10.0 first, then 10 + 10.0 = 20.0.", "OUTPUT_PREDICTION"),
    mcq("Find the bug:\n\nprint(\"Total:\" total)\n\nwhere total = 5.", ["Missing comma between the two arguments", "total must be in quotes", "print needs a capital P", "No bug"], 0, "A comma (or +/f-string) is needed to combine the pieces: print(\"Total:\", total).", "DEBUG"),
  ],
  tasks: [task("Fix the average", "The average of 10 and 20 is meant to be 15.0 but the code below prints 20.0. Fix the expression and print the average of a and b.", "a = 10\nb = 20\nprint(a + b / 2)\n", `a = 10\nb = 20\nprint((a + b) / 2)`, [["", "15.0"], ["", "15.0"]], [["", "15.0"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Practical: Personal Introduction and Student Card",
  minutes: 40,
  learn: ["Combine print(), variables and f-strings in a small program", "Build a formatted student information card", "Practise aligning text with fixed-width formatting", "Plan a program in steps before writing it"],
  why: "Small, finished programs build confidence. This one uses everything from Module 1 and previews the f-strings you will study properly in Module 4.",
  realWorld: "ID cards, receipts and reports are all formatted text built from data: the same idea at a smaller scale.",
  simple: "Store each fact in a <strong>variable</strong> (a named box for a value), then print them neatly. An <strong>f-string</strong> is a string starting with <code>f</code> in which <code>{name}</code> is replaced by the variable's value.",
  detail: `<p>Plan first: (1) decide what the card must show, (2) store each item in a variable, (3) print a border, then each line, then a border.</p>
<ul><li><code>"=" * 30</code> repeats a string 30 times; handy for borders.</li><li>An f-string such as <code>f"Name : {name}"</code> inserts the value of <code>name</code>.</li><li>Inside braces you can add a format: <code>{name:&lt;12}</code> left-aligns the text in 12 characters; <code>{marks:&gt;5}</code> right-aligns in 5.</li></ul>
<p>You will meet variables fully in Module 3 and string formatting in Module 4. Here you only use them as labelled boxes.</p>`,
  diagram: chain("Plan for the student card", "Top-to-bottom steps: store data in variables, print border, print each line, print border.",
    [{ k: "term", t: "Store data in variables" }, { k: "proc", t: "Print top border" }, { k: "proc", t: "Print each field with f-string" }, { k: "proc", t: "Print bottom border" }], { vertical: true, w: 230, hgt: 42, gap: 24 }),
  example: { code: `name = "Asha Verma"\ncity = "Pune"\ngoal = "Become a Python developer"\nprint("Hello! My name is", name)\nprint(f"I live in {city}.")\nprint(f"My goal: {goal}.")`, out: `Hello! My name is Asha Verma\nI live in Pune.\nMy goal: Become a Python developer.` },
  lineByLine: [["name = \"Asha Verma\"", "Creates a variable called <code>name</code> holding a string."], ["print(\"Hello! My name is\", name)", "Two arguments; print adds a space between them."], ["print(f\"I live in {city}.\")", "An f-string substitutes the value of <code>city</code>."], ["print(f\"My goal: {goal}.\")", "Same idea with another variable."]],
  dryRun: { intro: "Values at each step:", headers: ["After line", "name", "city", "goal", "Screen"], rows: [["1&ndash;3", "Asha Verma", "Pune", "Become a Python developer", "(nothing yet)"], ["4", "same", "same", "same", "Hello! My name is Asha Verma"], ["5", "same", "same", "same", "+ I live in Pune."], ["6", "same", "same", "same", "+ My goal: Become a Python developer."]] },
  realExample: { intro: "A formatted student card with a border and aligned labels.", code: `name = "Asha Verma"\nroll = 101\nbranch = "Computer Science"\nyear = 1\nline = "=" * 34\nprint(line)\nprint(f"{'CODEARENA STUDENT CARD':^34}")\nprint(line)\nprint(f"{'Name':<10}: {name}")\nprint(f"{'Roll No':<10}: {roll}")\nprint(f"{'Branch':<10}: {branch}")\nprint(f"{'Year':<10}: {year}")\nprint(line)`, out: `==================================\n      CODEARENA STUDENT CARD      \n==================================\nName      : Asha Verma\nRoll No   : 101\nBranch    : Computer Science\nYear      : 1\n==================================` },
  mistakes: ["Forgetting the <code>f</code> before the quote, so <code>{name}</code> is printed literally.", "Using the same quote type inside an f-string expression in older Python versions. Mix single and double quotes.", "Forgetting <code>*</code> repeats text: <code>\"=\" * 34</code>, not <code>\"=\" + 34</code>.", "Hard-coding the same value in several places instead of using a variable."],
  practices: ["Store data in variables; print in one place.", "Change a variable and the whole card updates: that is the point.", "Use meaningful variable names (<code>roll</code>, not <code>x</code>)."],
  interview: ["What does the f in an f-string stand for?", "What does \"=\" * 10 produce?", "How do you left-align text in an f-string?"],
  practiceQs: ["Change the card to show your own details.", "Add a line for Email without breaking the alignment.", "Make the border 40 characters wide and re-centre the title."],
  revision: ["Variables hold values; f-strings insert them.", "\"text\" * n repeats text.", "{value:<w} left, {value:^w} centre, {value:>w} right align.", "Plan, store, print."],
  hinglish: "Pehle data variables mein rakho, phir f-string se sundar format mein print karo. \"=\" * 30 se border banta hai. :<10 left align, :^34 center aur :>5 right align karta hai.",
  quiz: [
    mcq("What does this print?\n\nname = \"Ravi\"\nprint(f\"Hi {name}\")", ["Hi {name}", "Hi Ravi", "f Hi Ravi", "Error"], 1, "The f-string replaces {name} by its value.", "OUTPUT_PREDICTION"),
    mcq("What does \"-\" * 5 produce?", ["-5", "-----", "- - - - -", "Error"], 1, "Multiplying a string repeats it."),
    mcq("Without the f prefix, print(\"Hi {name}\") prints:", ["Hi Ravi", "Hi {name}", "Error", "Hi name"], 1, "Without the f, braces are ordinary characters.", "OUTPUT_PREDICTION"),
    mcq("Which format left-aligns the value in a field 10 wide?", ["{x:>10}", "{x:^10}", "{x:<10}", "{x:10.}"], 2, "< means left-align, > right, ^ centre."),
  ],
  tasks: [
    task("Introduction card", "Print exactly these three lines using variables name = \"Neha\", city = \"Delhi\", skill = \"Python\":\n\nName: Neha\nCity: Delhi\nSkill: Python", "name = \"Neha\"\ncity = \"Delhi\"\nskill = \"Python\"\n# print the three lines using f-strings\n", `name = "Neha"\ncity = "Delhi"\nskill = "Python"\nprint(f"Name: {name}")\nprint(f"City: {city}")\nprint(f"Skill: {skill}")`, [["", "Name: Neha\nCity: Delhi\nSkill: Python"], ["", "Name: Neha\nCity: Delhi\nSkill: Python"]], [["", "Name: Neha\nCity: Delhi\nSkill: Python"]]),
    task("Boxed title", "Print a 20-character border of \"*\", then the word PYTHON centred in 20 characters, then the border again.", "border = \"*\" * 20\n# print the border, the centred title, the border\n", `border = "*" * 20\nprint(border)\nprint(f"{'PYTHON':^20}")\nprint(border)`, [["", "********************\n       PYTHON       \n********************"], ["", "********************\n       PYTHON       \n********************"]], [["", "********************\n       PYTHON       \n********************"]]),
  ],
});

module.exports = {
  module: {
    title: "Phase 0 - Module 1: Introduction to Programming",
    description: "What programming is, what Python is, how Python runs a program, and your first working programs.",
    chapters: [{ title: "Introduction to Programming", description: "Concepts, history, execution model and first programs.", lessons }],
    assessment: {
      title: "Module 1 Assessment: Introduction to Programming",
      description: "Print-based problems covering Module 1.",
      questions: [
        task("Three-line greeting", "Print exactly:\n\nHello\nWelcome to Python\nLet's code", "", `print("Hello")\nprint("Welcome to Python")\nprint("Let's code")`, [["", "Hello\nWelcome to Python\nLet's code"], ["", "Hello\nWelcome to Python\nLet's code"]], [["", "Hello\nWelcome to Python\nLet's code"]]),
        task("Same line", "Print the words Python and rocks on the same line using two print calls so the output is exactly: Python rocks", "", `print("Python", end=" ")\nprint("rocks")`, [["", "Python rocks"], ["", "Python rocks"]], [["", "Python rocks"]]),
        task("Mini card", "Use variables name = \"Kiran\" and roll = 7 to print: Kiran (Roll 7)", "name = \"Kiran\"\nroll = 7\n", `name = "Kiran"\nroll = 7\nprint(f"{name} (Roll {roll})")`, [["", "Kiran (Roll 7)"], ["", "Kiran (Roll 7)"]], [["", "Kiran (Roll 7)"]]),
      ],
    },
  },
};
