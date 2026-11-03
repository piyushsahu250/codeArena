// Phase 5 / Module 19, lessons 1-3: NumPy arrays, NumPy indexing and statistics, and pandas Series and DataFrames.
// Examples need numpy and pandas (installed in the course's virtual environment; verified with NumPy 2.5 and pandas 3.1). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "NumPy Arrays: Vectorised Maths and Broadcasting",
  minutes: 55,
  learn: ["Create NumPy arrays and read their shape, dtype and size", "Replace Python loops with vectorised operations", "Use broadcasting to combine arrays of different shapes", "Know the difference between a view and a copy"],
  why: "NumPy is the base of almost all Python data science: pandas, scikit-learn, Matplotlib and deep-learning libraries all use its arrays. Vectorised code is shorter and often tens of times faster than a Python loop.",
  realWorld: "A shop computes the bill for thousands of orders by multiplying a price array by a quantity array, adds 18 percent tax to all of them in one line, and applies a discount only where the total is large.",
  simple: "A NumPy <strong>array</strong> is a grid of numbers that all have the <em>same type</em>. An operation such as <code>prices * quantity</code> is applied to every element at once, in fast compiled code, with no explicit loop.",
  detail: `<p><strong>Install:</strong> <code>python -m pip install numpy</code>, then <code>import numpy as np</code>.</p>
<h3>Making arrays</h3>
${table(["Call", "Result"], [["<code>np.array([1, 2, 3])</code>", "array from a list (a list of lists makes a 2-D array)"], ["<code>np.arange(0, 10, 3)</code>", "[0 3 6 9]: like range, but an array"], ["<code>np.linspace(0, 1, 5)</code>", "5 evenly spaced numbers from 0 to 1 inclusive"], ["<code>np.zeros((2, 3))</code>, <code>np.ones(4)</code>, <code>np.eye(3)</code>", "filled arrays and the identity matrix"], ["<code>a.reshape(2, 3)</code>", "same data, new shape (the sizes must multiply to the same total)"], ["<code>np.random.default_rng(seed)</code>", "a reproducible random number generator"]])}
<h3>Attributes</h3>
<p><code>a.shape</code> (rows, columns), <code>a.ndim</code> (number of dimensions), <code>a.size</code> (total elements), <code>a.dtype</code> (element type such as <code>int64</code>, <code>float64</code>, <code>bool</code>). Because every element has one dtype, mixing ints and floats gives floats, and mixing numbers with text gives text (<code>U</code>). Convert with <code>a.astype(float)</code>.</p>
<h3>Vectorisation</h3>
<p>Arithmetic and functions (<code>+ - * / ** np.sqrt np.log np.abs</code>) work element by element. Comparison gives a boolean array. Prefer these over <code>for</code> loops; if you find yourself looping over array elements, look for a NumPy function.</p>
<h3>Broadcasting</h3>
<p>When shapes differ, NumPy stretches the smaller array to match, comparing shapes from the right: dimensions are compatible if they are equal or one of them is 1. A column of shape (3, 1) plus a row of shape (3,) becomes a (3, 3) table, as in the example. If shapes are not compatible NumPy raises <code>ValueError</code>.</p>
<h3>Views and copies</h3>
<p>Slices are <strong>views</strong>: changing them changes the original. Plain assignment (<code>b = a</code>) does not copy at all. Use <code>a.copy()</code> for an independent array.</p>
<h3>Precision</h3>
<p>Floating-point results can differ by tiny amounts; compare with <code>np.allclose(a, b)</code> instead of <code>==</code>. NumPy integers have a fixed size and can overflow silently (for example <code>int8</code> wraps after 127), so choose dtypes deliberately for large data.</p>`,
  syntax: { code: `import numpy as np\na = np.array([72, 85, 90])\na * 2\na / 100\nnp.arange(0, 10, 3)\na.reshape(3, 1) + np.array([1, 2])`, note: "One operation, every element, no loop." },
  diagram: chain("Vectorised operation", "Left to right: an input array, one vectorised operation executed by compiled code over every element, and a new result array.",
    [{ k: "io", t: "array\n[72 85 90]" }, { k: "proc", t: "vectorised op\nmarks / 100" }, { k: "io", t: "new array\n[0.72 0.85 0.9]" }], { w: 170, gap: 44, hgt: 62 }),
  example: { code: `import numpy as np

marks = np.array([72, 85, 90, 64, 58])
print(marks, marks.dtype, marks.shape, marks.ndim, marks.size)
print(marks * 2, marks + 5)
print(marks / 100)
print(np.arange(0, 10, 3), np.linspace(0, 1, 5))
print(np.zeros((2, 3)))
print(np.eye(2))

matrix = np.arange(6).reshape(2, 3)
print(matrix)
print(matrix.T.shape, matrix.sum(), matrix.sum(axis=0), matrix.sum(axis=1))

col = np.array([[10], [20], [30]])
row = np.array([1, 2, 3])
print(col + row)

print(np.array([1, 2, 3], dtype=np.float32).dtype, np.array([1, 2.5]).dtype, np.array([1, "a"]).dtype.kind)
a = np.array([1, 2, 3])
b = a
c = a.copy()
b[0] = 99
print(a, c)`, out: `[72 85 90 64 58] int64 (5,) 1 5
[144 170 180 128 116] [77 90 95 69 63]
[0.72 0.85 0.9  0.64 0.58]
[0 3 6 9] [0.   0.25 0.5  0.75 1.  ]
[[0. 0. 0.]
 [0. 0. 0.]]
[[1. 0.]
 [0. 1.]]
[[0 1 2]
 [3 4 5]]
(3, 2) 15 [3 5 7] [ 3 12]
[[11 12 13]
 [21 22 23]
 [31 32 33]]
float32 float64 U
[99  2  3] [1 2 3]` },
  lineByLine: [["np.array([...])", "Builds a one-dimensional array; all five numbers are stored as int64."], ["marks * 2 and marks / 100", "Applied to every element. Division gives floats."], ["arange / linspace", "arange(0, 10, 3) stops before 10; linspace includes both ends."], ["np.arange(6).reshape(2, 3)", "Six numbers arranged as 2 rows by 3 columns."], ["matrix.sum(axis=0) and axis=1", "axis=0 collapses the rows (one total per column: 3 5 7); axis=1 collapses the columns (one per row: 3 12)."], ["col + row", "Shapes (3, 1) and (3,) broadcast to (3, 3): every row value is added to every column value."], ["dtype rules", "Ints and floats mix to float64; numbers and text mix to text (kind U)."], ["b = a versus a.copy()", "b is another name for the same array, so changing b changed a; c stayed independent."]],
  dryRun: { intro: "Broadcasting <code>col + row</code>, first row of the result:", headers: ["Step", "Values"], rows: [["col[0]", "10 (stretched across the row)"], ["row", "1 2 3"], ["result[0]", "10+1, 10+2, 10+3 = 11 12 13"]] },
  realExample: { intro: "Billing many orders at once: totals, tax, a loop check and a conditional discount.", code: `import numpy as np

prices = np.array([250.0, 100.0, 80.0, 40.0])
quantity = np.array([2, 5, 1, 10])
total = prices * quantity
print(total, total.sum())
print((total * 1.18).round(2))

loop = [p * q for p, q in zip(prices, quantity)]
print(np.allclose(total, loop))

discount = np.where(total > 400, 0.1, 0.0)
print(discount, (total * (1 - discount)).sum())`, out: `[500. 500.  80. 400.] 1480.0
[590.  590.   94.4 472. ]
True
[0.1 0.1 0.  0. ] 1380.0` },
  mistakes: ["Writing Python loops over array elements.", "Forgetting that slices are views and modifying the original by accident.", "Comparing floats with <code>==</code>.", "Mixing up <code>axis=0</code> and <code>axis=1</code>.", "Relying on <code>+</code> of two Python lists: it concatenates, while arrays add."],
  practices: ["Think in whole arrays: operations, masks and aggregations.", "Check <code>shape</code> and <code>dtype</code> when something looks wrong.", "Use <code>copy()</code> when you need independence.", "Seed random generators for reproducible results."],
  interview: ["Why is NumPy faster than a Python list loop?", "What is broadcasting?", "View versus copy?", "What does axis=0 mean?"],
  practiceQs: ["What is the shape of np.zeros((4, 2))?", "What does np.arange(1, 10, 4) return?", "Why does np.array([1, 2.5]) have dtype float64?", "What happens with shapes (3, 2) and (3,)?"],
  revision: ["Same-type grid; shape, dtype, size.", "Vectorised arithmetic replaces loops.", "Broadcasting aligns shapes from the right.", "Slices are views; copy() is independent."],
  hinglish: "NumPy array ek hi type ke numbers ka grid hota hai. prices * quantity jaisa operation har element par ek saath chalta hai, loop ki zaroorat nahi. Alag shapes ko broadcasting se jodte hain, aur slice asli array ka view hoti hai, isliye copy() use karo.",
  quiz: [
    mcq("What does marks * 2 do when marks is a NumPy array?", ["Repeats the array twice", "Multiplies every element by 2", "Raises an error", "Doubles the array length"], 1, "Arithmetic is applied element by element; this differs from a Python list, where * 2 repeats the list."),
    mcq("What is the shape of np.arange(6).reshape(2, 3)?", ["(6,)", "(3, 2)", "(2, 3)", "(2, 3, 1)"], 2, "Two rows and three columns."),
    mcq("For a 2-D array a, what does a.sum(axis=0) return?", ["One total per column", "One total per row", "The grand total only", "The shape"], 0, "axis=0 collapses the rows, leaving one value per column."),
    mcq("After b = a and b[0] = 99, what happens to a?", ["Nothing", "a[0] also becomes 99", "a is deleted", "A copy is made"], 1, "Assignment makes another name for the same array."),
    mcq("Which call is the right way to compare two float arrays?", ["a == b", "np.allclose(a, b)", "a is b", "len(a) == len(b)"], 1, "allclose tolerates tiny rounding differences.")
  ],
  tasks: [task("Min-max scaling", "Read a line of numbers. Rescale them to the range 0 to 1 with (x - min) / (max - min) and print the results on one line, separated by spaces, each with exactly 3 decimals. If all numbers are equal print 0.000 for each.", "values = list(map(float, input().split()))\n# scale to the range 0..1\n", `values = list(map(float, input().split()))
low, high = min(values), max(values)
span = high - low
print(" ".join(f"{(v - low) / span:.3f}" if span else "0.000" for v in values))`, [["72 85 90 64 58", "0.438 0.844 1.000 0.188 0.000"], ["5 5 5", "0.000 0.000 0.000"], ["0 10", "0.000 1.000"], ["-5 0 5", "0.000 0.500 1.000"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "NumPy Indexing, Boolean Masks and Statistics",
  minutes: 55,
  learn: ["Index and slice one- and two-dimensional arrays", "Filter data with boolean masks and np.where", "Compute statistics along an axis: mean, median, std, percentiles, argmax", "Sort, rank and count unique values"],
  why: "Most analysis questions are of the form &quot;which rows satisfy this condition, and what is their average?&quot;. Boolean masks and axis-wise statistics answer them in one line each.",
  realWorld: "From a table of exam scores (one row per student, one column per subject) you find who passed every subject, the average per subject, the top student in each row and how many scores were above 90.",
  simple: "<code>a[row, column]</code> picks elements, <code>a[a &gt; 60]</code> keeps only the elements where the condition is True, and <code>a.mean(axis=0)</code> averages down each column.",
  detail: `<h3>Indexing and slicing</h3>
${table(["Expression", "Meaning"], [["<code>a[1]</code>", "row 1"], ["<code>a[1, 2]</code>", "row 1, column 2"], ["<code>a[:, 0]</code>", "the whole first column"], ["<code>a[1:3, :2]</code>", "rows 1-2, first two columns (slices are views)"], ["<code>a[::2]</code>, <code>a[::-1]</code>", "every second row, reversed"], ["<code>a[[0, 2]]</code>", "fancy indexing: rows 0 and 2 (a copy)"], ["<code>a[a &gt; 60]</code>", "boolean mask: a flat array of matching values (a copy)"], ["<code>a[mask_rows]</code>", "a boolean array with one entry per row keeps those rows"]])}
<h3>Masks</h3>
<p>A comparison such as <code>scores &gt;= 60</code> yields a boolean array of the same shape. Combine masks with <code>&amp;</code>, <code>|</code> and <code>~</code> (not <code>and</code>/<code>or</code>), and put each comparison in brackets: <code>(a &gt; 50) &amp; (a &lt; 90)</code>. <code>mask.sum()</code> counts the True values, <code>mask.any()</code> and <code>mask.all()</code> test for some or all (with an <code>axis</code>). <code>np.where(cond, x, y)</code> chooses between two values elementwise; <code>np.where(cond)</code> returns the positions.</p>
<h3>Statistics</h3>
<p><code>sum mean median std var min max cumsum</code>, <code>np.percentile(a, 50)</code>, <code>argmax</code>/<code>argmin</code> (position of the largest/smallest), <code>np.sort</code>, <code>np.argsort</code> (positions that would sort), <code>np.unique(a, return_counts=True)</code>, <code>np.corrcoef</code>. Pass <code>axis=</code> to compute per column or per row. Note <code>np.std</code> divides by n by default (population); pandas divides by n-1 (sample).</p>
<h3>Randomness</h3>
<p><code>rng = np.random.default_rng(42)</code> then <code>rng.integers(1, 7, size=100)</code> or <code>rng.random(5)</code> gives reproducible simulations for the same seed and library version. Do not use random numbers for passwords (use <code>secrets</code>).</p>`,
  syntax: { code: `scores[scores > 90]\n(scores >= 40).all(axis=1)\nscores.mean(axis=0)\nnp.where(scores >= 60, "P", "F")`, note: "Condition in brackets selects; axis picks the direction." },
  diagram: chain("Filtering with a mask", "Left to right: the data array, a comparison that creates a boolean mask, the mask selects matching elements, and an aggregate such as a mean summarises them.",
    [{ k: "io", t: "array\nscores" }, { k: "dec", t: "mask\nscores >= 60" }, { k: "proc", t: "select\nscores[mask]" }, { k: "term", t: "aggregate\n.mean()" }], { w: 150, gap: 40, hgt: 62 }),
  example: { code: `import numpy as np

scores = np.array([[72, 85, 90], [64, 58, 77], [91, 88, 95], [40, 35, 52]])
print(scores[1], scores[1, 2], scores[:, 0], scores[1:3, :2])

mask = scores >= 60
print(mask.sum(), mask.all(axis=1))
print(scores[scores > 90])

passed = (scores >= 40).all(axis=1)
print(passed, scores[passed].shape)
print(scores.mean(), scores.mean(axis=0).round(1), scores.max(axis=1), scores.argmax(axis=1))
print(np.where(scores >= 60, "P", "F"))
print(np.sort(scores[:, 0])[::-1], np.argsort(scores[:, 0]))
print(np.percentile(scores, 50), scores.std().round(3), np.median(scores))
print(np.unique([3, 1, 3, 2, 1], return_counts=True))
print(np.round(np.corrcoef([1, 2, 3, 4], [2, 4, 6, 9])[0, 1], 4))`, out: `[64 58 77] 77 [72 64 91 40] [[64 58]
 [91 88]]
8 [ True False  True False]
[91 95]
[ True  True  True False] (3, 3)
70.58333333333333 [66.8 66.5 78.5] [90 77 95 52] [2 2 2 2]
[['P' 'P' 'P']
 ['P' 'F' 'P']
 ['P' 'P' 'P']
 ['F' 'F' 'F']]
[91 72 64 40] [3 1 0 2]
74.5 19.776 74.5
(array([1, 2, 3]), array([2, 1, 2]))
0.9944` },
  lineByLine: [["scores[1], scores[1, 2], scores[:, 0]", "Row 1, one element, and the first column."], ["scores[1:3, :2]", "Rows 1 and 2, columns 0 and 1."], ["mask.sum()", "Counting True values: 8 scores are 60 or more. mask.all(axis=1) says which rows have all three."], ["scores[scores > 90]", "Only the elements above 90: 91 and 95."], ["(scores >= 40).all(axis=1)", "One boolean per student: the last student has a 35, so False."], ["scores[passed].shape", "Keeps the three passing rows: shape (3, 3)."], ["mean(axis=0), max(axis=1), argmax(axis=1)", "Column averages, each student's best score, and the position of that best score (subject 2 for everyone)."], ["np.where(...)", "Builds a P/F table from the condition."], ["argsort", "Returns the row positions that would sort the first column: 40 is row 3, then 64 is row 1, and so on."]],
  dryRun: { intro: "How <code>scores[passed]</code> selects rows:", headers: ["Row", "passed", "Kept?"], rows: [["0 (72 85 90)", "True", "yes"], ["1 (64 58 77)", "True", "yes"], ["2 (91 88 95)", "True", "yes"], ["3 (40 35 52)", "False", "no"]] },
  realExample: { intro: "Daily visits: moving average, day-to-day change and unusual days.", code: `import numpy as np

daily = np.array([12, 15, 11, 18, 22, 19, 25, 30])
moving = np.convolve(daily, np.ones(3) / 3, mode="valid")
print(moving.round(2))

change = np.diff(daily)
print(change, (change > 0).sum())

z = (daily - daily.mean()) / daily.std()
print(np.abs(z).max().round(2), daily[np.abs(z) > 1.5])
print(daily.cumsum()[:3], daily.cumsum()[-1])

grid = np.arange(12).reshape(3, 4)
print(grid[::2, 1::2], grid[:, -1], grid[grid % 5 == 0])

rng = np.random.default_rng(7)
sample = rng.integers(1, 7, size=1000)
print(sample.shape, sample.min() >= 1, sample.max() <= 6)`, out: `[12.67 14.67 17.   19.67 22.   24.67]
[ 3 -4  7  4 -3  6  5] 5
1.81 [30]
[12 27 38] 152
[[ 1  3]
 [ 9 11]] [ 3  7 11] [ 0  5 10]
(1000,) True True` },
  mistakes: ["Using <code>and</code>/<code>or</code> instead of <code>&amp;</code>/<code>|</code> on arrays.", "Forgetting brackets around each comparison in a combined mask.", "Expecting a boolean-mask result to be a view (it is a copy).", "Mixing up the population and sample standard deviation.", "Printing random numbers in tests without fixing a seed."],
  practices: ["Name masks (<code>passed = ...</code>) so the code reads like the question.", "Use <code>axis</code> explicitly.", "Check shapes after every selection.", "Prefer <code>np.where</code> to a loop with if/else."],
  interview: ["How do you select all values above a threshold?", "What does argmax return?", "Why use &amp; and not and?", "What is the difference between np.std and pandas std?"],
  practiceQs: ["How do you get the last column of a 2-D array?", "How do you count the values above 50?", "What does np.where(a &gt; 0, 1, -1) do?", "What does np.unique(..., return_counts=True) return?"],
  revision: ["a[row, col], slices, masks.", "&amp; | ~ with brackets; sum counts True.", "mean/std/percentile/argmax with axis.", "default_rng(seed) for reproducible randomness."],
  hinglish: "scores[scores > 90] sirf wahi values deta hai jahan condition True hai. Do conditions jodne ke liye & aur | use karo aur har condition ko bracket mein rakho. axis=0 har column ka, axis=1 har row ka hisaab deta hai.",
  quiz: [
    mcq("What does scores[:, 0] select?", ["The first row", "The first column", "The first element", "Every second element"], 1, "A colon before the comma means all rows; 0 picks column 0."),
    mcq("Which expression selects values strictly between 50 and 90?", ["a > 50 and a < 90", "(a > 50) & (a < 90)", "a > 50 & a < 90", "a in (50, 90)"], 1, "Use & with brackets around each comparison."),
    mcq("What does (a >= 60).sum() return?", ["The sum of the values", "How many values are 60 or more", "The largest value", "A boolean"], 1, "True counts as 1, so the sum counts the matches."),
    mcq("What does a.argmax() return?", ["The largest value", "The position of the largest value", "The sorted array", "The mean"], 1, "argmax returns an index."),
    mcq("Which statement about slices such as a[1:3] is correct?", ["They are independent copies", "They are views of the original data", "They cannot be modified", "They always have the same shape as a"], 1, "Changing a slice changes the original array.")
  ],
  tasks: [task("Column statistics", "Read r and c, then r rows of c numbers. Print three lines: col means: the mean of each column with 2 decimals, row max index: the position (starting at 0, first occurrence) of the largest value in each row, and count >= 60: how many values are at least 60.", "r, c = map(int, input().split())\nrows = [list(map(float, input().split())) for _ in range(r)]\n# print the three lines\n", `r, c = map(int, input().split())
rows = [list(map(float, input().split())) for _ in range(r)]
means = [sum(row[j] for row in rows) / r for j in range(c)]
print("col means:", " ".join(f"{m:.2f}" for m in means))
print("row max index:", " ".join(str(row.index(max(row))) for row in rows))
print("count >= 60:", sum(1 for row in rows for v in row if v >= 60))`, [["4 3\n72 85 90\n64 58 77\n91 88 95\n40 35 52", "col means: 66.75 66.50 78.50\nrow max index: 2 2 2 2\ncount >= 60: 8"], ["1 3\n5 5 5", "col means: 5.00 5.00 5.00\nrow max index: 0\ncount >= 60: 0"], ["2 2\n60 61\n59 100", "col means: 59.50 80.50\nrow max index: 1 1\ncount >= 60: 3"], ["3 1\n1\n2\n3", "col means: 2.00\nrow max index: 0 0 0\ncount >= 60: 0"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "pandas Series and DataFrames: Creating and Inspecting Tables",
  minutes: 55,
  learn: ["Explain what a Series and a DataFrame are and how the index works", "Create DataFrames from dictionaries and files", "Inspect data with shape, head, dtypes, describe and info", "Add, drop and rename columns"],
  why: "pandas is the standard tool for working with tables of data in Python. Cleaning, joining and summarising data are everyday tasks for data analysts, data engineers, testers and backend developers.",
  realWorld: "An analyst loads a CSV of student results, checks its size and column types, adds a total and a grade column, and exports a summary for the principal, all in a few lines.",
  simple: "A <strong>Series</strong> is one labelled column; a <strong>DataFrame</strong> is a table made of Series that share the same row labels (the <strong>index</strong>). Columns can have different types; each column has one type.",
  detail: `<p><strong>Install:</strong> <code>python -m pip install pandas</code>, then <code>import pandas as pd</code>. The examples in this module were checked with pandas 3.1; older versions can print small details differently (for example the name of the text dtype).</p>
<h3>Creating</h3>
<ul><li>From a dictionary of columns: <code>pd.DataFrame({&quot;name&quot;: [...], &quot;marks&quot;: [...]})</code>.</li><li>From a list of records: <code>pd.DataFrame([{&quot;name&quot;: &quot;Asha&quot;, &quot;marks&quot;: 82}, ...])</code>.</li><li>From files: <code>pd.read_csv(path)</code>, <code>pd.read_excel(path)</code>, <code>pd.read_json(...)</code> (lesson 7).</li><li>A Series: <code>pd.Series([10, 20, 30], index=[&quot;a&quot;, &quot;b&quot;, &quot;c&quot;])</code>.</li></ul>
<h3>Looking at a table</h3>
${table(["Expression", "Tells you"], [["<code>df.shape</code>", "(rows, columns)"], ["<code>df.head(n)</code>, <code>df.tail(n)</code>", "first or last rows"], ["<code>df.columns</code>, <code>df.index</code>", "labels"], ["<code>df.dtypes</code>", "the type of each column"], ["<code>df.describe()</code>", "count, mean, std, min, quartiles, max of numeric columns"], ["<code>df.info()</code>", "columns, non-null counts and memory"], ["<code>df['col']</code>", "one column (a Series)"], ["<code>df[['a', 'b']]</code>", "several columns (a DataFrame)"], ["<code>df.isna().sum()</code>", "missing values per column"], ["<code>df.to_numpy()</code> / <code>df.values</code>", "the underlying NumPy array"]])}
<h3>Changing columns</h3>
<p><code>df[&quot;total&quot;] = df[&quot;a&quot;] + df[&quot;b&quot;]</code> adds a column from other columns (vectorised, like NumPy). <code>df.assign(big=df[&quot;total&quot;] &gt; 400)</code> returns a new table with the extra column. <code>df.drop(columns=[&quot;x&quot;])</code>, <code>df.rename(columns={&quot;old&quot;: &quot;new&quot;})</code>, <code>df[&quot;x&quot;].astype(float)</code>. Most methods <strong>return a new object</strong> instead of changing the table; assign the result back to keep it.</p>
<h3>Index and alignment</h3>
<p>Operations between Series match by <em>label</em>, not by position, so unmatched labels give missing values (NaN). Use <code>reset_index(drop=True)</code> when you want 0..n-1 again.</p>
<h3>Copy-on-write</h3>
<p>Modern pandas (3.x) always behaves as if each derived object is a copy, so changing a slice does not change the original table. Avoid chained assignment such as <code>df[df.a &gt; 1][&quot;b&quot;] = 0</code>; use <code>df.loc[df.a &gt; 1, &quot;b&quot;] = 0</code>.</p>`,
  syntax: { code: `import pandas as pd\ndf = pd.DataFrame({"name": ["Asha", "Ravi"], "marks": [82, 67]})\ndf.shape\ndf["marks"].mean()\ndf["bonus"] = df["marks"] + 5`, note: "A DataFrame is a dictionary of equal-length columns." },
  diagram: graph("A DataFrame is made of Series", "Three Series boxes for name, dept and marks, all sharing one index, combine into one DataFrame box on the right.", 640, 220,
    [{ id: "a", k: "proc", t: "Series: name", x: 110, y: 40, w: 170, h: 40 }, { id: "b", k: "proc", t: "Series: dept", x: 110, y: 110, w: 170, h: 40 }, { id: "c", k: "proc", t: "Series: marks", x: 110, y: 180, w: 170, h: 40 }, { id: "d", k: "term", t: "DataFrame\n(shared index)", x: 480, y: 110, w: 200, h: 60 }],
    [{ from: "a", to: "d" }, { from: "b", to: "d" }, { from: "c", to: "d" }]),
  example: { code: `import pandas as pd

students = pd.DataFrame({
    "name": ["Asha", "Ravi", "Zoya", "Kabir", "Meera"],
    "dept": ["CSE", "ECE", "CSE", "ME", "ECE"],
    "marks": [82, 67, 91, 55, 74],
    "year": [2, 3, 2, 1, 3],
})
print(students)
print(students.shape, list(students.columns))
print(students.dtypes["marks"], students["marks"].mean())
print(students.head(2))

s = pd.Series([10, 20, 30], index=["a", "b", "c"])
print(s["b"], s.iloc[2], (s * 2).to_dict())

students["bonus"] = students["marks"] + 5
print(students[["name", "bonus"]].tail(2))
print(students.drop(columns=["year", "bonus"]).rename(columns={"marks": "score"}).columns.tolist())`, out: `    name dept  marks  year
0   Asha  CSE     82     2
1   Ravi  ECE     67     3
2   Zoya  CSE     91     2
3  Kabir   ME     55     1
4  Meera  ECE     74     3
(5, 4) ['name', 'dept', 'marks', 'year']
int64 73.8
   name dept  marks  year
0  Asha  CSE     82     2
1  Ravi  ECE     67     3
20 30 {'a': 20, 'b': 40, 'c': 60}
    name  bonus
3  Kabir     60
4  Meera     79
['name', 'dept', 'score']` },
  lineByLine: [["pd.DataFrame({...})", "Each dictionary key becomes a column; all lists must have the same length."], ["print(students)", "The left-hand 0..4 is the index (row labels)."], ["shape and columns", "Five rows and four columns."], ["dtypes[\"marks\"] and mean()", "The marks column holds int64 numbers; the mean is 73.8."], ["head(2)", "The first two rows."], ["s[\"b\"] versus s.iloc[2]", "Square brackets with a label use the index; iloc uses the position."], ["students[\"bonus\"] = ...", "A new column is computed for all rows at once."], ["tail(2)", "The last two rows keep their original index labels 3 and 4."], ["drop and rename", "Both return new tables; the chain ends with the list of column names."]],
  dryRun: { intro: "How <code>students[\"bonus\"] = students[\"marks\"] + 5</code> is evaluated:", headers: ["Step", "Result"], rows: [["students[\"marks\"]", "Series 82 67 91 55 74"], ["+ 5", "new Series 87 72 96 60 79"], ["assign to students[\"bonus\"]", "a fifth column aligned by index"]] },
  realExample: { intro: "An orders table: derived column, best order, summary statistics and column types.", code: `import pandas as pd

orders = pd.DataFrame({"order": [1, 2, 3, 4], "price": [250.0, 100.0, 80.0, 40.0], "qty": [2, 5, 1, 10]})
orders["total"] = orders["price"] * orders["qty"]
print(orders)
print(orders["total"].sum(), orders["total"].idxmax(), orders.loc[orders["total"].idxmax(), "order"])
print(orders.describe().loc[["mean", "max"], ["price", "qty"]].round(2))
print(orders.index.tolist(), orders.columns.tolist(), orders.to_numpy().shape)

orders = orders.assign(big=orders["total"] > 400).drop(columns=["price"])
print(orders)

s = pd.Series([3, 1, 2], name="count")
print(s.sort_values().tolist(), s.cumsum().tolist(), s.name)`, out: `   order  price  qty  total
0      1  250.0    2  500.0
1      2  100.0    5  500.0
2      3   80.0    1   80.0
3      4   40.0   10  400.0
1480.0 0 1
      price   qty
mean  117.5   4.5
max   250.0  10.0
[0, 1, 2, 3] ['order', 'price', 'qty', 'total'] (4, 4)
   order  qty  total    big
0      1    2  500.0   True
1      2    5  500.0   True
2      3    1   80.0  False
3      4   10  400.0  False
[1, 2, 3] [3, 4, 6] count` },
  mistakes: ["Calling a method and not keeping the result (<code>df.drop(...)</code> alone changes nothing).", "Chained assignment such as <code>df[mask][&quot;x&quot;] = 1</code>.", "Looping over rows with <code>iterrows</code> when a column operation would do.", "Confusing label-based (<code>loc</code>) and position-based (<code>iloc</code>) selection.", "Forgetting that a column has a single dtype (one text value turns a numeric column into text)."],
  practices: ["Always start with <code>shape</code>, <code>head</code>, <code>dtypes</code> and <code>isna().sum()</code>.", "Use vectorised column operations.", "Use clear lower-case column names.", "Assign results back or chain methods in one expression."],
  interview: ["Series versus DataFrame?", "What is the index for?", "loc versus iloc?", "Why avoid iterrows?"],
  practiceQs: ["What does df.shape return?", "How do you add a column that is the sum of two others?", "How do you list missing values per column?", "What does describe() show?"],
  revision: ["Series = labelled column; DataFrame = table.", "shape, head, dtypes, describe, isna().sum().", "New columns by vectorised expressions.", "Methods return new objects."],
  hinglish: "Series ek labelled column hai aur DataFrame aise columns ki table. shape, head, dtypes, describe aur isna().sum() se data ko pehle samjho. Naya column df['total'] = df['a'] + df['b'] se banta hai, aur zyada tar methods naya object lautati hain, isliye result ko wapas assign karo.",
  quiz: [
    mcq("What is a pandas Series?", ["A table with many columns", "A one-dimensional labelled array (a column)", "A Python list", "A file format"], 1, "A DataFrame is built from Series."),
    mcq("What does df.shape return for 5 rows and 4 columns?", ["(4, 5)", "(5, 4)", "20", "[5, 4]"], 1, "The tuple is (rows, columns)."),
    mcq("What does df.drop(columns=['x']) do on its own?", ["Removes x from df permanently", "Returns a new table without x and leaves df unchanged", "Raises an error", "Deletes the file"], 1, "Assign the result back (df = df.drop(...)) to keep it."),
    mcq("Which call lists the number of missing values in each column?", ["df.isna().sum()", "df.count_missing()", "df.shape", "df.describe(missing=True)"], 0, "isna gives booleans and sum counts them per column."),
    mcq("Why can a column of numbers suddenly have a text dtype?", ["Because pandas is slow", "One non-numeric value forces the column to hold text", "Because of the index", "It cannot happen"], 1, "A column has one dtype; a bad value such as 'n/a' changes it.")
  ],
  tasks: [task("Describe a column", "Read a line of numbers (at least two). Print eight lines like pandas describe: count, mean, std (the sample standard deviation, dividing by n-1), min, 25%, 50%, 75% and max, each as the name, a space and the value with 2 decimals (count is an integer). Quartiles use linear interpolation between neighbouring values (statistics.quantiles with method inclusive).", "import statistics\nvalues = list(map(float, input().split()))\n# print count, mean, std, min, 25%, 50%, 75%, max\n", `import statistics

values = list(map(float, input().split()))
q1, q2, q3 = statistics.quantiles(values, n=4, method="inclusive")
print("count", len(values))
print(f"mean {statistics.mean(values):.2f}")
print(f"std {statistics.stdev(values):.2f}")
print(f"min {min(values):.2f}")
print(f"25% {q1:.2f}")
print(f"50% {q2:.2f}")
print(f"75% {q3:.2f}")
print(f"max {max(values):.2f}")`, [["82 67 91 55 74 60 300 70", "count 8\nmean 99.88\nstd 81.67\nmin 55.00\n25% 65.25\n50% 72.00\n75% 84.25\nmax 300.00"], ["1 2 3 4 5", "count 5\nmean 3.00\nstd 1.58\nmin 1.00\n25% 2.00\n50% 3.00\n75% 4.00\nmax 5.00"], ["10 20", "count 2\nmean 15.00\nstd 7.07\nmin 10.00\n25% 12.50\n50% 15.00\n75% 17.50\nmax 20.00"], ["4 4 4 4", "count 4\nmean 4.00\nstd 0.00\nmin 4.00\n25% 4.00\n50% 4.00\n75% 4.00\nmax 4.00"]])],
});

module.exports = { lessons };
