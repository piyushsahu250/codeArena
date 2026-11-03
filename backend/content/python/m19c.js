// Phase 5 / Module 19, lessons 7-9: reading and writing files, exploratory data analysis, and visualisation with Matplotlib.
// Examples need pandas, numpy, matplotlib and openpyxl (installed in the course's virtual environment). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Reading and Writing Data: CSV, Excel and JSON",
  minutes: 55,
  learn: ["Read and write CSV, Excel and JSON with pandas", "Control types, dates, separators, missing-value markers and encodings while reading", "Process large files in chunks", "Flatten nested JSON from an API"],
  why: "Data arrives as files and API responses. Reading it with the right options avoids silent mistakes such as lost leading zeros, wrong dates or comma-decimal numbers read as text.",
  realWorld: "Finance sends an Excel sheet each month, an API returns nested JSON, and a log export is a 2 GB CSV. You load each safely, combine them and write a clean CSV for the dashboard.",
  simple: "<code>pd.read_csv</code>, <code>read_excel</code> and <code>read_json</code> turn files into DataFrames; <code>to_csv</code>, <code>to_excel</code> and <code>to_json</code> write them back. The options matter as much as the call.",
  detail: `<h3>CSV</h3>
${table(["Need", "Option"], [["different separator or decimal comma", "<code>sep=\";\", decimal=\",\"</code>"], ["keep leading zeros (ids, phone numbers)", "<code>dtype={\"id\": str}</code>"], ["parse dates", "<code>parse_dates=[\"joined\"], date_format=\"%d/%m/%Y\"</code>"], ["skip a comment/title line", "<code>skiprows=1</code>"], ["only some columns / first rows", "<code>usecols=[...]</code>, <code>nrows=1000</code>"], ["extra missing markers", "<code>na_values=[\"-\", \"missing\"]</code>"], ["encoding problems", "<code>encoding=\"utf-8\"</code> or <code>\"utf-8-sig\"</code> (Excel exports), <code>\"latin-1\"</code>"], ["huge files", "<code>chunksize=100_000</code> returns an iterator of DataFrames"], ["write without the index", "<code>df.to_csv(\"out.csv\", index=False)</code>"]])}
<h3>Excel</h3>
<p>Needs the <code>openpyxl</code> package for <code>.xlsx</code>. <code>pd.read_excel(path, sheet_name=&quot;Marks&quot;)</code>, <code>pd.ExcelFile(path).sheet_names</code> lists the sheets, <code>df.to_excel(path, sheet_name=&quot;Marks&quot;, index=False)</code>; use <code>pd.ExcelWriter</code> to write several sheets. Excel hides problems: merged cells, notes above the header, numbers stored as text and formulas whose cached values are read, not the formula.</p>
<h3>JSON</h3>
<p><code>df.to_json(orient=&quot;records&quot;)</code> gives a list of objects (the common API shape). For nested API data use <code>pd.json_normalize(data[&quot;results&quot;])</code>: nested keys become columns such as <code>user.name</code>. For one JSON object per line (JSON Lines, used by logs) use <code>lines=True</code>.</p>
<h3>Other sources</h3>
<p><code>pd.read_sql(query, connection)</code> (with a SQLAlchemy engine or sqlite3 connection, see Module 16), <code>read_parquet</code> (a compact, fast, typed format common in data engineering), <code>read_clipboard</code>. Prefer Parquet over CSV for large intermediate files because it keeps types and is smaller.</p>
<h3>Good habits</h3>
<ul><li>Never overwrite the raw file; write results to a new path.</li><li>After reading, check <code>shape</code>, <code>dtypes</code>, <code>head()</code>.</li><li>Use <code>pathlib</code> paths, not hard-coded strings with backslashes.</li><li>Never read files from untrusted sources with formats that can run code (for example <code>pickle</code>).</li><li>Personal data in files: store only what you need and protect the files.</li></ul>`,
  syntax: { code: `df = pd.read_csv("marks.csv", dtype={"id": str}, parse_dates=["joined"])\ndf.to_csv("clean.csv", index=False)\npd.read_excel("marks.xlsx", sheet_name="Marks")\ndf.to_json(orient="records")`, note: "The options decide whether the data is read correctly." },
  diagram: chain("Files in, analysis, files out", "Left to right: CSV, Excel and JSON sources are read into a DataFrame, analysed, and written out as a clean CSV or report.",
    [{ k: "io", t: "CSV / Excel /\nJSON files" }, { k: "proc", t: "read_*\n(with options)" }, { k: "proc", t: "DataFrame\nanalysis" }, { k: "io", t: "to_csv /\nto_excel" }], { w: 150, gap: 40, hgt: 62 }),
  example: { code: `import io
import json
import pathlib
import shutil
import tempfile

import pandas as pd

folder = pathlib.Path(tempfile.mkdtemp())
df = pd.DataFrame({"name": ["Asha", "Ravi"], "marks": [82, 67], "tags": ["a;b", "c"]})

csv_path = folder / "marks.csv"
df.to_csv(csv_path, index=False)
print(csv_path.read_text().splitlines())
back = pd.read_csv(csv_path)
print(back.equals(df), back.shape)

df.to_excel(folder / "marks.xlsx", sheet_name="Marks", index=False)
excel = pd.read_excel(folder / "marks.xlsx", sheet_name="Marks")
print(excel.to_dict("records"))
print(pd.ExcelFile(folder / "marks.xlsx").sheet_names)

text = df.to_json(orient="records")
print(text)
print(pd.read_json(io.StringIO(text)).shape)
data = json.loads('{"results": [{"id": 1, "user": {"name": "Asha"}}, {"id": 2, "user": {"name": "Ravi"}}]}')
print(pd.json_normalize(data["results"]).columns.tolist())

big = "id,score\\n" + "\\n".join(f"{i},{i % 7}" for i in range(1, 11))
total = 0
for chunk in pd.read_csv(io.StringIO(big), chunksize=4):
    total += chunk["score"].sum()
print(total)
print(pd.read_csv(io.StringIO(big), usecols=["score"], nrows=3)["score"].tolist())
print(pd.read_csv(io.StringIO("a;b\\n1,5;2\\n"), sep=";", decimal=",").iloc[0].tolist())
shutil.rmtree(folder, ignore_errors=True)`, out: `['name,marks,tags', 'Asha,82,a;b', 'Ravi,67,c']
True (2, 3)
[{'name': 'Asha', 'marks': 82, 'tags': 'a;b'}, {'name': 'Ravi', 'marks': 67, 'tags': 'c'}]
['Marks']
[{"name":"Asha","marks":82,"tags":"a;b"},{"name":"Ravi","marks":67,"tags":"c"}]
(2, 3)
['id', 'user.name']
27
[1, 2, 3]
[1.5, 2.0]` },
  lineByLine: [["to_csv(csv_path, index=False)", "Writes the table without the 0..n-1 index column."], ["back.equals(df)", "Round trip: reading the CSV gives back the same table."], ["to_excel / read_excel / sheet_names", "A real .xlsx file is created (via openpyxl), read back and its sheets listed."], ["to_json(orient=\"records\")", "A JSON list with one object per row."], ["json_normalize", "Flattens the nested user object into a user.name column."], ["chunksize=4", "Reads the 10-row text as pieces of up to 4 rows so memory stays small; the scores 1,2,3,4,5,6,0,1,2,3 add up to 27."], ["usecols and nrows", "Load only the score column and the first 3 rows."], ["sep=\";\", decimal=\",\"", "A European-style file: fields split on semicolons and 1,5 means 1.5."]],
  dryRun: { intro: "Chunked reading of the 10 data rows with <code>chunksize=4</code>:", headers: ["Chunk", "Rows", "Sum of score"], rows: [["1", "ids 1-4", "1+2+3+4 = 10"], ["2", "ids 5-8", "5+6+0+1 = 12"], ["3", "ids 9-10", "2+3 = 5"], ["total", "", "27"]] },
  realExample: { intro: "A messy export: a title line, leading zeros in ids, day-first dates and a NA marker, read with the right options and written back as clean CSV.", code: `import io

import pandas as pd

raw = "# exported 2026-11-03\\nid,joined,score\\n001,03/11/2026,NA\\n002,04/11/2026,88\\n"
df = pd.read_csv(io.StringIO(raw), skiprows=1, dtype={"id": str}, parse_dates=["joined"], date_format="%d/%m/%Y")
print(df["id"].tolist(), df["joined"].dt.day.tolist(), df["score"].tolist())
print(df.to_csv(index=False, lineterminator="\\n"), end="")
print(df.to_json(orient="records", date_format="iso"))`, out: `['001', '002'] [3, 4] [nan, 88.0]
id,joined,score
001,2026-11-03,
002,2026-11-04,88.0
[{"id":"001","joined":"2026-11-03T00:00:00.000","score":null},{"id":"002","joined":"2026-11-04T00:00:00.000","score":88.0}]` },
  mistakes: ["Letting ids and phone numbers be read as numbers (losing leading zeros).", "Reading day-first dates without a format.", "Wrong encoding that turns names into garbage.", "Writing the index into the CSV by accident.", "Loading a huge file entirely when chunks or selected columns would do."],
  practices: ["Pass <code>dtype</code>, <code>parse_dates</code> and <code>na_values</code> explicitly.", "Check the result with <code>shape</code>, <code>dtypes</code> and <code>head</code>.", "Keep raw inputs read-only.", "Use Parquet for large intermediate data."],
  interview: ["How do you read a very large CSV?", "How do you keep leading zeros?", "What is JSON Lines?", "What does json_normalize do?"],
  practiceQs: ["Which package does read_excel need for .xlsx?", "How do you skip the first line of a CSV?", "What does index=False do?", "How do you parse day-first dates?"],
  revision: ["read_csv/read_excel/read_json and the matching to_*.", "dtype, parse_dates, na_values, sep, decimal, encoding.", "chunksize for big files.", "json_normalize flattens nested JSON."],
  hinglish: "read_csv, read_excel aur read_json file ko DataFrame banate hain, aur to_csv jaise methods wapas likhte hain. Ids ke leading zero bachane ke liye dtype=str do, dates ke liye parse_dates aur format do, aur badi file ko chunksize se tukdon mein padho.",
  quiz: [
    mcq("How do you stop pandas from turning the id 007 into the number 7?", ["Use dtype={\"id\": str} in read_csv", "Use sort_values", "Use head()", "Nothing can be done"], 0, "Reading the column as text keeps the zeros."),
    mcq("What does index=False do in to_csv?", ["Deletes the file", "Leaves the row index out of the file", "Sorts the rows", "Hides the header"], 1, "Otherwise an extra column of 0..n-1 is written."),
    mcq("Which option reads a large CSV piece by piece?", ["nrows only", "chunksize", "usecols", "decimal"], 1, "chunksize returns an iterator of DataFrames."),
    mcq("Which function flattens a list of nested JSON objects into a table?", ["pd.json_normalize", "pd.melt", "pd.pivot", "pd.cut"], 0, "Nested keys become columns like user.name."),
    mcq("Which package is needed to read .xlsx files with pandas?", ["openpyxl", "requests", "flask", "pytest"], 0, "pandas uses openpyxl as the engine for modern Excel files.")
  ],
  tasks: [task("CSV to JSON", "Read CSV text from standard input (a header row, then data rows; quoted fields may contain commas). Print one line: the JSON list of records (use json.dumps with default settings). Convert each value: an empty value becomes null, a whole number becomes an integer, a decimal number becomes a float, anything else stays text.", "import csv, json, sys\nreader = csv.DictReader(sys.stdin)\n# convert each value and print the JSON list\n", `import csv
import json
import sys


def convert(text):
    if text == "":
        return None
    for kind in (int, float):
        try:
            return kind(text)
        except ValueError:
            pass
    return text


reader = csv.DictReader(sys.stdin)
print(json.dumps([{key: convert(value) for key, value in row.items()} for row in reader]))`, [["name,marks,tags\nAsha,82,a;b\nRavi,67.5,\n", '[{"name": "Asha", "marks": 82, "tags": "a;b"}, {"name": "Ravi", "marks": 67.5, "tags": null}]'], ["a,b\n", "[]"], ["x\n1\n2\n", '[{"x": 1}, {"x": 2}]'], ['name,note\n"Das, A",hello\n', '[{"name": "Das, A", "note": "hello"}]']])],
});

// ---------------------------------------------------------------- 8
lessons.push({
  title: "Exploratory Data Analysis: Summaries, Correlation and Outliers",
  minutes: 60,
  learn: ["Follow an EDA checklist from shape to relationships", "Summarise with describe, value_counts, groupby and crosstab", "Measure relationships with correlation and know its limits", "Detect outliers with the IQR rule and the z-score and decide what to do"],
  why: "Before any model or report you must understand your data: its size, quality, distribution and relationships. EDA finds errors and suggests questions, and it stops you from drawing conclusions from broken data.",
  realWorld: "Looking at marks, an analyst finds one student with 300 out of 100 (a typing error), sees that attendance and marks rise together, and that one department's average is lower because of a small class.",
  simple: "EDA means looking at the data from many angles with simple numbers and charts <em>before</em> doing anything clever: How big is it? What is missing? What does each column look like? What is related to what? What is strange?",
  detail: `<h3>An EDA checklist</h3>
<ol><li><strong>Shape and types</strong>: <code>shape</code>, <code>dtypes</code>, <code>head()</code>.</li><li><strong>Quality</strong>: missing values, duplicates, impossible values (marks above 100, negative ages).</li><li><strong>Each column alone</strong>: <code>describe()</code> for numbers (compare mean and median: a big gap means skew or outliers), <code>value_counts()</code> for categories.</li><li><strong>Pairs</strong>: <code>groupby</code> means, <code>crosstab</code> for two categories, <code>corr()</code> for numbers, scatter plots (next lesson).</li><li><strong>Questions</strong>: write down what you learned and what to check next.</li></ol>
<h3>Correlation</h3>
<p><code>df.corr()</code> gives Pearson's r between -1 and 1: near 1 means the two columns rise together, near -1 means one rises while the other falls, near 0 means no <em>straight-line</em> relationship. It measures only linear association, is distorted by outliers, and <strong>correlation is not causation</strong>: ice-cream sales and drownings both rise in summer. Use <code>method=&quot;spearman&quot;</code> for rank-based association.</p>
<h3>Outliers</h3>
${table(["Rule", "Definition", "Notes"], [["IQR rule", "outside Q1 - 1.5 x IQR and Q3 + 1.5 x IQR, where IQR = Q3 - Q1", "robust; the rule behind box plots"], ["z-score", "|(x - mean) / std| above about 3", "the outlier inflates mean and std, so small samples hide it"], ["domain rule", "marks must be between 0 and 100", "often the best check"]])}
<p>An outlier is a <em>question</em>, not an automatic deletion. Is it an error (fix or remove), a rare but real event (keep, and consider a robust statistic such as the median), or the most interesting row? Record what you did.</p>
<h3>Typical traps</h3>
<ul><li><strong>Mean versus median</strong>: with the 300 in the data the mean marks are 99.9 although most students scored 55 to 91.</li><li><strong>Small groups</strong>: an average over 2 students means little; show counts next to averages.</li><li><strong>Simpson's paradox</strong>: a trend can reverse when groups are combined.</li><li><strong>Leakage and bias</strong>: check how the data was collected before trusting it.</li></ul>`,
  syntax: { code: `df.describe()\ndf["dept"].value_counts()\ndf.corr(numeric_only=True)\nq1, q3 = df["x"].quantile([0.25, 0.75])`, note: "Look before you model." },
  diagram: chain("EDA workflow", "Left to right: check shape and types, check quality, summarise each column, study pairs of columns, then write down findings and questions.",
    [{ k: "proc", t: "shape and\ntypes" }, { k: "proc", t: "quality\nchecks" }, { k: "proc", t: "each\ncolumn" }, { k: "proc", t: "pairs and\ngroups" }, { k: "term", t: "findings and\nquestions" }], { w: 125, gap: 30, hgt: 62 }),
  example: { code: `import io

import pandas as pd

raw = """id,dept,marks,attendance
1,CSE,82,91
2,ECE,67,78
3,CSE,91,96
4,ME,55,60
5,ECE,74,85
6,CSE,60,70
7,ME,300,88
8,ECE,70,82
"""
df = pd.read_csv(io.StringIO(raw))
print(df["marks"].describe().round(2))
print(df["dept"].value_counts().to_dict())
print(df[["marks", "attendance"]].corr().round(3).loc["marks", "attendance"])

q1, q3 = df["marks"].quantile([0.25, 0.75])
iqr = q3 - q1
low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
print(q1, q3, low, high)
print(df[(df["marks"] < low) | (df["marks"] > high)]["id"].tolist())

clean = df[df["marks"] <= 100]
print(clean["marks"].mean().round(2), clean["marks"].median())
z = (clean["marks"] - clean["marks"].mean()) / clean["marks"].std()
print(z.round(2).tolist())
print(clean.groupby("dept")["marks"].mean().round(1).sort_values(ascending=False).to_dict())
print(pd.crosstab(df["dept"], df["marks"] >= 70).to_string())`, out: `count      8.00
mean      99.88
std       81.67
min       55.00
25%       65.25
50%       72.00
75%       84.25
max      300.00
Name: marks, dtype: float64
{'CSE': 3, 'ECE': 3, 'ME': 2}
0.363
65.25 84.25 36.75 112.75
[7]
71.29 70.0
[0.86, -0.35, 1.59, -1.31, 0.22, -0.91, -0.1]
{'CSE': 77.7, 'ECE': 70.3, 'ME': 55.0}
marks  False  True
dept
CSE        1      2
ECE        1      2
ME         1      1` },
  lineByLine: [["describe()", "The mean (99.88) is far above the median (72): a sign of an outlier. The maximum 300 is impossible for marks out of 100."], ["value_counts()", "CSE and ECE have three students each, ME has two."], ["corr()", "Marks and attendance have r = 0.363 here, a weak positive link, partly distorted by the 300."], ["quantile([0.25, 0.75])", "Q1 = 65.25 and Q3 = 84.25, so IQR = 19."], ["fences", "Low fence 65.25 - 28.5 = 36.75, high fence 84.25 + 28.5 = 112.75. Only id 7 is outside."], ["clean = df[df.marks <= 100]", "A domain rule removes the impossible value. The mean drops to 71.29, close to the median 70."], ["z-scores", "No remaining value has |z| above 2, so none is extreme."], ["groupby mean", "CSE is highest at 77.7; the ME average rests on one student after cleaning."], ["crosstab", "Counts of students below and above 70 marks per department."]],
  dryRun: { intro: "The IQR rule for marks:", headers: ["Step", "Value"], rows: [["Q1, Q3", "65.25, 84.25"], ["IQR = Q3 - Q1", "19"], ["low fence = Q1 - 1.5 x IQR", "65.25 - 28.5 = 36.75"], ["high fence = Q3 + 1.5 x IQR", "84.25 + 28.5 = 112.75"], ["300 > 112.75", "outlier"]] },
  realExample: { intro: "Study hours against scores: correlation matrix, a fitted line and score bands.", code: `import numpy as np
import pandas as pd

df = pd.DataFrame({"hours": [1, 2, 3, 4, 5, 6, 7, 8], "score": [35, 42, 50, 55, 64, 68, 77, 85], "absences": [8, 7, 6, 6, 4, 3, 2, 1]})
print(df.corr().round(2))
print(pd.cut(df["score"], bins=[0, 50, 70, 100]).value_counts().sort_index().tolist())
slope, intercept = np.polyfit(df["hours"], df["score"], 1)
print(round(slope, 2), round(intercept, 2))
print(df.agg(["min", "max"]).T.to_string())
print(df.nunique().to_dict(), df.duplicated().sum())`, out: `          hours  score  absences
hours      1.00   1.00     -0.99
score      1.00   1.00     -0.99
absences  -0.99  -0.99      1.00
[3, 3, 2]
7.0 28.0
          min  max
hours       1    8
score      35   85
absences    1    8
{'hours': 8, 'score': 8, 'absences': 7} 0` },
  mistakes: ["Skipping EDA and going straight to a model.", "Deleting outliers automatically.", "Treating correlation as proof of cause.", "Reporting averages of tiny groups without counts.", "Not checking the data's source and collection method."],
  practices: ["Always compare mean and median.", "Show counts beside averages.", "Write findings down as you go.", "Use domain rules (valid ranges) as well as statistical ones."],
  interview: ["What would you do first with a new dataset?", "Correlation versus causation?", "How do you detect outliers?", "Mean or median for skewed data?"],
  practiceQs: ["What does r = -0.9 mean?", "How is IQR defined?", "Why can a mean be misleading?", "What does crosstab show?"],
  revision: ["Shape, quality, columns, pairs, questions.", "Mean far from median signals skew or outliers.", "IQR fences: Q1 - 1.5 IQR and Q3 + 1.5 IQR.", "Correlation is not causation."],
  hinglish: "Model banane se pehle data ko samjho: size, missing values, har column ka describe aur value_counts, aur do columns ka relation corr() se. IQR rule se outlier pakdo, lekin unhe sidha delete mat karo; pehle socho ki wo galti hai ya asli ghatna. Correlation ka matlab causation nahi hota.",
  quiz: [
    mcq("The mean of a column is much larger than its median. What does this suggest?", ["Nothing", "Skew or outliers pull the mean up", "The median is wrong", "The column is text"], 1, "The mean is sensitive to extreme values; the median is robust."),
    mcq("What does a correlation of 0.95 between two columns show?", ["One causes the other", "They rise together in a strong straight-line pattern", "They are identical", "The data is clean"], 1, "It describes association, not cause."),
    mcq("Which formula gives the upper IQR fence?", ["Q3 + 1.5 x IQR", "Q1 - 1.5 x IQR", "mean + std", "max - min"], 0, "Values above Q3 + 1.5 x IQR are flagged as outliers."),
    mcq("What should you do first with an outlier such as marks = 300?", ["Delete all rows", "Investigate whether it is an error or a real value", "Ignore it", "Replace it with the mean without checking"], 1, "The treatment depends on its cause."),
    mcq("What does pd.crosstab(df.dept, df.passed) produce?", ["A table of counts for each pair of categories", "A chart", "A sorted copy of the data", "A correlation matrix"], 0, "It counts the rows for every combination.")
  ],
  tasks: [task("IQR outliers", "Read a line of at least two numbers. Compute Q1 and Q3 with statistics.quantiles(values, n=4, method=\"inclusive\") (the pandas default). Print q1=A q3=B low=C high=D with 2 decimals, where low = Q1 - 1.5 x IQR and high = Q3 + 1.5 x IQR. Then print outliers: followed by the values outside the fences in ascending order, separated by spaces (use none when there are no outliers). Print whole numbers without a decimal point (use the g format).", "import statistics\nvalues = list(map(float, input().split()))\n# compute the quartiles, fences and outliers\n", `import statistics

values = list(map(float, input().split()))
q1, _, q3 = statistics.quantiles(values, n=4, method="inclusive")
iqr = q3 - q1
low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
print(f"q1={q1:.2f} q3={q3:.2f} low={low:.2f} high={high:.2f}")
outliers = sorted(v for v in values if v < low or v > high)
print("outliers:", " ".join(f"{v:g}" for v in outliers) if outliers else "none")`, [["82 67 91 55 74 60 300 70", "q1=65.25 q3=84.25 low=36.75 high=112.75\noutliers: 300"], ["1 2 3 4 5", "q1=2.00 q3=4.00 low=-1.00 high=7.00\noutliers: none"], ["10 12 11 13 12 11 -50 95", "q1=10.75 q3=12.25 low=8.50 high=14.50\noutliers: -50 95"], ["5 5 5 5", "q1=5.00 q3=5.00 low=5.00 high=5.00\noutliers: none"]])],
});

// ---------------------------------------------------------------- 9
lessons.push({
  title: "Data Visualisation with Matplotlib: Choosing and Building Charts",
  minutes: 60,
  learn: ["Create line, bar, histogram and scatter charts with the Figure and Axes objects", "Label axes, titles and legends and save figures to files", "Choose the right chart for the question and avoid misleading charts", "Use pandas plotting and a non-interactive backend on servers"],
  why: "A good chart shows a pattern at a glance and a bad one misleads. Dashboards, reports, notebooks and interview take-home tasks all expect clear, honest charts.",
  realWorld: "A monthly report shows sales as a line, department averages as bars, and the spread of marks as a histogram, each with labelled axes and a title that states the point.",
  simple: "In Matplotlib you create a <strong>Figure</strong> (the canvas) with one or more <strong>Axes</strong> (the plots), call methods such as <code>ax.plot</code> or <code>ax.bar</code> to draw, label them, and then show or save the figure.",
  detail: `<p><strong>Install:</strong> <code>python -m pip install matplotlib</code>. Import with <code>import matplotlib.pyplot as plt</code>. In a notebook or on your desktop <code>plt.show()</code> opens the chart; on a server (no screen) choose the non-interactive backend first: <code>matplotlib.use(&quot;Agg&quot;)</code> and save with <code>fig.savefig(&quot;chart.png&quot;, dpi=150)</code>.</p>
<h3>The object-oriented way</h3>
<pre style="background:#16181c;color:#d8dee9;padding:12px 14px;border-radius:8px;overflow:auto"><code>fig, ax = plt.subplots(figsize=(6, 3))
ax.plot(months, sales, marker="o", label="sales")
ax.set_title("Sales by month")
ax.set_xlabel("Month")
ax.set_ylabel("Units")
ax.legend()
fig.tight_layout()
fig.savefig("sales.png", dpi=150)
plt.close(fig)</code></pre>
<p>Use <code>fig, (ax1, ax2) = plt.subplots(1, 2)</code> for several panels. Always <code>plt.close(fig)</code> in scripts that make many charts, or memory grows.</p>
${table(["Chart", "Method", "Best for"], [["line", "<code>ax.plot(x, y)</code>", "change over time"], ["bar", "<code>ax.bar(names, values)</code> / <code>ax.barh</code>", "comparing categories"], ["histogram", "<code>ax.hist(values, bins=10)</code>", "the distribution of one number"], ["scatter", "<code>ax.scatter(x, y)</code>", "relationship between two numbers"], ["box plot", "<code>ax.boxplot(groups)</code>", "spread and outliers per group"], ["pie", "<code>ax.pie(...)</code>", "rarely; bars are easier to compare"]])}
<h3>pandas shortcuts</h3>
<p><code>df[&quot;marks&quot;].plot(kind=&quot;hist&quot;)</code>, <code>df.groupby(&quot;dept&quot;)[&quot;marks&quot;].mean().plot(kind=&quot;bar&quot;)</code> and <code>df.plot(x=&quot;hours&quot;, y=&quot;score&quot;, kind=&quot;scatter&quot;)</code> draw with Matplotlib and return the Axes, so you can still set titles and labels. Seaborn and Plotly build on the same ideas (statistical charts and interactive charts).</p>
<h3>Honest and readable charts</h3>
<ul><li>Title says the message; axes have labels <em>with units</em>.</li><li>Bar charts start at zero; a truncated axis exaggerates differences.</li><li>Do not rely on colour alone (colour-blind readers); add labels or markers. Use few colours, and consistent ones across charts.</li><li>Order categories meaningfully; avoid 3-D effects and clutter.</li><li>Show the amount of data (counts, sample size) when it matters.</li><li>Large fonts for slides; <code>dpi=150</code> or more for reports; vector formats (<code>.svg</code>, <code>.pdf</code>) for print.</li></ul>
<h3>Testing charts</h3>
<p>You rarely compare pixels. Test the data and the decisions: the number of bars, the heights, the labels, the axis limits, and that the file was written. The example does exactly that.</p>`,
  syntax: { code: `import matplotlib\nmatplotlib.use("Agg")\nimport matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.bar(names, values)\nax.set_title("Average marks")\nfig.savefig("marks.png")`, note: "Figure, Axes, draw, label, save, close." },
  diagram: chain("Anatomy of a chart script", "Left to right: prepare the data, create a figure and axes, draw with a plot method, add labels and title, then save and close.",
    [{ k: "io", t: "data\n(lists, DataFrame)" }, { k: "proc", t: "plt.subplots()\nfig, ax" }, { k: "proc", t: "ax.plot /\nax.bar / ax.hist" }, { k: "proc", t: "labels,\ntitle, legend" }, { k: "term", t: "savefig\nclose" }], { w: 140, gap: 28, hgt: 62 }),
  example: { code: `import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8, 3))
months = ["Jan", "Feb", "Mar", "Apr"]
sales = [120, 150, 90, 180]
ax1.plot(months, sales, marker="o", label="sales")
ax1.set_title("Sales")
ax1.set_xlabel("Month")
ax1.set_ylabel("Units")
ax1.legend()
bars = ax2.bar(["CSE", "ECE", "ME"], [77.7, 70.5, 55.0], color="tab:blue")
ax2.set_title("Average marks")
ax2.bar_label(bars)
fig.tight_layout()

print(ax1.get_title(), ax1.get_xlabel(), ax1.get_ylabel(), [t.get_text() for t in ax1.get_legend().get_texts()])
print(len(ax1.lines), len(ax2.patches), [round(float(p.get_height()), 1) for p in ax2.patches])
print(ax1.lines[0].get_ydata().tolist())
print(fig.get_size_inches().tolist(), fig.dpi)

buffer = io.BytesIO()
fig.savefig(buffer, format="png", dpi=80)
print(buffer.getvalue()[:8] == b"\\x89PNG\\r\\n\\x1a\\n", buffer.tell() > 1000)
plt.close(fig)

fig, ax = plt.subplots()
ax.hist([1, 2, 2, 3, 3, 3, 4, 4, 5], bins=5)
print(len(ax.patches), [int(p.get_height()) for p in ax.patches])
ax.scatter([1, 2, 3], [3, 1, 2])
print(len(ax.collections))
print(matplotlib.get_backend())
plt.close(fig)`, out: `Sales Month Units ['sales']
1 3 [77.7, 70.5, 55.0]
[120, 150, 90, 180]
[8.0, 3.0] 100.0
True True
5 [1, 2, 3, 2, 1]
1
Agg` },
  lineByLine: [["matplotlib.use(\"Agg\")", "Selects the non-interactive backend: nothing opens on screen, which is right for servers and tests."], ["plt.subplots(1, 2, figsize=(8, 3))", "One figure 8 by 3 inches with two Axes side by side."], ["ax1.plot(... marker=\"o\", label=\"sales\")", "A line with round markers; the label feeds the legend."], ["ax2.bar(...) and bar_label", "Three bars with their values written on top."], ["ax1.get_title(), get_xlabel(), legend texts", "Reading the chart's settings back: the way to check labels in a test."], ["len(ax2.patches), p.get_height()", "Each bar is a rectangle (patch) whose height is the value."], ["savefig(buffer, format=\"png\")", "Writes the PNG into memory. The PNG signature bytes and a plausible size show a real image was produced."], ["ax.hist(..., bins=5)", "Counts per bin for 1,2,2,3,3,3,4,4,5: 1, 2, 3, 2, 1."], ["plt.close(fig)", "Frees the figure's memory."]],
  dryRun: { intro: "How the histogram bins the data (5 bins between 1 and 5, width 0.8):", headers: ["Bin", "Values inside", "Count"], rows: [["1.0 to 1.8", "1", "1"], ["1.8 to 2.6", "2, 2", "2"], ["2.6 to 3.4", "3, 3, 3", "3"], ["3.4 to 4.2", "4, 4", "2"], ["4.2 to 5.0", "5", "1"]] },
  realExample: { intro: "A reusable function that makes a labelled bar chart from a pandas table and returns the figure for saving or testing.", code: `import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


def average_by(df, group, value, title):
    means = df.groupby(group)[value].mean().sort_values(ascending=False)
    fig, ax = plt.subplots(figsize=(5, 3))
    ax.bar(means.index, means.values)
    ax.set_title(title)
    ax.set_xlabel(group)
    ax.set_ylabel(f"average {value}")
    ax.set_ylim(0, 100)
    return fig, ax


df = pd.DataFrame({"dept": ["CSE", "ECE", "CSE", "ME", "ECE"], "marks": [82, 67, 91, 55, 74]})
fig, ax = average_by(df, "dept", "marks", "Average marks by department")
print(ax.get_title(), "|", ax.get_ylabel(), "|", tuple(float(v) for v in ax.get_ylim()))
print([label.get_text() for label in ax.get_xticklabels()], [round(float(p.get_height()), 1) for p in ax.patches])
plt.close(fig)`, out: `Average marks by department | average marks | (0.0, 100.0)
['CSE', 'ECE', 'ME'] [86.5, 70.5, 55.0]` },
  mistakes: ["Forgetting axis labels and units.", "Starting a bar chart's axis above zero.", "Leaving figures open in a loop, so memory grows.", "Using <code>plt.show()</code> on a server without a display.", "Colour as the only way to tell series apart."],
  practices: ["Use the Figure/Axes style, not only <code>plt.plot</code>.", "Wrap chart code in a function that returns the figure.", "Test counts, heights and labels instead of pixels.", "Pick the chart type from the question."],
  interview: ["Which chart for a distribution? A trend? A comparison?", "What is the Agg backend?", "Figure versus Axes?", "How can a chart mislead?"],
  practiceQs: ["How do you save a chart to a file?", "What does bins control in a histogram?", "Why close figures?", "Which method adds a legend?"],
  revision: ["fig, ax = plt.subplots(); draw; label; savefig; close.", "line = trend, bar = compare, hist = distribution, scatter = relationship.", "Agg backend for servers.", "Honest axes and labels."],
  hinglish: "Matplotlib mein Figure canvas hota hai aur Axes uske andar ke plots. ax.plot, ax.bar, ax.hist se chart banate hain, title aur axis label lagate hain, savefig se file mein rakhte hain aur close karte hain. Trend ke liye line, tulna ke liye bar, distribution ke liye histogram aur do numbers ke relation ke liye scatter use karo.",
  quiz: [
    mcq("Which chart suits showing how one numeric column is distributed?", ["Pie chart", "Histogram", "Line chart of ids", "Bar chart of names"], 1, "A histogram counts values in ranges."),
    mcq("Why use matplotlib.use(\"Agg\") in a server script?", ["It makes charts colourful", "It draws without needing a screen", "It is required by pandas", "It speeds up NumPy"], 1, "Agg renders to files and memory only."),
    mcq("What is wrong with a bar chart whose axis starts at 50?", ["Nothing", "Differences look larger than they are", "It cannot be saved", "It needs a legend"], 1, "Bars encode length, so the baseline should be zero."),
    mcq("Which call writes a figure to a PNG file?", ["fig.savefig(\"out.png\")", "fig.write()", "plt.print()", "ax.export()"], 0, "savefig supports PNG, SVG, PDF and more."),
    mcq("How can a test check a bar chart without comparing pixels?", ["It cannot", "Read the bar heights, labels and title from the Axes", "Take a photo", "Count the file name letters"], 1, "The Axes object exposes patches, tick labels and titles.")
  ],
  tasks: [task("Text histogram", "Read a bin width w, then a line of integers. Bins start at the largest multiple of w that is at most the smallest value and have the form [lo, lo+w). Print one line per bin from the first to the last (including empty bins) as lo-hi: followed by a space and one # per value in the bin (an empty bin prints just lo-hi: with nothing after the colon).", "w = int(input())\nvalues = list(map(int, input().split()))\n# build and print the bins\n", `w = int(input())
values = list(map(int, input().split()))
start = (min(values) // w) * w
last = (max(values) // w) * w
for lo in range(start, last + w, w):
    count = sum(1 for v in values if lo <= v < lo + w)
    print(f"{lo}-{lo + w}:" + (" " + "#" * count if count else ""))`, [["10\n12 18 25 31 33 39 41", "10-20: ##\n20-30: #\n30-40: ###\n40-50: #"], ["5\n1 2 3", "0-5: ###"], ["10\n5 35", "0-10: #\n10-20:\n20-30:\n30-40: #"], ["3\n0 3 3 6 7 7 7", "0-3: #\n3-6: ##\n6-9: ####"]])],
});

module.exports = { lessons };
