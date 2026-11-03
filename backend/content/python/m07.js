// Phase 1 / Module 7: Python Collections (lists, tuples, sets, dictionaries).
"use strict";
const { chain, graph, table, svgWrap, esc } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];
const t = (x, y, s, size = 14, anchor = "middle") => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="currentColor" font-family="system-ui,sans-serif">${esc(s)}</text>`;

// ---------------------------------------------------------------- 1
lessons.push({
  title: "Lists: Creation, Indexing, Slicing and Changing",
  minutes: 45,
  learn: ["Create lists and read items by index and slice", "Change, add and remove items", "Use len, in, +, * and unpacking", "Explain why lists are mutable and what that means"],
  why: "A list holds many values in order under one name. Almost every program stores its data (marks, names, prices, records) in lists.",
  realWorld: "A class list of names, the daily temperatures of a month, the items in a shopping cart.",
  simple: "A list is an ordered, changeable row of items written in square brackets: <code>[10, 20, 30]</code>. Items are numbered from 0, exactly like characters in a string, but unlike strings you can <strong>change</strong> them.",
  detail: `<h3>Creating</h3>
<p><code>[]</code> empty; <code>[1, 2, 3]</code>; <code>list("abc")</code> gives <code>['a', 'b', 'c']</code>; <code>list(range(5))</code>; <code>[0] * 4</code> gives <code>[0, 0, 0, 0]</code>. A list may hold different types, including other lists.</p>
<h3>Reading</h3>
<p>Index <code>a[0]</code>, <code>a[-1]</code>; slice <code>a[1:3]</code>, <code>a[::-1]</code> (a <em>new</em> list); length <code>len(a)</code>; membership <code>x in a</code>. Index out of range raises <code>IndexError</code>.</p>
<h3>Changing</h3>
${table(["Task", "Code"], [["Replace one item", "<code>a[1] = 99</code>"], ["Replace a slice", "<code>a[1:3] = [7, 8, 9]</code>"], ["Add at the end", "<code>a.append(x)</code>"], ["Add many", "<code>a.extend([x, y])</code> or <code>a += [x, y]</code>"], ["Insert at position", "<code>a.insert(0, x)</code>"], ["Remove by value (first match)", "<code>a.remove(x)</code> (ValueError if absent)"], ["Remove by position and get it", "<code>a.pop()</code> last, <code>a.pop(i)</code>"], ["Delete by position or slice", "<code>del a[0]</code>, <code>del a[1:3]</code>"], ["Empty it", "<code>a.clear()</code>"]])}
<h3>Unpacking</h3>
<p><code>first, second = a</code> needs exactly two items; <code>first, *rest = a</code> puts the remaining items in a list.</p>
<h3>Cost</h3>
<p><code>append</code> and <code>pop()</code> at the end are fast (O(1) on average). <code>insert</code>, <code>remove</code>, <code>pop(0)</code> and <code>in</code> are O(n): items must be moved or scanned.</p>`,
  syntax: { code: `a = [10, 20, 30]\na[0]  a[-1]  a[1:3]  len(a)\na.append(40)   a.insert(1, 15)\na.remove(20)   last = a.pop()\nfirst, *rest = a`, note: "Lists are changed in place." },
  diagram: graph("A list in memory", "A list named scores holding four items 70, 85, 90, 60 at indexes 0 to 3 and negative indexes -4 to -1.", 600, 170,
    [{ id: "n", k: "term", t: "scores", x: 70, y: 85, w: 100, h: 40 }, { id: "a", k: "proc", t: "70", x: 220, y: 85, w: 70, h: 46 }, { id: "b", k: "proc", t: "85", x: 300, y: 85, w: 70, h: 46 }, { id: "c", k: "proc", t: "90", x: 380, y: 85, w: 70, h: 46 }, { id: "d", k: "proc", t: "60", x: 460, y: 85, w: 70, h: 46 }], [{ from: "n", to: "a" }])
    .replace("</svg>", ["0", "1", "2", "3"].map((s, i) => t(220 + i * 80, 40, s)).join("") + ["-4", "-3", "-2", "-1"].map((s, i) => t(220 + i * 80, 140, s)).join("") + "</svg>"),
  example: { code: `a = [10, 20, 30]\na.append(40)\na.insert(1, 15)\nprint(a)\nprint(a[1:3], a[-1], len(a))\na[0] = 5\na.remove(30)\nlast = a.pop()\nprint(a, last)\nfirst, *rest = [1, 2, 3, 4]\nprint(first, rest)\nprint([0] * 3 + [1, 2])`, out: `[10, 15, 20, 30, 40]\n[15, 20] 40 5\n[5, 15, 20] 40\n1 [2, 3, 4]\n[0, 0, 0, 1, 2]` },
  lineByLine: [["a.append(40)", "Adds 40 at the end."], ["a.insert(1, 15)", "Inserts 15 at index 1, shifting later items right."], ["a[1:3]", "A new list with indexes 1 and 2."], ["a.remove(30)", "Removes the first item equal to 30."], ["last = a.pop()", "Removes and returns the final item (40)."], ["first, *rest = ...", "The starred name collects everything left over into a list."]],
  dryRun: { intro: "State of <code>a</code> after each change:", headers: ["After", "a"], rows: [["a = [10, 20, 30]", "[10, 20, 30]"], ["append(40)", "[10, 20, 30, 40]"], ["insert(1, 15)", "[10, 15, 20, 30, 40]"], ["a[0] = 5", "[5, 15, 20, 30, 40]"], ["remove(30)", "[5, 15, 20, 40]"], ["pop()", "[5, 15, 20] (returns 40)"]] },
  realExample: { intro: "A to-do list changed step by step.", code: `plan = ["write report", "call Asha", "buy pens"]\nplan.append("revise Python")\ndone = plan.pop(1)\nplan[0] = plan[0].title()\nprint(done)\nprint(plan)\nprint(len(plan), "tasks left")`, out: `call Asha\n['Write Report', 'buy pens', 'revise Python']\n3 tasks left` },
  mistakes: ["Using <code>a = a.append(x)</code>: append returns None.", "Using an index equal to <code>len(a)</code>.", "Removing items while looping over the same list.", "Using <code>remove</code> for an absent value (ValueError).", "Writing <code>[[0] * 3] * 3</code> for a grid (all rows are the same list; see the copying lesson)."],
  practices: ["Check <code>if a:</code> before taking <code>a[0]</code> or <code>a.pop()</code>.", "Prefer <code>for x in a</code> over indexing.", "Use <code>collections.deque</code> for queues (Module 15) rather than <code>pop(0)</code>."],
  interview: ["Difference between append and extend?", "How do you remove all occurrences of a value?", "What does a[::-1] do and does it change a?", "Time complexity of insert(0, x)?"],
  practiceQs: ["Predict: a = [1, 2, 3]; b = a + [4]; print(a, b).", "Remove the middle item of any odd-length list.", "Swap the first and last items.", "What is [1, 2, 3][5:]?"],
  revision: ["Ordered, indexed from 0, mutable.", "append / extend / insert; remove / pop / del / clear.", "Slices return new lists.", "first, *rest = a."],
  hinglish: "List ek ordered aur badli ja sakne wali collection hai. append end mein jodta hai, insert kisi position par, remove value se aur pop position se hataata hai. a[1:3] nayi list deta hai.",
  quiz: [
    mcq("What is printed?\n\na = [1, 2, 3]\na.append(4)\nprint(a)", ["[1, 2, 3]", "[1, 2, 3, 4]", "None", "[4]"], 1, "append changes the list in place.", "OUTPUT_PREDICTION"),
    mcq("What is x?\n\nx = [1, 2, 3].append(4)", ["[1, 2, 3, 4]", "None", "4", "Error"], 1, "append returns None.", "OUTPUT_PREDICTION"),
    mcq("What is [10, 20, 30, 40][1:3]?", ["[10, 20]", "[20, 30]", "[20, 30, 40]", "[30, 40]"], 1, "Indexes 1 and 2.", "OUTPUT_PREDICTION"),
    mcq("What does pop() return for [1, 2, 3]?", ["1", "3", "[3]", "None"], 1, "The last item, which it removes.", "OUTPUT_PREDICTION"),
    mcq("Which is slowest on a long list?", ["append(x)", "pop()", "insert(0, x)", "a[0]"], 2, "Inserting at the front shifts every item."),
  ],
  tasks: [task("Rotate left", "Read a line of integers and then an integer k. Print the list rotated left by k positions (the first k items move to the end), items separated by spaces. k may be larger than the list length.", "nums = input().split()\nk = int(input())\n# rotate left by k and print\n", `nums = input().split()\nk = int(input()) % len(nums)\nprint(" ".join(nums[k:] + nums[:k]))`, [["1 2 3 4 5\n2", "3 4 5 1 2"], ["1 2 3\n0", "1 2 3"]], [["1 2 3 4 5\n2", "3 4 5 1 2"], ["1 2 3\n0", "1 2 3"], ["1 2 3\n3", "1 2 3"], ["1 2 3\n4", "2 3 1"], ["7\n5", "7"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "List Methods, Sorting, Nested Lists and Comprehensions",
  minutes: 50,
  learn: ["Sort and reverse lists in place or into new lists", "Use index, count, min, max, sum", "Work with lists of lists (matrices)", "Write list comprehensions with conditions"],
  why: "Sorting and transforming data is daily work: ranking students, cleaning input, building tables. Comprehensions express it in one readable line.",
  realWorld: "A leaderboard is a sorted list; a marks table is a list of lists; converting all names to uppercase is a comprehension.",
  simple: "<code>sort()</code> reorders the list itself and returns nothing; <code>sorted()</code> gives you a new sorted list. A <strong>list comprehension</strong> builds a list from another in one line: <code>[x * x for x in nums if x &gt; 0]</code>.",
  detail: `<h3>Sorting</h3>
${table(["Code", "Effect"], [["<code>a.sort()</code>", "sorts <code>a</code> in place, returns None"], ["<code>sorted(a)</code>", "returns a new sorted list; <code>a</code> unchanged; works on any iterable"], ["<code>a.sort(reverse=True)</code>", "descending"], ["<code>sorted(words, key=len)</code>", "sort by a key function"], ["<code>a.reverse()</code>", "reverse in place"]])}
<p>Sorting is <strong>stable</strong>: items that compare equal keep their original order, so you can sort by a second key first and then by the main key. It takes O(n log n) time. Mixed types such as <code>[1, "a"]</code> cannot be sorted (TypeError).</p>
<h3>Other helpers</h3>
<p><code>a.index(x)</code> position of the first x (ValueError if absent); <code>a.count(x)</code>; <code>min(a)</code>, <code>max(a)</code>, <code>sum(a)</code>; <code>len(a)</code>; <code>any(a)</code>, <code>all(a)</code>.</p>
<h3>Nested lists</h3>
<p>A list of lists models a table: <code>grid[row][col]</code>. Each inner list is a separate object. Build a grid with a comprehension: <code>[[0] * 3 for _ in range(2)]</code>. Never write <code>[[0] * 3] * 2</code>: that repeats <em>one</em> inner list, so a change to one row shows in all.</p>
<h3>List comprehensions</h3>
<pre style="background:rgba(127,127,127,.14);padding:12px 14px;border-radius:8px"><code>[expression for item in iterable]\n[expression for item in iterable if condition]\n[a if cond else b for item in iterable]</code></pre>
<p>It is equivalent to a loop with <code>append</code> but shorter and usually faster. If it needs more than one condition and a nested loop, use a normal loop for clarity.</p>`,
  syntax: { code: `sorted(a, key=len, reverse=True)\nsquares = [x * x for x in range(1, 6)]\nevens = [x for x in a if x % 2 == 0]\ngrid = [[0] * cols for _ in range(rows)]`, note: "A comprehension builds a new list." },
  diagram: chain("A list comprehension step by step", "Left to right: take each item, filter with the condition, compute the expression, collect results into a new list.",
    [{ k: "io", t: "for item in\niterable" }, { k: "dec", t: "if\ncondition?" }, { k: "proc", t: "expression\n(item)" }, { k: "proc", t: "collect into\nnew list" }], { w: 130, gap: 30, hgt: 58 }),
  example: { code: `nums = [5, 2, 9, 1, 7]\nprint(sorted(nums), nums)\nnums.sort(reverse=True)\nprint(nums)\nwords = ["pear", "fig", "apple", "kiwi"]\nprint(sorted(words, key=len))\nprint([n * n for n in range(1, 6) if n % 2 == 1])\nprint(["big" if n > 5 else "small" for n in [3, 8]])\ngrid = [[0] * 3 for _ in range(2)]\ngrid[0][1] = 7\nprint(grid)\nprint(sum(nums), min(nums), max(nums), nums.index(9), nums.count(2))`, out: `[1, 2, 5, 7, 9] [5, 2, 9, 1, 7]\n[9, 7, 5, 2, 1]\n['fig', 'pear', 'kiwi', 'apple']\n[1, 9, 25]\n['small', 'big']\n[[0, 7, 0], [0, 0, 0]]\n24 1 9 0 1` },
  lineByLine: [["sorted(nums), nums", "A sorted copy; the original keeps its order."], ["nums.sort(reverse=True)", "Sorts in place, largest first."], ["sorted(words, key=len)", "Sorted by length; equal lengths (pear, kiwi) keep their original order."], ["[n * n for n in range(1, 6) if n % 2 == 1]", "Squares of the odd numbers only."], ["[\"big\" if n > 5 else \"small\" ...]", "A conditional expression inside a comprehension."], ["grid[0][1] = 7", "Changes only the first row."]],
  dryRun: { intro: "How <code>[n * n for n in range(1, 6) if n % 2 == 1]</code> runs:", headers: ["n", "n % 2 == 1", "value kept"], rows: [["1", "True", "1"], ["2", "False", "-"], ["3", "True", "9"], ["4", "False", "-"], ["5", "True", "25"]] },
  realExample: { intro: "A marks table (rows = students, columns = subjects): row totals and column maximums.", code: `marks = [[70, 80, 90], [60, 75, 85], [95, 85, 70]]\nrow_totals = [sum(row) for row in marks]\nbest_per_subject = [max(row[c] for row in marks) for c in range(3)]\nprint(row_totals)\nprint(best_per_subject)`, out: `[240, 220, 250]\n[95, 85, 90]` },
  mistakes: ["Writing <code>a = a.sort()</code> (None).", "Using <code>[[0] * n] * m</code> for a grid.", "Sorting mixed types.", "Over-long comprehensions that nobody can read.", "Forgetting that <code>sorted()</code> returns a list even for a string: <code>sorted(\"cab\")</code> is <code>['a', 'b', 'c']</code>."],
  practices: ["Use comprehensions for simple map/filter jobs only.", "Use <code>key=</code> instead of writing your own sorting code.", "Sort by two keys with two stable sorts, or with a key returning a tuple."],
  interview: ["Difference between sort() and sorted()?", "What does stable sorting mean?", "Why does [[0] * 3] * 3 behave strangely?", "Rewrite a loop with append as a comprehension."],
  practiceQs: ["Sort [\"b\", \"A\", \"c\"] ignoring case.", "Build a 3x3 identity matrix with a comprehension.", "Flatten [[1, 2], [3], [4, 5]].", "What does [x for x in \"hello\" if x in \"aeiou\"] return?"],
  revision: ["sort() in place; sorted() new.", "key=, reverse=.", "grid = [[0]*c for _ in range(r)].", "[expr for x in it if cond]."],
  hinglish: "sort() list ko wahin badal deta hai aur None return karta hai, sorted() nayi list deta hai. List comprehension ek line mein nayi list banata hai: [x*x for x in a if x > 0]. Grid banate waqt [[0]*3 for _ in range(2)] likho, [[0]*3]*2 nahi.",
  quiz: [
    mcq("What does a.sort() return?", ["The sorted list", "None", "A copy", "True"], 1, "It sorts in place and returns None.", "OUTPUT_PREDICTION"),
    mcq("What is [x * 2 for x in range(3)]?", ["[0, 2, 4]", "[2, 4, 6]", "[0, 1, 2]", "[0, 2, 4, 6]"], 0, "x takes 0, 1, 2.", "OUTPUT_PREDICTION"),
    mcq("What is sorted(\"cab\")?", ["'abc'", "['a', 'b', 'c']", "('a','b','c')", "Error"], 1, "sorted always returns a list.", "OUTPUT_PREDICTION"),
    mcq("What is the bug?\n\ngrid = [[0] * 2] * 2\ngrid[0][0] = 1\nprint(grid)", ["Both rows change: [[1, 0], [1, 0]]", "Only row 0 changes", "IndexError", "No bug"], 0, "Both rows are the same list object.", "DEBUG"),
    mcq("What does sorted([3,1,2], reverse=True) return?", ["[1, 2, 3]", "[3, 2, 1]", "[3, 1, 2]", "None"], 1, "Descending order.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Sort by length", "Read a line of words. Print them sorted by length (shortest first); words of equal length must be in alphabetical order. Separate the words with spaces.", "words = input().split()\n# sort by length, then alphabetically\n", `words = input().split()\nprint(" ".join(sorted(sorted(words), key=len)))`, [["pear fig apple kiwi", "fig kiwi pear apple"], ["b a cc aa", "a b aa cc"]], [["pear fig apple kiwi", "fig kiwi pear apple"], ["b a cc aa", "a b aa cc"], ["one", "one"], ["zebra ant bee cat", "ant bee cat zebra"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Copying Lists: Aliases, Shallow Copy and Deep Copy",
  minutes: 35,
  learn: ["Tell an alias, a shallow copy and a deep copy apart", "Choose the right copy for flat and nested lists", "Predict changes through shared inner lists", "Pass lists to functions safely"],
  why: "Unexpected changes through shared lists are among the most common real-world Python bugs. This lesson gives you the rules to avoid them.",
  realWorld: "A report function receives the student list. If it sorts or edits the list in place, the caller's data changes too, which may be wrong.",
  simple: "<code>b = a</code> is not a copy. <code>a.copy()</code> copies the outer list only (shallow). <code>copy.deepcopy(a)</code> copies everything inside as well.",
  detail: `${table(["Operation", "New outer list?", "Inner objects shared?"], [["<code>b = a</code>", "No (same list)", "Yes"], ["<code>a.copy()</code>, <code>a[:]</code>, <code>list(a)</code>", "Yes", "Yes (shared)"], ["<code>copy.deepcopy(a)</code>", "Yes", "No (copied too)"]])}
<h3>Flat lists</h3>
<p>For a list of numbers or strings (immutable items) a shallow copy is a full copy: nothing inside can change in place.</p>
<h3>Nested lists</h3>
<p>For a list of lists, a shallow copy gives a new outer list whose rows are the <em>same</em> inner lists. Changing a row through one copy shows in the other. Use <code>deepcopy</code>, or copy each row: <code>[row[:] for row in grid]</code>.</p>
<h3>Functions and lists</h3>
<p>A function receives a reference to the caller's list. If it should not change the original, work on a copy or use <code>sorted()</code> instead of <code>.sort()</code>. Document functions that modify their arguments.</p>
<h3>Default arguments trap (preview)</h3>
<p>A mutable default such as <code>def add(x, items=[])</code> is created once and shared by all calls. Use <code>None</code> and create the list inside (Module 8).</p>`,
  syntax: { code: `import copy\nb = a.copy()           # shallow\nb = copy.deepcopy(a)   # deep\nrows = [row[:] for row in grid]`, note: "Shallow is enough only when the items are immutable." },
  diagram: graph("Shallow copy shares the inner lists", "Outer list a and shallow copy b are different objects but both point to the same two inner lists; deep copy c has its own inner lists.", 640, 250,
    [{ id: "a", k: "proc", t: "a (outer)", x: 90, y: 40, w: 110, h: 40 }, { id: "b", k: "proc", t: "b = a.copy()", x: 90, y: 120, w: 130, h: 40 }, { id: "c", k: "proc", t: "c = deepcopy(a)", x: 90, y: 205, w: 150, h: 40 }, { id: "i1", k: "io", t: "[1, 2]", x: 420, y: 60, w: 110, h: 38 }, { id: "i2", k: "io", t: "[3, 4]", x: 420, y: 120, w: 110, h: 38 }, { id: "j1", k: "io", t: "[1, 2] (copy)", x: 420, y: 190, w: 150, h: 34 }, { id: "j2", k: "io", t: "[3, 4] (copy)", x: 420, y: 232, w: 150, h: 30 }],
    [{ from: "a", to: "i1" }, { from: "b", to: "i2" }, { from: "c", to: "j1" }]),
  example: { code: `import copy\ngrid = [[1, 2], [3, 4]]\nalias = grid\nshallow = grid.copy()\ndeep = copy.deepcopy(grid)\ngrid[0][0] = 99\ngrid.append([5, 6])\nprint(alias)\nprint(shallow)\nprint(deep)\nrows = [row[:] for row in [[1], [2]]]\nprint(rows)`, out: `[[99, 2], [3, 4], [5, 6]]\n[[99, 2], [3, 4]]\n[[1, 2], [3, 4]]\n[[1], [2]]` },
  lineByLine: [["alias = grid", "Same list: sees every change, including the appended row."], ["shallow = grid.copy()", "New outer list; later appends to <code>grid</code> do not appear here, but the inner list <code>[1, 2]</code> is shared, so the change to <code>grid[0][0]</code> does."], ["deep = copy.deepcopy(grid)", "Fully independent: unchanged."], ["[row[:] for row in ...]", "Copies each row, a manual two-level copy."]],
  dryRun: { intro: "After <code>grid[0][0] = 99</code> and <code>grid.append([5, 6])</code>:", headers: ["Name", "Outer list", "First row"], rows: [["grid", "own", "[99, 2]"], ["alias", "same as grid", "same row, [99, 2]"], ["shallow", "separate (2 rows)", "same row, [99, 2]"], ["deep", "separate (2 rows)", "separate row, [1, 2]"]] },
  realExample: { intro: "A function that must not change the caller's list.", code: `def top_two(scores):\n    ordered = sorted(scores, reverse=True)\n    return ordered[:2]\n\nmarks = [60, 90, 75, 85]\nprint(top_two(marks))\nprint(marks)`, out: `[90, 85]\n[60, 90, 75, 85]` },
  mistakes: ["Assuming <code>a[:]</code> gives a fully independent copy of a nested list.", "Using <code>.sort()</code> inside a function on an argument you must not change.", "Using <code>deepcopy</code> everywhere out of fear: it is slower; use it when the data is nested and mutable.", "Comparing with <code>is</code> to test whether two lists are equal."],
  practices: ["Say in a comment whether a function modifies its argument.", "Return new lists instead of mutating where practical.", "Use tuples or <code>frozenset</code> for data that must not change."],
  interview: ["Shallow vs deep copy?", "What does b = a do?", "How do you copy a list of lists?", "Why can a function change a list passed to it?"],
  practiceQs: ["After b = a[:], does b.append(1) change a?", "For a = [[1], [2]] and b = a.copy(), what happens to a after b[0].append(9)?", "Write a function that returns the sorted list without changing the input."],
  revision: ["b = a is an alias.", "copy/[:]/list() = shallow.", "deepcopy = fully independent.", "Functions get references."],
  hinglish: "b = a sirf doosra naam hai. a.copy() sirf bahar wali list ki copy banata hai, andar ki lists share rehti hain. Nested list ke liye copy.deepcopy() use karo.",
  quiz: [
    mcq("Which makes a fully independent copy of a list of lists?", ["a.copy()", "a[:]", "copy.deepcopy(a)", "list(a)"], 2, "Only deepcopy copies inner lists."),
    mcq("What is printed?\n\na = [[1], [2]]\nb = a.copy()\nb[0].append(9)\nprint(a)", ["[[1], [2]]", "[[1, 9], [2]]", "[[9], [2]]", "Error"], 1, "The inner list is shared.", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\na = [1, 2]\nb = a[:]\nb.append(3)\nprint(a)", ["[1, 2]", "[1, 2, 3]", "[3]", "Error"], 0, "A shallow copy of a flat list is independent.", "OUTPUT_PREDICTION"),
    mcq("After b = a, b.sort(), what happens to a?", ["Unchanged", "It is sorted too", "Error", "It becomes empty"], 1, "Same list object.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Independent rows", "Given grid = [[1, 2], [3, 4]], make an independent copy named copy_grid, set copy_grid[0][0] to 99, and print grid and copy_grid on one line separated by a space.", "import copy\ngrid = [[1, 2], [3, 4]]\n# make an independent copy, change it, print both\n", `import copy\ngrid = [[1, 2], [3, 4]]\ncopy_grid = copy.deepcopy(grid)\ncopy_grid[0][0] = 99\nprint(grid, copy_grid)`, [["", "[[1, 2], [3, 4]] [[99, 2], [3, 4]]"], ["", "[[1, 2], [3, 4]] [[99, 2], [3, 4]]"]], [["", "[[1, 2], [3, 4]] [[99, 2], [3, 4]]"]])],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Tuples: Immutability, Packing and Unpacking",
  minutes: 35,
  learn: ["Create tuples, including the one-item tuple", "Read tuples by index and slice", "Pack and unpack values, including swaps and returns", "Choose a tuple instead of a list"],
  why: "Tuples are the right type for fixed groups of values (a coordinate, a date, a row of a database). They are lighter than lists, hashable (so usable as dictionary keys) and communicate &quot;this will not change&quot;.",
  realWorld: "<code>(12.97, 77.59)</code> for latitude and longitude; a function that returns <code>(minimum, maximum)</code>.",
  simple: "A tuple is like a list that cannot be changed after creation: <code>(1, 2, 3)</code>. You can still read it, slice it, loop over it and unpack it into variables.",
  detail: `<h3>Creating</h3>
<p><code>(1, 2, 3)</code>, <code>1, 2, 3</code> (brackets are optional), <code>tuple([1, 2])</code>, <code>()</code> empty. A tuple of <strong>one</strong> item needs a trailing comma: <code>(5,)</code>. <code>(5)</code> is just the number 5 in brackets.</p>
<h3>Immutability</h3>
<p><code>t[0] = 9</code> raises <code>TypeError</code>. The tuple itself cannot change, but a <em>mutable item inside it</em> (a list) still can: <code>(1, [2, 3])</code>.</p>
<h3>Methods</h3>
<p>Only <code>count</code> and <code>index</code>, plus everything that reads: <code>len</code>, <code>in</code>, slicing, <code>+</code>, <code>*</code>, <code>min</code>, <code>max</code>, <code>sum</code>, <code>sorted(t)</code> (returns a list).</p>
<h3>Packing and unpacking</h3>
<p><code>point = (3, 4)</code> packs; <code>x, y = point</code> unpacks (the counts must match). <code>a, b = b, a</code> swaps by building a tuple. <code>first, *middle, last = t</code> splits a sequence. A function that <code>return a, b</code> returns one tuple that the caller can unpack.</p>
<h3>Why use a tuple?</h3>
<ul><li>Safety: nobody can change it by accident.</li><li>Hashable when all items are hashable: tuples work as dictionary keys and set members.</li><li>Slightly less memory and faster to create than lists.</li><li>Comparison is element by element: <code>(1, 5) &lt; (2, 0)</code> is True.</li></ul>`,
  syntax: { code: `t = (1, 2, 3)\nsingle = (5,)\nx, y = (3, 4)\nfirst, *rest = t\ndef bounds(a): return min(a), max(a)`, note: "The comma makes the tuple, not the brackets." },
  diagram: graph("Tuple versus list", "Two boxes: a list that allows append, remove and item assignment, and a tuple that allows only reading and unpacking.", 600, 170,
    [{ id: "l", k: "proc", t: "list [1, 2, 3]\nappend, remove, a[0] = 9", x: 160, y: 85, w: 250, h: 70 }, { id: "t", k: "proc", t: "tuple (1, 2, 3)\nread, slice, unpack only", x: 450, y: 85, w: 240, h: 70 }], []),
  example: { code: `t = (10, 20, 30)\nprint(t[0], t[-1], t[1:])\nsingle = (5,)\nprint(type(single), type((5)))\nx, y = 3, 4\nx, y = y, x\nprint(x, y)\nfirst, *rest = (1, 2, 3, 4)\nprint(first, rest)\ntry:\n    t[0] = 99\nexcept TypeError:\n    print("tuples cannot change")\npoints = {(0, 0): "origin", (1, 2): "A"}\nprint(points[(1, 2)])\nprint((1, 5) < (2, 0))`, out: `10 30 (20, 30)\n<class 'tuple'> <class 'int'>\n4 3\n1 [2, 3, 4]\ntuples cannot change\nA\nTrue` },
  lineByLine: [["t[1:]", "Slicing a tuple gives a tuple."], ["(5,) and (5)", "The comma creates a tuple; brackets alone do not."], ["x, y = y, x", "Swap through a temporary tuple."], ["first, *rest = ...", "The starred name collects a <em>list</em> of the remaining items."], ["points[(1, 2)]", "A tuple is a valid dictionary key because it is hashable."], ["(1, 5) < (2, 0)", "Compares the first items first: 1 < 2 decides."]],
  dryRun: { intro: "Swapping with <code>x, y = y, x</code> when x = 3 and y = 4:", headers: ["Step", "Right side", "x", "y"], rows: [["start", "-", "3", "4"], ["evaluate", "(4, 3)", "3", "4"], ["assign", "-", "4", "3"]] },
  realExample: { intro: "A function returning several values as one tuple.", code: `def stats(numbers):\n    return min(numbers), max(numbers), sum(numbers) / len(numbers)\n\nlow, high, average = stats([4, 8, 6])\nprint(low, high, average)\nprint(stats([4, 8, 6]))`, out: `4 8 6.0\n(4, 8, 6.0)` },
  mistakes: ["Writing <code>(5)</code> and expecting a tuple.", "Unpacking with the wrong number of names (ValueError).", "Believing a tuple holding a list is fully frozen.", "Using a tuple for data that you will keep changing.", "Trying to <code>append</code> to a tuple."],
  practices: ["Use tuples for fixed records and as dictionary keys.", "Name unpacked values meaningfully instead of indexing <code>result[0]</code>.", "Use <code>collections.namedtuple</code> or a dataclass when a record has many fields (Modules 10 and 11)."],
  interview: ["Difference between list and tuple?", "How do you create a tuple with one element?", "Can a tuple be a dictionary key? When not?", "What does a, b = b, a do internally?"],
  practiceQs: ["What is (1, 2) + (3,)?", "Unpack (1, 2, 3, 4, 5) into first, last and the middle items.", "Why can (1, [2]) not be a dictionary key?", "Return the quotient and remainder of a division from one function."],
  revision: ["Immutable ordered sequence.", "One item: (5,).", "Pack and unpack; swap; *rest.", "Hashable if its items are."],
  hinglish: "Tuple list jaisa hota hai lekin banane ke baad badal nahi sakte. Ek item ke tuple mein comma zaroori hai: (5,). x, y = y, x se swap hota hai. Tuple dictionary ki key ban sakta hai, list nahi.",
  quiz: [
    mcq("What is type((5))?", ["tuple", "int", "list", "str"], 1, "Brackets alone do not make a tuple.", "OUTPUT_PREDICTION"),
    mcq("What happens with t = (1, 2); t[0] = 9?", ["t becomes (9, 2)", "TypeError", "ValueError", "Nothing"], 1, "Tuples are immutable."),
    mcq("What is printed?\n\na, *b = (1, 2, 3)\nprint(b)", ["[2, 3]", "(2, 3)", "2", "Error"], 0, "The starred name collects a list.", "OUTPUT_PREDICTION"),
    mcq("Which can be a dictionary key?", ["[1, 2]", "(1, 2)", "{1, 2}", "{'a': 1}"], 1, "Only hashable objects can be keys."),
    mcq("What is (1, 2, 3)[1:]?", ["(2, 3)", "[2, 3]", "(1, 2)", "2"], 0, "A slice of a tuple is a tuple.", "OUTPUT_PREDICTION"),
  ],
  tasks: [task("Smallest and largest", "Read a line of integers. Print a tuple holding the smallest and the largest, exactly as Python shows a tuple, for example (1, 5).", "nums = list(map(int, input().split()))\n# print (smallest, largest)\n", `nums = list(map(int, input().split()))\nprint((min(nums), max(nums)))`, [["3 1 4 1 5", "(1, 5)"], ["7", "(7, 7)"]], [["3 1 4 1 5", "(1, 5)"], ["7", "(7, 7)"], ["-4 0 9", "(-4, 9)"], ["2 2 2", "(2, 2)"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Sets: Unique Items and Set Operations",
  minutes: 40,
  learn: ["Create sets and remove duplicates", "Add and remove items safely", "Use union, intersection, difference and symmetric difference", "Write set comprehensions and know the speed advantage"],
  why: "Sets answer &quot;is it in there?&quot; instantly and make duplicates disappear. They map directly onto membership, uniqueness and Venn-diagram questions.",
  realWorld: "Students enrolled in both Python and SQL (intersection); emails that appear in either list (union); tags with duplicates removed.",
  simple: "A set is an unordered collection with no duplicates: <code>{1, 2, 3}</code>. You cannot index it, but you can test membership very fast and combine sets with mathematical operators.",
  detail: `<h3>Creating</h3>
<p><code>{1, 2, 3}</code>; <code>set([1, 1, 2])</code> gives <code>{1, 2}</code>; <code>set("hello")</code>. An empty set must be written <code>set()</code>: <code>{}</code> is an empty <em>dictionary</em>.</p>
<h3>Rules</h3>
<ul><li>Items must be <strong>hashable</strong> (numbers, strings, tuples of those). Lists and dicts are not allowed inside a set.</li><li><strong>No order</strong> and no indexes. Do not rely on the printing order; use <code>sorted(s)</code> when you need a stable display.</li></ul>
<h3>Changing</h3>
<p><code>s.add(x)</code>; <code>s.discard(x)</code> (no error if missing); <code>s.remove(x)</code> (KeyError if missing); <code>s.pop()</code> removes an arbitrary item; <code>s.update(other)</code>; <code>s.clear()</code>.</p>
<h3>Set algebra</h3>
${table(["Operation", "Operator", "Method", "Meaning"], [["Union", "<code>a | b</code>", "<code>a.union(b)</code>", "in a or b"], ["Intersection", "<code>a &amp; b</code>", "<code>a.intersection(b)</code>", "in both"], ["Difference", "<code>a - b</code>", "<code>a.difference(b)</code>", "in a but not b"], ["Symmetric difference", "<code>a ^ b</code>", "<code>a.symmetric_difference(b)</code>", "in exactly one"], ["Subset", "<code>a &lt;= b</code>", "<code>a.issubset(b)</code>", "every item of a is in b"], ["Disjoint", "-", "<code>a.isdisjoint(b)</code>", "nothing in common"]])}
<h3>Speed</h3>
<p>Adding, removing and testing membership take O(1) time on average because sets use hashing. <code>x in my_list</code> is O(n). Turning a list into a set to test membership many times is a very common speed-up.</p>
<p>Set comprehension: <code>{c.lower() for c in text if c.isalpha()}</code>. <code>frozenset</code> is an immutable set that can be a dictionary key.</p>`,
  syntax: { code: `s = {1, 2, 3}\nempty = set()\ns.add(4)   s.discard(9)\na | b   a & b   a - b   a ^ b\nuniq = set(items)`, note: "{} is an empty dict, not an empty set." },
  diagram: ((() => { const inner = `<circle cx="230" cy="110" r="85" fill="rgba(56,139,253,.18)" stroke="currentColor" stroke-width="1.6"/><circle cx="350" cy="110" r="85" fill="rgba(46,160,67,.18)" stroke="currentColor" stroke-width="1.6"/>` + t(190, 100, "A only") + t(190, 120, "{1, 2}") + t(290, 100, "both") + t(290, 120, "{3, 4}") + t(390, 100, "B only") + t(390, 120, "{5}") + t(160, 30, "A = {1, 2, 3, 4}", 13) + t(420, 30, "B = {3, 4, 5}", 13) + t(290, 215, "A & B = {3, 4}   A | B = {1..5}   A - B = {1, 2}   A ^ B = {1, 2, 5}", 12); return svgWrap(580, 230, "Venn diagram of two sets", "Two overlapping circles: A only holds 1 and 2, the overlap holds 3 and 4, B only holds 5.", inner); })()),
  example: { code: `a = {1, 2, 3, 4}\nb = {3, 4, 5}\nprint(sorted(a | b), sorted(a & b), sorted(a - b), sorted(a ^ b))\nprint({1, 2} <= a, a.isdisjoint({9}))\nnames = ["asha", "ravi", "asha", "zoya", "ravi"]\nprint(sorted(set(names)), len(set(names)))\nseen = set()\nseen.add(7)\nseen.discard(100)\nprint(7 in seen, 8 in seen)\nprint(sorted({ch for ch in "Hello World" if ch.isalpha()}))`, out: `[1, 2, 3, 4, 5] [3, 4] [1, 2] [1, 2, 5]\nTrue True\n['asha', 'ravi', 'zoya'] 3\nTrue False\n['H', 'W', 'd', 'e', 'l', 'o', 'r']` },
  lineByLine: [["a | b, a & b, a - b, a ^ b", "Union, intersection, difference and symmetric difference (sorted only to give a fixed print order)."], ["{1, 2} <= a", "A subset test."], ["set(names)", "Duplicates vanish."], ["seen.discard(100)", "Silently does nothing when the item is absent."], ["{ch for ch in ... if ch.isalpha()}", "A set comprehension of the distinct letters."]],
  dryRun: { intro: "Building <code>a ^ b</code> (in exactly one set):", headers: ["Item", "in a", "in b", "kept"], rows: [["1", "yes", "no", "yes"], ["2", "yes", "no", "yes"], ["3", "yes", "yes", "no"], ["4", "yes", "yes", "no"], ["5", "no", "yes", "yes"]] },
  realExample: { intro: "Who attends both clubs, and who attends only one?", code: `coding_club = {"Asha", "Ravi", "Zoya", "Kiran"}\nrobotics_club = {"Ravi", "Meera", "Kiran"}\nprint(sorted(coding_club & robotics_club))\nprint(sorted(coding_club ^ robotics_club))\nprint(len(coding_club | robotics_club))`, out: `['Kiran', 'Ravi']\n['Asha', 'Meera', 'Zoya']\n5` },
  mistakes: ["Writing <code>{}</code> for an empty set.", "Expecting a set to keep order or support <code>s[0]</code>.", "Printing a set and expecting a fixed order in a judged program; use <code>sorted()</code>.", "Putting a list inside a set (unhashable).", "Using <code>remove</code> when the item may be absent (use <code>discard</code>)."],
  practices: ["Convert to a set for repeated membership tests on large data.", "Use <code>sorted(set(x))</code> for sorted unique values.", "Use set operators instead of loops for overlap questions."],
  interview: ["How do you remove duplicates from a list, and does it keep the order?", "Why is x in a set faster than in a list?", "What does {} create?", "Difference between remove and discard?"],
  practiceQs: ["Find the common items of two lists.", "Count the distinct characters in a string.", "Which items are in a but not in b?", "Why can't [1, 2] be in a set?"],
  revision: ["Unique, unordered, hashable items.", "| & - ^ and <=.", "add/discard/remove/pop.", "O(1) average membership."],
  hinglish: "Set mein duplicate nahi hote aur order nahi hota. {} khali dictionary banata hai, khali set ke liye set() likho. a & b dono mein common, a | b dono ka jod, a - b sirf a mein, a ^ b sirf ek mein.",
  quiz: [
    mcq("What does {} create?", ["An empty set", "An empty dictionary", "An empty list", "A syntax error"], 1, "Use set() for an empty set.", "OUTPUT_PREDICTION"),
    mcq("What is len(set([1, 1, 2, 3, 3]))?", ["5", "3", "2", "4"], 1, "The distinct items are 1, 2, 3.", "OUTPUT_PREDICTION"),
    mcq("What is {1, 2, 3} & {2, 3, 4}?", ["{2, 3}", "{1, 4}", "{1, 2, 3, 4}", "{1}"], 0, "Items in both.", "OUTPUT_PREDICTION"),
    mcq("Which set method does not raise an error for a missing item?", ["remove", "discard", "pop on empty", "index"], 1, "discard ignores a missing item."),
    mcq("Which cannot be an item of a set?", ["(1, 2)", "\"abc\"", "[1, 2]", "42"], 2, "Lists are unhashable."),
  ],
  tasks: [task("Common and total", "Read two lines of integers. On the first output line print the sorted common values (the intersection) separated by spaces; on the second print how many distinct values appear in total (the union).", "a = set(map(int, input().split()))\nb = set(map(int, input().split()))\n# line 1: sorted common values, line 2: size of the union\n", `a = set(map(int, input().split()))\nb = set(map(int, input().split()))\nprint(" ".join(map(str, sorted(a & b))))\nprint(len(a | b))`, [["1 2 3 4\n3 4 5", "3 4\n5"], ["10 20 30\n30 20 40 50", "20 30\n5"]], [["1 2 3 4\n3 4 5", "3 4\n5"], ["10 20 30\n30 20 40 50", "20 30\n5"], ["1 1 2\n2 2 3", "2\n3"], ["5 6\n6 5", "5 6\n2"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Dictionaries: Keys, Values and Everyday Operations",
  minutes: 45,
  learn: ["Create dictionaries and read, add, update and remove entries", "Use get, setdefault, update, pop and items safely", "Loop over keys, values and pairs", "Count and group data with a dictionary"],
  why: "A dictionary connects a key to a value and finds it instantly: roll number to student, word to count, product to price. It is the most useful data structure in everyday Python.",
  realWorld: "A phone book, a word-frequency table, a JSON record from an API, a settings file.",
  simple: "A dictionary stores <strong>key: value</strong> pairs: <code>{'name': 'Asha', 'age': 20}</code>. Look up a value with its key: <code>d['name']</code>.",
  detail: `<h3>Basics</h3>
<ul><li>Keys must be unique and hashable (strings, numbers, tuples). Values can be anything.</li><li>Since Python 3.7 a dictionary <strong>remembers insertion order</strong>.</li><li><code>d[key]</code> raises <code>KeyError</code> when the key is missing; <code>d.get(key)</code> returns <code>None</code>, or a default you give: <code>d.get(key, 0)</code>.</li><li><code>key in d</code> tests keys (not values) in O(1) average time.</li></ul>
${table(["Task", "Code"], [["Create", "<code>d = {}</code>, <code>dict(a=1)</code>, <code>dict(zip(keys, values))</code>"], ["Add / update", "<code>d[k] = v</code>, <code>d.update({k: v})</code>"], ["Read safely", "<code>d.get(k, default)</code>"], ["Add if absent", "<code>d.setdefault(k, default)</code>"], ["Remove", "<code>del d[k]</code>, <code>d.pop(k, default)</code>, <code>d.popitem()</code> (last pair)"], ["Views", "<code>d.keys()</code>, <code>d.values()</code>, <code>d.items()</code>"], ["Merge (3.9+)", "<code>d1 | d2</code> (right side wins on clashes)"]])}
<h3>Looping</h3>
<p><code>for k in d</code> gives keys; <code>for k, v in d.items()</code> gives pairs (the usual choice). Do not add or remove keys while looping over the same dictionary.</p>
<h3>Counting pattern</h3>
<p><code>counts[w] = counts.get(w, 0) + 1</code> counts occurrences without a KeyError. (Module 11 introduces <code>collections.Counter</code> and <code>defaultdict</code>, which do the same more briefly.)</p>`,
  syntax: { code: `d = {"name": "Asha", "age": 20}\nd["city"] = "Pune"\nd.get("phone", "n/a")\nfor key, value in d.items():\n    ...\ncounts[w] = counts.get(w, 0) + 1`, note: "get avoids KeyError." },
  diagram: graph("A dictionary maps keys to values", "Three keys name, age and city on the left each pointing to a value on the right: Asha, 20 and Pune.", 560, 200,
    [{ id: "k1", k: "term", t: "\"name\"", x: 110, y: 40, w: 120, h: 38 }, { id: "k2", k: "term", t: "\"age\"", x: 110, y: 100, w: 120, h: 38 }, { id: "k3", k: "term", t: "\"city\"", x: 110, y: 160, w: 120, h: 38 }, { id: "v1", k: "proc", t: "\"Asha\"", x: 400, y: 40, w: 120, h: 38 }, { id: "v2", k: "proc", t: "20", x: 400, y: 100, w: 120, h: 38 }, { id: "v3", k: "proc", t: "\"Pune\"", x: 400, y: 160, w: 120, h: 38 }],
    [{ from: "k1", to: "v1" }, { from: "k2", to: "v2" }, { from: "k3", to: "v3" }]),
  example: { code: `d = {"name": "Asha", "age": 20}\nd["city"] = "Pune"\nd["age"] += 1\nprint(d)\nprint(d.get("phone"), d.get("phone", "n/a"))\nprint("name" in d, "Asha" in d)\nfor key, value in d.items():\n    print(key, "->", value)\nremoved = d.pop("city")\nprint(removed, list(d))\ncounts = {}\nfor w in "a b a c b a".split():\n    counts[w] = counts.get(w, 0) + 1\nprint(counts)\nprint({"x": 1} | {"y": 2, "x": 9})`, out: `{'name': 'Asha', 'age': 21, 'city': 'Pune'}\nNone n/a\nTrue False\nname -> Asha\nage -> 21\ncity -> Pune\nPune ['name', 'age']\n{'a': 3, 'b': 2, 'c': 1}\n{'x': 9, 'y': 2}` },
  lineByLine: [["d[\"city\"] = \"Pune\"", "Assigning to a new key adds it; to an existing key, replaces its value."], ["d.get(\"phone\", \"n/a\")", "No KeyError; returns the default."], ["\"Asha\" in d", "False: <code>in</code> checks keys, not values."], ["for key, value in d.items()", "Unpacks each pair."], ["counts.get(w, 0) + 1", "Starts a new word at 0 and adds one."], ["{\"x\": 1} | {\"y\": 2, \"x\": 9}", "Merge: the right side wins for the clashing key."]],
  dryRun: { intro: "Counting the words of <code>a b a c b a</code>:", headers: ["word", "get(word, 0)", "new count"], rows: [["a", "0", "1"], ["b", "0", "1"], ["a", "1", "2"], ["c", "0", "1"], ["b", "1", "2"], ["a", "2", "3"]] },
  realExample: { intro: "A price list: look up, update and total an order.", code: `prices = {"pen": 10, "book": 250, "bag": 800}\norder = {"pen": 3, "bag": 1}\ntotal = 0\nfor item, qty in order.items():\n    total += prices[item] * qty\nprices["pen"] = 12\nprint(total)\nprint(prices["pen"] * order["pen"])`, out: `830\n36` },
  mistakes: ["Using <code>d[key]</code> for a key that may not exist.", "Expecting <code>value in d</code> to search values.", "Using a list as a key.", "Changing the dictionary's size while iterating over it.", "Writing duplicate keys in a literal; the last one silently wins."],
  practices: ["Use <code>get</code> or <code>in</code> when a key may be missing.", "Loop with <code>items()</code>.", "Choose meaningful, consistent key names.", "Use a dictionary instead of parallel lists."],
  interview: ["What happens on d[missing]?", "Is a dictionary ordered?", "How would you count word frequencies?", "Difference between pop and del?"],
  practiceQs: ["Invert {\"a\": 1, \"b\": 2}.", "Merge two dictionaries; what if keys clash?", "Print the keys sorted.", "What does d.get(\"x\") return for a missing key?"],
  revision: ["key: value pairs, insertion ordered, hashable keys.", "get / setdefault / update / pop / items.", "in tests keys.", "Counting: counts[k] = counts.get(k, 0) + 1."],
  hinglish: "Dictionary key: value ke jode rakhti hai. d[key] na milne par KeyError deta hai, d.get(key, default) nahi. for k, v in d.items() se saare jode milte hain. Gine jaane ke liye counts[w] = counts.get(w, 0) + 1 likhte hain.",
  quiz: [
    mcq("What does d.get(\"x\") return if \"x\" is missing?", ["KeyError", "None", "0", "\"\""], 1, "get returns None (or your default).", "OUTPUT_PREDICTION"),
    mcq("What is printed?\n\nd = {\"a\": 1}\nprint(1 in d)", ["True", "False", "Error", "None"], 1, "in checks keys; the only key is \"a\".", "OUTPUT_PREDICTION"),
    mcq("What is list({\"x\": 1, \"y\": 2})?", ["[1, 2]", "['x', 'y']", "[('x', 1), ('y', 2)]", "Error"], 1, "Iterating a dictionary gives its keys.", "OUTPUT_PREDICTION"),
    mcq("What does {\"a\": 1} | {\"a\": 2} give (Python 3.9+)?", ["{'a': 1}", "{'a': 2}", "{'a': 3}", "Error"], 1, "The right-hand side wins.", "OUTPUT_PREDICTION"),
    mcq("Which cannot be a dictionary key?", ["\"name\"", "42", "(1, 2)", "[1, 2]"], 3, "Lists are unhashable."),
  ],
  tasks: [task("Word frequency", "Read a line of words. Print each distinct word with its count, one per line in the order of first appearance, in the form word count.", "words = input().split()\n# count with a dictionary and print in order of first appearance\n", `words = input().split()\ncounts = {}\nfor w in words:\n    counts[w] = counts.get(w, 0) + 1\nfor w, c in counts.items():\n    print(w, c)`, [["a b a c b a", "a 3\nb 2\nc 1"], ["to be or not to be", "to 2\nbe 2\nor 1\nnot 1"]], [["a b a c b a", "a 3\nb 2\nc 1"], ["to be or not to be", "to 2\nbe 2\nor 1\nnot 1"], ["one", "one 1"], ["x x x", "x 3"]])],
});

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Nested Dictionaries, Comprehensions and Real-World Data",
  minutes: 45,
  learn: ["Model records with dictionaries of dictionaries and lists of dictionaries", "Sort and filter records", "Write dictionary comprehensions", "Read and build JSON-like data"],
  why: "Data from files and web APIs arrives as nested dictionaries and lists. Handling that shape confidently is a core job skill.",
  realWorld: "A list of student records, each with name, marks and subjects; a JSON response from a weather API.",
  simple: "A dictionary value can itself be a dictionary or a list. Reach inside with one key per level: <code>students['asha']['marks'][0]</code>.",
  detail: `<h3>Shapes you will meet</h3>
${table(["Shape", "Example", "Use"], [["dict of dicts", "<code>{\"s1\": {\"name\": \"Asha\", \"marks\": 80}}</code>", "Lookup by id"], ["list of dicts", "<code>[{\"name\": \"Asha\"}, {\"name\": \"Ravi\"}]</code>", "Rows of a table; most JSON arrays"], ["dict of lists", "<code>{\"Asha\": [70, 80]}</code>", "Grouping"]])}
<h3>Safe deep access</h3>
<p>Use <code>get</code> at each level when keys may be missing: <code>d.get("address", {}).get("city", "unknown")</code>.</p>
<h3>Sorting records</h3>
<p>Sort a list of dictionaries with a key function. A small <code>lambda</code> (Module 8) is typical: <code>sorted(rows, key=lambda r: r["marks"])</code>. For a dictionary use <code>sorted(d, key=d.get)</code> to order the keys by value.</p>
<h3>Dictionary comprehension</h3>
<p><code>{k: v for k, v in pairs}</code>, for example <code>{n: n * n for n in range(4)}</code>, or filtering <code>{k: v for k, v in d.items() if v &gt; 50}</code>. To invert a one-to-one mapping: <code>{v: k for k, v in d.items()}</code>.</p>
<h3>Grouping</h3>
<p><code>groups.setdefault(key, []).append(item)</code> creates the list the first time a key appears.</p>
<h3>JSON</h3>
<p>JSON maps closely to Python: object &rarr; dict, array &rarr; list, string, number, <code>true</code>/<code>false</code> &rarr; <code>True</code>/<code>False</code>, <code>null</code> &rarr; <code>None</code>. The <code>json</code> module converts between text and Python objects (Module 9).</p>`,
  syntax: { code: `rows = [{"name": "Asha", "marks": 80}]\nrows.sort(key=lambda r: r["marks"])\nsquares = {n: n * n for n in range(4)}\ngroups.setdefault(k, []).append(x)`, note: "Reach nested values one key at a time." },
  diagram: chain("Reading a nested record", "Top to bottom: the dictionary students, then the key asha giving a record, then the key marks giving a list, then index 0 giving 80.",
    [{ k: "proc", t: "students" }, { k: "proc", t: "[\"asha\"]  -> record dict" }, { k: "proc", t: "[\"marks\"]  -> list [80, 90]" }, { k: "term", t: "[0]  -> 80" }], { vertical: true, w: 230, hgt: 38, gap: 22 }),
  example: { code: `students = {\n    "s1": {"name": "Asha", "marks": [80, 90]},\n    "s2": {"name": "Ravi", "marks": [70, 60]},\n}\nprint(students["s1"]["marks"][0])\nprint(students.get("s9", {}).get("name", "unknown"))\naverages = {sid: sum(s["marks"]) / len(s["marks"]) for sid, s in students.items()}\nprint(averages)\nprint(sorted(averages, key=averages.get, reverse=True))\nrows = [{"n": "b", "m": 2}, {"n": "a", "m": 2}, {"n": "c", "m": 1}]\nrows.sort(key=lambda r: (-r["m"], r["n"]))\nprint([r["n"] for r in rows])\ngroups = {}\nfor word in ["apple", "avocado", "banana", "blueberry", "cherry"]:\n    groups.setdefault(word[0], []).append(word)\nprint(groups)`, out: `80\nunknown\n{'s1': 85.0, 's2': 65.0}\n['s1', 's2']\n['a', 'b', 'c']\n{'a': ['apple', 'avocado'], 'b': ['banana', 'blueberry'], 'c': ['cherry']}` },
  lineByLine: [["students[\"s1\"][\"marks\"][0]", "Three lookups in a row: dictionary, key, list index."], ["students.get(\"s9\", {}).get(\"name\", \"unknown\")", "Safe access: a missing record becomes an empty dictionary."], ["{sid: sum(...) / len(...) for ...}", "A dictionary comprehension computing each average."], ["sorted(averages, key=averages.get, reverse=True)", "Keys ordered by their values, highest first."], ["rows.sort(key=lambda r: (-r[\"m\"], r[\"n\"]))", "Sort by marks descending, then name ascending, using a tuple key."], ["groups.setdefault(word[0], []).append(word)", "Creates the list for a new letter, then appends."]],
  dryRun: { intro: "Grouping by first letter:", headers: ["word", "key", "groups after"], rows: [["apple", "a", "{'a': ['apple']}"], ["avocado", "a", "{'a': ['apple', 'avocado']}"], ["banana", "b", "adds 'b': ['banana']"], ["blueberry", "b", "'b' gets blueberry"], ["cherry", "c", "adds 'c': ['cherry']"]] },
  realExample: { intro: "Filter and invert dictionaries.", code: `marks = {"Asha": 82, "Ravi": 45, "Zoya": 67}\npassed = {name: m for name, m in marks.items() if m >= 50}\nprint(passed)\ncode_to_name = {"A1": "Asha", "R2": "Ravi"}\nprint({name: code for code, name in code_to_name.items()})`, out: `{'Asha': 82, 'Zoya': 67}\n{'Asha': 'A1', 'Ravi': 'R2'}` },
  mistakes: ["Indexing deep without checking that each level exists.", "Mutating the list of dictionaries while looping over it.", "Inverting a mapping with duplicate values: later keys overwrite earlier ones.", "Sharing one dictionary object between rows by repeating it (<code>[row] * 3</code>).", "Sorting dictionaries directly (<code>sorted(rows)</code> raises TypeError)."],
  practices: ["Keep records as dictionaries with consistent keys.", "Use comprehensions for simple filters and transformations only.", "Validate external data before indexing into it."],
  interview: ["How do you sort a list of dictionaries by a field?", "How do you group items by a key?", "How do you access a nested value safely?", "How does JSON map to Python types?"],
  practiceQs: ["Build {n: n**3} for n in 1..4.", "Filter a dictionary to keys that start with a vowel.", "Find the student with the highest total mark.", "What does {v: k for k, v in {\"a\": 1, \"b\": 1}.items()} return?"],
  revision: ["Nested access: one key per level.", "get(key, {}) for safe depth.", "{k: v for ...}.", "setdefault for grouping; sort with key."],
  hinglish: "Dictionary ke andar dictionary ya list ho sakti hai, ek ek key se andar jaate hain. Safe access ke liye har level par get use karo. Group banane ke liye setdefault(key, []).append(item) bahut kaam aata hai.",
  quiz: [
    mcq("How do you read 80 from d = {\"a\": {\"m\": [80, 90]}}?", ["d[\"a\"][\"m\"][0]", "d[\"a\", \"m\", 0]", "d.a.m[0]", "d[0][\"a\"]"], 0, "One lookup per level."),
    mcq("What is {n: n * n for n in range(3)}?", ["{0: 0, 1: 1, 2: 4}", "[0, 1, 4]", "{1: 1, 2: 4, 3: 9}", "Error"], 0, "A dictionary comprehension.", "OUTPUT_PREDICTION"),
    mcq("What does {v: k for k, v in {\"a\": 1, \"b\": 1}.items()} give?", ["{1: 'a'}", "{1: 'b'}", "{1: ['a', 'b']}", "Error"], 1, "Duplicate values overwrite: the last key wins.", "OUTPUT_PREDICTION"),
    mcq("What does sorted(d, key=d.get) sort?", ["The keys by their values", "The values only", "The items by key", "Nothing"], 0, "key=d.get looks up each key's value."),
    mcq("JSON null becomes which Python value?", ["0", "None", "\"\"", "False"], 1, "null maps to None."),
  ],
  tasks: [task("Top student", "Read n, then n lines in the form name mark. Print the name of the student with the highest mark (if several tie, print the one who appeared first).", "n = int(input())\n# read the records and print the name with the highest mark\n", `n = int(input())\nbest_name = None\nbest_mark = None\nfor _ in range(n):\n    name, mark = input().split()\n    mark = int(mark)\n    if best_mark is None or mark > best_mark:\n        best_name, best_mark = name, mark\nprint(best_name)`, [["3\nAsha 80\nRavi 92\nZoya 75", "Ravi"], ["2\nA 5\nB 5", "A"]], [["3\nAsha 80\nRavi 92\nZoya 75", "Ravi"], ["2\nA 5\nB 5", "A"], ["1\nKiran 0", "Kiran"], ["4\na 1\nb 3\nc 3\nd 2", "b"]])],
});

// ---------------------------------------------------------------- 8
lessons.push({
  title: "Choosing the Right Collection: Use Cases and Performance",
  minutes: 40,
  learn: ["Compare list, tuple, set and dictionary side by side", "Choose by the question you need answered", "Know the cost of common operations", "Remove duplicates while keeping order"],
  why: "Picking the wrong collection is the most common cause of slow or clumsy code. A short decision guide saves hours later.",
  realWorld: "A login system needs fast &quot;does this user exist?&quot; checks (set/dict); a playlist needs order (list); a map pin needs a fixed pair (tuple).",
  simple: "Ask: do I need order? duplicates? changes? lookup by key? The answers point to exactly one of the four collections.",
  detail: `${table(["", "list", "tuple", "set", "dict"], [["Ordered", "yes", "yes", "no", "yes (insertion)"], ["Duplicates", "yes", "yes", "no", "keys unique"], ["Changeable", "yes", "no", "yes", "yes"], ["Index / key access", "by position", "by position", "no", "by key"], ["Hashable (can be a key)", "no", "if items are", "no (frozenset yes)", "no"], ["Typical use", "sequence of items", "fixed record", "uniqueness, membership, set maths", "lookup table, counting, records"]])}
<h3>Cost of common operations (average)</h3>
${table(["Operation", "list", "set / dict"], [["x in c", "O(n)", "O(1)"], ["add at end / add key", "O(1)", "O(1)"], ["insert at front", "O(n)", "-"], ["remove a value", "O(n)", "O(1)"], ["index by position / key", "O(1)", "O(1) by key"], ["iterate everything", "O(n)", "O(n)"]])}
<h3>Decision guide</h3>
<ul><li>Need the order and may add or remove items: <strong>list</strong>.</li><li>Fixed group of values, or a dictionary key made of several parts: <strong>tuple</strong>.</li><li>Only care whether something is present, or need to drop duplicates: <strong>set</strong>.</li><li>Look something up by name or id, count occurrences, store records: <strong>dict</strong>.</li></ul>
<h3>Remove duplicates but keep the order</h3>
<p><code>list(dict.fromkeys(items))</code> works because dictionaries keep insertion order and keys are unique. <code>set(items)</code> removes duplicates but loses the order.</p>
<p>Other tools (Modules 11 and 15): <code>collections.deque</code> for fast queues, <code>Counter</code> for counting, <code>heapq</code> for priorities, arrays for numbers.</p>`,
  syntax: { code: `unique = list(dict.fromkeys(items))   # keeps order\nlookup = set(big_list)               # fast membership\ncounts = {}                          # counting`, note: "Convert once, test many times." },
  diagram: graph("Which collection?", "Decision tree: need lookup by key? yes dict. no: need uniqueness only? yes set. no: will it change? yes list, no tuple.", 620, 290,
    [{ id: "q1", k: "dec", t: "lookup by\nkey?", x: 130, y: 50, w: 150, h: 64 }, { id: "d", k: "io", t: "dict", x: 400, y: 50, w: 100, h: 38 }, { id: "q2", k: "dec", t: "uniqueness or\nmembership only?", x: 130, y: 140, w: 180, h: 64 }, { id: "s", k: "io", t: "set", x: 400, y: 140, w: 100, h: 38 }, { id: "q3", k: "dec", t: "will it\nchange?", x: 130, y: 225, w: 150, h: 56 }, { id: "l", k: "io", t: "list", x: 330, y: 215, w: 90, h: 34 }, { id: "t", k: "io", t: "tuple", x: 330, y: 255, w: 90, h: 30 }],
    [{ from: "q1", to: "d", label: "yes" }, { from: "q1", to: "q2", label: "no" }, { from: "q2", to: "s", label: "yes" }, { from: "q2", to: "q3", label: "no" }, { from: "q3", to: "l", label: "yes" }, { from: "q3", to: "t", label: "no" }]),
  example: { code: `items = [3, 1, 3, 2, 1]\nprint(sorted(set(items)))\nprint(list(dict.fromkeys(items)))\nbig = list(range(100000))\nlookup = set(big)\nprint(99999 in lookup, 100000 in lookup)\nprint(len({}), len(set()), len(()), len([]))\nprices = {"pen": 10}\nprint(prices.get("pen"), "pen" in prices)`, out: `[1, 2, 3]\n[3, 1, 2]\nTrue False\n0 0 0 0\n10 True` },
  lineByLine: [["sorted(set(items))", "Unique values, ordered."], ["list(dict.fromkeys(items))", "Unique values in first-seen order."], ["set(big)", "Built once in O(n); every later test is O(1)."], ["len({}), len(set()), ...", "Four different empty collections."]],
  dryRun: { intro: "<code>dict.fromkeys([3, 1, 3, 2, 1])</code> step by step:", headers: ["item", "already a key?", "keys so far"], rows: [["3", "no", "3"], ["1", "no", "3, 1"], ["3", "yes (ignored)", "3, 1"], ["2", "no", "3, 1, 2"], ["1", "yes (ignored)", "3, 1, 2"]] },
  realExample: { intro: "Why a set makes a repeated check faster: find which of the requested ids exist.", code: `known = {101, 102, 105, 110}\nrequested = [100, 101, 105, 111]\nfound = [r for r in requested if r in known]\nmissing = [r for r in requested if r not in known]\nprint(found)\nprint(missing)`, out: `[101, 105]\n[100, 111]` },
  mistakes: ["Using a list for membership tests on big data.", "Expecting <code>set(items)</code> to keep the order.", "Using a dictionary when a simple list is enough.", "Using a list of pairs for lookup instead of a dictionary.", "Mutating a collection that is also used as a dictionary key (impossible for tuples of immutables, which is the point)."],
  practices: ["Decide by the operations you will perform most.", "Convert once outside the loop.", "Keep it simple: a list is the default."],
  interview: ["When would you pick a set over a list?", "How do you remove duplicates keeping order?", "What are the average costs of lookup in a list versus a dictionary?", "Why can't a list be a key?"],
  practiceQs: ["Which collection for a stack of undo steps? for unique visitors? for a name-to-phone book?", "Why is x in my_list inside a loop O(n²) overall?", "Convert a list of pairs into a dictionary."],
  revision: ["list: ordered, mutable.", "tuple: fixed, hashable.", "set: unique, fast membership.", "dict: key lookup, counting, records.", "dict.fromkeys keeps order while deduplicating."],
  hinglish: "Order chahiye aur badalna hai to list, fixed jode ke liye tuple, sirf unique ya membership ke liye set aur key se dhoondhna ho to dict. Duplicate hatate hue order rakhna ho to list(dict.fromkeys(items)) use karo.",
  quiz: [
    mcq("Which collection is best for fast \"is this id present?\" checks on a million ids?", ["list", "tuple", "set", "string"], 2, "Hash lookup is O(1) on average."),
    mcq("What does list(dict.fromkeys([2, 1, 2])) give?", ["[2, 1]", "[1, 2]", "[2, 1, 2]", "{2, 1}"], 0, "Unique items in first-seen order.", "OUTPUT_PREDICTION"),
    mcq("Which is hashable?", ["list", "dict", "set", "tuple of ints"], 3, "Immutable tuples of hashable items are hashable."),
    mcq("Which operation is O(1) on average for a dictionary?", ["Looking up a key", "Sorting", "Printing all items", "Finding the largest value"], 0, "Key lookup is hashed."),
    mcq("A fixed pair (latitude, longitude) is best stored as a:", ["tuple", "set", "list always", "dict always"], 0, "A fixed record that never changes."),
  ],
  tasks: [task("Unique, keeping order", "Read a line of integers. Print the distinct values in the order they first appear, separated by spaces.", "nums = input().split()\n# print the unique values in first-seen order\n", `nums = input().split()\nprint(" ".join(dict.fromkeys(nums)))`, [["3 1 3 2 1", "3 1 2"], ["5 5 5", "5"]], [["3 1 3 2 1", "3 1 2"], ["5 5 5", "5"], ["1 2 3", "1 2 3"], ["9 8 9 8 7", "9 8 7"]])],
});

module.exports = {
  module: {
    title: "Phase 1 - Python Collections",
    description: "Lists, tuples, sets and dictionaries taught independently, with copying rules, comprehensions, nested data, performance and a guide to choosing the right collection.",
    chapters: [{ title: "Python Collections", description: "Storing and organising many values.", lessons }],
    assessment: {
      title: "Module 7 Assessment: Python Collections",
      description: "Collection problems: two-sum, second largest, transpose, most frequent word and symmetric difference.",
      questions: [
        task("Two sum indices", "Read a line of integers and then a target. Print the indices i and j (i smaller than j, separated by a space) of the first pair whose sum equals the target, scanning i from the start and then j from i+1.", "", `nums = list(map(int, input().split()))\ntarget = int(input())\nfound = False\nfor i in range(len(nums)):\n    for j in range(i + 1, len(nums)):\n        if nums[i] + nums[j] == target:\n            print(i, j)\n            found = True\n            break\n    if found:\n        break`, [["2 7 11 15\n9", "0 1"], ["3 2 4\n6", "1 2"]], [["2 7 11 15\n9", "0 1"], ["3 2 4\n6", "1 2"], ["3 3\n6", "0 1"], ["1 5 5 1\n6", "0 1"], ["-1 -2 -3 -4\n-6", "1 3"]]),
        task("Second largest", "Read a line of integers (at least two different values). Print the second largest distinct value.", "", `nums = set(map(int, input().split()))\nnums.discard(max(nums))\nprint(max(nums))`, [["5 3 9 9 1", "5"], ["10 20", "10"]], [["5 3 9 9 1", "5"], ["10 20", "10"], ["-1 -5 -3", "-3"], ["7 7 7 8", "7"], ["1 2 3 4 5", "4"]]),
        task("Transpose a matrix", "Read r and c on the first line (rows and columns), then r lines of c integers. Print the transpose: c lines of r integers separated by spaces.", "", `r, c = map(int, input().split())\ngrid = [input().split() for _ in range(r)]\nfor col in range(c):\n    print(" ".join(grid[row][col] for row in range(r)))`, [["2 3\n1 2 3\n4 5 6", "1 4\n2 5\n3 6"], ["1 2\n7 8", "7\n8"]], [["2 3\n1 2 3\n4 5 6", "1 4\n2 5\n3 6"], ["1 2\n7 8", "7\n8"], ["2 2\n1 2\n3 4", "1 3\n2 4"], ["3 1\n1\n2\n3", "1 2 3"]]),
        task("Most frequent word", "Read a line of words. Print the word that occurs most often; if several words tie, print the alphabetically smallest of them.", "", `words = input().split()\ncounts = {}\nfor w in words:\n    counts[w] = counts.get(w, 0) + 1\nbest = max(counts.values())\nprint(min(w for w in counts if counts[w] == best))`, [["a b a c b a", "a"], ["b a b a", "a"]], [["a b a c b a", "a"], ["b a b a", "a"], ["x", "x"], ["to be or not to be", "be"], ["z y z y x", "y"]]),
        task("Symmetric difference", "Read two lines of integers. Print the sorted values that appear in exactly one of the two lines, separated by spaces (there is always at least one).", "", `a = set(map(int, input().split()))\nb = set(map(int, input().split()))\nprint(" ".join(map(str, sorted(a ^ b))))`, [["1 2 3 4\n3 4 5", "1 2 5"], ["1 2\n2 3", "1 3"]], [["1 2 3 4\n3 4 5", "1 2 5"], ["1 2\n2 3", "1 3"], ["5\n6", "5 6"], ["1 1 2\n2 3 3", "1 3"]]),
      ],
    },
  },
};
