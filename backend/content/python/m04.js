// Phase 1 / Module 4: Data Types and Data Handling.
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
  title: "Numbers, Booleans and None",
  minutes: 40,
  learn: ["Use int, float, complex, bool and None", "Convert between number systems and between types", "Explain why bool is a kind of int", "Choose between float and Decimal"],
  why: "Every value in a program has a type, and the type decides what you can do with it. Choosing the right numeric type avoids rounding bugs in marks, money and measurements.",
  realWorld: "A marks sheet uses int for roll numbers, float for percentages, bool for pass/fail and None for a mark not yet entered.",
  simple: "Whole numbers are <code>int</code>, numbers with a decimal point are <code>float</code>, <code>True</code>/<code>False</code> are <code>bool</code>, and <code>None</code> means &quot;no value&quot;. Python also has <code>complex</code> numbers for engineering and science.",
  detail: `${table(["Type", "Example", "Notes"], [["int", "42, -7, 1_000_000", "Unlimited size. <code>_</code> can separate digits for readability"], ["float", "3.14, 2e3, -0.5", "64-bit approximation of a real number; <code>2e3</code> is 2000.0"], ["complex", "3 + 4j", "<code>.real</code>, <code>.imag</code>; <code>abs()</code> gives the magnitude"], ["bool", "True, False", "A subclass of int: <code>True == 1</code>, <code>False == 0</code>"], ["NoneType", "None", "The single &quot;nothing&quot; value; test with <code>is None</code>"]])}
<h3>Number systems</h3>
<p>Write literals as <code>0b101</code> (binary), <code>0o17</code> (octal), <code>0xFF</code> (hex). Convert with <code>bin()</code>, <code>oct()</code>, <code>hex()</code>, and parse text with <code>int("101", 2)</code>.</p>
<h3>Special float values</h3>
<p><code>float("inf")</code> is infinity and <code>float("nan")</code> means &quot;not a number&quot;. NaN is not equal to anything, even itself: <code>nan == nan</code> is False.</p>
<h3>Float versus Decimal</h3>
<p>Floats are binary approximations, so <code>0.1 + 0.2</code> is not exactly 0.3. For money, use integers (paise) or the <code>decimal</code> module, which does exact decimal arithmetic: <code>Decimal("0.1") + Decimal("0.2")</code> is exactly <code>0.3</code>. Always build a Decimal from a <em>string</em>, not a float.</p>
<h3>Type conversion summary</h3>
<p><code>int(3.9)</code> is 3 (truncates toward zero); <code>float(2)</code> is 2.0; <code>int(True)</code> is 1; <code>bool(0)</code>, <code>bool("")</code>, <code>bool(None)</code> are False, nearly everything else is True; <code>int("abc")</code> raises ValueError.</p>`,
  syntax: { code: `x = 10          # int\ny = 2.5         # float\nz = 3 + 4j      # complex\nok = True       # bool\nnothing = None  # NoneType\ntype(x)         # ask for the type\nisinstance(x, int)`, note: "<code>isinstance(value, type)</code> is the preferred way to test a type." },
  diagram: graph("Python's basic value types", "A box labelled value types with arrows to int, float, complex, bool and None; a note that bool is a kind of int.", 640, 210,
    [{ id: "v", k: "term", t: "Basic value types", x: 320, y: 32, w: 210, h: 40 }, { id: "i", k: "proc", t: "int\n42", x: 80, y: 130, w: 110, h: 50 }, { id: "f", k: "proc", t: "float\n3.14", x: 210, y: 130, w: 110, h: 50 }, { id: "c", k: "proc", t: "complex\n3+4j", x: 340, y: 130, w: 110, h: 50 }, { id: "b", k: "proc", t: "bool\n(is an int)", x: 470, y: 130, w: 110, h: 50 }, { id: "n", k: "proc", t: "None", x: 590, y: 130, w: 90, h: 50 }],
    [{ from: "v", to: "i" }, { from: "v", to: "f" }, { from: "v", to: "c" }, { from: "v", to: "b" }, { from: "v", to: "n" }]),
  example: { code: `big = 2 ** 100\nprint(big)\nprint(type(3.0), type(True), type(None))\nz = 3 + 4j\nprint(z.real, z.imag, abs(z))\nprint(True + True, isinstance(True, int))\nprint(bin(10), hex(255), int("101", 2))\nprint(1_000_000)`, out: `1267650600228229401496703205376\n<class 'float'> <class 'bool'> <class 'NoneType'>\n3.0 4.0 5.0\n2 True\n0b1010 0xff 5\n1000000` },
  lineByLine: [["2 ** 100", "Python integers never overflow; the result has 31 digits."], ["type(3.0), type(True), type(None)", "Three different classes."], ["z.real, z.imag, abs(z)", "A complex number 3+4j has real part 3.0, imaginary part 4.0 and magnitude 5.0 (3-4-5 triangle)."], ["True + True", "bool behaves as the integers 1 and 0, so the sum is 2."], ["bin(10), hex(255), int(\"101\", 2)", "Conversions between number systems."], ["1_000_000", "Underscores are ignored; they only help the reader."]],
  dryRun: { intro: "Why <code>True + True</code> is 2:", headers: ["Expression", "Treated as", "Result"], rows: [["True", "int 1", "1"], ["True + True", "1 + 1", "2"], ["isinstance(True, int)", "bool is a subclass of int", "True"]] },
  realExample: { intro: "Money with floats versus Decimal.", code: `from decimal import Decimal\nprint(0.1 + 0.1 + 0.1 == 0.3)\nprint(Decimal("0.1") + Decimal("0.1") + Decimal("0.1") == Decimal("0.3"))\nmark = None\nprint(mark is None)`, out: `False\nTrue\nTrue` },
  mistakes: ["Comparing floats with <code>==</code>.", "Creating <code>Decimal(0.1)</code> from a float; it carries the float's error. Use <code>Decimal(\"0.1\")</code>.", "Using <code>== None</code> instead of <code>is None</code>.", "Thinking <code>int(-3.9)</code> is -4. It truncates to -3.", "Leading zeros: <code>007</code> is a SyntaxError for an int literal."],
  practices: ["Use int for counts and IDs, float for measurements, Decimal or integer paise for money.", "Test types with <code>isinstance()</code>, not <code>type(x) == ...</code>.", "Use <code>None</code> to mean &quot;not available yet&quot;, never 0 or &quot;&quot;."],
  interview: ["Is bool a subclass of int? What does True + 1 give?", "Why is 0.1 + 0.2 != 0.3?", "How large can a Python int be?", "What is the difference between == None and is None?"],
  practiceQs: ["Predict: int(-3.9), round(-3.9), int(\"12\") + 1.", "Write 255 in binary, octal and hex using built-ins.", "What does bool([]) return? bool([0])?"],
  revision: ["int is unlimited; float is approximate; complex has real and imag; bool is an int; None is nothing.", "Convert: int() truncates; float() widens; bool() tests emptiness.", "Money: Decimal from strings, or integer paise."],
  hinglish: "int bina limit ke bada ho sakta hai, float approximate hota hai, bool asal mein int hi hai (True = 1). None ka matlab hai koi value nahi. Paise ke liye float ki jagah Decimal ya integer paise use karo.",
  quiz: [
    mcq("What is True + True?", ["TrueTrue", "2", "True", "Error"], 1, "bool is a subclass of int.", "OUTPUT_PREDICTION"),
    mcq("What is int(-3.9)?", ["-4", "-3", "3", "-3.9"], 1, "int() truncates toward zero.", "OUTPUT_PREDICTION"),
    mcq("Which is the right test for None?", ["x == None only", "x is None", "None in x", "x = None"], 1, "None is a single object, so compare identity."),
    mcq("What is the type of 2e3?", ["int", "float", "str", "complex"], 1, "Scientific notation gives a float: 2000.0."),
    mcq("What does bin(5) return?", ["101", "0b101", "5b", "0x5"], 1, "bin() returns a string with the 0b prefix."),
  ],
  tasks: [task("Binary of a number", "Read a non-negative integer and print its binary form without the 0b prefix.", "n = int(input())\n# print the binary digits only\n", `n = int(input())\nprint(bin(n)[2:])`, [["5", "101"], ["8", "1000"]], [["5", "101"], ["8", "1000"], ["0", "0"], ["255", "11111111"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Mutable vs Immutable Objects, References and Identity",
  minutes: 40,
  learn: ["Tell mutable and immutable types apart", "Explain what happens when you assign, copy or modify objects", "Use id() and is to reason about identity", "Avoid the classic aliasing bug"],
  why: "Most &quot;mysterious&quot; Python bugs, such as a list changing when you did not touch it, come from not knowing which objects can change in place.",
  realWorld: "Two parts of an app hold the same cart list. If one adds an item, the other sees it, which is either a feature or a bug depending on whether you meant to share it.",
  simple: "Immutable objects (numbers, strings, tuples) can never change; &quot;changing&quot; them makes a new object. Mutable objects (lists, dictionaries, sets) can change in place, and every name pointing at them sees the change.",
  detail: `${table(["Immutable", "Mutable"], [["int, float, bool, complex", "list"], ["str", "dict"], ["tuple", "set"], ["frozenset, bytes", "bytearray, most user-defined objects"]])}
<h3>Names and objects</h3>
<p><code>b = a</code> never copies an object: it makes a second name for it. For immutables this is harmless because nothing can change. For mutables, both names see in-place changes.</p>
<h3>Making a copy</h3>
<ul><li>Shallow copy: <code>a.copy()</code>, <code>a[:]</code>, <code>list(a)</code>. New outer list, same inner objects.</li><li>Deep copy: <code>copy.deepcopy(a)</code>. Everything is copied recursively (needed for lists of lists; Module 7 goes deeper).</li></ul>
<h3>== versus is</h3>
<p><code>==</code> compares values; <code>is</code> compares identity (same object). <code>id(x)</code> gives an integer unique to the object while it lives; its numeric value differs from run to run, so only compare ids, never print them.</p>
<h3>Strings never change</h3>
<p><code>s[0] = "x"</code> raises <code>TypeError</code>. Methods such as <code>s.upper()</code> return a <em>new</em> string and leave <code>s</code> as it was.</p>`,
  syntax: { code: `b = a            # second name, same object\nb = a.copy()     # new list, same items\nid(a) == id(b)   # same as: a is b\nimport copy\nb = copy.deepcopy(a)`, note: "Copy when you need an independent object." },
  diagram: graph("Alias versus copy", "Names a and b point to the same list; name c points to a separate copy made with copy().", 620, 190,
    [{ id: "a", k: "term", t: "a", x: 70, y: 40, w: 70, h: 36 }, { id: "b", k: "term", t: "b = a", x: 70, y: 100, w: 80, h: 36 }, { id: "c", k: "term", t: "c = a.copy()", x: 70, y: 160, w: 120, h: 36 }, { id: "o1", k: "proc", t: "list [1, 2, 3]\n(one object)", x: 370, y: 70, w: 190, h: 56 }, { id: "o2", k: "proc", t: "list [1, 2, 3]\n(a different object)", x: 370, y: 160, w: 210, h: 50 }],
    [{ from: "a", to: "o1" }, { from: "b", to: "o1" }, { from: "c", to: "o2" }]),
  example: { code: `a = [1, 2, 3]\nb = a\nc = a.copy()\nb.append(4)\nprint(a)\nprint(c)\nprint(a is b, a is c, a == c)\n\nname = "python"\ntry:\n    name[0] = "P"\nexcept TypeError:\n    print("strings are immutable")\nprint(name.upper(), name)`, out: `[1, 2, 3, 4]\n[1, 2, 3]\nTrue False False\nstrings are immutable\nPYTHON python` },
  lineByLine: [["b = a", "A second name for the same list."], ["c = a.copy()", "A new list with the same items."], ["b.append(4)", "Changes the one list that <code>a</code> and <code>b</code> share."], ["a is b, a is c, a == c", "a and b are one object; c is a different object; after the append a no longer equals c, so the last value is False."], ["name[0] = \"P\"", "Strings cannot be changed in place, so this raises TypeError, which the try/except catches."], ["name.upper(), name", "upper() returns a new string; the original is untouched."]],
  dryRun: { intro: "Tracking the three names:", headers: ["After", "a", "b", "c"], rows: [["a = [1,2,3]", "[1,2,3]", "-", "-"], ["b = a", "[1,2,3]", "same object", "-"], ["c = a.copy()", "[1,2,3]", "same object", "[1,2,3] (new)"], ["b.append(4)", "[1,2,3,4]", "same object", "[1,2,3]"]] },
  realExample: { intro: "The classic nested-list trap: a shallow copy shares the inner lists.", code: `import copy\nmatrix = [[1, 2], [3, 4]]\nshallow = matrix.copy()\ndeep = copy.deepcopy(matrix)\nmatrix[0][0] = 99\nprint(shallow[0][0])\nprint(deep[0][0])`, out: `99\n1` },
  mistakes: ["Thinking <code>b = a</code> copies a list.", "Using a shallow copy for a list of lists.", "Using <code>is</code> to compare values.", "Expecting <code>s.upper()</code> to change <code>s</code>.", "Printing or storing <code>id()</code> numbers and expecting them to repeat."],
  practices: ["Say &quot;second name&quot; when you write <code>b = a</code> and ask whether that is intended.", "Copy before modifying data you received from elsewhere.", "Prefer immutable types (tuple, str) for data that should not change."],
  interview: ["What is the difference between mutable and immutable? Give examples.", "What is the difference between a shallow and a deep copy?", "Why can a tuple containing a list still &quot;change&quot;?", "What does a is b check?"],
  practiceQs: ["Predict: x = [1]; y = x; y += [2]; print(x).", "Predict: s = \"hi\"; t = s; t += \"!\"; print(s, t).", "Make an independent copy of [[1], [2]] so changing the copy never changes the original."],
  revision: ["Immutable: int, float, bool, str, tuple. Mutable: list, dict, set.", "Assignment never copies.", "copy()/[:] shallow, deepcopy deep.", "== value, is identity."],
  hinglish: "b = a ka matlab copy nahi, sirf doosra naam hai. List mutable hai isliye ek naam se badlo to dusre naam se bhi badla dikhega. Alag list chahiye to copy() ya nested ke liye deepcopy() use karo.",
  quiz: [
    mcq("Which type is immutable?", ["list", "dict", "tuple", "set"], 2, "Tuples cannot be changed in place."),
    mcq("What is printed?\n\na = [1]\nb = a\nb.append(2)\nprint(a)", ["[1]", "[1, 2]", "[2]", "Error"], 1, "a and b are the same list.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\ns = \"hi\"\nt = s\nt += \"!\"\nprint(s, t)", ["hi! hi!", "hi hi!", "hi hi", "Error"], 1, "Strings are immutable; t += \"!\" makes a new string for t.", "OUTPUT_PREDICTION"),
    mcq("Which makes an independent copy of a list of lists?", ["b = a", "b = a.copy()", "b = copy.deepcopy(a)", "b = a[:]"], 2, "Only a deep copy copies the inner lists too."),
    mcq("What does this do?\n\ns = \"cat\"\ns[0] = \"b\"", ["Makes s = bat", "Raises TypeError", "Raises ValueError", "Does nothing"], 1, "Strings do not support item assignment.", "DEBUG"),
  ],
  tasks: [task("Independent copy", "Given a = [1, 2, 3], make b a copy of a, append 4 to b only, then print a and b on one line separated by a space.", "a = [1, 2, 3]\n# make a copy b, change only b, then print a and b\n", `a = [1, 2, 3]\nb = a.copy()\nb.append(4)\nprint(a, b)`, [["", "[1, 2, 3] [1, 2, 3, 4]"], ["", "[1, 2, 3] [1, 2, 3, 4]"]], [["", "[1, 2, 3] [1, 2, 3, 4]"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Strings: Representation, Escape Sequences and Indexing",
  minutes: 40,
  learn: ["Create strings with single, double and triple quotes", "Use escape sequences and raw strings", "Index characters with positive and negative positions", "Explain how text is stored (Unicode)"],
  why: "Names, messages, file paths, JSON and web pages are all text. Strings are the type you will use most.",
  realWorld: "A login form handles a username (string), compares it with stored text and writes a log line. Every step is string handling.",
  simple: "A string is a row of characters. Each character has a position (index) starting at <strong>0</strong>. Negative positions count from the end: <code>-1</code> is the last character.",
  detail: `<h3>Creating strings</h3>
<ul><li><code>'single'</code> or <code>"double"</code> quotes: identical. Use the other kind to include a quote: <code>"it's"</code>.</li><li><code>"""triple"""</code> strings can span several lines.</li><li>A string is a sequence of <strong>Unicode</strong> characters, so Hindi and emoji work: <code>len("नमस्ते")</code> is 6 (code points, not what a reader sees as letters).</li></ul>
<h3>Escape sequences</h3>
${table(["Sequence", "Meaning"], [["\\n", "new line"], ["\\t", "tab"], ["\\\\", "one backslash"], ["\\'  \\\"", "a quote inside a string of the same kind"], ["\\u0905", "Unicode character by code (here the Hindi letter अ)"]])}
<p>A <strong>raw string</strong> <code>r"C:\\new\\table"</code> keeps backslashes as they are, which is useful for Windows paths and regular expressions.</p>
<h3>Indexing</h3>
${table(["", "P", "Y", "T", "H", "O", "N"], [["index", "0", "1", "2", "3", "4", "5"], ["negative", "-6", "-5", "-4", "-3", "-2", "-1"]])}
<p>An index outside the string raises <code>IndexError</code>. Strings are <strong>immutable</strong>, so you can read <code>s[0]</code> but not assign to it.</p>
<h3>Handy built-ins</h3>
<p><code>len(s)</code> length; <code>ord("A")</code> the code of a character (65); <code>chr(97)</code> the character for a code (a); <code>repr(s)</code> a developer-friendly form showing quotes and escapes; <code>s1 + s2</code> joins; <code>s * 3</code> repeats; <code>"a" in s</code> tests for a substring.</p>`,
  syntax: { code: `s = "Python"\ns[0]       # 'P'\ns[-1]      # 'n'\nlen(s)      # 6\nr"C:\\new"   # raw string\n"""line 1\nline 2"""`, note: "Index 0 is the first character." },
  diagram: graph("Positive and negative indexes of PYTHON", "Six boxes for the letters P Y T H O N with indexes 0 to 5 above and -6 to -1 below.", 620, 150,
    [{ id: "p", k: "proc", t: "P", x: 90, y: 75, w: 60, h: 46 }, { id: "y", k: "proc", t: "Y", x: 170, y: 75, w: 60, h: 46 }, { id: "t", k: "proc", t: "T", x: 250, y: 75, w: 60, h: 46 }, { id: "h", k: "proc", t: "H", x: 330, y: 75, w: 60, h: 46 }, { id: "o", k: "proc", t: "O", x: 410, y: 75, w: 60, h: 46 }, { id: "n", k: "proc", t: "N", x: 490, y: 75, w: 60, h: 46 }],
    []).replace("</svg>", ["0", "1", "2", "3", "4", "5"].map((d, i) => `<text x="${90 + i * 80}" y="38" text-anchor="middle" font-size="14" fill="currentColor" font-family="system-ui,sans-serif">${d}</text>`).join("") + ["-6", "-5", "-4", "-3", "-2", "-1"].map((d, i) => `<text x="${90 + i * 80}" y="125" text-anchor="middle" font-size="14" fill="currentColor" font-family="system-ui,sans-serif">${d}</text>`).join("") + "</svg>"),
  example: { code: `s = "Python"\nprint(s[0], s[5], s[-1], s[-6])\nprint(len(s))\nprint("Line 1\\nLine 2")\nprint("a\\tb")\nprint(r"C:\\new")\nprint(repr("hi\\n"))\nprint(ord("A"), chr(97))\nprint(len("नमस्ते"))`, out: `P n n P\n6\nLine 1\nLine 2\na\tb\nC:\\new\n'hi\\n'\n65 a\n6` },
  lineByLine: [["s[0], s[5], s[-1], s[-6]", "First, last (two ways) and first again from the end."], ["len(s)", "Counts characters: 6."], ["\"Line 1\\nLine 2\"", "<code>\\n</code> starts a new line when printed."], ["r\"C:\\new\"", "Raw string: the backslash is kept, so no new line is produced."], ["repr(\"hi\\n\")", "Shows the escape sequence instead of acting on it."], ["ord(\"A\"), chr(97)", "Character code and back."], ["len(\"नमस्ते\")", "Six Unicode code points."]],
  dryRun: { intro: "Index lookup in <code>s = \"Python\"</code>:", headers: ["Expression", "Position counted", "Result"], rows: [["s[0]", "from the left, 0", "P"], ["s[5]", "from the left, 5", "n"], ["s[-1]", "from the right, 1", "n"], ["s[6]", "out of range", "IndexError"]] },
  realExample: { intro: "Initials from a full name using indexing and a space search.", code: `full_name = "Asha Verma"\nspace = full_name.index(" ")\ninitials = full_name[0] + full_name[space + 1]\nprint(initials)\nprint(full_name[-1])`, out: `AV\na` },
  mistakes: ["Starting to count at 1.", "Using <code>s[len(s)]</code>: the last index is <code>len(s) - 1</code>.", "Assigning to a character: <code>s[0] = \"x\"</code>.", "Writing a Windows path like <code>\"C:\\new\\test\"</code> and getting a newline and tab; use a raw string or forward slashes.", "Confusing <code>print(s)</code> with <code>print(repr(s))</code> when debugging."],
  practices: ["Use negative indexes for &quot;from the end&quot;.", "Use triple quotes for multi-line text.", "Use <code>repr()</code> to see hidden characters such as trailing newlines or spaces."],
  interview: ["Are strings mutable? What happens on s[0] = 'x'?", "What does s[-1] return?", "What is a raw string and when do you use it?", "Does len() count bytes or characters?"],
  practiceQs: ["What is \"Hello\"[1] and \"Hello\"[-2]?", "Print a string that contains both single and double quotes.", "What does \"a\\tb\\n\" look like through repr()?"],
  revision: ["Index from 0; negative from the end.", "\\n \\t \\\\ are escapes; r\"...\" is raw.", "Strings are immutable Unicode sequences.", "len, ord, chr, repr, in, +, *."],
  hinglish: "String mein index 0 se shuru hota hai, aur negative index peeche se ginta hai (-1 matlab last). String ko badla nahi ja sakta (immutable). Windows path ke liye raw string r\"...\" use karo.",
  quiz: [
    mcq("What is \"Python\"[-1]?", ["P", "n", "o", "Error"], 1, "-1 is the last character.", "OUTPUT_PREDICTION"),
    mcq("What happens with \"cat\"[3]?", ["t", "Empty string", "IndexError", "None"], 2, "Valid indexes are 0 to 2."),
    mcq("What does print(\"a\\tb\") output?", ["a\\tb", "a    b with a tab between", "ab", "Error"], 1, "\\t inserts a tab character.", "OUTPUT_PREDICTION"),
    mcq("What does r\"C:\\new\" contain?", ["A newline after C:", "The backslash and n as written", "An error", "Only C:"], 1, "A raw string keeps backslashes literally."),
    mcq("What is ord(\"A\")?", ["1", "65", "97", "A"], 1, "The Unicode code point of A is 65.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("First, last and length", "Read a word. Print its first character, its last character and its length, separated by single spaces.", "s = input()\n# print first, last and length\n", `s = input()\nprint(s[0], s[-1], len(s))`, [["Python", "P n 6"], ["code", "c e 4"]], [["Python", "P n 6"], ["code", "c e 4"], ["a", "a a 1"], ["Arena", "A a 5"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "String Slicing",
  minutes: 35,
  learn: ["Cut strings with start:stop:step", "Reverse a string and take every nth character", "Predict slices with negative bounds and steps", "Know that slices never raise IndexError"],
  why: "Slicing is one of Python's most used features and a favourite interview topic: reversing, palindromes, prefix/suffix checks and windows over data all use it.",
  realWorld: "Splitting a roll number like <code>CS2025045</code> into department (<code>[:2]</code>) and serial (<code>[-3:]</code>) is a slice.",
  simple: "<code>s[start:stop]</code> gives the part from <code>start</code> up to but <strong>not including</strong> <code>stop</code>. Leave a bound out to mean &quot;from the beginning&quot; or &quot;to the end&quot;.",
  detail: `<p>General form: <code>s[start:stop:step]</code>. Defaults: start = 0, stop = end, step = 1. With a negative step the defaults flip: start = last, stop = before first.</p>
${table(["Slice of \"PYTHON\"", "Result", "Explanation"], [["s[0:2]", "PY", "indexes 0 and 1"], ["s[2:]", "THON", "from 2 to the end"], ["s[:3]", "PYT", "first three"], ["s[-3:]", "HON", "last three"], ["s[:-1]", "PYTHO", "everything except the last"], ["s[::2]", "PTO", "every second character"], ["s[1:5:2]", "YH", "indexes 1 and 3"], ["s[::-1]", "NOHTYP", "reversed"], ["s[10:]", "(empty)", "out of range slices give an empty string"]])}
<p>Slices make <em>new</em> strings. They are forgiving: bounds beyond the ends are clipped silently, unlike a single index, which raises <code>IndexError</code>.</p>
<h3>The &quot;half-open&quot; idea</h3>
<p>Because the stop is excluded, <code>s[:k] + s[k:]</code> is always the whole string, and <code>s[a:b]</code> has <code>b - a</code> characters. That is why Python ranges and slices fit together without off-by-one gaps.</p>`,
  syntax: { code: `s[start:stop]\ns[start:stop:step]\ns[:k]  s[k:]  s[-k:]  s[::-1]`, note: "stop is not included." },
  diagram: graph("Slicing PYTHON with s[1:4]", "The letters P Y T H O N with the slice from index 1 up to but not including 4 highlighted as YTH.", 620, 150,
    [{ id: "p", k: "proc", t: "P", x: 90, y: 90, w: 60, h: 46 }, { id: "y", k: "term", t: "Y", x: 170, y: 90, w: 60, h: 46 }, { id: "t", k: "term", t: "T", x: 250, y: 90, w: 60, h: 46 }, { id: "h", k: "term", t: "H", x: 330, y: 90, w: 60, h: 46 }, { id: "o", k: "proc", t: "O", x: 410, y: 90, w: 60, h: 46 }, { id: "n", k: "proc", t: "N", x: 490, y: 90, w: 60, h: 46 }],
    []).replace("</svg>", `<text x="250" y="30" text-anchor="middle" font-size="14" fill="currentColor" font-family="system-ui,sans-serif">s[1:4] = "YTH"  (start 1 included, stop 4 excluded)</text><line x1="140" y1="45" x2="360" y2="45" stroke="currentColor" stroke-width="2"/><text x="90" y="135" text-anchor="middle" font-size="12" fill="currentColor">0</text><text x="170" y="135" text-anchor="middle" font-size="12" fill="currentColor">1</text><text x="250" y="135" text-anchor="middle" font-size="12" fill="currentColor">2</text><text x="330" y="135" text-anchor="middle" font-size="12" fill="currentColor">3</text><text x="410" y="135" text-anchor="middle" font-size="12" fill="currentColor">4</text><text x="490" y="135" text-anchor="middle" font-size="12" fill="currentColor">5</text></svg>`),
  example: { code: `s = "PYTHON"\nprint(s[0:2], s[2:], s[:3])\nprint(s[-3:], s[:-1])\nprint(s[::2], s[1:5:2])\nprint(s[::-1])\nprint(repr(s[10:]))`, out: `PY THON PYT\nHON PYTHO\nPTO YH\nNOHTYP\n''` },
  lineByLine: [["s[0:2], s[2:], s[:3]", "Positions 0-1; 2 to the end; the first three."], ["s[-3:], s[:-1]", "The last three characters; everything but the last."], ["s[::2], s[1:5:2]", "Every second character from the start; indexes 1 and 3."], ["s[::-1]", "A step of -1 walks backwards through the whole string."], ["s[10:]", "Beyond the end: an empty string, not an error; <code>repr</code> shows it as <code>''</code>."]],
  dryRun: { intro: "How <code>s[1:5:2]</code> is built:", headers: ["Step", "Index", "Character", "Kept?"], rows: [["start", "1", "Y", "yes"], ["+2", "3", "H", "yes"], ["+2", "5", "N", "no: 5 is the stop (excluded)"]] },
  realExample: { intro: "Split a roll number into parts and test a palindrome the slice way.", code: `roll = "CS2025045"\ndept, year, serial = roll[:2], roll[2:6], roll[-3:]\nprint(dept, year, serial)\nword = "level"\nprint(word == word[::-1])`, out: `CS 2025 045\nTrue` },
  mistakes: ["Expecting the stop index to be included.", "Mixing up <code>s[-3:]</code> (last three) and <code>s[:-3]</code> (all but the last three).", "Expecting a slice to change the original string.", "Forgetting that a negative step reverses the meaning of start and stop.", "Using a slice where a single index is meant: <code>s[2:3]</code> is a string, <code>s[2]</code> is a character (the same here, but not for lists of numbers)."],
  practices: ["Name your bounds when they are not obvious: <code>year = roll[2:6]</code>.", "Use <code>[::-1]</code> to reverse; use <code>[-k:]</code> for suffixes.", "Remember <code>len(s[a:b]) == b - a</code> inside the range."],
  interview: ["How do you reverse a string in Python?", "What is s[::2]? What is s[::-2]?", "Why does s[100:] not raise an error but s[100] does?", "Check whether a word is a palindrome using slicing."],
  practiceQs: ["For s = \"abcdef\", write s[1:4], s[-2:], s[::-1], s[::3].", "Get the last two characters of any string.", "What is \"hello\"[1:-1]?"],
  revision: ["s[start:stop:step]; stop excluded.", "Omitted bounds default to the ends.", "s[::-1] reverses.", "Slices are forgiving and create new strings."],
  hinglish: "s[a:b] mein a se shuru hota hai aur b se pehle ruk jata hai (b shamil nahi). s[::-1] string ko ulta kar deta hai. Slice out of range ho to error nahi aata, khali string milti hai.",
  quiz: [
    mcq("What is \"PYTHON\"[1:4]?", ["PYT", "YTH", "YTHO", "THO"], 1, "Indexes 1, 2, 3.", "OUTPUT_PREDICTION"),
    mcq("What is \"PYTHON\"[::-1]?", ["PYTHON", "NOHTYP", "NOHTY", "Error"], 1, "A negative step reverses.", "OUTPUT_PREDICTION"),
    mcq("What is \"abcdef\"[-2:]?", ["ab", "ef", "de", "f"], 1, "The last two characters.", "OUTPUT_PREDICTION"),
    mcq("What does \"abc\"[5:] return?", ["IndexError", "None", "An empty string", "c"], 2, "Slices clip to the string, so you get ''."),
    mcq("What is \"hello\"[1:-1]?", ["ell", "hell", "ello", "el"], 0, "From index 1 up to but not including the last character.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Reverse and every second", "Read a string. Print it reversed on the first line and every second character (starting from the first) on the second line.", "s = input()\n# line 1: reversed, line 2: every second character\n", `s = input()\nprint(s[::-1])\nprint(s[::2])`, [["PYTHON", "NOHTYP\nPTO"], ["abcdef", "fedcba\nace"]], [["PYTHON", "NOHTYP\nPTO"], ["abcdef", "fedcba\nace"], ["a", "a\na"], ["ab", "ba\na"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "String Methods",
  minutes: 45,
  learn: ["Change case and clean text with upper, lower, title, strip, replace", "Split text into words and join words back", "Search with find, index, count, startswith, endswith", "Test content with isdigit, isalpha, isalnum"],
  why: "Real data is messy: extra spaces, mixed case, commas. String methods clean and analyse it, and they appear in almost every coding test.",
  realWorld: "A sign-up form trims spaces, lowercases the email, checks that the phone number contains only digits and splits the full name.",
  simple: "A method is a function that belongs to a value: <code>text.upper()</code>. Strings are immutable, so every method <strong>returns a new string</strong>; the original never changes unless you reassign it.",
  detail: `${table(["Group", "Methods", "Example → result"], [["Case", "upper, lower, title, capitalize, swapcase, casefold", "\"hello world\".title() → 'Hello World'"], ["Clean", "strip, lstrip, rstrip", "\"  hi  \".strip() → 'hi'"], ["Replace", "replace(old, new[, count])", "\"a-b-c\".replace(\"-\", \"\") → 'abc'"], ["Split / join", "split(sep), splitlines(), \"sep\".join(list)", "\"a,b,c\".split(\",\") → ['a', 'b', 'c']"], ["Search", "find, rfind, index, count, startswith, endswith", "\"banana\".find(\"na\") → 2"], ["Test", "isdigit, isalpha, isalnum, isspace, isupper, islower", "\"123\".isdigit() → True"], ["Layout", "center, ljust, rjust, zfill", "\"7\".zfill(3) → '007'"], ["Partition", "partition(sep)", "\"k=v\".partition(\"=\") → ('k', '=', 'v')"]])}
<h3>find vs index</h3>
<p><code>find</code> returns <code>-1</code> when the text is missing; <code>index</code> raises <code>ValueError</code>. Use <code>in</code> for a plain yes/no.</p>
<h3>split and join are opposites</h3>
<p><code>"a b  c".split()</code> with no argument splits on any run of whitespace and ignores leading/trailing space: <code>['a', 'b', 'c']</code>. <code>" ".join(words)</code> glues a list of strings with a space between. <code>join</code> belongs to the <em>separator</em>, not the list.</p>
<h3>count does not overlap</h3>
<p><code>"aaaa".count("aa")</code> is 2, not 3.</p>
<h3>Chaining</h3>
<p>Each method returns a string, so you can chain: <code>text.strip().lower().replace(" ", "_")</code>.</p>`,
  syntax: { code: `text.strip()\ntext.lower()\ntext.replace(old, new)\ntext.split()        # list of words\n" ".join(words)\ntext.find(sub)  text.count(sub)\ntext.startswith(prefix)`, note: "All of these return new values; text itself is unchanged." },
  diagram: chain("Cleaning text with chained methods", "Four steps left to right: raw text, strip spaces, lowercase, replace spaces with underscores.",
    [{ k: "io", t: "\"  Hello World \"" }, { k: "proc", t: ".strip()" }, { k: "proc", t: ".lower()" }, { k: "proc", t: ".replace(\" \", \"_\")" }], { w: 150, gap: 26, hgt: 50 }),
  example: { code: `text = "  Hello, World  "\nprint(text.strip())\nprint(text.strip().upper())\nprint("a,b,c".split(","))\nprint("-".join(["x", "y", "z"]))\nprint("banana".count("an"), "banana".find("na"), "banana".find("x"))\nprint("hello world".title(), "123".isdigit(), "abc".isalpha())\nprint("7".zfill(3), "hi".center(6, "*"))\nprint("k=v".partition("="))\nprint(text.strip().lower().replace(" ", "_"))`, out: `Hello, World\nHELLO, WORLD\n['a', 'b', 'c']\nx-y-z\n2 2 -1\nHello World True True\n007 **hi**\n('k', '=', 'v')\nhello,_world` },
  lineByLine: [["text.strip()", "Removes spaces from both ends."], ["\"a,b,c\".split(\",\")", "Cuts at each comma, returning a list."], ["\"-\".join([...])", "Glues list items with a dash."], ["\"banana\".count(\"an\"), find(\"na\"), find(\"x\")", "Two non-overlapping &quot;an&quot;; first &quot;na&quot; at index 2; missing text gives -1."], ["\"7\".zfill(3), \"hi\".center(6, \"*\")", "Zero-pad to width 3; centre in 6 using * as filler."], ["\"k=v\".partition(\"=\")", "Returns (before, separator, after)."], ["strip().lower().replace(...)", "Methods chained left to right."]],
  dryRun: { intro: "Evaluating the final chain on <code>\"  Hello, World  \"</code>:", headers: ["Step", "Value"], rows: [["start", "'  Hello, World  '"], [".strip()", "'Hello, World'"], [".lower()", "'hello, world'"], [".replace(\" \", \"_\")", "'hello,_world'"]] },
  realExample: { intro: "Normalise a sentence: tidy spaces, count words, build a slug for a URL.", code: `title = "  Python   Zero To Hero  "\nwords = title.split()\nprint(len(words))\nprint(" ".join(words))\nprint("-".join(words).lower())`, out: `4\nPython Zero To Hero\npython-zero-to-hero` },
  mistakes: ["Writing <code>s.upper()</code> and expecting <code>s</code> to change.", "Using <code>index</code> when the text may be missing (ValueError); use <code>find</code> or <code>in</code>.", "Calling <code>\"abc\".join</code> on the list instead of the separator: <code>words.join(\" \")</code> is an AttributeError.", "Forgetting that <code>strip()</code> only removes the ends, not spaces inside.", "Comparing <code>\"Yes\" == \"yes\"</code> without normalising case."],
  practices: ["Clean input first: <code>.strip().lower()</code>.", "Use <code>split()</code> without arguments for words.", "Use <code>in</code>/<code>startswith</code> for yes/no questions instead of <code>find() != -1</code>.", "Use <code>casefold()</code> for case-insensitive comparisons of international text."],
  interview: ["Difference between find and index?", "Are strings changed by upper()? Why?", "How do you reverse the words in a sentence?", "What does split() do with no arguments?"],
  practiceQs: ["Turn \"  data science \" into \"Data Science\".", "Count the vowels a in \"banana\" and the substring \"na\".", "Why does \"abc\".join(\"12\") give '1abc2'?", "Reverse the word order of \"I love Python\" using split and join."],
  revision: ["Methods return new strings.", "strip, lower, upper, title, replace.", "split &harr; join; find vs index; count; startswith/endswith.", "isdigit, isalpha, isalnum for content checks."],
  hinglish: "String methods nayi string return karte hain, purani string badalti nahi. strip() dono kinaaron ke space hatata hai, split() string ko list mein todta hai aur join() list ko jodta hai. find() na milne par -1 deta hai, index() error deta hai.",
  quiz: [
    mcq("What does \"  hi  \".strip() return?", ["'hi'", "'  hi'", "'hi  '", "'  hi  '"], 0, "strip() removes whitespace from both ends.", "OUTPUT_PREDICTION"),
    mcq("What is \"a,b,c\".split(\",\")?", ["'a b c'", "['a', 'b', 'c']", "('a','b','c')", "'abc'"], 1, "split returns a list of strings.", "OUTPUT_PREDICTION"),
    mcq("What does \"banana\".find(\"x\") return?", ["0", "-1", "None", "ValueError"], 1, "find returns -1 when the text is not present."),
    mcq("What is printed?\n\ns = \"python\"\ns.upper()\nprint(s)", ["PYTHON", "python", "Python", "Error"], 1, "The result of upper() was thrown away; s is unchanged.", "OUTPUT_PREDICTION"),
    mcq("Which joins a list of words with spaces?", ["words.join(\" \")", "\" \".join(words)", "join(words, \" \")", "words + \" \""], 1, "join is a method of the separator string."),
    mcq("What is \"aaaa\".count(\"aa\")?", ["3", "2", "4", "1"], 1, "Matches do not overlap.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Clean and count", "Read a line that may have extra spaces. Print the text as Title Case with single spaces between the words on the first line, and the number of words on the second line.", "line = input()\n# line 1: tidy Title Case text, line 2: word count\n", `line = input()\nwords = line.split()\nprint(" ".join(words).title())\nprint(len(words))`, [["  hello   world ", "Hello World\n2"], ["python zero to hero", "Python Zero To Hero\n4"]], [["  hello   world ", "Hello World\n2"], ["python zero to hero", "Python Zero To Hero\n4"], ["one", "One\n1"], ["  data   SCIENCE  club ", "Data Science Club\n3"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "String Formatting and f-strings",
  minutes: 40,
  learn: ["Format values with f-strings, str.format() and the % operator", "Control width, alignment, padding, decimals, separators and percentages", "Print aligned tables and receipts", "Use !r and = for debugging output"],
  why: "Professional output is aligned, rounded and readable. f-strings are the modern standard and appear in nearly all current Python code.",
  realWorld: "Invoices, report cards, log lines and CLI tables are all formatted text.",
  simple: "Put an <code>f</code> before the quotes and write Python expressions inside <code>{ }</code>. After a colon you can say how to show the value: <code>{price:.2f}</code> means two decimals.",
  detail: `<h3>Three ways</h3>
${table(["Style", "Example", "Use"], [["f-string (3.6+)", "f\"{name} scored {marks:.1f}\"", "Preferred"], ["str.format()", "\"{} scored {:.1f}\".format(name, marks)", "Older code, templates stored in variables"], ["% operator", "\"%s scored %.1f\" % (name, marks)", "Legacy code; some logging calls"]])}
<h3>The format specification  <code>{value:[fill][align][sign][0][width][,][.precision][type]}</code></h3>
${table(["Spec", "Meaning", "Example → result"], [[".2f", "2 decimals", "f\"{3.14159:.2f}\" → 3.14"], ["10", "width 10", "f\"{'ab':10}|\" → ab        |"], ["&lt;10  &gt;10  ^10", "left / right / centre", "f\"{'ab':^6}\" → '  ab  '"], ["*^9", "fill with * and centre", "f\"{'x':*^9}\" → ****x****"], ["05d", "zero-pad integer", "f\"{42:05d}\" → 00042"], [",", "thousands separator", "f\"{1234567:,}\" → 1,234,567"], [".1%", "percentage", "f\"{0.256:.1%}\" → 25.6%"], ["b  x  o", "binary / hex / octal", "f\"{255:b}\" → 11111111"], ["e", "scientific", "f\"{12345.678:.2e}\" → 1.23e+04"]])}
<h3>Debugging helpers</h3>
<p><code>f"{name!r}"</code> shows <code>repr(name)</code> (with quotes). <code>f"{x=}"</code> (Python 3.8+) prints both the expression and its value: <code>x=5</code>. Literal braces are written doubled: <code>f"{{ok}}"</code>.</p>
<p>Numbers align right by default; text aligns left. Any expression works inside the braces: <code>{a + b}</code>, <code>{name.upper()}</code>. Keep them short.</p>`,
  syntax: { code: `f"{value}"\nf"{value:>10}"\nf"{value:.2f}"\nf"{value:,}"\nf"{x=}"\n"{} {}".format(a, b)`, note: "After the colon comes the format specification." },
  diagram: chain("Anatomy of an f-string field", "Four boxes: the expression, the colon, the alignment and width, the type with precision, e.g. price colon greater-than 8 point 2 f.",
    [{ k: "proc", t: "{ price" }, { k: "proc", t: ": (start of spec)" }, { k: "proc", t: "> 8  (right, width 8)" }, { k: "proc", t: ".2f }  (2 decimals)" }], { w: 150, gap: 22, hgt: 54 }),
  example: { code: `name = "Asha"\nmarks = 78.456\nprint(f"{name} scored {marks:.1f}")\nprint(f"[{name:<8}] [{name:>8}] [{name:^8}]")\nprint(f"{42:05d} {1234567:,} {0.256:.1%}")\nprint(f"{255:b} {255:x} {'x':*^9}")\nx = 5\nprint(f"{x=} {name!r}")\nprint("{} scored {:.1f}".format(name, marks))\nprint("%s scored %.1f" % (name, marks))\nprint(f"{{literal}} {x + 1}")`, out: `Asha scored 78.5\n[Asha    ] [    Asha] [  Asha  ]\n00042 1,234,567 25.6%\n11111111 ff ****x****\nx=5 'Asha'\nAsha scored 78.5\nAsha scored 78.5\n{literal} 6` },
  lineByLine: [["{marks:.1f}", "78.456 rounded to one decimal: 78.5."], ["{name:<8} {name:>8} {name:^8}", "Left, right and centre aligned in 8 characters."], ["{42:05d}  {1234567:,}  {0.256:.1%}", "Zero padded; thousands separator; percentage (multiplies by 100)."], ["{255:b}  {255:x}  {'x':*^9}", "Binary, hexadecimal and a centred filler."], ["{x=}  {name!r}", "Debug form <code>x=5</code>; <code>!r</code> adds quotes."], [".format and %", "The two older styles giving the same text."], ["{{literal}} {x + 1}", "Doubled braces print literally; other braces evaluate an expression."]],
  dryRun: { intro: "Building <code>[{name:^8}]</code> for Asha (4 letters in a width of 8):", headers: ["Step", "Value"], rows: [["text", "Asha (4 characters)"], ["padding needed", "8 - 4 = 4"], ["split left/right", "2 left, 2 right"], ["result", "'  Asha  '"]] },
  realExample: { intro: "An aligned receipt: names left, numbers right, totals with two decimals.", code: `items = [("Notebook", 3, 45.5), ("Pen", 10, 8.25), ("Bag", 1, 899.0)]\nprint(f"{'Item':<10}{'Qty':>4}{'Total':>10}")\ngrand = 0\nfor item, qty, price in items:\n    total = qty * price\n    grand += total\n    print(f"{item:<10}{qty:>4}{total:>10.2f}")\nprint(f"{'TOTAL':<14}{grand:>10.2f}")`, out: `Item       Qty     Total\nNotebook     3    136.50\nPen         10     82.50\nBag          1    899.00\nTOTAL            1118.00` },
  mistakes: ["Forgetting the <code>f</code> prefix.", "Reusing the same quote type inside an f-string on older Python versions.", "Using <code>:.2f</code> on a string (ValueError) or <code>:d</code> on a float.", "Rounding with <code>round()</code> and then expecting trailing zeros; formatting is what keeps <code>20.00</code>.", "Putting long logic inside the braces instead of computing it first."],
  practices: ["Format only at the output step; keep calculations unformatted.", "Use a fixed width for table columns.", "Use <code>{x=}</code> for quick debugging.", "Use <code>%</code>-style only when a library (such as logging) asks for it."],
  interview: ["What are the differences between f-strings, format() and %?", "How do you print a float with exactly 2 decimals?", "How do you print braces in an f-string?", "What does f\"{x=}\" do?"],
  practiceQs: ["Format 1234.5 as 1,234.50.", "Print the number 7 as 007.", "Print 'Python' centred in 20 characters with dashes.", "Show 0.875 as a percentage with one decimal."],
  revision: ["f\"{value:spec}\".", "Align: &lt; &gt; ^; fill; width; .Nf; comma; %; b/x/o.", "{x=} debug, !r repr, {{ }} literal braces.", "format() and % still exist."],
  hinglish: "f-string mein f lagao aur { } ke andar value ya expression likho. Colon ke baad format batao: .2f do decimal, >10 right align, , se thousands separator. Debugging ke liye {x=} bahut kaam aata hai.",
  quiz: [
    mcq("What does f\"{3.14159:.2f}\" produce?", ["3.1", "3.14", "3.142", "3.14159"], 1, ".2f means two digits after the decimal point.", "OUTPUT_PREDICTION"),
    mcq("What does f\"{42:05d}\" produce?", ["42000", "00042", "42", "0042"], 1, "05d pads with zeros to width 5.", "OUTPUT_PREDICTION"),
    mcq("What does f\"{0.256:.1%}\" produce?", ["0.3%", "25.6%", "0.256%", "26%"], 1, "% multiplies by 100 and adds the sign.", "OUTPUT_PREDICTION"),
    mcq("How do you print a literal { in an f-string?", ["\\{", "{{", "[{]", "%{"], 1, "Double the brace."),
    mcq("What does f\"{x=}\" print when x is 5?", ["5", "x=5", "x = 5.0", "Error"], 1, "It prints the expression and its value (Python 3.8+).", "OUTPUT_PREDICTION"),
  ],
  tasks: [
    task("Report line", "Read a name and a mark (a decimal). Print the name left-aligned in 10 characters, then a | character, then the mark right-aligned in width 6 with 2 decimals.", "name = input()\nmarks = float(input())\n# print: name padded to 10, |, mark in width 6 with 2 decimals\n", `name = input()\nmarks = float(input())\nprint(f"{name:<10}|{marks:>6.2f}")`, [["Asha\n78.5", "Asha      | 78.50"], ["Ravi\n9", "Ravi      |  9.00"]], [["Asha\n78.5", "Asha      | 78.50"], ["Ravi\n9", "Ravi      |  9.00"], ["Zoya\n100", "Zoya      |100.00"]]),
    task("Percentage", "Read two integers: the marks obtained and the total marks. Print the percentage with one decimal place and a % sign (use the % format type).", "got = int(input())\ntotal = int(input())\n# print the percentage with 1 decimal\n", `got = int(input())\ntotal = int(input())\nprint(f"{got / total:.1%}")`, [["1\n4", "25.0%"], ["2\n3", "66.7%"]], [["1\n4", "25.0%"], ["2\n3", "66.7%"], ["45\n50", "90.0%"], ["0\n10", "0.0%"]]),
  ],
});

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Common String Problems for Interviews",
  minutes: 45,
  learn: ["Solve reverse, palindrome, anagram, vowel-count and rotation problems", "Apply slicing and methods instead of long code", "State the time and space complexity of each solution", "Test with edge cases: empty string, one character, mixed case"],
  why: "String questions are the most common first round of coding tests. Knowing the standard patterns makes them quick and safe.",
  realWorld: "Checking a username, matching a name regardless of case, validating a code or comparing two words for the same letters.",
  simple: "Most string problems reduce to four tools: normalise (lower, strip), slice, count/compare, or sort. Think &quot;what makes two strings equal for this problem?&quot; and change both strings to that form first.",
  detail: `<p>Only tools from this module are used here. Loops and conditions (Modules 5 and 6) make several of these shorter; the complexity noted is for the shown version. <em>n</em> is the string length.</p>
${table(["Problem", "Idea", "Time", "Extra space"], [["Reverse a string", "<code>s[::-1]</code>", "O(n)", "O(n)"], ["Palindrome (ignore case and spaces)", "normalise, compare with its reverse", "O(n)", "O(n)"], ["Anagram check", "<code>sorted(a) == sorted(b)</code> after normalising", "O(n log n)", "O(n)"], ["Count vowels", "<code>count</code> for each vowel on the lowercase text", "O(n) (five scans)", "O(1)"], ["Rotation check", "same length and <code>b in a + a</code>", "O(n) to O(n&sup2;) depending on search", "O(n)"], ["Word count", "<code>len(s.split())</code>", "O(n)", "O(n)"], ["Longest word", "<code>max(s.split(), key=len)</code>", "O(n)", "O(n)"], ["Remove all spaces", "<code>&quot;&quot;.join(s.split())</code>", "O(n)", "O(n)"]])}
<h3>Edge cases to always test</h3>
<ul><li>Empty string <code>""</code>: is an empty string a palindrome? (Yes, by convention.)</li><li>One character.</li><li>Upper and lower case mixed: <code>"Madam"</code>.</li><li>Spaces and punctuation: <code>"A man, a plan..."</code>: say whether they count.</li></ul>
<h3>sorted() on a string</h3>
<p><code>sorted("silent")</code> returns a <em>list</em> of characters in order: <code>['e','i','l','n','s','t']</code>. Two words are anagrams when their sorted lists are equal.</p>`,
  syntax: { code: `s[::-1]\nclean = s.lower().replace(" ", "")\nsorted(a) == sorted(b)\nb in a + a\nmax(words, key=len)`, note: "Normalise first, then compare." },
  diagram: chain("Anagram check", "Left to right: two words, make both lowercase, sort the letters of each, compare the two sorted lists.",
    [{ k: "io", t: "listen\nsilent" }, { k: "proc", t: "lowercase" }, { k: "proc", t: "sort letters\nof each" }, { k: "dec", t: "equal?" }], { w: 130, gap: 32, hgt: 58 }),
  example: { code: `s = "Never Odd Or Even"\ncleaned = s.lower().replace(" ", "")\nprint(cleaned)\nprint(cleaned == cleaned[::-1])\nprint(sorted("silent") == sorted("listen"))\nprint(sorted("silent"))\nprint("erbottlewat" in "waterbottle" + "waterbottle")\nprint(max("I love programming in Python".split(), key=len))`, out: `neveroddoreven\nTrue\nTrue\n['e', 'i', 'l', 'n', 's', 't']\nTrue\nprogramming` },
  lineByLine: [["s.lower().replace(\" \", \"\")", "Normalise: lowercase and no spaces."], ["cleaned == cleaned[::-1]", "A palindrome reads the same backwards."], ["sorted(\"silent\") == sorted(\"listen\")", "Same letters in any order give equal sorted lists."], ["\"erbottlewat\" in \"waterbottle\" + \"waterbottle\"", "A rotation of a string is always a substring of the string written twice."], ["max(words, key=len)", "The word with the greatest length."]],
  dryRun: { intro: "Palindrome check for <code>\"Never Odd Or Even\"</code>:", headers: ["Step", "Value"], rows: [["lower()", "never odd or even"], ["replace spaces", "neveroddoreven"], ["reversed", "neveroddoreven"], ["equal?", "True"]] },
  realExample: { intro: "Count vowels without a loop, using one count per vowel.", code: `text = "Education Is Power"\nlow = text.lower()\nvowels = low.count("a") + low.count("e") + low.count("i") + low.count("o") + low.count("u")\nprint(vowels)\nprint(len(text.split()))`, out: `8\n3` },
  mistakes: ["Forgetting to lowercase before comparing.", "Comparing <code>sorted(a)</code> to the string <code>b</code> (a list never equals a string).", "Testing only the sample input: no empty string, no mixed case.", "Counting vowels on the original text but only checking lowercase vowels.", "Claiming O(1) space when the solution builds a new string."],
  practices: ["Write the normalisation step first and test it alone.", "State complexity in interviews: say both time and space.", "Mention the loop version after the one-liner to show you can write both."],
  interview: ["Reverse a string without s[::-1] (answer after Module 6).", "Check whether two strings are anagrams. What is the complexity? Can you do it in O(n)? (answer after Module 7: count characters in a dictionary.)", "Is one string a rotation of another?", "Find the longest word in a sentence."],
  practiceQs: ["Is \"Madam\" a palindrome? What normalisation do you need?", "Are \"Dusty\" and \"Study\" anagrams (ignore case)?", "Why does the rotation trick need the same length check?", "How many words are in \"  a  b c \"?"],
  revision: ["Normalise, then compare.", "Reverse: [::-1]; anagram: sorted; rotation: in a + a.", "Always test empty, single, mixed case.", "State time and space."],
  hinglish: "String ke sawaal mein pehle dono strings ko ek jaisa banao (lower, spaces hatao), phir compare karo. Palindrome ke liye s == s[::-1], anagram ke liye sorted(a) == sorted(b).",
  quiz: [
    mcq("Which expression checks that s is a palindrome (already normalised)?", ["s == s[::-1]", "s is s[::-1]", "s[0] == s[-1] only", "sorted(s) == s"], 0, "A palindrome equals its reverse."),
    mcq("What does sorted(\"cab\") return?", ["'abc'", "['a', 'b', 'c']", "('a','b','c')", "'cab'"], 1, "sorted returns a list.", "OUTPUT_PREDICTION"),
    mcq("Which finds the longest word in words?", ["max(words, key=len)", "len(max(words))", "words.max()", "sorted(words)[0]"], 0, "key=len compares by length."),
    mcq("What is \"abc\" == sorted(\"abc\")?", ["True", "False", "Error", "None"], 1, "A string never equals a list.", "OUTPUT_PREDICTION"),
    mcq("Which statement is true for the rotation test b in a + a?", ["It also needs len(a) == len(b)", "It works for any two strings", "It needs sorting", "It only works for palindromes"], 0, "Without the equal-length check a short substring would pass."),
  ],
  tasks: [
    task("Palindrome ignoring case and spaces", "Read a line. Print True if it is a palindrome when case and spaces are ignored, otherwise False.", "s = input()\n# normalise, then compare with the reverse\n", `s = input()\ncleaned = s.lower().replace(" ", "")\nprint(cleaned == cleaned[::-1])`, [["Never odd or even", "True"], ["Python", "False"]], [["Never odd or even", "True"], ["Python", "False"], ["Madam", "True"], ["a", "True"], ["race car", "True"]]),
    task("Anagram check", "Read two words on separate lines. Print True if they are anagrams of each other ignoring case, otherwise False.", "a = input()\nb = input()\n# compare the sorted letters\n", `a = input()\nb = input()\nprint(sorted(a.lower()) == sorted(b.lower()))`, [["listen\nsilent", "True"], ["apple\npale", "False"]], [["listen\nsilent", "True"], ["apple\npale", "False"], ["Dusty\nStudy", "True"], ["abc\nabcc", "False"]]),
  ],
});

const pad = (s, n) => String(s).padEnd(n), padl = (s, n) => String(s).padStart(n);
module.exports = {
  module: {
    title: "Phase 1 - Module 4: Data Types and Data Handling",
    description: "Numbers, booleans and None, mutable and immutable objects, references and identity, and complete string handling: indexing, slicing, methods, formatting and interview problems.",
    chapters: [{ title: "Data Types and Data Handling", description: "From numeric types to confident string manipulation.", lessons }],
    assessment: {
      title: "Module 4 Assessment: Data Types and Strings",
      description: "Number systems, slicing, formatting and string analysis.",
      questions: [
        task("Binary representation", "Read a non-negative integer and print its binary digits without the 0b prefix.", "", `n = int(input())\nprint(bin(n)[2:])`, [["10", "1010"], ["1", "1"]], [["10", "1010"], ["1", "1"], ["0", "0"], ["64", "1000000"]]),
        task("Reverse and shout", "Read a word. Print it reversed in capital letters.", "", `s = input()\nprint(s[::-1].upper())`, [["python", "NOHTYP"], ["Arena", "ANERA"]], [["python", "NOHTYP"], ["Arena", "ANERA"], ["a", "A"]]),
        task("Receipt line", "Read an item name, a quantity (integer) and a unit price (decimal) on three lines. Print the name left-aligned in width 10, the quantity right-aligned in width 3 and the total (quantity times price) right-aligned in width 8 with 2 decimals, all on one line with no separators.", "", `item = input()\nqty = int(input())\nprice = float(input())\nprint(f"{item:<10}{qty:>3}{qty * price:>8.2f}")`, [["Pen\n3\n12.5", pad("Pen", 10) + padl(3, 3) + padl("37.50", 8)], ["Bag\n1\n899", pad("Bag", 10) + padl(1, 3) + padl("899.00", 8)]], [["Pen\n3\n12.5", pad("Pen", 10) + padl(3, 3) + padl("37.50", 8)], ["Bag\n1\n899", pad("Bag", 10) + padl(1, 3) + padl("899.00", 8)], ["Notebook\n12\n45.25", pad("Notebook", 10) + padl(12, 3) + padl("543.00", 8)]]),
        task("Count the vowels", "Read a line of text. Print how many vowels (a, e, i, o, u in either case) it contains.", "", `low = input().lower()\nprint(sum(low.count(v) for v in "aeiou"))`, [["Education", "5"], ["rhythm", "0"]], [["Education", "5"], ["rhythm", "0"], ["AEIOU aeiou", "10"], ["Python Zero To Hero", "6"]]),
      ],
    },
  },
};
