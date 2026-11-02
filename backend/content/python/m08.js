// Phase 1 / Module 8: Functions and Modular Programming.
"use strict";
const { chain, graph, table, svgWrap, esc } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];
const tx = (x, y, s, size = 14, anchor = "middle") => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="currentColor" font-family="system-ui,sans-serif">${esc(s)}</text>`;
const box = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="rgba(127,127,127,.08)" stroke="currentColor" stroke-width="1.6"/>`;

// ---------------------------------------------------------------- 1
lessons.push({
  title: "Defining and Calling Functions, return and Docstrings",
  minutes: 45,
  learn: ["Define a function with def and call it", "Return one or several values", "Tell print() and return apart", "Write a docstring and a clean function"],
  why: "A function gives a name to a piece of work so you can reuse it, test it and understand big programs in small parts. Every real program is built from functions.",
  realWorld: "<code>calculate_gst(amount)</code> is written once and used on every invoice; <code>send_email(to, text)</code> is called from many places.",
  simple: "<code>def name(inputs):</code> starts a function. Inside, <code>return</code> sends a result back. Calling <code>name(values)</code> runs it and gives you that result.",
  detail: `<h3>Parts of a function</h3>
<ul><li><strong>def</strong> and a name in <code>snake_case</code>, brackets with <strong>parameters</strong> (the inputs it expects), a colon.</li><li>An indented <strong>body</strong>, usually starting with a one-line <strong>docstring</strong>.</li><li><strong>return</strong> sends a value back and ends the function at once. A function without a <code>return</code> (or with a bare <code>return</code>) gives back <code>None</code>.</li></ul>
<p>The values you pass when calling are <strong>arguments</strong>. Defining a function runs nothing; calling it does.</p>
<h3>print versus return</h3>
<p><code>print</code> shows something on the screen for a person. <code>return</code> hands a value to the code that called the function, so it can be stored, tested or combined. Functions that compute should usually <em>return</em>; the caller decides whether to print.</p>
<h3>Several results</h3>
<p><code>return a, b</code> returns one tuple; the caller unpacks it: <code>low, high = bounds(data)</code>.</p>
<h3>Good function design</h3>
<ul><li>Do one thing and name it with a verb: <code>count_vowels</code>, <code>is_even</code>.</li><li>Prefer returning a value over printing or changing global variables.</li><li>Keep it short enough to read on one screen.</li><li>Functions are objects: you can store them in lists, pass them to other functions and return them (next lessons).</li></ul>`,
  syntax: { code: `def function_name(parameter1, parameter2):\n    """One line describing what it does."""\n    result = parameter1 + parameter2\n    return result\n\nvalue = function_name(3, 4)`, note: "The call needs the same number of arguments as parameters (unless defaults are given)." },
  diagram: graph("Calling a function", "Flow: the caller passes arguments to the function, the body runs, return sends a value back to the caller which stores it.", 640, 170,
    [{ id: "c", k: "proc", t: "caller:\nresult = area(4, 5)", x: 110, y: 85, w: 170, h: 60 }, { id: "f", k: "proc", t: "function body\narea(l, w)", x: 330, y: 85, w: 160, h: 60 }, { id: "r", k: "io", t: "return l * w\n= 20", x: 540, y: 85, w: 150, h: 56 }],
    [{ from: "c", to: "f", label: "4, 5" }, { from: "f", to: "r" }]),
  example: { code: `def area(length, breadth):\n    """Return the area of a rectangle."""\n    return length * breadth\n\ndef bounds(values):\n    return min(values), max(values)\n\ndef shout(text):\n    print(text.upper())\n\nprint(area(4, 5))\nlow, high = bounds([3, 9, 1])\nprint(low, high)\nresult = shout("hi")\nprint(result)`, out: `20\n1 9\nHI\nNone` },
  lineByLine: [["def area(length, breadth):", "Defines the function and its two parameters."], ["return length * breadth", "Sends the product back to the caller."], ["return min(values), max(values)", "Returns a tuple of two values."], ["def shout(text): print(...)", "Prints but does not return, so the call gives None."], ["result = shout(\"hi\")", "Runs the function (printing HI) and stores None."]],
  dryRun: { intro: "Tracing <code>area(4, 5)</code>:", headers: ["Step", "length", "breadth", "Note"], rows: [["call", "4", "5", "arguments bind to parameters"], ["compute", "4", "5", "4 * 5"], ["return", "-", "-", "20 goes back to the caller"]] },
  realExample: { intro: "A reusable GST calculator: the function returns, the caller formats.", code: `def total_with_gst(amount, rate=18):\n    """Return the amount including GST at the given percentage."""\n    return amount + amount * rate / 100\n\nprint(f"{total_with_gst(1000):.2f}")\nprint(f"{total_with_gst(1000, 5):.2f}")`, out: `1180.00\n1050.00` },
  mistakes: ["Calling without brackets (<code>area</code> is the function object; <code>area()</code> calls it).", "Using <code>print</code> where <code>return</code> is needed, then trying to use the result.", "Code after <code>return</code> never runs.", "Forgetting the colon or the indentation.", "Using a variable defined inside a function outside it (NameError)."],
  practices: ["Write a one-line docstring for every function.", "Keep functions small and single-purpose.", "Return values; print in the caller.", "Name functions with verbs and parameters with nouns."],
  interview: ["Difference between parameters and arguments?", "What does a function return if it has no return statement?", "Can a function return multiple values?", "What is a docstring?"],
  practiceQs: ["Write is_even(n) returning True or False.", "Write a function that returns the average of a list.", "What does print(print('a')) show?", "Why does code after return not run?"],
  revision: ["def name(params): body.", "return gives a value back; default None.", "print is for people, return for code.", "Multiple returns make a tuple."],
  hinglish: "def se function banate hain aur naam(arguments) se chalate hain. return value wapas bhejta hai, print sirf screen par dikhata hai. return na likho to function None deta hai.",
  quiz: [
    mcq("What does a function without a return statement give back?", ["0", "None", "An empty string", "An error"], 1, "It returns None.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\ndef f(x):\n    return x * 2\n    print(\"done\")\nprint(f(4))", ["8", "done then 8", "done", "None"], 0, "Code after return is not reached.", "OUTPUT_PREDICTION"),
    mcq("What does def f(): return 1, 2 return?", ["1", "[1, 2]", "(1, 2)", "2"], 2, "Several values make a tuple.", "OUTPUT_PREDICTION"),
    mcq("What is the difference between f and f()?", ["None", "f is the function object; f() calls it", "f() defines it", "They are the same"], 1, "Brackets perform the call."),
    mcq("Find the bug:\n\ndef add(a, b):\n    print(a + b)\ntotal = add(2, 3) + 1", ["add returns None, so None + 1 fails", "add is misspelled", "Missing colon", "No bug"], 0, "The function should return the sum.", "DEBUG"),
  ],
  tasks: [task("Rectangle helpers", "Complete the program: define area(l, w) and perimeter(l, w) that return the values, then read the length and the breadth (one per line) and print the area and the perimeter separated by a space.", "def area(l, w):\n    pass\n\ndef perimeter(l, w):\n    pass\n\nlength = int(input())\nbreadth = int(input())\n# print area and perimeter\n", `def area(l, w):\n    return l * w\n\ndef perimeter(l, w):\n    return 2 * (l + w)\n\nlength = int(input())\nbreadth = int(input())\nprint(area(length, breadth), perimeter(length, breadth))`, [["4\n5", "20 18"], ["1\n1", "1 4"]], [["4\n5", "20 18"], ["1\n1", "1 4"], ["10\n3", "30 26"], ["7\n7", "49 28"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Parameters and Arguments: Defaults, Keywords, *args and **kwargs",
  minutes: 50,
  learn: ["Pass arguments by position and by keyword", "Give parameters default values", "Accept any number of arguments with *args and **kwargs", "Avoid the mutable default argument trap"],
  why: "Flexible signatures make functions easy to call correctly and easy to extend without breaking old code. Libraries you will use (print, sorted, requests) are built this way.",
  realWorld: "<code>print(a, b, sep='-', end='')</code> uses variable arguments and keyword options; <code>send_mail(to, subject, body='', cc=None)</code> has optional parts.",
  simple: "Arguments can be matched by <strong>position</strong> or by <strong>name</strong>. A default value makes a parameter optional. <code>*args</code> collects extra positional values into a tuple and <code>**kwargs</code> collects extra named values into a dictionary.",
  detail: `${table(["Kind", "Example", "Notes"], [["Positional", "<code>f(1, 2)</code>", "matched left to right"], ["Keyword", "<code>f(b=2, a=1)</code>", "matched by name, any order; must come after positional ones"], ["Default", "<code>def f(a, b=10)</code>", "defaults must come after non-default parameters"], ["*args", "<code>def f(*args)</code>", "extra positional values as a tuple"], ["**kwargs", "<code>def f(**kwargs)</code>", "extra named values as a dict"], ["Keyword-only", "<code>def f(a, *, flag=False)</code>", "everything after <code>*</code> must be named"], ["Positional-only", "<code>def f(a, b, /)</code>", "Python 3.8+: before <code>/</code> cannot be named"]])}
<h3>Order in a signature</h3>
<p><code>def f(pos_only, /, normal, *args, kw_only, **kwargs)</code>. Most functions use only a few of these.</p>
<h3>Unpacking at the call</h3>
<p><code>f(*[1, 2, 3])</code> spreads a list into positional arguments; <code>f(**{"a": 1})</code> spreads a dictionary into keyword arguments.</p>
<h3>The mutable default trap</h3>
<p>Default values are created <strong>once</strong>, when the function is defined. <code>def add(x, items=[])</code> therefore shares one list between all calls. Use <code>None</code> and create the list inside:</p>
<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px"><code>def add(x, items=None):\n    if items is None:\n        items = []\n    items.append(x)\n    return items</code></pre>
<p>Python raises <code>TypeError</code> for a missing required argument, an unknown keyword or a value given twice.</p>`,
  syntax: { code: `def describe(name, age=18, *hobbies, city="Pune", **extra):\n    ...\ndescribe("Asha", 20, "chess", "music", city="Delhi", role="admin")`, note: "Order: positional, defaults, *args, keyword-only, **kwargs." },
  diagram: graph("How a call is matched", "The call describe(Asha, 20, chess, city=Delhi) matches name and age by position, extra positional values go to args, city by keyword.", 640, 240,
    [{ id: "c", k: "term", t: "describe(\"Asha\", 20, \"chess\", city=\"Delhi\")", x: 320, y: 36, w: 380, h: 40 }, { id: "n", k: "proc", t: "name = \"Asha\"", x: 90, y: 135, w: 150, h: 40 }, { id: "a", k: "proc", t: "age = 20", x: 225, y: 195, w: 100, h: 36 }, { id: "h", k: "proc", t: "hobbies = (\"chess\",)", x: 385, y: 195, w: 190, h: 40 }, { id: "ci", k: "proc", t: "city = \"Delhi\"", x: 570, y: 135, w: 130, h: 36 }],
    [{ from: "c", to: "n" }, { from: "c", to: "a" }, { from: "c", to: "h" }, { from: "c", to: "ci" }]),
  example: { code: `def describe(name, age=18, *hobbies, city="Pune", **extra):\n    print(name, age, hobbies, city, extra)\n\ndescribe("Asha")\ndescribe("Ravi", 20, "chess", "music", city="Delhi", role="admin")\ndescribe(age=30, name="Zoya")\n\ndef total(*numbers):\n    return sum(numbers)\n\nprint(total(1, 2, 3), total())\nvalues = [4, 5, 6]\nprint(total(*values))\n\ndef add(x, items=None):\n    if items is None:\n        items = []\n    items.append(x)\n    return items\n\nprint(add(1), add(2))`, out: `Asha 18 () Pune {}\nRavi 20 ('chess', 'music') Delhi {'role': 'admin'}\nZoya 30 () Pune {}\n6 0\n15\n[1] [2]` },
  lineByLine: [["describe(\"Asha\")", "Only the required name is given; the defaults fill in the rest; hobbies is an empty tuple."], ["describe(\"Ravi\", 20, \"chess\", \"music\", ...)", "Two extra positional values land in the tuple <code>hobbies</code>; <code>role</code> is not a named parameter, so it goes into the dict <code>extra</code>."], ["describe(age=30, name=\"Zoya\")", "Keyword arguments can come in any order."], ["total(*values)", "The star spreads the list into separate arguments."], ["items=None", "Creates a fresh list on every call, so calls do not share state."]],
  dryRun: { intro: "Matching the second call:", headers: ["Parameter", "Receives", "How"], rows: [["name", "\"Ravi\"", "1st positional"], ["age", "20", "2nd positional"], ["*hobbies", "(\"chess\", \"music\")", "remaining positional"], ["city", "\"Delhi\"", "keyword-only, by name"], ["**extra", "{'role': 'admin'}", "unknown keyword"]] },
  realExample: { intro: "The mutable default trap, shown and fixed.", code: `def bad(x, items=[]):\n    items.append(x)\n    return items\n\nprint(bad(1), bad(2))\n\ndef good(x, items=None):\n    items = [] if items is None else items\n    items.append(x)\n    return items\n\nprint(good(1), good(2))`, out: `[1, 2] [1, 2]\n[1] [2]` },
  mistakes: ["Using a list or dictionary as a default value.", "Placing a parameter without a default after one with a default.", "Passing the same argument both by position and by name (TypeError).", "Forgetting the star when passing a list as separate arguments.", "Using <code>*args</code> where a single list parameter is clearer."],
  practices: ["Use keyword arguments for options at the call site: <code>save(path, overwrite=True)</code>.", "Use <code>None</code> for &quot;no value&quot; defaults.", "Prefer a few clear parameters over **kwargs.", "Document what each parameter means."],
  interview: ["What is *args and **kwargs?", "Why is def f(x, items=[]) dangerous?", "Difference between positional and keyword arguments?", "What does f(*args, **kwargs) do?"],
  practiceQs: ["Write mean(*numbers) that returns 0 for no arguments.", "Call print with sep=\"-\" and end=\"!\".", "What error does def f(a, b): pass; f(1) raise?", "Why must keyword-only parameters be named in the call?"],
  revision: ["Positional, keyword, default.", "*args tuple; **kwargs dict.", "Defaults are evaluated once.", "Use None for mutable defaults."],
  hinglish: "Arguments position se ya naam se de sakte hain. Default value parameter ko optional bana deti hai. *args extra positional values ka tuple banata hai aur **kwargs extra named values ka dictionary. List ya dict ko default mat banao, None use karo.",
  quiz: [
    mcq("What type is args inside def f(*args)?", ["list", "tuple", "dict", "set"], 1, "Extra positional arguments are collected in a tuple.", "OUTPUT_PREDICTION"),
    mcq("What type is kwargs inside def f(**kwargs)?", ["tuple", "list", "dict", "str"], 2, "Extra named arguments become a dictionary.", "OUTPUT_PREDICTION"),
    mcq("What does this print?\n\ndef f(a, b=2):\n    return a + b\nprint(f(1), f(1, 5), f(b=1, a=1))", ["3 6 2", "1 5 1", "3 6 3", "Error"], 0, "1+2, 1+5, 1+1.", "OUTPUT_PREDICTION"),
    mcq("Which signature is invalid?", ["def f(a, b=1):", "def f(a=1, b):", "def f(*args):", "def f(a, *, b):"], 1, "A parameter without a default cannot follow one with a default."),
    mcq("What is the output?\n\ndef add(x, items=[]):\n    items.append(x)\n    return items\nadd(1)\nprint(add(2))", ["[2]", "[1, 2]", "[1]", "Error"], 1, "The default list is shared between calls.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Average of any numbers", "Define average(*numbers) that returns the mean of the values it receives, rounded to 2 decimals. Read a line of numbers, call it with the numbers spread as separate arguments and print the result.", "def average(*numbers):\n    pass\n\nnums = list(map(float, input().split()))\n# print(average(...))\n", `def average(*numbers):\n    return round(sum(numbers) / len(numbers), 2)\n\nnums = list(map(float, input().split()))\nprint(average(*nums))`, [["70 80 90", "80.0"], ["1 2", "1.5"]], [["70 80 90", "80.0"], ["1 2", "1.5"], ["5", "5.0"], ["10 20 25", "18.33"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Scope: Local, Global, Enclosing and the LEGB Rule",
  minutes: 40,
  learn: ["Explain where a name can be seen", "Apply the LEGB lookup order", "Use global and nonlocal correctly (and rarely)", "Build a closure that remembers a value"],
  why: "Scope errors (a variable &quot;not defined&quot; or silently shadowed) are among the most confusing beginner bugs. The rules are short and fixed.",
  realWorld: "A counter that remembers how many times it was called, a discount function configured once and used many times: both rely on closures.",
  simple: "A name created inside a function is <strong>local</strong>: it exists only while the function runs. Python looks for a name in four places in this order: <strong>L</strong>ocal, <strong>E</strong>nclosing function, <strong>G</strong>lobal (module), <strong>B</strong>uilt-in.",
  detail: `<h3>The four scopes</h3>
${table(["Scope", "Where", "Example"], [["Local", "inside the current function", "variables and parameters"], ["Enclosing", "in an outer function around this one", "variables of a function that contains a nested function"], ["Global", "top level of the file", "constants, imported modules, functions"], ["Built-in", "Python itself", "<code>len</code>, <code>print</code>, <code>sum</code>"]])}
<h3>Assignment makes a name local</h3>
<p>If a function assigns to a name anywhere in its body, that name is local <em>for the whole function</em>. Reading it before assigning raises <code>UnboundLocalError</code>, even if a global of the same name exists.</p>
<h3>global and nonlocal</h3>
<ul><li><code>global x</code> inside a function lets it assign to the module-level <code>x</code>.</li><li><code>nonlocal x</code> lets a nested function assign to a variable of the enclosing function.</li></ul>
<p>Reading a global needs no keyword; only <em>assigning</em> does. Avoid <code>global</code>: pass values in and return results instead. Changing a mutable global (appending to a global list) also needs no keyword, which is another reason to avoid shared state.</p>
<h3>Closures</h3>
<p>A nested function that uses a variable of the enclosing function keeps that variable alive after the outer function returns. This is a <strong>closure</strong>: it lets you build configured functions such as <code>make_multiplier(3)</code>.</p>
<h3>Shadowing built-ins</h3>
<p>Naming a variable <code>list</code>, <code>sum</code> or <code>input</code> hides the built-in in that scope and breaks later calls. Choose other names.</p>`,
  syntax: { code: `count = 0\ndef bump():\n    global count\n    count += 1\n\ndef outer():\n    n = 0\n    def inner():\n        nonlocal n\n        n += 1\n        return n\n    return inner`, note: "Prefer parameters and return values over global." },
  diagram: ((() => { const inner = box(20, 10, 460, 300) + box(50, 50, 400, 230) + box(90, 100, 320, 150) + tx(250, 38, "B  Built-in:  len, print, sum, ...", 13) + tx(250, 80, "G  Global:  names at the top of the file", 13) + tx(250, 128, "E  Enclosing:  variables of the outer function", 13) + box(130, 150, 240, 80) + tx(250, 182, "L  Local", 14) + tx(250, 204, "parameters and variables", 12) + tx(250, 232, "of the running function", 12) + tx(250, 300, "Python searches from the inside out: L, E, G, B", 12); return svgWrap(500, 320, "LEGB scope rule", "Four nested rectangles: local inside enclosing inside global inside built-in, searched from the inside out.", inner); })()),
  example: { code: `x = "global"\ndef show():\n    x = "local"\n    print(x)\nshow()\nprint(x)\n\ndef broken():\n    try:\n        print(y)\n        y = 1\n    except UnboundLocalError:\n        print("y is local because it is assigned below")\nbroken()\n\ncount = 0\ndef bump():\n    global count\n    count += 1\nbump(); bump()\nprint(count)\n\ndef make_counter():\n    n = 0\n    def step():\n        nonlocal n\n        n += 1\n        return n\n    return step\nc = make_counter()\nprint(c(), c(), c())\ndef make_multiplier(k):\n    return lambda v: v * k\ntriple = make_multiplier(3)\nprint(triple(5))`, out: `local\nglobal\ny is local because it is assigned below\n2\n1 2 3\n15` },
  lineByLine: [["x = \"local\" inside show()", "Creates a new local x; the global x is untouched."], ["print(y) before y = 1", "The assignment makes y local for the whole function, so reading it first raises UnboundLocalError."], ["global count", "Allows the function to rebind the module-level name."], ["nonlocal n", "Allows <code>step</code> to rebind the variable of <code>make_counter</code>."], ["make_multiplier(3)", "The returned function remembers k = 3: a closure."]],
  dryRun: { intro: "Calls to the counter from <code>make_counter()</code>:", headers: ["Call", "n before", "n after", "returns"], rows: [["c()", "0", "1", "1"], ["c()", "1", "2", "2"], ["c()", "2", "3", "3"]] },
  realExample: { intro: "Configured functions from one factory: tax calculators for different rates.", code: `def make_tax(rate):\n    def tax(amount):\n        return round(amount * rate / 100, 2)\n    return tax\n\ngst5 = make_tax(5)\ngst18 = make_tax(18)\nprint(gst5(200), gst18(200))`, out: `10.0 36.0` },
  mistakes: ["Assigning to a global inside a function without <code>global</code>, creating a new local instead.", "Reading a name before assigning it in the same function (UnboundLocalError).", "Relying on many globals.", "Naming variables after built-ins (<code>list</code>, <code>max</code>).", "Closures in loops: all of them see the loop variable's final value."],
  practices: ["Pass inputs as parameters and return outputs.", "Keep constants global in UPPER_CASE; nothing else.", "Use a class or a closure for state that must persist (Module 10)."],
  interview: ["What is the LEGB rule?", "Difference between global and nonlocal?", "What is a closure?", "Why does UnboundLocalError happen?"],
  practiceQs: ["What does the code print: x = 1; def f(): x = 2; f(); print(x)?", "Write a counter closure that starts at a given number.", "Why is a list defined at the top of the file readable inside a function without global?"],
  revision: ["L E G B order.", "Assignment makes a name local.", "global / nonlocal rebind outer names.", "Closure = function plus remembered variables."],
  hinglish: "Python naam ko Local, Enclosing, Global, Built-in ke order mein dhoondhta hai (LEGB). Function ke andar assign karne par naam local ban jata hai. Bahar ka naam badalna ho to global ya nonlocal likhna padta hai, lekin better hai ki parameters aur return use karo.",
  quiz: [
    mcq("What does LEGB stand for?", ["Local, Enclosing, Global, Built-in", "Loop, Else, Global, Break", "Local, External, General, Base", "List, Extend, Get, Build"], 0, "It is the lookup order."),
    mcq("What is printed?\n\nx = 5\ndef f():\n    x = 10\nf()\nprint(x)", ["5", "10", "Error", "None"], 0, "The assignment inside f created a separate local x.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nn = 0\ndef inc():\n    global n\n    n += 1\ninc(); inc()\nprint(n)", ["0", "1", "2", "Error"], 2, "global lets the function rebind n.", "OUTPUT_PREDICTION"),
    mcq("A function remembering a variable of its enclosing function is called a:", ["closure", "generator", "decorator", "module"], 0, "It closes over the variable."),
    mcq("Which keyword lets a nested function rebind a variable of the enclosing function?", ["global", "nonlocal", "static", "outer"], 1, "nonlocal refers to the enclosing scope."),
  ],
  tasks: [task("Multiplier factory", "Define make_multiplier(k) that returns a function multiplying its argument by k. Read k and then x (one per line) and print make_multiplier(k)(x).", "def make_multiplier(k):\n    pass\n\nk = int(input())\nx = int(input())\n# print the result of the configured function\n", `def make_multiplier(k):\n    def multiply(x):\n        return x * k\n    return multiply\n\nk = int(input())\nx = int(input())\nprint(make_multiplier(k)(x))`, [["3\n5", "15"], ["10\n-2", "-20"]], [["3\n5", "15"], ["10\n-2", "-20"], ["0\n9", "0"], ["7\n7", "49"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Recursion: Base Case, Recursive Case and the Call Stack",
  minutes: 50,
  learn: ["Write a function that calls itself with a smaller problem", "Always identify the base case first", "Trace the call stack", "Speed up repeated work with memoisation"],
  why: "Recursion is the natural way to express problems that contain smaller copies of themselves: folders in folders, trees, divide-and-conquer, backtracking. It is also an interview favourite.",
  realWorld: "Walking through every folder on a disk, expanding nested comments, evaluating a mathematical expression.",
  simple: "A recursive function solves a problem by solving a <strong>slightly smaller</strong> version of the same problem, and stops at a case so small that the answer is known (the <strong>base case</strong>).",
  detail: `<h3>Two parts</h3>
<ol><li><strong>Base case</strong>: the simplest input, answered directly (<code>factorial(0) = 1</code>).</li><li><strong>Recursive case</strong>: reduce the problem and call yourself (<code>n * factorial(n - 1)</code>), moving <em>toward</em> the base case.</li></ol>
<p>Without a base case, or if the problem never shrinks, the calls never stop and Python raises <code>RecursionError</code> (the default limit is about 1000 nested calls; check <code>sys.getrecursionlimit()</code>).</p>
<h3>The call stack</h3>
<p>Each call waits for the call it made to finish. Python stacks the waiting calls and unwinds them when the base case returns: <code>factorial(3)</code> waits for <code>factorial(2)</code>, which waits for <code>factorial(1)</code>, then results flow back <code>1 &rarr; 2 &rarr; 6</code>.</p>
<h3>Cost</h3>
<p>Every call uses stack memory (O(depth) space). The naive Fibonacci <code>fib(n-1) + fib(n-2)</code> recomputes the same values again and again: about 2<sup>n</sup> calls. <strong>Memoisation</strong> stores answers already found; <code>functools.cache</code> (Python 3.9+) does it with one decorator, giving O(n) time.</p>
<h3>Recursion or a loop?</h3>
<p>Any recursion can become a loop (sometimes with a stack). Use a loop for simple repetition (sums, factorials: clearer and no depth limit). Use recursion when the data or the problem is itself nested or branching (trees, permutations, divide and conquer).</p>`,
  syntax: { code: `def solve(n):\n    if n == 0:          # base case\n        return 1\n    return n * solve(n - 1)   # smaller problem\n\nfrom functools import cache\n@cache\ndef fib(n): ...`, note: "Make sure every path reaches the base case." },
  diagram: chain("The call stack of factorial(3)", "Vertical: factorial(3) calls factorial(2), which calls factorial(1), which calls factorial(0) returning 1; results 1, 1, 2, 6 flow back.",
    [{ k: "proc", t: "factorial(3) = 3 * factorial(2)" }, { k: "proc", t: "factorial(2) = 2 * factorial(1)" }, { k: "proc", t: "factorial(1) = 1 * factorial(0)" }, { k: "term", t: "factorial(0) = 1  (base case)" }], { vertical: true, w: 300, hgt: 38, gap: 22 }),
  example: { code: `def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n - 1)\n\ndef digit_sum(n):\n    if n < 10:\n        return n\n    return n % 10 + digit_sum(n // 10)\n\nprint(factorial(5), digit_sum(1234))\n\nfrom functools import cache\n@cache\ndef fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\nprint(fib(30))\n\ndef endless(n):\n    return endless(n + 1)\ntry:\n    endless(0)\nexcept RecursionError:\n    print("RecursionError")`, out: `120 10\n832040\nRecursionError` },
  lineByLine: [["if n == 0: return 1", "Base case: stops the recursion."], ["n * factorial(n - 1)", "Recursive case: a smaller n each time."], ["n % 10 + digit_sum(n // 10)", "Last digit plus the digit sum of the rest."], ["@cache", "Remembers results, so fib(30) needs only 31 distinct computations."], ["endless", "No base case: Python stops it with RecursionError."]],
  dryRun: { intro: "Unwinding <code>factorial(3)</code>:", headers: ["Call", "waits for", "returns"], rows: [["factorial(3)", "factorial(2)", "3 * 2 = 6"], ["factorial(2)", "factorial(1)", "2 * 1 = 2"], ["factorial(1)", "factorial(0)", "1 * 1 = 1"], ["factorial(0)", "-", "1 (base case)"]] },
  realExample: { intro: "Recursion on nested data: add up a list that may contain lists. Recursion is a natural fit because the data is nested.", code: `def deep_sum(items):\n    total = 0\n    for item in items:\n        if isinstance(item, list):\n            total += deep_sum(item)\n        else:\n            total += item\n    return total\n\nprint(deep_sum([1, [2, [3, 4]], 5]))`, out: `15` },
  mistakes: ["No base case, or a base case that is never reached.", "Not reducing the problem (<code>f(n)</code> calls <code>f(n)</code>).", "Using naive recursion for Fibonacci with large n.", "Forgetting to <code>return</code> the recursive call (the result becomes None).", "Hitting the depth limit with a million-step recursion: use a loop."],
  practices: ["Write the base case first.", "Check that each call moves toward it.", "Memoise overlapping subproblems.", "Prefer loops for simple linear work."],
  interview: ["What are the base case and the recursive case?", "Why is naive recursive Fibonacci slow? How do you fix it?", "What is the recursion limit and why does it exist?", "Convert a recursive function to a loop."],
  practiceQs: ["Write power(base, exp) recursively.", "Write a recursive palindrome check for a string.", "How many calls does factorial(5) make?", "What does sum_to(n) = n + sum_to(n-1) need to stop?"],
  revision: ["Base case + smaller recursive case.", "Stack depth = O(n) space.", "Naive fib is exponential; cache fixes it.", "RecursionError ~1000 deep."],
  hinglish: "Recursion mein function khud ko chhoti problem ke saath bulata hai. Base case zaroor likho, warna RecursionError aayegi. Fibonacci jaise kaam mein @cache lagane se bahut tez ho jata hai.",
  quiz: [
    mcq("What is missing?\n\ndef f(n):\n    return n + f(n - 1)", ["A base case", "A colon", "A parameter", "Nothing"], 0, "Without a base case the recursion never ends.", "DEBUG"),
    mcq("What is factorial(4)?", ["10", "24", "16", "12"], 1, "4 * 3 * 2 * 1.", "OUTPUT_PREDICTION"),
    mcq("What error does infinite recursion raise?", ["ValueError", "RecursionError", "MemoryOnly", "StopIteration"], 1, "Python caps the depth."),
    mcq("What does @cache do for fib?", ["Stores results already computed", "Makes it a loop", "Prints results", "Nothing"], 0, "Memoisation avoids repeated work."),
    mcq("What is the space cost of recursing to depth n?", ["O(1)", "O(n)", "O(n²)", "O(log n) always"], 1, "One stack frame per pending call."),
  ],
  tasks: [
    task("Recursive digit sum", "Define a recursive function digit_sum(n) (n is a non-negative integer) and print digit_sum for the input number.", "def digit_sum(n):\n    pass\n\nprint(digit_sum(int(input())))\n", `def digit_sum(n):\n    if n < 10:\n        return n\n    return n % 10 + digit_sum(n // 10)\n\nprint(digit_sum(int(input())))`, [["1234", "10"], ["9", "9"]], [["1234", "10"], ["9", "9"], ["0", "0"], ["999", "27"], ["100000", "1"]]),
    task("Fibonacci with memory", "Read n (0 to 80). Print the n-th Fibonacci number (F(0)=0, F(1)=1) using recursion with functools.cache.", "from functools import cache\n\n@cache\ndef fib(n):\n    pass\n\nprint(fib(int(input())))\n", `from functools import cache\n\n@cache\ndef fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint(fib(int(input())))`, [["10", "55"], ["30", "832040"]], [["10", "55"], ["30", "832040"], ["0", "0"], ["1", "1"], ["80", "23416728348467685"]]),
  ],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Lambda, map(), filter() and reduce()",
  minutes: 40,
  learn: ["Write small anonymous functions with lambda", "Transform and filter data with map and filter", "Combine values with functools.reduce", "Choose between these tools and comprehensions"],
  why: "Passing small functions as values (to sorted, max, map...) is a core Python skill and the basis of functional style.",
  realWorld: "Sort students by their second mark, convert all prices to numbers, keep only active users.",
  simple: "A <code>lambda</code> is a tiny nameless function: <code>lambda x: x * 2</code>. <code>map</code> applies a function to every item, <code>filter</code> keeps items for which a function says True, <code>reduce</code> folds a sequence into one value.",
  detail: `<h3>lambda</h3>
<p><code>lambda parameters: expression</code> returns the value of the single expression. It cannot contain statements. If it needs a name or more than one line, use <code>def</code>. Typical use: the <code>key</code> argument of <code>sorted</code>, <code>min</code>, <code>max</code>.</p>
${table(["Tool", "Purpose", "Example", "Result"], [["<code>map(f, items)</code>", "apply f to each item", "<code>list(map(str.upper, [\"a\", \"b\"]))</code>", "['A', 'B']"], ["<code>filter(f, items)</code>", "keep items where f is true", "<code>list(filter(lambda n: n % 2, [1, 2, 3]))</code>", "[1, 3]"], ["<code>reduce(f, items, start)</code>", "combine pairwise into one value", "<code>reduce(lambda a, b: a * b, [1, 2, 3, 4])</code>", "24"]])}
<p><code>map</code> and <code>filter</code> return <strong>lazy iterators</strong>, so wrap them in <code>list(...)</code> to see the items. <code>reduce</code> lives in <code>functools</code>.</p>
<h3>Comprehension or map?</h3>
<p>List comprehensions are usually clearer: <code>[n * n for n in nums if n % 2 == 0]</code> versus <code>list(map(lambda n: n * n, filter(lambda n: n % 2 == 0, nums)))</code>. Use <code>map</code> with a ready-made function (<code>map(int, tokens)</code>). Prefer built-ins like <code>sum</code>, <code>max</code>, <code>any</code>, <code>all</code> over <code>reduce</code> where they exist.</p>
<h3>Functions are values</h3>
<p>Because functions are objects you can put them in a dictionary: <code>ops = {"+": lambda a, b: a + b}</code> replaces a long if-elif chain.</p>`,
  syntax: { code: `square = lambda x: x * x\nlist(map(square, nums))\nlist(filter(lambda n: n > 0, nums))\nfrom functools import reduce\nreduce(lambda a, b: a + b, nums, 0)\nsorted(words, key=lambda w: w[-1])`, note: "map and filter return iterators." },
  diagram: chain("A map, filter and reduce pipeline", "Left to right: numbers, filter keeps evens, map squares them, reduce adds them up.",
    [{ k: "io", t: "numbers\n1 2 3 4" }, { k: "proc", t: "filter\nkeep evens" }, { k: "proc", t: "map\nsquare" }, { k: "proc", t: "reduce\nadd up" }], { w: 125, gap: 30, hgt: 56 }),
  example: { code: `from functools import reduce\nnums = [1, 2, 3, 4]\nsquare = lambda x: x * x\nprint(list(map(square, nums)))\nprint(list(filter(lambda n: n % 2 == 0, nums)))\nprint(reduce(lambda a, b: a * b, nums))\nprint(reduce(lambda a, b: a + b, map(square, filter(lambda n: n % 2 == 0, nums)), 0))\nwords = ["pear", "fig", "banana"]\nprint(sorted(words, key=lambda w: len(w)))\nprint(max(words, key=lambda w: w[-1]))\nops = {"+": lambda a, b: a + b, "*": lambda a, b: a * b}\nprint(ops["*"](6, 7))\nprint(list(map(int, "1 2 3".split())))`, out: `[1, 4, 9, 16]\n[2, 4]\n24\n20\n['fig', 'pear', 'banana']\npear\n42\n[1, 2, 3]` },
  lineByLine: [["map(square, nums)", "Applies the function to each item; list() makes the results visible."], ["filter(lambda n: n % 2 == 0, nums)", "Keeps 2 and 4."], ["reduce(lambda a, b: a * b, nums)", "((1*2)*3)*4 = 24."], ["reduce(..., map(...), 0)", "Sum of the squares of the evens: 4 + 16 = 20; the 0 is the starting value."], ["max(words, key=lambda w: w[-1])", "The word with the greatest last letter: pear (r)."], ["ops[\"*\"](6, 7)", "A dictionary of functions replaces an if-elif chain."]],
  dryRun: { intro: "<code>reduce(lambda a, b: a * b, [1, 2, 3, 4])</code>:", headers: ["a (so far)", "b (next)", "a * b"], rows: [["1", "2", "2"], ["2", "3", "6"], ["6", "4", "24"]] },
  realExample: { intro: "Clean and total: convert text amounts to numbers and add up only the positive ones.", code: `raw = ["120", "-30", "45", "oops", "10"]\nvalid = [int(x) for x in raw if x.lstrip("-").isdigit()]\nprint(valid)\nprint(sum(filter(lambda v: v > 0, valid)))`, out: `[120, -30, 45, 10]\n175` },
  mistakes: ["Printing a map or filter object directly (<code>&lt;map object ...&gt;</code>).", "Writing a long, unreadable lambda.", "Forgetting to import reduce.", "Reusing a map object after it has been consumed (iterators are one-shot).", "Using <code>reduce</code> where <code>sum</code> or <code>max</code> already exist."],
  practices: ["Keep lambdas to a single short expression.", "Prefer comprehensions for readability.", "Name a function with <code>def</code> if you use it more than once."],
  interview: ["What is a lambda?", "What do map and filter return?", "How does reduce work?", "map or list comprehension?"],
  practiceQs: ["Sort [(\"a\", 3), (\"b\", 1)] by the number.", "Use filter to keep strings longer than 3 characters.", "Use reduce to find the largest of a list.", "Why does list(m) twice give an empty list the second time?"],
  revision: ["lambda args: expression.", "map applies; filter keeps; reduce folds.", "Iterators are lazy and one-shot.", "Prefer comprehensions and built-ins."],
  hinglish: "lambda ek chhota bina naam ka function hai. map har item par function lagata hai, filter sirf wahi items rakhta hai jinke liye function True de, reduce sabko ek value mein jodta hai. Zyada tar jagah list comprehension zyada saaf hota hai.",
  quiz: [
    mcq("What is list(map(lambda x: x + 1, [1, 2]))?", ["[2, 3]", "[1, 2]", "[1, 2, 1]", "Error"], 0, "Each item plus one.", "OUTPUT_PREDICTION"),
    mcq("What is list(filter(lambda n: n > 1, [0, 1, 2, 3]))?", ["[2, 3]", "[1, 2, 3]", "[0, 1]", "[3]"], 0, "Items greater than 1.", "OUTPUT_PREDICTION"),
    mcq("Where does reduce live?", ["builtins", "functools", "math", "itertools only"], 1, "from functools import reduce."),
    mcq("What does a lambda body consist of?", ["Any statements", "A single expression", "A class", "A loop"], 1, "Lambdas hold one expression."),
    mcq("What is printed?\n\nm = map(str, [1, 2])\nlist(m)\nprint(list(m))", ["['1', '2']", "[]", "[1, 2]", "Error"], 1, "The iterator was already consumed.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Sum of squares of evens", "Read a line of integers. Using filter, map and lambda (or a comprehension if you prefer), print the sum of the squares of the even numbers.", "nums = list(map(int, input().split()))\n# print the sum of squares of the even numbers\n", `nums = list(map(int, input().split()))\nprint(sum(map(lambda n: n * n, filter(lambda n: n % 2 == 0, nums))))`, [["1 2 3 4", "20"], ["5 7 9", "0"]], [["1 2 3 4", "20"], ["5 7 9", "0"], ["2", "4"], ["-2 -4 6", "56"], ["10 11 12", "244"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Decorators and Generators: A First Look",
  minutes: 45,
  learn: ["Explain functions as values and build a simple decorator", "Use @syntax and functools.wraps", "Write a generator with yield", "See why generators save memory"],
  why: "Decorators power frameworks (routes in Flask and FastAPI, caching, logging, access checks). Generators let you process huge or endless data one item at a time.",
  realWorld: "<code>@app.get(\"/users\")</code> registers a function as a web route; a generator reads a 5 GB log file line by line without loading it.",
  simple: "A <strong>decorator</strong> wraps a function to add behaviour before or after it, without editing the function. A <strong>generator</strong> is a function that <code>yield</code>s values one at a time and pauses between them.",
  detail: `<h3>Decorators</h3>
<p>A decorator is a function that takes a function and returns a new function. The line <code>@decorator</code> above <code>def f</code> is shorthand for <code>f = decorator(f)</code>. The wrapper should accept <code>*args, **kwargs</code> so it fits any function, and use <code>functools.wraps</code> to keep the original name and docstring.</p>
<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px"><code>def logged(func):\n    @wraps(func)\n    def wrapper(*args, **kwargs):\n        print("calling", func.__name__)\n        result = func(*args, **kwargs)\n        return result\n    return wrapper</code></pre>
<h3>Generators</h3>
<p>A function containing <code>yield</code> returns a <strong>generator</strong>. Each <code>next()</code> (or each pass of a <code>for</code> loop) runs the function until the next <code>yield</code>, hands out that value and pauses with all its local variables kept. When the function ends the generator raises <code>StopIteration</code>, which a <code>for</code> loop handles silently.</p>
<ul><li><strong>Lazy</strong>: values are produced on demand, so memory use stays tiny.</li><li><strong>One-shot</strong>: once consumed a generator is empty.</li><li><strong>Generator expression</strong>: <code>(x * x for x in range(5))</code>, like a list comprehension with round brackets: <code>sum(x * x for x in range(1000000))</code> never builds the list.</li></ul>
<p>Iterators and the iteration protocol are explained fully in Module 11.</p>`,
  syntax: { code: `def decorator(func):\n    def wrapper(*args, **kwargs):\n        return func(*args, **kwargs)\n    return wrapper\n\n@decorator\ndef f(): ...\n\ndef countdown(n):\n    while n > 0:\n        yield n\n        n -= 1`, note: "@decorator means f = decorator(f)." },
  diagram: graph("A decorator wraps a function", "A call goes into the wrapper, which does something before, calls the original function, does something after and returns its result to the caller.", 640, 190,
    [{ id: "c", k: "term", t: "caller", x: 70, y: 95, w: 100, h: 40 }, { id: "b", k: "proc", t: "wrapper:\nbefore", x: 230, y: 95, w: 110, h: 54 }, { id: "f", k: "proc", t: "original\nfunction", x: 390, y: 95, w: 110, h: 54 }, { id: "a", k: "proc", t: "wrapper:\nafter", x: 550, y: 95, w: 110, h: 54 }],
    [{ from: "c", to: "b" }, { from: "b", to: "f" }, { from: "f", to: "a" }]),
  example: { code: `from functools import wraps\n\ndef logged(func):\n    @wraps(func)\n    def wrapper(*args, **kwargs):\n        print("calling", func.__name__, args)\n        result = func(*args, **kwargs)\n        print("returned", result)\n        return result\n    return wrapper\n\n@logged\ndef add(a, b):\n    """Add two numbers."""\n    return a + b\n\nprint(add(2, 3))\nprint(add.__name__, add.__doc__)\n\ndef countdown(n):\n    while n > 0:\n        yield n\n        n -= 1\n\ngen = countdown(3)\nprint(next(gen), next(gen))\nprint(list(gen))\nprint(sum(x * x for x in range(1000000)))`, out: `calling add (2, 3)\nreturned 5\n5\nadd Add two numbers.\n3 2\n[1]\n333332833333500000` },
  lineByLine: [["@logged", "Same as <code>add = logged(add)</code>: calls now go through <code>wrapper</code>."], ["func(*args, **kwargs)", "Forwards whatever arguments the caller gave."], ["@wraps(func)", "Keeps the original name and docstring."], ["yield n", "Hands out n and pauses here until asked again."], ["next(gen), next(gen)", "Resumes twice: 3, then 2."], ["list(gen)", "Only 1 is left, because the generator remembers its place."], ["sum(x * x for x in range(1000000))", "A generator expression adds a million squares without storing them."]],
  dryRun: { intro: "Stepping the generator <code>countdown(3)</code>:", headers: ["Request", "n inside", "yielded"], rows: [["next()", "3", "3"], ["next()", "2", "2"], ["next()", "1", "1"], ["next()", "0: loop ends", "StopIteration"]] },
  realExample: { intro: "A timing decorator pattern (the wrapper measures; here we only show that it ran). And a generator producing the first squares lazily.", code: `import time\ndef timed(func):\n    def wrapper(*args, **kwargs):\n        start = time.perf_counter()\n        result = func(*args, **kwargs)\n        elapsed = time.perf_counter() - start\n        print("finished", elapsed >= 0)\n        return result\n    return wrapper\n\n@timed\ndef work(n):\n    return sum(range(n))\n\nprint(work(1000))\n\ndef squares():\n    n = 1\n    while True:\n        yield n * n\n        n += 1\n\ng = squares()\nprint([next(g) for _ in range(5)])`, out: `finished True\n499500\n[1, 4, 9, 16, 25]` },
  mistakes: ["Forgetting to return the wrapper (the decorated name becomes None).", "Forgetting to return the wrapped function's result.", "Not using <code>*args, **kwargs</code>.", "Iterating a generator twice.", "Using <code>return value</code> in a generator expecting it to be yielded."],
  practices: ["Use <code>functools.wraps</code> in every decorator.", "Use generators for large or unbounded sequences.", "Keep decorators small and single-purpose (log, time, cache, check permission)."],
  interview: ["What is a decorator?", "What does yield do compared with return?", "Why are generators memory-efficient?", "What does functools.wraps do?"],
  practiceQs: ["Write a decorator that prints Done after a function runs.", "Write a generator for even numbers up to n.", "What does next() raise on an exhausted generator?", "Difference between [x for x in a] and (x for x in a)?"],
  revision: ["Decorator: function in, function out; @name.", "yield pauses and resumes.", "Generators are lazy, one-shot.", "wraps keeps metadata."],
  hinglish: "Decorator ek function ko wrap karke uska behaviour badal deta hai bina uska code chhede. yield wala function generator banata hai jo ek ek value deta hai aur beech mein ruk jata hai, isliye memory bahut kam lagti hai.",
  quiz: [
    mcq("What does @d above def f(): ... equal?", ["f = d(f)", "d = f(d)", "f = f()", "d(f())"], 0, "Decoration is a call that replaces the name."),
    mcq("What does a function with yield return when called?", ["Its first value", "A generator object", "None", "A list"], 1, "The body runs only when the generator is advanced."),
    mcq("What does this print?\n\ndef g():\n    yield 1\n    yield 2\nx = g()\nprint(next(x), next(x))", ["1 2", "1 1", "2 1", "[1, 2]"], 0, "Two resumes: 1 then 2.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nx = (n for n in range(3))\nlist(x)\nprint(list(x))", ["[0, 1, 2]", "[]", "[3]", "Error"], 1, "A generator is exhausted after one pass.", "OUTPUT_PREDICTION"),
    mcq("Why use functools.wraps?", ["Speed", "To keep the wrapped function's name and docstring", "To allow recursion", "It is required by Python"], 1, "Otherwise the function appears to be named wrapper."),
  ],
  tasks: [task("Countdown generator", "Define a generator countdown(n) that yields n, n-1, ..., 1. Read n and print the values on one line separated by spaces.", "def countdown(n):\n    pass\n\nn = int(input())\nprint(\" \".join(str(v) for v in countdown(n)))\n", `def countdown(n):\n    while n > 0:\n        yield n\n        n -= 1\n\nn = int(input())\nprint(" ".join(str(v) for v in countdown(n)))`, [["3", "3 2 1"], ["1", "1"]], [["3", "3 2 1"], ["1", "1"], ["5", "5 4 3 2 1"], ["10", "10 9 8 7 6 5 4 3 2 1"]])],
});

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Modules and Packages: import, Standard Library and Your Own Modules",
  minutes: 45,
  learn: ["Import modules and names in the right style", "Use math, random, datetime and other standard modules", "Create and import your own module", "Understand packages and the module search path"],
  why: "No real program is one file. Modules let you split code logically, reuse it between projects and use the huge standard library (&quot;batteries included&quot;).",
  realWorld: "A project has <code>models.py</code>, <code>utils.py</code> and a <code>billing/</code> package, and imports <code>json</code> and <code>datetime</code> from the standard library.",
  simple: "A <strong>module</strong> is just a <code>.py</code> file. <code>import module</code> lets you use what it defines as <code>module.name</code>. A <strong>package</strong> is a folder of modules.",
  detail: `${table(["Statement", "Meaning"], [["<code>import math</code>", "use as <code>math.sqrt(9)</code>"], ["<code>import math as m</code>", "alias: <code>m.sqrt(9)</code>"], ["<code>from math import sqrt, pi</code>", "bring chosen names in: <code>sqrt(9)</code>"], ["<code>from math import *</code>", "everything; avoid, it hides where names come from"]])}
<h3>Useful standard modules</h3>
${table(["Module", "Use"], [["math", "sqrt, pi, floor, ceil, gcd, factorial, isclose"], ["random", "randint, choice, shuffle, sample, seed"], ["datetime", "dates, times, differences"], ["os, pathlib, sys", "files, paths, interpreter details"], ["json, csv", "data files (Module 9)"], ["collections, itertools, functools", "better data structures and tools (Module 11)"], ["time, statistics, string", "timing, mean/median, character constants"]])}
<p><code>random.seed(n)</code> makes random numbers repeatable, which is important for tests.</p>
<h3>Your own module</h3>
<p>Save functions in <code>helpers.py</code> and write <code>import helpers</code> in a file in the same folder. Python searches the script's folder, then installed packages (<code>sys.path</code>). Put the demonstration code under <code>if __name__ == "__main__":</code> so importing does not run it.</p>
<h3>Packages</h3>
<p>A folder with modules (traditionally with an <code>__init__.py</code> file) is a package: <code>from billing import invoice</code>, <code>from billing.tax import gst</code>. Inside a package, relative imports such as <code>from . import util</code> refer to sibling modules.</p>
<h3>Rules to avoid trouble</h3>
<ul><li>Never name your file like a standard module (<code>random.py</code>, <code>math.py</code>): it hides the real one.</li><li>Avoid circular imports (A imports B and B imports A); move shared code to a third module.</li><li>Put imports at the top of the file, standard library first, then third-party, then your own.</li></ul>`,
  syntax: { code: `import math\nfrom random import randint\nimport numpy as np\nfrom billing.tax import gst`, note: "Prefer explicit imports." },
  diagram: graph("A small project's modules", "A folder app with main.py importing helpers.py and a billing package containing tax.py and invoice.py.", 640, 240,
    [{ id: "m", k: "term", t: "main.py", x: 120, y: 40, w: 130, h: 40 }, { id: "h", k: "proc", t: "helpers.py", x: 120, y: 150, w: 140, h: 40 }, { id: "p", k: "proc", t: "billing/  (package)", x: 380, y: 100, w: 200, h: 44 }, { id: "t", k: "io", t: "tax.py", x: 330, y: 205, w: 100, h: 34 }, { id: "i", k: "io", t: "invoice.py", x: 480, y: 205, w: 130, h: 34 }],
    [{ from: "m", to: "h" }, { from: "m", to: "p" }, { from: "p", to: "t" }, { from: "p", to: "i" }]),
  example: { code: `import math\nimport random\nfrom datetime import date\nprint(math.sqrt(16), math.floor(3.7), math.gcd(12, 18), round(math.pi, 4))\nrandom.seed(7)\nfirst = random.randint(1, 100)\nrandom.seed(7)\nprint(first == random.randint(1, 100))\nprint(date(2026, 11, 2).strftime("%d %b %Y"), (date(2026, 12, 25) - date(2026, 11, 2)).days)\n\nimport sys, tempfile, pathlib\nwith tempfile.TemporaryDirectory() as folder:\n    pathlib.Path(folder, "greeter.py").write_text('def hello(name):\\n    return f"Hello, {name}!"\\n')\n    sys.path.insert(0, folder)\n    import greeter\n    print(greeter.hello("Asha"))\n    sys.path.remove(folder)`, out: `4.0 3 6 3.1416\nTrue\n02 Nov 2026 53\nHello, Asha!` },
  lineByLine: [["math.sqrt(16), math.floor(3.7), math.gcd(12, 18)", "Square root, round down, greatest common divisor."], ["random.seed(7)", "Starting from the same seed gives the same random numbers, so the two draws match."], ["date(2026, 12, 25) - date(2026, 11, 2)", "Subtracting dates gives a timedelta; <code>.days</code> is 53."], ["pathlib.Path(...).write_text(...)", "Creates a tiny module file in a temporary folder (files are covered in Module 9)."], ["sys.path.insert(0, folder); import greeter", "Python can now find <code>greeter.py</code> and run <code>import greeter</code>."]],
  dryRun: { intro: "What <code>import greeter</code> does:", headers: ["Step", "Python"], rows: [["1", "Looks in <code>sys.modules</code> (already imported?)"], ["2", "Searches the folders in <code>sys.path</code> for greeter.py"], ["3", "Runs the file once, top to bottom, creating its functions"], ["4", "Binds the name <code>greeter</code> to the module object"]] },
  realExample: { intro: "Seeded randomness gives repeatable tests; the standard library saves writing code. Here: a deterministic sample and some statistics.", code: `import random, statistics\nrandom.seed(1)\nmarks = [random.randint(40, 100) for _ in range(5)]\nprint(len(marks), all(40 <= m <= 100 for m in marks))\nprint(statistics.mean([60, 70, 80]), statistics.median([1, 9, 3]))`, out: `5 True\n70 3` },
  mistakes: ["Naming your file after a standard module (<code>random.py</code>).", "Running a module with a relative import directly as a script.", "Circular imports.", "Using <code>import *</code>.", "Putting test code at the top level of a module so it runs on import."],
  practices: ["Group imports at the top: standard library, third-party, local.", "Guard demo code with <code>if __name__ == \"__main__\":</code>.", "Use a virtual environment for third-party packages (Module 2)."],
  interview: ["Difference between a module and a package?", "What is __name__ == \"__main__\" for?", "What happens when you import a module twice?", "What is a circular import and how do you fix it?"],
  practiceQs: ["Import only sqrt and pi from math.", "Why can random.py in your folder break the program?", "How do you make random output repeatable?", "Write a module with two functions and import it."],
  revision: ["import module / from module import name / as alias.", "Standard library: math, random, datetime...", "Own module = .py file; package = folder.", "sys.path decides where Python looks."],
  hinglish: "Module ek .py file hoti hai aur import se uska code use karte hain. Package modules ka folder hota hai. Apni file ka naam random.py ya math.py mat rakho. random.seed() se random numbers har baar same milte hain.",
  quiz: [
    mcq("What does from math import sqrt do?", ["Imports only sqrt into your namespace", "Imports math entirely under the name sqrt", "Deletes sqrt", "Creates a package"], 0, "You can then call sqrt(9) directly."),
    mcq("Why avoid naming a file random.py?", ["It is slow", "It hides the standard random module", "Python forbids it", "It cannot be imported"], 1, "Your file is found first."),
    mcq("What does random.seed(5) enable?", ["Repeatable random numbers", "Faster random numbers", "True randomness", "Larger numbers"], 0, "The same seed gives the same sequence."),
    mcq("What is math.gcd(12, 18)?", ["3", "6", "36", "2"], 1, "The greatest common divisor is 6.", "OUTPUT_PREDICTION"),
    mcq("What makes a folder a (traditional) package?", ["An __init__.py file", "A README", "A requirements.txt", "A .venv"], 0, "Traditionally an __init__.py marks a package."),
  ],
  tasks: [
    task("Circle area", "Read the radius (a number). Print the area of the circle with math.pi, rounded to 2 decimal places.", "import math\nr = float(input())\n# print the area\n", `import math\nr = float(input())\nprint(round(math.pi * r * r, 2))`, [["2", "12.57"], ["1", "3.14"]], [["2", "12.57"], ["1", "3.14"], ["10", "314.16"], ["0", "0.0"], ["2.5", "19.63"]]),
    task("GCD and LCM", "Read two positive integers on one line. Print their greatest common divisor and least common multiple separated by a space (use math.gcd).", "import math\na, b = map(int, input().split())\n# print gcd and lcm\n", `import math\na, b = map(int, input().split())\ng = math.gcd(a, b)\nprint(g, a * b // g)`, [["12 18", "6 36"], ["7 5", "1 35"]], [["12 18", "6 36"], ["7 5", "1 35"], ["10 10", "10 10"], ["100 75", "25 300"]]),
  ],
});

module.exports = {
  module: {
    title: "Phase 1 - Module 8: Functions and Modular Programming",
    description: "Defining functions, parameters and arguments, scope and closures, recursion, lambda with map, filter and reduce, decorators and generators, modules, packages and the standard library.",
    chapters: [{ title: "Functions and Modular Programming", description: "Building programs from reusable parts.", lessons }],
    assessment: {
      title: "Module 8 Assessment: Functions and Modular Programming",
      description: "Function and recursion problems.",
      questions: [
        task("Recursive palindrome", "Define a recursive function is_pal(s) and use it to print True if the input word is a palindrome (compare case-insensitively), otherwise False.", "", `def is_pal(s):\n    if len(s) < 2:\n        return True\n    if s[0] != s[-1]:\n        return False\n    return is_pal(s[1:-1])\n\nprint(is_pal(input().lower()))`, [["Madam", "True"], ["python", "False"]], [["Madam", "True"], ["python", "False"], ["a", "True"], ["racecar", "True"], ["ab", "False"], ["Noon", "True"]]),
        task("Primes up to n", "Define is_prime(n). Read n and print all primes up to and including n on one line separated by spaces (print an empty line is not needed: n is at least 2).", "", `def is_prime(n):\n    if n < 2:\n        return False\n    d = 2\n    while d * d <= n:\n        if n % d == 0:\n            return False\n        d += 1\n    return True\n\nn = int(input())\nprint(" ".join(str(k) for k in range(2, n + 1) if is_prime(k)))`, [["20", "2 3 5 7 11 13 17 19"], ["2", "2"]], [["20", "2 3 5 7 11 13 17 19"], ["2", "2"], ["10", "2 3 5 7"], ["30", "2 3 5 7 11 13 17 19 23 29"]]),
        task("Flatten a nested list", "Read a Python list literal that may contain nested lists, for example [1, [2, [3, 4]], 5]. Print all the numbers in order on one line separated by spaces. (Use ast.literal_eval to read the input.)", "", `import ast\n\ndef flatten(items):\n    for item in items:\n        if isinstance(item, list):\n            yield from flatten(item)\n        else:\n            yield item\n\ndata = ast.literal_eval(input())\nprint(" ".join(str(v) for v in flatten(data)))`, [["[1, [2, [3, 4]], 5]", "1 2 3 4 5"], ["[[1], [2]]", "1 2"]], [["[1, [2, [3, 4]], 5]", "1 2 3 4 5"], ["[[1], [2]]", "1 2"], ["[7]", "7"], ["[[[[9]]], 8]", "9 8"]]),
        task("Fast power", "Read a base b and a non-negative exponent e. Define a recursive power function (use the idea that b^e = (b^(e/2))^2 for even e) and print b raised to e.", "", `def power(b, e):\n    if e == 0:\n        return 1\n    half = power(b, e // 2)\n    return half * half if e % 2 == 0 else half * half * b\n\nb, e = map(int, input().split())\nprint(power(b, e))`, [["2 10", "1024"], ["3 0", "1"]], [["2 10", "1024"], ["3 0", "1"], ["5 3", "125"], ["7 1", "7"], ["2 62", "4611686018427387904"], ["10 5", "100000"]]),
      ],
    },
  },
};
