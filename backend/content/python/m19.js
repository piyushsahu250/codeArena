// Phase 5 / Module 19: Python for Data Analysis. Lessons live in m19a.js to m19c.js; this file adds the module assessment.
"use strict";
const { task } = require("./lib");
const lessons = [...require("./m19a").lessons, ...require("./m19b").lessons, ...require("./m19c").lessons];

module.exports = {
  module: {
    title: "Phase 5 - Python for Data Analysis",
    description: "NumPy arrays, indexing and statistics; pandas Series and DataFrames; selecting, cleaning, grouping, joining and reshaping data; reading and writing CSV, Excel and JSON; exploratory data analysis; and charts with Matplotlib.",
    chapters: [
      { title: "NumPy", description: "Arrays, vectorised maths, masks and statistics.", lessons: lessons.slice(0, 2) },
      { title: "pandas", description: "Tables: creating, selecting, cleaning, grouping and joining.", lessons: lessons.slice(2, 6) },
      { title: "Files, Exploration and Charts", description: "Loading data, understanding it and showing it.", lessons: lessons.slice(6) },
    ],
    assessment: {
      title: "Module 19 Assessment: Python for Data Analysis",
      description: "Standard-library problems on correlation, moving averages, joins and missing-value reports.",
      questions: [
        task("Pearson correlation", "Read two lines of numbers of the same length (at least two values, not constant). Print the Pearson correlation coefficient r rounded to 4 decimals.", "", `import statistics

x = list(map(float, input().split()))
y = list(map(float, input().split()))
print(f"{statistics.correlation(x, y):.4f}")`, [["1 2 3 4\n2 4 6 9", "0.9944"], ["1 2 3\n3 2 1", "-1.0000"], ["1 2 3 4 5\n2 4 5 4 5", "0.7746"], ["10 20 30\n1 2 3", "1.0000"]]),
        task("Moving average", "Read the window size k, then a line of numbers. Print the average of every full window of k consecutive values, each with 2 decimals, separated by spaces. If there are fewer than k numbers print none.", "", `k = int(input())
values = list(map(float, input().split()))
if len(values) < k:
    print("none")
else:
    print(" ".join(f"{sum(values[i:i + k]) / k:.2f}" for i in range(len(values) - k + 1)))`, [["3\n12 15 11 18 22 19 25 30", "12.67 14.67 17.00 19.67 22.00 24.67"], ["2\n1 2 3", "1.50 2.50"], ["5\n1 2 3", "none"], ["1\n4 8", "4.00 8.00"]]),
        task("Left join", "Read n and then n lines id name (the left table). Then read m and m lines id score (the right table; each id appears once). For every left row, in the original order, print id name score, writing NA when the id has no score.", "", `n = int(input())
left = [input().split() for _ in range(n)]
m = int(input())
scores = dict(input().split() for _ in range(m))
for key, name in left:
    print(key, name, scores.get(key, "NA"))`, [["3\n1 Asha\n2 Ravi\n3 Zoya\n2\n2 80\n3 91", "1 Asha NA\n2 Ravi 80\n3 Zoya 91"], ["1\n7 Dev\n0", "7 Dev NA"], ["2\n5 A\n6 B\n2\n6 10\n5 20", "5 A 20\n6 B 10"], ["2\n1 X\n2 Y\n1\n9 99", "1 X NA\n2 Y NA"]]),
        task("Missing-value report", "Read CSV text from standard input: a header row and data rows (no quoted commas). A value is missing when it is empty, only spaces, or NA. For every column in header order print name: M missing (P%) where P is the percentage of the data rows with 1 decimal.", "", `import csv
import sys

rows = list(csv.reader(sys.stdin))
header, data = rows[0], rows[1:]
for index, name in enumerate(header):
    missing = sum(1 for row in data if row[index].strip() in ("", "NA"))
    print(f"{name}: {missing} missing ({100 * missing / len(data):.1f}%)")`, [["name,marks,dept\nAsha,82,CSE\nRavi,,ECE\nZoya,91,NA\nKabir,NA,ME\n", "name: 0 missing (0.0%)\nmarks: 2 missing (50.0%)\ndept: 1 missing (25.0%)"], ["a,b\n1,2\n", "a: 0 missing (0.0%)\nb: 0 missing (0.0%)"], ["x\nNA\n3\nNA\n", "x: 2 missing (66.7%)"], ["p,q\n,\n,1\n,2\n,3\n", "p: 4 missing (100.0%)\nq: 1 missing (25.0%)"]]),
      ],
    },
  },
};
