// Phase 2 / Module 12: Python Memory and Performance.
"use strict";
const { chain, graph, table } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "The Python Object Model: References, Identity and Mutability",
  minutes: 45,
  learn: ["Describe a Python object (identity, type, value)", "Explain names as references, not boxes", "Use id(), is and == correctly", "Predict what happens when objects are shared, copied or changed"],
  why: "Every surprising Python behaviour (lists changing in functions, += on strings, default arguments) follows from one idea: <em>names refer to objects</em>. This lesson makes that idea precise.",
  realWorld: "A cache holding a list that a caller later mutates, a function that edits its argument, a dictionary default shared between users: all are reference bugs.",
  simple: "Everything is an <strong>object</strong> living in memory. A variable is a <strong>name pointing to</strong> an object. Assignment makes a name point somewhere; it never copies the object.",
  detail: `<h3>What an object has</h3>
${table(["Part", "Meaning", "How to see it"], [["identity", "unique while the object lives (in CPython: its memory address)", "<code>id(x)</code>, <code>x is y</code>"], ["type", "what operations are allowed", "<code>type(x)</code>"], ["value", "the data it holds", "<code>x == y</code>, <code>print(x)</code>"]])}
<h3>== versus is</h3>
<p><code>==</code> asks &quot;same value?&quot; (calls <code>__eq__</code>); <code>is</code> asks &quot;same object?&quot; (compares identities). Use <code>is</code> for <code>None</code> only.</p>
<h3>What gets shared</h3>
<ul><li>Assignment (<code>b = a</code>) and passing arguments to functions share the object (&quot;pass by object reference&quot;).</li><li>An <strong>immutable</strong> object (int, str, tuple) cannot change, so sharing is harmless; <code>x += 1</code> makes a <em>new</em> int and re-points the name.</li><li>A <strong>mutable</strong> object (list, dict, set) can change in place, and every name pointing to it sees the change.</li><li><code>x += y</code> on a list extends it <em>in place</em>, while <code>x = x + y</code> builds a new list. On a tuple or string both make new objects.</li></ul>
<h3>Implementation details you must not rely on</h3>
<p>CPython keeps small integers (about -5 to 256) and some strings as shared objects, so <code>a = 256; b = 256; a is b</code> may be True while the same test for 1000 may be False. This is an optimisation, not a rule: never use <code>is</code> to compare numbers or strings.</p>
<h3>Size of objects</h3>
<p><code>sys.getsizeof(obj)</code> gives the object's own size in bytes (not what it refers to) and differs between versions and platforms.</p>`,
  syntax: { code: `a = [1, 2]\nb = a\nb is a, b == [1, 2], id(a) == id(b)\nimport sys\nsys.getsizeof(a)`, note: "is compares identity; == compares value." },
  diagram: graph("Names are references", "Names a and b both refer to one list object; name c refers to a different list holding equal values.", 600, 190,
    [{ id: "a", k: "term", t: "a", x: 80, y: 40, w: 70, h: 36 }, { id: "b", k: "term", t: "b", x: 80, y: 95, w: 70, h: 36 }, { id: "c", k: "term", t: "c", x: 80, y: 150, w: 70, h: 30 }, { id: "o", k: "proc", t: "list object #1\n[1, 2]", x: 350, y: 68, w: 180, h: 54 }, { id: "p", k: "proc", t: "list object #2\n[1, 2]", x: 350, y: 150, w: 180, h: 44 }],
    [{ from: "a", to: "o" }, { from: "b", to: "o" }, { from: "c", to: "p" }]),
  example: { code: `import sys\na = [1, 2]\nb = a\nc = [1, 2]\nprint(a is b, a == c, a is c)\nb += [3]\nprint(a, c)\nx = (1, 2)\ny = x\ny += (3,)\nprint(x, y)\ns = "py"\nt = s\nt += "thon"\nprint(s, t)\nprint(sys.getsizeof([]) < sys.getsizeof(list(range(1000))))\nfirst = id(a)\na.append(4)\nprint(id(a) == first)\nn = 10\nm = n\nn += 1\nprint(m, n, m is n)`, out: `True True False\n[1, 2, 3] [1, 2]\n(1, 2) (1, 2, 3)\npy python\nTrue\nTrue\n10 11 False` },
  lineByLine: [["a is b, a == c, a is c", "Same object; equal value; different objects."], ["b += [3]", "Extends the shared list in place, so a sees it."], ["y += (3,)", "A tuple cannot change, so y becomes a new tuple; x is untouched."], ["t += \"thon\"", "A new string; s is untouched."], ["id(a) == first after append", "A list keeps its identity while it changes."], ["n += 1", "n now refers to a different int; m still refers to 10."]],
  dryRun: { intro: "Tracking <code>b += [3]</code>:", headers: ["Step", "a", "b", "same object?"], rows: [["b = a", "[1, 2]", "[1, 2]", "yes"], ["b += [3]", "[1, 2, 3]", "[1, 2, 3]", "yes (changed in place)"]] },
  realExample: { intro: "A function that changes its argument versus one that does not.", code: `def add_bonus_in_place(marks):\n    marks.append(5)\n\ndef add_bonus_copy(marks):\n    return marks + [5]\n\nscores = [70, 80]\nadd_bonus_in_place(scores)\nprint(scores)\nnew_scores = add_bonus_copy(scores)\nprint(scores, new_scores, scores is new_scores)`, out: `[70, 80, 5]\n[70, 80, 5] [70, 80, 5, 5] False` },
  mistakes: ["Using <code>is</code> to compare values.", "Assuming <code>b = a</code> copies.", "Relying on small-integer or string interning.", "Forgetting that <code>+=</code> on a list mutates but on a tuple does not.", "Printing <code>id()</code> values in tests."],
  practices: ["Make it obvious whether a function mutates its argument.", "Copy defensively when storing data you were handed.", "Use immutable types for values that must not change."],
  interview: ["Is Python pass-by-value or pass-by-reference?", "Difference between is and ==?", "Why does a += b differ from a = a + b for lists?", "Why can a is b be True for small ints?"],
  practiceQs: ["Predict: a = [1]; b = [a, a]; a.append(2); print(b).", "What does id() return?", "Why does x = x + [1] inside a function not change the caller's list?", "Name three immutable types."],
  revision: ["Names refer to objects; assignment shares.", "Identity, type, value.", "Mutable objects change in place; immutable ones are replaced.", "Never use is for values."],
  hinglish: "Python mein naam objects ki taraf point karte hain, assignment copy nahi karta. is identity dekhta hai aur == value. List mutable hai isliye += uski wahi list badal deta hai, jabki tuple aur string mein naya object banta hai.",
  quiz: [
    mcq("What does b = a do for a list a?", ["Copies the list", "Creates a second name for the same list", "Creates an empty list", "Freezes the list"], 1, "Assignment never copies."),
    mcq("What is printed?\n\na = [1]\nb = a\nb += [2]\nprint(a)", ["[1]", "[1, 2]", "[2]", "Error"], 1, "+= extends the shared list in place.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nt = (1,)\nu = t\nu += (2,)\nprint(t)", ["(1,)", "(1, 2)", "(2,)", "Error"], 0, "A tuple is replaced, not changed.", "OUTPUT_PREDICTION"),
    mcq("When should you use `is`?", ["To compare numbers", "To compare strings", "To compare with None", "Always instead of =="], 2, "None is a singleton."),
    mcq("Which is true for id(x)?", ["It is stable across runs", "It is unique among live objects", "It is the object's value", "It is its type"], 1, "It identifies the object while it exists.")
  ],
  tasks: [task("Independent inner lists", "Read n. Build a list of n empty lists in a way that does NOT share one inner list, append the number 1 to the first inner list, and print the whole list.", "n = int(input())\n# build n separate empty lists, append 1 to the first, print\n", `n = int(input())\ngrid = [[] for _ in range(n)]\ngrid[0].append(1)\nprint(grid)`, [["3", "[[1], [], []]"], ["1", "[[1]]"]], [["3", "[[1], [], []]"], ["1", "[[1]]"], ["2", "[[1], []]"], ["5", "[[1], [], [], [], []]"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Memory Management: Reference Counting, Garbage Collection, Stack and Heap",
  minutes: 45,
  learn: ["Explain how CPython frees memory with reference counting", "Describe the cyclic garbage collector and when it matters", "Distinguish stack frames from heap objects", "Use weakref, del and gc sensibly"],
  why: "Memory leaks and unexpected object lifetimes cause real production problems. You do not manage memory by hand in Python, but you must know what keeps objects alive.",
  realWorld: "A cache that never lets go of old objects, a callback holding a big object alive, a circular reference between a parent and its children.",
  simple: "Every object counts how many references point to it. When the count reaches <strong>zero</strong> the memory is freed at once. If objects point to each other in a loop, the count never reaches zero, so a separate <strong>garbage collector</strong> finds and removes such cycles.",
  detail: `<h3>Reference counting</h3>
<p>Each object stores a reference count (<code>sys.getrefcount(obj)</code> reports it, always one higher than you expect because the call itself holds a reference). Assigning, putting in a list or passing to a function adds references; <code>del name</code>, reassigning a name or leaving a function removes them. At zero, CPython runs the object's finaliser and frees it immediately and predictably.</p>
<h3>Cycles and the garbage collector</h3>
<p>If <code>a.other = b</code> and <code>b.other = a</code>, deleting both names leaves each object with a count of 1. The <strong>cyclic garbage collector</strong> (<code>gc</code> module) periodically looks for groups of objects that can only reach each other and frees them. You can trigger it with <code>gc.collect()</code> and inspect it with <code>gc.get_stats()</code>, but you rarely need to.</p>
<h3>weakref</h3>
<p>A weak reference does not count towards the reference count and returns <code>None</code> once the object is gone. Use it for caches and observer lists that must not keep objects alive.</p>
<h3>Stack and heap</h3>
${table(["", "Call stack", "Heap"], [["Holds", "one frame per active function call: local names, return position", "all Python objects (ints, lists, instances...)"], ["Lifetime", "ends when the function returns", "until no references remain"], ["Limit", "recursion depth (RecursionError)", "available memory (MemoryError)"]])}
<p>Local variables in a frame are just names pointing to heap objects.</p>
<h3>Practical advice</h3>
<ul><li>Use <code>with</code> for resources (files, locks): do not rely on the garbage collector to close them.</li><li>Do not define <code>__del__</code> unless you must; its timing is not guaranteed on other Python implementations.</li><li>Large temporary data: let names go out of scope or <code>del</code> them.</li><li>Other implementations (PyPy, Jython) use different strategies; CPython's immediate freeing is an implementation detail.</li></ul>`,
  syntax: { code: `import gc, sys, weakref\nsys.getrefcount(x)\ndel name\ngc.collect()\nr = weakref.ref(obj)\nr()   # the object, or None`, note: "getrefcount is one higher than expected." },
  diagram: chain("Life of an object", "Left to right: created, references added, references removed, count reaches zero, memory freed; a cycle needs the garbage collector instead.",
    [{ k: "term", t: "created\ncount 1" }, { k: "proc", t: "more names\ncount grows" }, { k: "proc", t: "names removed\ncount falls" }, { k: "dec", t: "count 0?" }, { k: "term", t: "freed" }], { w: 120, gap: 24, hgt: 56 }),
  example: { code: `import gc, sys, weakref\n\nclass Node:\n    pass\n\nx = Node()\nbase = sys.getrefcount(x)\ny = x\nalias_count = sys.getrefcount(x)\nprint(alias_count - base)\ndel y\nprint(sys.getrefcount(x) == base)\n\nref = weakref.ref(x)\nprint(ref() is x)\ndel x\nprint(ref())\n\na, b = Node(), Node()\na.other, b.other = b, a\ncycle = weakref.ref(a)\ndel a, b\nprint(cycle() is not None)\ngc.collect()\nprint(cycle())\n\ndef frame():\n    local = [1, 2, 3]\n    return weakref.ref(local) if False else len(local)\nprint(frame())`, out: `1\nTrue\nTrue\nNone\nTrue\nNone\n3` },
  lineByLine: [["sys.getrefcount(x) minus base", "Creating the alias <code>y</code> added exactly one reference."], ["del y", "Removes that reference: the count returns to the base value."], ["weakref.ref(x)", "Watches x without keeping it alive."], ["del x then ref()", "The count hit zero, so x was freed and the weak reference now gives None."], ["a.other, b.other = b, a", "A cycle: each object keeps the other alive."], ["gc.collect()", "The collector finds the unreachable cycle and frees it."]],
  dryRun: { intro: "Reference count of the object bound to <code>x</code> (excluding the temporary one made by getrefcount):", headers: ["Statement", "Count"], rows: [["x = Node()", "1"], ["y = x", "2"], ["del y", "1"], ["del x", "0: freed"]] },
  realExample: { intro: "A cache that must not keep objects alive: a WeakValueDictionary forgets entries when the object is freed.", code: `import weakref, gc\nclass Report:\n    def __init__(self, name):\n        self.name = name\n\ncache = weakref.WeakValueDictionary()\nr = Report("q1")\ncache["q1"] = r\nprint(len(cache), cache["q1"].name)\ndel r\ngc.collect()\nprint(len(cache))`, out: `1 q1\n0` },
  mistakes: ["Believing <code>del x</code> always frees memory (other references may exist).", "Relying on <code>__del__</code> to close resources.", "Creating cycles that hold big objects, then wondering about memory growth.", "Calling <code>gc.collect()</code> in loops for speed (it rarely helps).", "Forgetting that a global cache keeps objects alive forever."],
  practices: ["Use <code>with</code> for resources.", "Use weak references or size limits (<code>lru_cache(maxsize=...)</code>) for caches.", "Profile memory (<code>tracemalloc</code>) before guessing."],
  interview: ["How does Python manage memory?", "What is reference counting and what is its weakness?", "What is the difference between the stack and the heap?", "What is a weak reference for?"],
  practiceQs: ["What does sys.getrefcount return for a fresh object?", "Why do cycles need a garbage collector?", "How can a cache avoid keeping objects alive?", "What happens to local variables when a function returns?"],
  revision: ["Count = number of references; zero frees immediately.", "Cycles need gc.", "Stack frames hold names; heap holds objects.", "weakref does not keep objects alive."],
  hinglish: "Python har object ke references ginta hai aur count zero hote hi memory free kar deta hai. Jab objects ek doosre ko gol chakkar mein pakadte hain (cycle), tab garbage collector unhe hataata hai. weakref object ko zinda nahi rakhta.",
  quiz: [
    mcq("When does CPython normally free an object?", ["At program end only", "When its reference count reaches zero", "Every 10 seconds", "When gc.collect() is called"], 1, "Reference counting frees immediately."),
    mcq("Why is a garbage collector needed?", ["To speed up loops", "To free reference cycles", "To close files", "To manage the stack"], 1, "Cycles keep counts above zero."),
    mcq("What does a weak reference return after its object was freed?", ["The object", "None", "An error", "0"], 1, "ref() gives None.", "OUTPUT_PREDICTION"),
    mcq("Where do Python objects live?", ["Call stack", "Heap", "Registers", "Disk"], 1, "Names are on frames; objects are on the heap."),
    mcq("What is the safest way to release a file?", ["__del__", "Wait for gc", "with open(...)", "del f only"], 2, "Context managers give deterministic cleanup.")
  ],
  tasks: [task("Alias, copy and equality", "Read a number n. Build a = list(range(n)), b = a and c = a[:]. Print three values separated by spaces: a is b, a is c, and a == c (as True or False).", "n = int(input())\na = list(range(n))\n# print: a is b, a is c, a == c\n", `n = int(input())\na = list(range(n))\nb = a\nc = a[:]\nprint(a is b, a is c, a == c)`, [["3", "True False True"], ["0", "True False True"]], [["3", "True False True"], ["0", "True False True"], ["10", "True False True"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Time and Space Complexity and Big O Notation",
  minutes: 55,
  learn: ["Analyse the time and space complexity of a function", "Read Big O notation and compare growth rates", "Know the costs of common list, dict and set operations", "Explain best, average, worst and amortised cost"],
  why: "Coding interviews and real systems both ask the same question: how does this behave when the input grows by a thousand times? Big O is the shared language for the answer.",
  realWorld: "Search over 1 crore records, sorting a leaderboard, de-duplicating logs: the choice of algorithm decides whether it takes a second or a day.",
  simple: "Count the main steps as a function of the input size <em>n</em>, keep only the fastest-growing term, drop constants. Two nested loops over n items: about n&sup2; steps, so O(n&sup2;). Memory used beyond the input is the <em>space</em> complexity.",
  detail: `<h3>Rules for counting</h3>
<ol><li>Sequential parts add: <code>O(n) + O(n)</code> is <code>O(n)</code>.</li><li>Nested parts multiply: a loop of n inside a loop of m is <code>O(n * m)</code>.</li><li>Keep the biggest term: <code>n&sup2; + n + 1</code> is <code>O(n&sup2;)</code>.</li><li>Drop constants: <code>3n</code> is <code>O(n)</code>.</li><li>Halving or doubling each step gives <code>O(log n)</code>.</li></ol>
${table(["Operation", "list", "dict / set (average)", "deque"], [["index / lookup", "O(1)", "O(1)", "O(n) in the middle"], ["append / add", "O(1) amortised", "O(1)", "O(1)"], ["insert at front", "O(n)", "-", "O(1)"], ["pop at end", "O(1)", "-", "O(1)"], ["pop at front", "O(n)", "-", "O(1)"], ["x in c", "O(n)", "O(1)", "O(n)"], ["remove value", "O(n)", "O(1)", "O(n)"], ["sort", "O(n log n)", "-", "-"], ["slice of k items", "O(k)", "-", "-"], ["copy", "O(n)", "O(n)", "O(n)"]])}
<h3>Cases</h3>
<ul><li><strong>Best / average / worst</strong>: linear search takes 1 step at best, n/2 on average, n at worst. Big O usually quotes the worst case.</li><li><strong>Amortised</strong>: <code>list.append</code> sometimes has to resize (O(n)) but averaged over many appends it is O(1).</li><li>Dictionary lookup is O(1) on average but can degrade with many hash collisions.</li></ul>
<h3>Space</h3>
<p>Recursion uses stack space proportional to depth. Building a new list of n items is O(n) extra space; a generator is O(1).</p>
<h3>Related notations</h3>
<p>Big O is an upper bound, Omega (&Omega;) a lower bound and Theta (&Theta;) a tight bound. Day-to-day, people say &quot;O&quot; and mean the tight bound.</p>`,
  syntax: { code: `# O(n): one pass\nfor x in data: ...\n# O(n^2): all pairs\nfor a in data:\n    for b in data: ...\n# O(log n): halving\nwhile n > 1: n //= 2`, note: "Count steps as n grows." },
  diagram: chain("Growth rates from best to worst", "Left to right: O(1), O(log n), O(n), O(n log n), O(n squared), O(2 to the n); the further right, the faster the work grows.",
    [{ k: "term", t: "O(1)" }, { k: "proc", t: "O(log n)" }, { k: "proc", t: "O(n)" }, { k: "proc", t: "O(n log n)" }, { k: "proc", t: "O(n²)" }, { k: "term", t: "O(2ⁿ)" }], { w: 95, gap: 18, hgt: 44 }),
  example: { code: `def count_steps_linear(n):\n    steps = 0\n    for _ in range(n):\n        steps += 1\n    return steps\n\ndef count_steps_quadratic(n):\n    steps = 0\n    for _ in range(n):\n        for _ in range(n):\n            steps += 1\n    return steps\n\ndef count_steps_log(n):\n    steps = 0\n    while n > 1:\n        n //= 2\n        steps += 1\n    return steps\n\nfor n in (10, 100, 1000):\n    print(n, count_steps_linear(n), count_steps_quadratic(n), count_steps_log(n))\n\ndef has_duplicate_slow(items):\n    for i in range(len(items)):\n        for j in range(i + 1, len(items)):\n            if items[i] == items[j]:\n                return True\n    return False\n\ndef has_duplicate_fast(items):\n    return len(set(items)) != len(items)\n\ndata = [3, 1, 4, 1, 5]\nprint(has_duplicate_slow(data), has_duplicate_fast(data))`, out: `10 10 100 3\n100 100 10000 6\n1000 1000 1000000 9\nTrue True` },
  lineByLine: [["count_steps_linear(n)", "One loop: n steps, O(n)."], ["count_steps_quadratic(n)", "Loop inside loop: n × n steps, O(n²)."], ["count_steps_log(n)", "Halving: log₂ n steps."], ["10 → 100 → 1000", "Quadratic steps grow 100 times for every 10 times growth of n; log steps barely move."], ["has_duplicate_slow", "Compares every pair: O(n²) time, O(1) space."], ["has_duplicate_fast", "One pass into a set: O(n) time, O(n) space: a time/space trade-off."]],
  dryRun: { intro: "Growth when n is multiplied by 10:", headers: ["Complexity", "n = 10", "n = 100", "n = 1000"], rows: [["O(log n)", "3", "6", "9"], ["O(n)", "10", "100", "1,000"], ["O(n log n)", "~33", "~664", "~9,966"], ["O(n²)", "100", "10,000", "1,000,000"]] },
  realExample: { intro: "Why a set rescues a nested loop: find whether two lists share an item.", code: `a = list(range(0, 2000, 2))\nb = list(range(1, 2001, 2))\n\ndef common_slow(a, b):\n    return any(x in b for x in a)\n\ndef common_fast(a, b):\n    return not set(a).isdisjoint(b)\n\nprint(common_slow(a, b), common_fast(a, b))\nprint(common_fast(a, [1000, 5000]))`, out: `False False\nTrue` },
  mistakes: ["Counting seconds instead of growth.", "Ignoring the hidden loop in <code>x in list</code> or <code>list.index</code>.", "Quoting best-case complexity as if it were the general case.", "Forgetting space complexity of recursion and copies.", "Optimising code that handles tiny inputs."],
  practices: ["State time and space together: &quot;O(n log n) time, O(n) space&quot;.", "Check input limits: n = 10<sup>5</sup> allows O(n log n), not O(n²).", "Know the cost table above by heart."],
  interview: ["What is the complexity of binary search? sorting? dictionary lookup?", "Explain amortised O(1) for append.", "What is the difference between O(n) and O(2n)?", "How would you remove duplicates in O(n)?"],
  practiceQs: ["Complexity of: for i in range(n): for j in range(i, n): ...", "Complexity of building a string by repeated +=?", "What is the space complexity of recursive factorial?", "Which is faster for large n, O(n log n) or O(n²)?"],
  revision: ["Add sequential, multiply nested, keep the largest term, drop constants.", "list in/insert/remove O(n); dict/set O(1).", "Best / average / worst / amortised.", "Trade time for space."],
  hinglish: "Big O batata hai ki input n badhne par steps kitne badhte hain. Nested loops multiply hote hain (n²), sequential loops jud jaate hain, aur har baar aadha karne par log n. Time aur space dono batao.",
  quiz: [
    mcq("What is the complexity of two nested loops of n?", ["O(n)", "O(2n)", "O(n²)", "O(log n)"], 2, "n × n."),
    mcq("What is the complexity of x in a list of n items?", ["O(1)", "O(log n)", "O(n)", "O(n²)"], 2, "It scans the list."),
    mcq("What is the complexity of 3n + 5?", ["O(n)", "O(3n)", "O(5)", "O(n²)"], 0, "Drop constants and lower terms."),
    mcq("What is the complexity of halving n until 1?", ["O(n)", "O(log n)", "O(1)", "O(n log n)"], 1, "The number of halvings is log₂ n."),
    mcq("Which has O(1) average membership testing?", ["list", "tuple", "set", "string scan"], 2, "Hash tables.")
  ],
  tasks: [task("Is there a pair with this sum?", "Read a line of integers and a target. Print True if two different positions hold values that add up to the target, otherwise False. Aim for O(n) time using a set.", "nums = list(map(int, input().split()))\ntarget = int(input())\n# one pass with a set\n", `nums = list(map(int, input().split()))\ntarget = int(input())\nseen = set()\nfound = False\nfor n in nums:\n    if target - n in seen:\n        found = True\n        break\n    seen.add(n)\nprint(found)`, [["2 7 11 15\n9", "True"], ["1 2 3\n10", "False"]], [["2 7 11 15\n9", "True"], ["1 2 3\n10", "False"], ["5\n10", "False"], ["5 5\n10", "True"], ["-1 1\n0", "True"], ["3 3 3\n7", "False"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Measuring: timeit, Profiling and tracemalloc",
  minutes: 40,
  learn: ["Time small code fragments reliably with timeit", "Find slow functions with cProfile", "Measure memory with tracemalloc and sys.getsizeof", "Follow the measure, change, measure loop"],
  why: "Programmers are poor at guessing where time goes. Measuring tells you what to fix and proves the fix worked.",
  realWorld: "A report page takes 8 seconds; the profile shows 90% of the time in one database helper, not in the loop everyone suspected.",
  simple: "<code>timeit</code> runs a snippet many times and reports the time. <code>cProfile</code> counts calls and times each function. <code>tracemalloc</code> shows how much memory your code allocates.",
  detail: `<h3>timeit</h3>
<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px"><code>import timeit\ntimeit.timeit("x in data", setup="data = list(range(10000)); x = 9999", number=1000)</code></pre>
<p>It disables the garbage collector and repeats the code, giving a more stable result than <code>time.time()</code> around a single call. In IPython or Jupyter use <code>%timeit</code>. Take the <em>minimum</em> of several repeats (<code>timeit.repeat</code>) to reduce noise from other programs.</p>
<h3>Profiling with cProfile</h3>
<p><code>python -m cProfile -s cumtime script.py</code> or <code>cProfile.run("main()")</code> prints, per function: number of calls, total time, time per call, cumulative time. Look for functions with a large cumulative time or an astonishing number of calls.</p>
<h3>Memory</h3>
<ul><li><code>sys.getsizeof(x)</code>: size of the object itself.</li><li><code>tracemalloc.start()</code> then <code>tracemalloc.get_traced_memory()</code> returns (current, peak) bytes; snapshots show which lines allocated most.</li></ul>
<h3>Method</h3>
<ol><li>Make it correct first, with tests.</li><li>Measure with realistic data.</li><li>Fix the biggest cost only (algorithm first, then data structure, then micro-optimisations).</li><li>Measure again; keep the change only if it helps.</li></ol>
<p>Timings depend on the machine, so compare two versions on the same computer. Benchmarks that differ by a few percent are noise.</p>`,
  syntax: { code: `import timeit, cProfile, tracemalloc\ntimeit.repeat(stmt, setup, number=1000, repeat=5)\ncProfile.run("main()", sort="cumtime")\ntracemalloc.start()\ncurrent, peak = tracemalloc.get_traced_memory()`, note: "Compare versions on the same machine." },
  diagram: chain("The optimisation loop", "Left to right: write a correct version, measure, change the biggest cost, measure again.",
    [{ k: "proc", t: "correct\nversion" }, { k: "proc", t: "measure\n(profile)" }, { k: "proc", t: "fix the\nbiggest cost" }, { k: "dec", t: "faster?" }], { w: 125, gap: 30, hgt: 58 }),
  example: { code: `import timeit, cProfile, pstats, io, tracemalloc\n\ndata = list(range(5000))\nas_set = set(data)\nslow = min(timeit.repeat("4999 in data", globals=globals(), number=2000, repeat=3))\nfast = min(timeit.repeat("4999 in as_set", globals=globals(), number=2000, repeat=3))\nprint("set lookup is faster:", fast < slow)\n\ndef work():\n    return sum(i * i for i in range(20000))\n\nprofiler = cProfile.Profile()\nprofiler.enable()\nwork()\nprofiler.disable()\nout = io.StringIO()\npstats.Stats(profiler, stream=out).sort_stats("cumulative").print_stats(3)\nreport = out.getvalue()\nprint("function calls" in report, "work" in report)\n\ntracemalloc.start()\nblock = [0] * 100000\ncurrent, peak = tracemalloc.get_traced_memory()\ntracemalloc.stop()\nprint(current > 100000, peak >= current)`, out: `set lookup is faster: True\nTrue True\nTrue True` },
  lineByLine: [["timeit.repeat(..., repeat=3)", "Runs the measurement three times; <code>min</code> removes noise."], ["fast < slow", "A hash lookup beats scanning a list of 5000 items."], ["cProfile.Profile() enable/disable", "Profiles only the code between the two calls."], ["pstats.Stats(...).print_stats(3)", "Prints the top three entries."], ["tracemalloc.get_traced_memory()", "Current and peak bytes allocated by Python code since start()."]],
  dryRun: { intro: "Reading a profile line:", headers: ["Column", "Meaning"], rows: [["ncalls", "how many times the function was called"], ["tottime", "time spent inside it (excluding sub-calls)"], ["cumtime", "time including everything it called"], ["filename:lineno(function)", "which function"]] },
  realExample: { intro: "Two ways to build a string measured fairly: join versus repeated concatenation. Only the relative result is shown.", code: `import timeit\npieces = ["x"] * 20000\ndef concat():\n    s = ""\n    for p in pieces:\n        s += p\n    return s\ndef joined():\n    return "".join(pieces)\nt_concat = min(timeit.repeat(concat, number=20, repeat=3))\nt_join = min(timeit.repeat(joined, number=20, repeat=3))\nprint(concat() == joined(), t_join < t_concat)`, out: `True True` },
  mistakes: ["Timing a single run with <code>time.time()</code>.", "Profiling tiny toy inputs.", "Optimising before measuring.", "Comparing timings from different computers or while other programs are running.", "Believing a 3% difference is real."],
  practices: ["Use realistic data sizes.", "Repeat and take the minimum.", "Profile the whole program, not guessed pieces.", "Keep a test that proves behaviour is unchanged."],
  interview: ["How do you find the slow part of a program?", "What is the difference between tottime and cumtime?", "Why does timeit repeat the code?", "How do you find memory growth?"],
  practiceQs: ["Compare sum(range(n)) with a manual loop using timeit.", "Which module would you use to find a memory spike?", "Why prefer the minimum of several timings?", "What does a very high ncalls value suggest?"],
  revision: ["timeit for snippets; cProfile for programs; tracemalloc for memory.", "Measure, fix the biggest cost, measure again.", "Compare on the same machine.", "Algorithm first, micro-optimisation last."],
  hinglish: "Andaza mat lagao, naapo: chhote code ke liye timeit, poore program ke liye cProfile aur memory ke liye tracemalloc. Sabse bada kharcha pehle theek karo aur phir dobara naapo.",
  quiz: [
    mcq("Which tool finds which functions use the most time?", ["timeit", "cProfile", "tracemalloc", "sys.getsizeof"], 1, "cProfile profiles functions."),
    mcq("Why take the minimum of several timeit repeats?", ["It is the fastest", "It reduces noise from other activity", "It is required", "It avoids imports"], 1, "Slower runs are caused by interference."),
    mcq("Which module reports memory allocated by Python code?", ["tracemalloc", "cProfile", "timeit", "dis"], 0, "tracemalloc tracks allocations."),
    mcq("What does cumtime include?", ["Only the function's own time", "Its own time plus the time of functions it called", "Waiting time only", "Import time"], 1, "It is cumulative."),
    mcq("Which comes first in optimisation?", ["Rewrite in C", "Measure", "Remove comments", "Add threads"], 1, "Measure before changing anything.")
  ],
  tasks: [task("Count the calls", "Define a decorator counted that counts how many times a function is called (store it in wrapper.calls). Decorate a naive recursive fib. Read n and print fib(n) and the number of calls separated by a space.", "def counted(func):\n    pass\n\n@counted\ndef fib(n):\n    pass\n\nn = int(input())\n# print the result and the number of calls\n", `from functools import wraps\n\ndef counted(func):\n    @wraps(func)\n    def wrapper(*args, **kwargs):\n        wrapper.calls += 1\n        return func(*args, **kwargs)\n    wrapper.calls = 0\n    return wrapper\n\n@counted\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n\nn = int(input())\nresult = fib(n)\nprint(result, fib.calls)`, [["10", "55 177"], ["5", "5 15"]], [["10", "55 177"], ["5", "5 15"], ["1", "1 1"], ["0", "0 1"], ["20", "6765 21891"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Efficient Data Structures and Common Performance Mistakes",
  minutes: 50,
  learn: ["Pick structures by the operations you need most", "Avoid the classic performance traps", "Save memory with generators and __slots__", "Apply caching and early exit"],
  why: "Most slow Python code is slow for a handful of repeated reasons. Learning those reasons removes 90% of performance problems without any clever tricks.",
  realWorld: "A script that checks a million emails against a blocklist: a list makes it hours, a set makes it seconds.",
  simple: "Choose the container whose fast operations match what you do most; do not repeat work inside loops; process data lazily; and let built-ins (written in C) do the heavy lifting.",
  detail: `<h3>Pick the right structure</h3>
${table(["You mostly...", "Use"], [["test membership", "<code>set</code> / <code>dict</code>"], ["add/remove at both ends", "<code>collections.deque</code>"], ["need a smallest/largest item repeatedly", "<code>heapq</code> (Module 15)"], ["search a sorted list", "<code>bisect</code> (binary search)"], ["count things", "<code>Counter</code>"], ["store millions of numbers", "<code>array</code> or NumPy arrays"], ["create many small objects", "classes with <code>__slots__</code> or dataclasses with <code>slots=True</code>"]])}
<h3>Common mistakes</h3>
<ul><li><strong>Membership in a list inside a loop</strong> (O(n²)).</li><li><strong>String building with <code>+=</code> in a loop</strong>: collect and <code>"".join()</code>.</li><li><strong>Recomputing the same value</strong> in a loop (<code>len(x)</code>, a constant expression, a regex compile): hoist it out.</li><li><strong>Loading everything into memory</strong> when you can stream with a generator.</li><li><strong>Sorting repeatedly</strong> instead of once, or sorting just to get the min/max (use <code>min</code>/<code>max</code>/<code>heapq.nsmallest</code>).</li><li><strong><code>list.pop(0)</code> / <code>insert(0, x)</code></strong> as a queue.</li><li><strong>Deep copies</strong> of big structures that you only read.</li><li><strong>Hand-written loops</strong> for what <code>sum</code>, <code>any</code>, <code>sorted</code>, <code>str.join</code> or comprehensions do in C.</li><li><strong>Catching exceptions in a hot loop</strong> that are not exceptional.</li></ul>
<h3>Memory savers</h3>
<p>Generator expressions instead of lists; <code>__slots__</code> removes the per-object dictionary (often halving the memory of many small instances); iterate files line by line; delete large temporaries.</p>
<h3>Caching and early exit</h3>
<p>Memoise pure, repeated calculations (<code>functools.cache</code>). Stop as soon as the answer is known (<code>any</code>, <code>break</code>, <code>return</code>).</p>
<p>Remember: <strong>readable first</strong>. Make code fast only where a measurement shows it matters.</p>`,
  syntax: { code: `blocked = set(blocklist)\nif email in blocked: ...\nparts = []\nparts.append(x)\ntext = "".join(parts)\nclass P:\n    __slots__ = ("x", "y")`, note: "Hoist constants out of loops." },
  diagram: graph("Slow pattern to fast pattern", "Four common slow patterns on the left each point to their faster replacement on the right.", 660, 250,
    [{ id: "s1", k: "proc", t: "x in a_list in a loop", x: 130, y: 40, w: 220, h: 40 }, { id: "s2", k: "proc", t: "s += piece in a loop", x: 130, y: 100, w: 220, h: 40 }, { id: "s3", k: "proc", t: "list.pop(0) as a queue", x: 130, y: 160, w: 220, h: 40 }, { id: "s4", k: "proc", t: "load whole file in memory", x: 130, y: 220, w: 220, h: 40 }, { id: "f1", k: "io", t: "set(...) lookup", x: 530, y: 40, w: 190, h: 38 }, { id: "f2", k: "io", t: "\"\".join(parts)", x: 530, y: 100, w: 190, h: 38 }, { id: "f3", k: "io", t: "deque.popleft()", x: 530, y: 160, w: 190, h: 38 }, { id: "f4", k: "io", t: "iterate line by line", x: 530, y: 220, w: 190, h: 38 }],
    [{ from: "s1", to: "f1" }, { from: "s2", to: "f2" }, { from: "s3", to: "f3" }, { from: "s4", to: "f4" }]),
  example: { code: `import sys\nfrom collections import deque\nfrom bisect import bisect_left\nfrom dataclasses import dataclass\n\nblocklist = list(range(0, 10000, 3))\nblocked = set(blocklist)\nemails = list(range(0, 600, 7))\nprint(sum(1 for e in emails if e in blocked))\n\nsorted_ids = list(range(0, 1000, 5))\nposition = bisect_left(sorted_ids, 500)\nprint(position, sorted_ids[position])\n\nq = deque(range(5))\nprint(q.popleft(), list(q))\n\nbig_list = [i * i for i in range(100000)]\nbig_gen = (i * i for i in range(100000))\nprint(sys.getsizeof(big_gen) < sys.getsizeof(big_list) // 100)\nprint(sum(big_gen) == sum(big_list))\n\n@dataclass(slots=True)\nclass Point:\n    x: int\n    y: int\np = Point(1, 2)\nprint(hasattr(p, "__dict__"), p)\n\ntext = "".join(str(n) for n in range(5))\nprint(text)`, out: `29\n100 500\n0 [1, 2, 3, 4]\nTrue\nTrue\nFalse Point(x=1, y=2)\n01234` },
  lineByLine: [["blocked = set(blocklist)", "Built once; every membership test afterwards is O(1)."], ["bisect_left(sorted_ids, 500)", "Binary search in O(log n) on a sorted list."], ["deque.popleft()", "O(1) removal from the front."], ["getsizeof(big_gen)", "A generator object is tiny; the list holds 100,000 items."], ["@dataclass(slots=True)", "No per-instance dictionary, so less memory."], [".join(...)", "Builds the string once."]],
  dryRun: { intro: "Why the set rescues the blocklist check (n emails, m blocked):", headers: ["Structure", "work per email", "total"], rows: [["list", "up to m comparisons", "O(n·m)"], ["set", "1 hash lookup", "O(n + m)"]] },
  realExample: { intro: "Hoisting repeated work out of a loop: compile the pattern once, and compute the constant once.", code: `import re\npattern = re.compile(r"\\d+")\nlimit = 10 ** 3\nlines = ["a 12", "b 5000", "c 999", "d"]\nbig = [ln for ln in lines if (m := pattern.search(ln)) and int(m.group()) > limit]\nprint(big)`, out: `['b 5000']` },
  mistakes: ["Premature optimisation.", "Optimising the wrong 90% of the program.", "Using a clever trick that nobody can read for a 2% gain.", "Forgetting that lists of numbers cost ~8 times more memory than arrays of numbers.", "Using <code>global</code> look-ups in hot loops without need (a minor effect; measure first)."],
  practices: ["Choose the structure first, micro-optimise last.", "Hoist invariants out of loops.", "Prefer built-ins and comprehensions.", "Write the simple version, then optimise only what the profile blames."],
  interview: ["How would you speed up a membership check against a large list?", "Why is list.pop(0) slow?", "How do generators save memory?", "What does __slots__ do?"],
  practiceQs: ["Rewrite a nested-loop duplicate finder in O(n).", "Why does s += c in a loop have quadratic worst-case behaviour in some implementations?", "Which module offers binary search on lists?", "When is a list fine?"],
  revision: ["Right structure: set/dict, deque, heapq, bisect, Counter.", "Avoid list membership in loops, += strings, pop(0).", "Generators and __slots__ save memory.", "Readable first; measure."],
  hinglish: "Zyada tar slow code ke wahi purane karan hote hain: list mein baar baar in, loop mein string +=, list.pop(0). Inki jagah set, join aur deque use karo. Pehle saaf code likho, phir measure karke theek karo.",
  quiz: [
    mcq("Which change speeds up repeated membership tests most?", ["Convert the list to a set", "Sort the list", "Reverse the list", "Use a tuple"], 0, "Hash lookups are O(1)."),
    mcq("Best way to build one long string from many pieces?", ["s += piece", "\"\".join(pieces)", "s = s + piece + \"\"", "str(pieces)"], 1, "join builds once."),
    mcq("What does bisect_left need?", ["A sorted sequence", "A set", "A dictionary", "A string only"], 0, "Binary search requires sorted input."),
    mcq("What does __slots__ save?", ["Time on imports", "Per-instance dictionary memory", "Disk space", "Nothing"], 1, "Instances have fixed attribute slots."),
    mcq("What should you do before optimising?", ["Rewrite everything", "Measure to find the bottleneck", "Add caching everywhere", "Use threads"], 1, "Profile first.")
  ],
  tasks: [task("First repeated value", "Read a line of integers. Print the first value (scanning from the left) that has already appeared earlier, or -1 if there is no repetition. Use a set so the work is O(n).", "nums = input().split()\n# print the first value that repeats, or -1\n", `nums = input().split()\nseen = set()\nanswer = -1\nfor n in nums:\n    if n in seen:\n        answer = int(n)\n        break\n    seen.add(n)\nprint(answer)`, [["2 1 3 1 2", "1"], ["1 2 3", "-1"]], [["2 1 3 1 2", "1"], ["1 2 3", "-1"], ["5 5", "5"], ["7", "-1"], ["1 2 3 2 1", "2"], ["9 8 7 6 9 8", "9"]])],
});

module.exports = {
  module: {
    title: "Phase 2 - Module 12: Python Memory and Performance",
    description: "The object model, references and identity, reference counting and garbage collection, stack and heap, time and space complexity with Big O, measuring with timeit, cProfile and tracemalloc, and efficient data structures.",
    chapters: [{ title: "Python Memory and Performance", description: "How Python stores objects and how to make programs fast and lean.", lessons }],
    assessment: {
      title: "Module 12 Assessment: Memory and Performance",
      description: "Efficient solutions with sets, windows and caching.",
      questions: [
        task("Longest substring without repeats", "Read a string and print the length of its longest substring with no repeated character (sliding window, O(n)).", "", `s = input()\nlast = {}\nstart = best = 0\nfor i, ch in enumerate(s):\n    if ch in last and last[ch] >= start:\n        start = last[ch] + 1\n    last[ch] = i\n    best = max(best, i - start + 1)\nprint(best)`, [["abcabcbb", "3"], ["bbbbb", "1"]], [["abcabcbb", "3"], ["bbbbb", "1"], ["pwwkew", "3"], ["a", "1"], ["abcdef", "6"], ["dvdf", "3"], ["abba", "2"]]),
        task("Anagram in O(n)", "Read two words on separate lines. Print True if they are anagrams (case-insensitive) using character counts rather than sorting.", "", `from collections import Counter\na = input().lower()\nb = input().lower()\nprint(Counter(a) == Counter(b))`, [["Listen\nSilent", "True"], ["apple\npale", "False"]], [["Listen\nSilent", "True"], ["apple\npale", "False"], ["aab\nabb", "False"], ["Dusty\nStudy", "True"], ["a\na", "True"]]),
        task("Unique paths in a grid", "A robot starts at the top-left of an m by n grid and may only move right or down. Read m and n on one line and print the number of different paths to the bottom-right corner. Use caching.", "", `from functools import cache\n\n@cache\ndef paths(r, c):\n    if r == 1 or c == 1:\n        return 1\n    return paths(r - 1, c) + paths(r, c - 1)\n\nm, n = map(int, input().split())\nprint(paths(m, n))`, [["3 7", "28"], ["3 2", "3"]], [["3 7", "28"], ["3 2", "3"], ["1 1", "1"], ["10 10", "48620"], ["18 18", "2333606220"]]),
        task("Pairs with a given difference", "Read a line of distinct integers and then k (k is positive). Print how many pairs of values differ by exactly k. Use a set.", "", `nums = list(map(int, input().split()))\nk = int(input())\nvalues = set(nums)\nprint(sum(1 for n in nums if n + k in values))`, [["1 5 3 4 2\n2", "3"], ["10 20\n5", "0"]], [["1 5 3 4 2\n2", "3"], ["10 20\n5", "0"], ["1 2 3\n1", "2"], ["8 12 16 4 0 20\n4", "5"], ["5\n1", "0"]]),
      ],
    },
  },
};
