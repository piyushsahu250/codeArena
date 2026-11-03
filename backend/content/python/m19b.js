// Phase 5 / Module 19, lessons 4-6: selecting and filtering, cleaning data, and grouping, joining and reshaping.
// Examples need pandas (installed in the course's virtual environment). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 4
lessons.push({
  title: "pandas Selection and Filtering: loc, iloc, Conditions and Sorting",
  minutes: 55,
  learn: ["Select rows and columns by label (loc) and by position (iloc)", "Filter rows with boolean conditions, isin and query", "Sort, rank and take the top or bottom rows", "Update values safely and create categories with cut"],
  why: "Almost every analysis starts with &quot;show me the rows where ...&quot;. Knowing the safe, readable ways to select and update data prevents wrong answers and the confusing warnings that come from chained assignment.",
  realWorld: "A placement officer lists the students of one department who scored above 70, sorted by marks, and then marks everyone below 60 as needing support.",
  simple: "<code>df.loc[rows, columns]</code> selects by <strong>label</strong>, <code>df.iloc[rows, columns]</code> selects by <strong>position</strong>, and a boolean condition inside the brackets keeps only the matching rows.",
  detail: `<h3>Selecting</h3>
${table(["Goal", "Code"], [["one column / several columns", "<code>df[\"marks\"]</code> / <code>df[[\"name\", \"marks\"]]</code>"], ["rows by condition", "<code>df[df[\"marks\"] &gt; 70]</code>"], ["rows and columns by label", "<code>df.loc[df[\"marks\"] &gt; 70, [\"name\", \"marks\"]]</code>"], ["rows and columns by position", "<code>df.iloc[1:3, 0:2]</code> (end excluded, like Python slices)"], ["one value", "<code>df.at[2, \"name\"]</code>, <code>df.iat[2, 0]</code>"], ["by a key column", "<code>df.set_index(\"name\").loc[\"Zoya\", \"marks\"]</code>"], ["SQL-like text condition", "<code>df.query(\"dept == 'CSE' and marks &gt; 85\")</code>"], ["membership", "<code>df[\"dept\"].isin([\"CSE\", \"ME\"])</code>"], ["text tests", "<code>df[\"name\"].str.startswith(\"A\")</code>, <code>.str.contains(...)</code>"]])}
<h3>Conditions</h3>
<p>Combine conditions with <code>&amp;</code> (and), <code>|</code> (or), <code>~</code> (not) and put <strong>each condition in brackets</strong>: <code>df[(df.dept == &quot;ECE&quot;) | (df.marks &gt; 90)]</code>. The words <code>and</code>/<code>or</code> do not work on columns.</p>
<h3>Sorting and ranking</h3>
<p><code>sort_values(&quot;marks&quot;, ascending=False)</code>, several keys with <code>sort_values([&quot;dept&quot;, &quot;marks&quot;], ascending=[True, False])</code>, <code>sort_index()</code>, <code>nlargest(2, &quot;marks&quot;)</code>, <code>nsmallest</code>, <code>rank(ascending=False)</code>, <code>sample(n, random_state=1)</code> for a reproducible random sample.</p>
<h3>Updating safely</h3>
<p>Use <code>df.loc[condition, &quot;column&quot;] = value</code> in one step. Do <strong>not</strong> write <code>df[condition][&quot;column&quot;] = value</code> (chained assignment): it changes a temporary copy and the original table stays the same. Remember that <code>df[condition]</code> is itself a new table.</p>
<h3>Categories from numbers</h3>
<p><code>pd.cut(df[&quot;marks&quot;], bins=[0, 59, 79, 100], labels=[&quot;C&quot;, &quot;B&quot;, &quot;A&quot;])</code> puts each value in a labelled range (bins are right-inclusive: 0 &lt; x &lt;= 59 and so on). <code>pd.qcut</code> makes equal-sized groups (quantiles).</p>`,
  syntax: { code: `df.loc[df["marks"] > 70, ["name", "marks"]]\ndf.iloc[1:3, 0:2]\ndf.query("dept == 'CSE'")\ndf.sort_values("marks", ascending=False)`, note: "Brackets around each condition; & | ~ for and, or, not." },
  diagram: chain("From question to answer", "Left to right: a condition builds a boolean mask over the rows, the mask filters the table, then sort and pick the columns you need.",
    [{ k: "dec", t: "condition\nmarks > 70" }, { k: "proc", t: "boolean\nmask" }, { k: "proc", t: "filtered\nrows" }, { k: "term", t: "sort and\nchoose columns" }], { w: 150, gap: 40, hgt: 62 }),
  example: { code: `import pandas as pd

students = pd.DataFrame({
    "name": ["Asha", "Ravi", "Zoya", "Kabir", "Meera"],
    "dept": ["CSE", "ECE", "CSE", "ME", "ECE"],
    "marks": [82, 67, 91, 55, 74],
    "year": [2, 3, 2, 1, 3],
})
print(students.loc[students["marks"] > 70, ["name", "marks"]])
print(students.iloc[1:3, 0:2])
print(students.query("dept == 'CSE' and marks > 85"))
print(students.sort_values("marks", ascending=False).head(3)["name"].tolist())

students["grade"] = pd.cut(students["marks"], bins=[0, 59, 79, 100], labels=["C", "B", "A"])
print(students[["name", "grade"]].to_string(index=False))
print(students["dept"].isin(["CSE", "ME"]).sum())
print(students.set_index("name").loc["Zoya", "marks"])`, out: `    name  marks
0   Asha     82
2   Zoya     91
4  Meera     74
   name dept
1  Ravi  ECE
2  Zoya  CSE
   name dept  marks  year
2  Zoya  CSE     91     2
['Zoya', 'Asha', 'Meera']
 name grade
 Asha     A
 Ravi     B
 Zoya     A
Kabir     C
Meera     B
3
91
` },
  lineByLine: [["loc[mask, [\"name\", \"marks\"]]", "Rows where marks > 70 (labels 0, 2, 4) and only two columns."], ["iloc[1:3, 0:2]", "Positions 1 and 2, columns 0 and 1; the end of each slice is excluded."], ["query(\"dept == 'CSE' and marks > 85\")", "The condition as text; here it can use the words and / or."], ["sort_values(...).head(3)", "The three highest marks: Zoya 91, Asha 82, Meera 74."], ["pd.cut(..., bins=[0, 59, 79, 100])", "55 falls in (0, 59] = C; 67 and 74 in (59, 79] = B; 82 and 91 in (79, 100] = A."], ["isin([\"CSE\", \"ME\"]).sum()", "True counts as 1: Asha, Zoya, Kabir."], ["set_index(\"name\").loc[\"Zoya\", \"marks\"]", "With name as the index you can look up a row by name."]],
  dryRun: { intro: "Evaluating <code>students[\"marks\"] &gt; 70</code> for the first filter:", headers: ["Row", "marks", "marks > 70", "Kept"], rows: [["0 Asha", "82", "True", "yes"], ["1 Ravi", "67", "False", "no"], ["2 Zoya", "91", "True", "yes"], ["3 Kabir", "55", "False", "no"], ["4 Meera", "74", "True", "yes"]] },
  realExample: { intro: "Several kinds of filters, a safe update with loc, and positional access.", code: `import pandas as pd

df = pd.DataFrame({"name": ["Asha", "Ravi", "Zoya", "Kabir", "Meera"], "dept": ["CSE", "ECE", "CSE", "ME", "ECE"], "marks": [82, 67, 91, 55, 74]})
print(df[(df["dept"] == "ECE") | (df["marks"] > 90)]["name"].tolist())
print(df[~df["dept"].isin(["CSE"])]["name"].tolist())
print(df.sort_values(["dept", "marks"], ascending=[True, False])["name"].tolist())
print(df.nlargest(2, "marks")["name"].tolist(), df.nsmallest(1, "marks")["name"].tolist())
print(df["name"].str.startswith("A").tolist(), df["name"].str.len().tolist())
print(df.loc[df["marks"] >= 70, "marks"].mean())

df.loc[df["marks"] < 60, "marks"] = 60
print(df["marks"].tolist())
print(df.at[2, "name"], df.iloc[-1]["name"], df.iloc[:, 1].tolist())
print(df.drop(index=[0, 1]).reset_index(drop=True))`, out: `['Ravi', 'Zoya', 'Meera']
['Ravi', 'Kabir', 'Meera']
['Zoya', 'Asha', 'Meera', 'Ravi', 'Kabir']
['Zoya', 'Asha'] ['Kabir']
[True, False, False, False, False] [4, 4, 4, 5, 5]
82.33333333333333
[82, 67, 91, 60, 74]
Zoya Meera ['CSE', 'ECE', 'CSE', 'ME', 'ECE']
    name dept  marks
0   Zoya  CSE     91
1  Kabir   ME     60
2  Meera  ECE     74` },
  mistakes: ["Using <code>and</code>/<code>or</code> or forgetting the brackets in a combined condition.", "Chained assignment: <code>df[df.x &gt; 1][&quot;y&quot;] = 0</code>.", "Mixing up <code>loc</code> (labels, end included) and <code>iloc</code> (positions, end excluded).", "Assuming the index is 0..n-1 after filtering.", "Sorting but forgetting to keep the result."],
  practices: ["Name your conditions for readability.", "Use <code>loc</code> for updates.", "Call <code>reset_index(drop=True)</code> when the old labels no longer matter.", "Check the number of rows after each filter."],
  interview: ["loc versus iloc?", "How do you combine two conditions?", "What is chained assignment and why avoid it?", "How do you get the top 3 rows by a column?"],
  practiceQs: ["How do you select rows where dept is ECE?", "What does df.iloc[:, 1] return?", "How do you set marks below 60 to 60?", "What does isin do?"],
  revision: ["loc = labels, iloc = positions.", "& | ~ with brackets.", "query for readable conditions.", "Update with df.loc[mask, col] = value."],
  hinglish: "loc label se aur iloc position se select karta hai. Condition ko bracket mein rakho aur & | ~ use karo. Value badalne ke liye df.loc[condition, 'column'] = value likho, chained assignment mat karo.",
  quiz: [
    mcq("Which expression keeps the rows where dept is CSE and marks exceed 80?", ["df[df.dept == 'CSE' and df.marks > 80]", "df[(df.dept == 'CSE') & (df.marks > 80)]", "df[df.dept == 'CSE' & df.marks > 80]", "df.filter('CSE', 80)"], 1, "Use & with brackets around each condition."),
    mcq("What does df.iloc[1:3] return?", ["Rows at positions 1 and 2", "Rows at positions 1, 2 and 3", "Rows with labels 1 to 3 including 3", "Columns 1 and 2"], 0, "iloc slices exclude the end position."),
    mcq("Which line correctly sets marks below 60 to 60?", ["df[df.marks < 60]['marks'] = 60", "df.loc[df.marks < 60, 'marks'] = 60", "df.marks < 60 = 60", "df.set(60)"], 1, "loc with a condition and a column name updates the table itself."),
    mcq("What does df.nlargest(2, 'marks') return?", ["The two smallest marks", "The two rows with the highest marks", "Two random rows", "The two longest names"], 1, "It is a shortcut for sort and head."),
    mcq("In pd.cut with bins [0, 59, 79, 100], which bin holds the value 59?", ["The first bin (0, 59]", "The second bin", "None", "An error is raised"], 0, "Bins are closed on the right by default.")
  ],
  tasks: [task("Filter and sort a table", "Read n, then n rows name,dept,marks, then a query line such as dept=CSE min=70 (dept=* means any department). Print the names of rows in that department (or any) with marks at least min, one per line, sorted by marks from high to low and by name for ties. Print no match when none qualifies.", "n = int(input())\nrows = [input().split(\",\") for _ in range(n)]\nquery = input().split()\n# filter and sort\n", `n = int(input())
rows = [input().split(",") for _ in range(n)]
dept, low = (part.split("=")[1] for part in input().split())
low = float(low)
chosen = [(-float(marks), name) for name, d, marks in rows if dept in ("*", d) and float(marks) >= low]
if chosen:
    for _, name in sorted(chosen):
        print(name)
else:
    print("no match")`, [["5\nAsha,CSE,82\nRavi,ECE,67\nZoya,CSE,91\nKabir,ME,55\nMeera,ECE,74\ndept=* min=70", "Zoya\nAsha\nMeera"], ["5\nAsha,CSE,82\nRavi,ECE,67\nZoya,CSE,91\nKabir,ME,55\nMeera,ECE,74\ndept=CSE min=85", "Zoya"], ["2\nAsha,CSE,82\nKabir,ME,55\ndept=ME min=70", "no match"], ["3\nA,X,80\nB,X,80\nC,X,90\ndept=X min=80", "C\nA\nB"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Data Cleaning: Missing Values, Duplicates, Types, Text and Dates",
  minutes: 60,
  learn: ["Find and handle missing values", "Remove duplicates and fix inconsistent text", "Convert columns to the right types, including dates", "Validate data and keep a repeatable cleaning script"],
  why: "Real data is messy: blanks, typos, mixed formats, duplicates and impossible values. Analysts commonly spend most of their time cleaning, and wrong cleaning silently produces wrong conclusions.",
  realWorld: "A college exports student data from three systems: department names appear as CSE, cse and Cse, some marks are blank, one date says &quot;not a date&quot;, and a row is repeated. Before any report, the data must be cleaned the same way every time.",
  simple: "Look first (what is missing, repeated or the wrong type?), decide what each problem means for <em>your</em> question, fix it in code you can re-run, and check the result. <strong>Never edit the raw file by hand.</strong>",
  detail: `<h3>Missing values</h3>
${table(["Task", "Code"], [["count per column", "<code>df.isna().sum()</code>"], ["drop rows with any / specific missing", "<code>df.dropna()</code>, <code>df.dropna(subset=[\"marks\"])</code>"], ["fill with a constant", "<code>df[\"marks\"].fillna(0)</code>"], ["fill with a statistic", "<code>df[\"marks\"].fillna(df[\"marks\"].median())</code>"], ["fill forward from the previous row", "<code>df[\"price\"].ffill()</code>"], ["a flag column", "<code>df[\"marks_missing\"] = df[\"marks\"].isna()</code>"]])}
<p>There is no single right choice. Dropping loses rows; filling with 0 can pretend the student scored zero; filling with the median is common but hides uncertainty. Decide from what the data means, and record the decision. Missing numbers are <code>NaN</code> (<code>NaN != NaN</code>, so use <code>isna()</code>, not <code>== np.nan</code>) and missing dates are <code>NaT</code>.</p>
<h3>Duplicates</h3>
<p><code>df.duplicated()</code> marks repeats, <code>df.drop_duplicates()</code> removes them (<code>subset=[...]</code> chooses the key columns, <code>keep=&quot;first&quot;</code> or <code>&quot;last&quot;</code>). Clean the text <em>before</em> checking duplicates, otherwise &quot;Ravi&quot; and &quot; ravi&quot; look different.</p>
<h3>Text</h3>
<p>The <code>.str</code> accessor: <code>strip()</code>, <code>lower()</code>, <code>upper()</code>, <code>title()</code>, <code>replace(pattern, new, regex=True)</code>, <code>contains()</code>, <code>split()</code>, <code>len()</code>. <code>df[&quot;dept&quot;].replace({&quot;CSE&quot;: &quot;Computer Science&quot;})</code> maps whole values.</p>
<h3>Types and dates</h3>
<p><code>astype(int)</code> fails on missing values, so fill first or use nullable types such as <code>&quot;Int64&quot;</code>. <code>pd.to_numeric(col, errors=&quot;coerce&quot;)</code> turns bad entries into NaN instead of raising. <code>pd.to_datetime(col, errors=&quot;coerce&quot;)</code> parses dates; pass <code>format=&quot;%d/%m/%Y&quot;</code> for day-first dates because ambiguous formats like 03/04/2026 are guessed otherwise. Then use <code>.dt.year</code>, <code>.dt.month</code>, <code>.dt.day_name()</code>, and subtract dates to get differences.</p>
<h3>Validation</h3>
<p>Check ranges and rules after cleaning: <code>assert df[&quot;marks&quot;].between(0, 100).all()</code>, unique ids with <code>df[&quot;id&quot;].is_unique</code>, allowed values with <code>isin</code>. Put the steps in one function, run it on the raw file, and keep the raw file untouched.</p>`,
  syntax: { code: `df["name"] = df["name"].str.strip()\ndf = df.drop_duplicates()\ndf["marks"] = df["marks"].fillna(df["marks"].median())\ndf["joined"] = pd.to_datetime(df["joined"], errors="coerce")`, note: "Clean text first, then duplicates, then types." },
  diagram: chain("A cleaning pipeline", "Left to right: load the raw data, inspect it, fix text, remove duplicates, handle missing values, convert types, then validate.",
    [{ k: "io", t: "raw data" }, { k: "proc", t: "inspect" }, { k: "proc", t: "fix text" }, { k: "proc", t: "dedupe" }, { k: "proc", t: "missing +\ntypes" }, { k: "term", t: "validate" }], { w: 110, gap: 28, hgt: 56 }),
  example: { code: `import io
import pandas as pd

raw = """name,dept,marks,joined
 Asha ,cse,82,2024-07-01
Ravi,ECE,,2024-07-03
Zoya,CSE,91,not a date
Ravi,ECE,,2024-07-03
Kabir,me,55,2024-08-01
"""
df = pd.read_csv(io.StringIO(raw))
print(df.isna().sum().to_dict())

df["name"] = df["name"].str.strip()
df["dept"] = df["dept"].str.upper()
df = df.drop_duplicates()
print(len(df))

df["marks"] = df["marks"].fillna(df["marks"].median())
print(df["marks"].tolist())

df["joined"] = pd.to_datetime(df["joined"], errors="coerce")
print(df["joined"].isna().sum(), df["joined"].dt.month.tolist())
print(df.dtypes["marks"], df["marks"].astype(int).tolist())
print(df.dropna(subset=["joined"]).shape)

df = df.rename(columns={"joined": "join_date"})
print(list(df.columns))
print(df["dept"].replace({"CSE": "Computer Science"}).tolist())
print(df.reset_index(drop=True))`, out: `{'name': 0, 'dept': 0, 'marks': 2, 'joined': 0}
4
[82.0, 82.0, 91.0, 55.0]
1 [7.0, 7.0, nan, 8.0]
float64 [82, 82, 91, 55]
(3, 4)
['name', 'dept', 'marks', 'join_date']
['Computer Science', 'ECE', 'Computer Science', 'ME']
    name dept  marks  join_date
0   Asha  CSE   82.0 2024-07-01
1   Ravi  ECE   82.0 2024-07-03
2   Zoya  CSE   91.0        NaT
3  Kabir   ME   55.0 2024-08-01` },
  lineByLine: [["isna().sum()", "Ravi's blank marks appear twice, so marks has 2 missing values."], ["str.strip() and str.upper()", "Removes the spaces around Asha and makes department codes consistent."], ["drop_duplicates()", "The two identical Ravi rows become one: 5 rows to 4. The earlier text cleaning mattered; here the rows were already identical."], ["fillna(median)", "The median of the known marks 82, 91 and 55 is 82, which fills Ravi's blank. Marks turns into floats because it once held NaN."], ["to_datetime(errors=\"coerce\")", "'not a date' becomes NaT instead of crashing; the month list shows nan for it."], ["astype(int)", "Possible now that no NaN remains."], ["dropna(subset=[\"joined\"])", "Removes only rows where the date is missing: 3 rows left."], ["replace({...})", "Maps whole values to new text; the original column is unchanged."]],
  dryRun: { intro: "Why the median is 82:", headers: ["Step", "Values"], rows: [["marks after dedupe", "82, NaN, 91, 55"], ["ignore NaN, sort", "55, 82, 91"], ["middle value", "82"]] },
  realExample: { intro: "Cleaning phone numbers and amounts with regular expressions; bad entries become NaN instead of crashing.", code: `import pandas as pd

raw = pd.DataFrame({"phone": ["98765 43210", "+91-98765-43211", "12345", None], "amount": ["1,200", "Rs 450", "n/a", "300"]})
raw["digits"] = raw["phone"].str.replace(r"\\D", "", regex=True).str[-10:]
raw["valid_phone"] = raw["digits"].str.len() == 10
raw["amount_num"] = pd.to_numeric(raw["amount"].str.replace(r"\\D", "", regex=True), errors="coerce")
print(raw[["digits", "valid_phone", "amount_num"]])
print(raw["amount_num"].sum(), raw["amount_num"].isna().sum())
print(raw["amount"].str.contains("n/a").tolist())`, out: `       digits  valid_phone  amount_num
0  9876543210         True      1200.0
1  9876543211         True       450.0
2       12345        False         NaN
3         NaN        False       300.0
1950.0 1
[False, False, True, False]` },
  mistakes: ["Filling every missing value with 0 without thinking.", "Checking duplicates before cleaning text and case.", "Editing the raw file by hand, so nobody can repeat the cleaning.", "Letting dates be guessed from ambiguous formats.", "Silently dropping rows and never reporting how many."],
  practices: ["Count missing values, duplicates and bad types before and after cleaning.", "Write cleaning as a function or script that starts from the raw file.", "Document each decision (why median, why drop).", "Validate ranges and keys at the end."],
  interview: ["How do you handle missing values?", "Why use errors=\"coerce\"?", "Mean or median for filling?", "How do you find duplicate rows?"],
  practiceQs: ["What is NaT?", "How do you remove leading and trailing spaces in a column?", "Why does astype(int) fail on a column with NaN?", "How do you parse day-first dates?"],
  revision: ["isna().sum(), dropna, fillna.", "Clean text, then drop_duplicates.", "to_numeric / to_datetime with errors=\"coerce\".", "Validate and keep the raw data untouched."],
  hinglish: "Asli data mein blank, typo, duplicate aur galat format hote hain. Pehle dekho kya missing hai, text saaf karo (strip, upper), phir duplicates hatao, missing values ko soch kar bharo (median aam hai) aur dates ko to_datetime se parse karo. Raw file ko haath se mat badlo.",
  quiz: [
    mcq("What does pd.to_numeric(col, errors=\"coerce\") do with the text n/a?", ["Raises an error", "Turns it into NaN", "Turns it into 0", "Leaves it as text"], 1, "coerce converts values that cannot be parsed into NaN."),
    mcq("Why clean text before calling drop_duplicates?", ["It is faster", "Ravi and ravi with spaces would look like different rows", "drop_duplicates needs text", "No reason"], 1, "Duplicates are found by exact comparison."),
    mcq("Which call counts missing values in each column?", ["df.isna().sum()", "df.missing()", "df.count()", "df.shape"], 0, "isna gives True for missing values; sum counts them."),
    mcq("What does NaT stand for?", ["Not a Table", "Not a Time (a missing date value)", "Null at Top", "New Active Type"], 1, "It is the missing-value marker for dates."),
    mcq("Why can astype(int) fail on a marks column?", ["Ints are not supported", "NaN cannot be converted to an integer", "Because of the index", "It never fails"], 1, "Fill or drop the missing values first, or use a nullable integer type.")
  ],
  tasks: [task("Clean a table", "Read n, then n rows name,dept,marks. Clean them: strip spaces around every field and make the department upper case. Remove exact duplicate rows after cleaning (keep the first). If marks is empty, fill it with the median of the marks that are present in the remaining rows. Print each row as name,DEPT,marks, in the original order, writing marks without a decimal part when it is a whole number (12.5 stays 12.5).", "import statistics\nn = int(input())\nrows = []\nfor _ in range(n):\n    name, dept, marks = (part.strip() for part in input().split(\",\"))\n    # collect cleaned rows\n", `import statistics

n = int(input())
rows = []
for _ in range(n):
    name, dept, marks = (part.strip() for part in input().split(","))
    row = (name, dept.upper(), marks)
    if row not in rows:
        rows.append(row)
known = [float(marks) for _, _, marks in rows if marks]
fill = statistics.median(known)
for name, dept, marks in rows:
    value = float(marks) if marks else fill
    print(f"{name},{dept},{value:g}")`, [["5\n Asha ,cse,82\nRavi,ECE,\nZoya,CSE,91\nRavi,ECE,\nKabir,me,55", "Asha,CSE,82\nRavi,ECE,82\nZoya,CSE,91\nKabir,ME,55"], ["2\nA,x,10\nB,y,20", "A,X,10\nB,Y,20"], ["3\nA,x,\nB,y,10\nC,z,15", "A,X,12.5\nB,Y,10\nC,Z,15"], ["3\nA,x,5\n a ,X,5\nA,x,5", "A,X,5\na,X,5"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Transforming Data: groupby, merge, concat, pivot and Reshaping",
  minutes: 60,
  learn: ["Summarise data by group with groupby and agg", "Add group-aware columns with transform and cumulative functions", "Join tables with merge and stack tables with concat", "Reshape with pivot_table, melt and pivot"],
  why: "Business questions are rarely about single rows: average marks per department, revenue per month, customers with no orders. Grouping, joining and reshaping answer them, and they are the pandas version of SQL's GROUP BY and JOIN.",
  realWorld: "The principal wants average and best marks per department and the department head's name next to each student. You group the results, then merge in a table of departments.",
  simple: "<strong>Split-apply-combine</strong>: split the rows into groups, calculate something for each group, combine the answers into a table. <strong>merge</strong> matches rows of two tables on a key column, like a SQL JOIN.",
  detail: `<h3>groupby</h3>
<ul><li><code>df.groupby(&quot;dept&quot;)[&quot;marks&quot;].mean()</code> one statistic per group.</li><li><code>df.groupby(&quot;dept&quot;)[&quot;marks&quot;].agg([&quot;count&quot;, &quot;mean&quot;, &quot;max&quot;])</code> several at once; <code>agg(avg=(&quot;marks&quot;, &quot;mean&quot;), best=(&quot;marks&quot;, &quot;max&quot;))</code> names the outputs.</li><li>Group by several columns with a list. Add <code>.reset_index()</code> to turn the group labels back into ordinary columns.</li><li><code>transform</code> returns a value for <em>every original row</em> (for example each row's share of its group total); <code>agg</code> returns one row per group.</li><li><code>size()</code> counts rows (including missing), <code>count()</code> counts non-missing values.</li></ul>
<h3>Joining tables</h3>
${table(["how=", "Keeps", "SQL equivalent"], [["inner", "keys found in both tables", "INNER JOIN"], ["left", "all left rows; right values NaN where unmatched", "LEFT JOIN"], ["right", "all right rows", "RIGHT JOIN"], ["outer", "all rows from both", "FULL OUTER JOIN"]])}
<p><code>left.merge(right, on=&quot;dept&quot;, how=&quot;left&quot;)</code>; use <code>left_on=</code> / <code>right_on=</code> when the key columns have different names, and <code>validate=&quot;many_to_one&quot;</code> to catch accidental duplicate keys that would multiply rows. <code>pd.concat([a, b])</code> stacks tables with the same columns (rows), or side by side with <code>axis=1</code>.</p>
<h3>Reshaping</h3>
<ul><li><code>pivot_table(index=&quot;dept&quot;, columns=&quot;year&quot;, values=&quot;marks&quot;, aggfunc=&quot;mean&quot;)</code> makes a summary grid (like an Excel pivot table).</li><li><code>melt</code> turns wide data (one column per month) into long data (one row per student-month); <code>pivot</code> goes back.</li><li>Long (tidy) data is the best shape for grouping and plotting.</li></ul>
<h3>Other useful tools</h3>
<p><code>apply(func)</code> runs a function per value (slow for large data; prefer vectorised code), <code>cumsum()</code>, <code>rank()</code>, <code>rolling(3).mean()</code> for moving averages, <code>value_counts()</code>, <code>pd.crosstab</code>, <code>df.sort_values().groupby().head(2)</code> for the top rows per group.</p>`,
  syntax: { code: `df.groupby("dept").agg(avg=("marks", "mean"), best=("marks", "max"))\nstudents.merge(depts, on="dept", how="left")\npd.concat([a, b])\ndf.pivot_table(index="dept", values="marks", aggfunc="mean")`, note: "Split, apply, combine; merge on a key." },
  diagram: graph("Split, apply, combine", "A table is split into one group per department, a calculation is applied to each group, and the answers are combined into a summary table.", 760, 230,
    [{ id: "t", k: "io", t: "students table", x: 100, y: 115, w: 160, h: 54 }, { id: "g1", k: "proc", t: "CSE rows", x: 360, y: 40, w: 130, h: 40 }, { id: "g2", k: "proc", t: "ECE rows", x: 360, y: 115, w: 130, h: 40 }, { id: "g3", k: "proc", t: "ME rows", x: 360, y: 190, w: 130, h: 40 }, { id: "r", k: "term", t: "summary\ntable", x: 650, y: 115, w: 150, h: 60 }],
    [{ from: "t", to: "g1" }, { from: "t", to: "g2" }, { from: "t", to: "g3" }, { from: "g1", to: "r" }, { from: "g2", to: "r" }, { from: "g3", to: "r" }]),
  example: { code: `import pandas as pd

students = pd.DataFrame({
    "name": ["Asha", "Ravi", "Zoya", "Kabir", "Meera", "Dev"],
    "dept": ["CSE", "ECE", "CSE", "ME", "ECE", "CSE"],
    "marks": [82, 67, 91, 55, 74, 60],
})
print(students.groupby("dept")["marks"].agg(["count", "mean", "max"]))
print(students.groupby("dept").agg(avg=("marks", "mean"), best=("marks", "max")).round(1).to_string())

depts = pd.DataFrame({"dept": ["CSE", "ECE", "ME"], "head": ["Dr. Rao", "Dr. Iyer", "Dr. Shah"]})
merged = students.merge(depts, on="dept", how="left")
print(merged[["name", "head"]].head(3).to_string(index=False))
print(pd.concat([students.head(1), students.tail(1)])["name"].tolist())

print(students.pivot_table(index="dept", values="marks", aggfunc="mean").round(2))
students["rank"] = students["marks"].rank(ascending=False).astype(int)
print(students.sort_values("rank")[["name", "rank"]].head(3).to_string(index=False))
print(students["marks"].apply(lambda m: "pass" if m >= 60 else "fail").value_counts().to_dict())`, out: `      count       mean  max
dept
CSE       3  77.666667   91
ECE       2  70.500000   74
ME        1  55.000000   55
       avg  best
dept
CSE   77.7    91
ECE   70.5    74
ME    55.0    55
name     head
Asha  Dr. Rao
Ravi Dr. Iyer
Zoya  Dr. Rao
['Asha', 'Dev']
      marks
dept
CSE   77.67
ECE   70.50
ME    55.00
 name  rank
 Zoya     1
 Asha     2
Meera     3
{'pass': 5, 'fail': 1}` },
  lineByLine: [["groupby(\"dept\")[\"marks\"].agg([...])", "Three departments, each with count, mean and max of marks. The group label becomes the index."], ["agg(avg=(\"marks\", \"mean\"), ...)", "Named aggregation gives clear column names."], ["merge(depts, on=\"dept\", how=\"left\")", "Every student keeps their row and gains the head of their department."], ["pd.concat([head(1), tail(1)])", "Stacks the first and last row into one table."], ["pivot_table(... aggfunc=\"mean\")", "A summary grid of average marks per department."], ["rank(ascending=False)", "1 is the highest mark."], ["apply(lambda ...).value_counts()", "Classifies each mark as pass or fail and counts them: five pass, one fails."]],
  dryRun: { intro: "Splitting the CSE group (Asha 82, Zoya 91, Dev 60):", headers: ["Statistic", "Calculation", "Result"], rows: [["count", "3 rows", "3"], ["mean", "(82 + 91 + 60) / 3", "77.666667"], ["max", "largest of 82, 91, 60", "91"]] },
  realExample: { intro: "Per-group shares and running totals with transform, a join that shows unmatched rows, and wide-to-long reshaping.", code: `import pandas as pd

sales = pd.DataFrame({"day": ["Mon", "Mon", "Tue", "Tue", "Tue"], "amount": [100, 50, 70, 30, 20]})
sales["running"] = sales["amount"].cumsum()
sales["share_of_day"] = (sales["amount"] / sales.groupby("day")["amount"].transform("sum")).round(2)
print(sales)

a = pd.DataFrame({"id": [1, 2, 3], "x": ["p", "q", "r"]})
b = pd.DataFrame({"id": [2, 3, 4], "y": [20, 30, 40]})
print(a.merge(b, on="id", how="inner")["id"].tolist(), a.merge(b, on="id", how="left")["y"].tolist(), a.merge(b, on="id", how="outer").shape)

wide = pd.DataFrame({"name": ["A", "B"], "m1": [1, 2], "m2": [3, 4]})
long = wide.melt(id_vars="name", var_name="month", value_name="score")
print(long.to_string(index=False))
print(long.pivot(index="name", columns="month", values="score").to_string())`, out: `   day  amount  running  share_of_day
0  Mon     100      100          0.67
1  Mon      50      150          0.33
2  Tue      70      220          0.58
3  Tue      30      250          0.25
4  Tue      20      270          0.17
[2, 3] [nan, 20.0, 30.0] (4, 3)
name month  score
   A    m1      1
   B    m1      2
   A    m2      3
   B    m2      4
month  m1  m2
name
A       1   3
B       2   4` },
  mistakes: ["Merging on a key with duplicates and silently multiplying rows.", "Using an inner join when the unmatched rows matter.", "Looping over groups in Python when <code>agg</code> would do.", "Forgetting <code>reset_index()</code> and then being surprised the group label is an index.", "Averaging averages instead of using the underlying rows."],
  practices: ["Check row counts before and after a merge.", "Use <code>validate=</code> in merges.", "Name aggregations.", "Keep data in long (tidy) form for analysis."],
  interview: ["agg versus transform?", "Explain left, inner and outer join.", "What is a pivot table?", "How do you find the top 2 rows per group?"],
  practiceQs: ["How do you count rows per department?", "What happens to unmatched rows in a left merge?", "When use melt?", "What does pd.concat do?"],
  revision: ["groupby: split, apply, combine.", "merge how= inner/left/right/outer.", "transform keeps the original number of rows.", "melt = wide to long, pivot = long to wide."],
  hinglish: "groupby data ko groups mein todta hai, har group par hisaab lagata hai aur jawab jodta hai. merge do tables ko key column par milata hai, bilkul SQL JOIN ki tarah. transform har row ke liye group ki value deta hai, jabki agg har group ke liye ek row.",
  quiz: [
    mcq("What is the difference between agg and transform in a groupby?", ["None", "agg returns one row per group; transform returns a value for every original row", "transform removes rows", "agg only works on text"], 1, "transform keeps the original length, so you can add the result as a column."),
    mcq("Which join keeps every row of the left table?", ["inner", "left", "outer only", "cross only"], 1, "A left join keeps all left rows and fills unmatched right values with NaN."),
    mcq("What does melt do?", ["Deletes columns", "Turns wide data into long data", "Sorts rows", "Joins tables"], 1, "It stacks several columns into variable and value columns."),
    mcq("A merge unexpectedly returns more rows than the left table. What is the likely cause?", ["The key has duplicates in the right table", "NaN values", "The index is sorted", "The tables are the same size"], 0, "One left row matches several right rows."),
    mcq("What does df.groupby('dept').size() count?", ["Distinct departments", "Rows in each department", "Columns", "Missing values only"], 1, "size counts rows per group, including rows with missing values.")
  ],
  tasks: [task("Group summary", "Read n, then n lines dept marks. For every department in alphabetical order print DEPT count=N mean=M max=X, where the mean has 1 decimal and the maximum is printed as it was given (an integer).", "from collections import defaultdict\nn = int(input())\ngroups = defaultdict(list)\n# collect the marks per department and print the summary\n", `from collections import defaultdict

n = int(input())
groups = defaultdict(list)
for _ in range(n):
    dept, marks = input().split()
    groups[dept].append(int(marks))
for dept in sorted(groups):
    marks = groups[dept]
    print(f"{dept} count={len(marks)} mean={sum(marks) / len(marks):.1f} max={max(marks)}")`, [["6\nCSE 82\nECE 67\nCSE 91\nME 55\nECE 74\nCSE 60", "CSE count=3 mean=77.7 max=91\nECE count=2 mean=70.5 max=74\nME count=1 mean=55.0 max=55"], ["1\nX 10", "X count=1 mean=10.0 max=10"], ["4\nB 1\nA 2\nB 4\nA 3", "A count=2 mean=2.5 max=3\nB count=2 mean=2.5 max=4"], ["3\nZ 100\nZ 99\nZ 98", "Z count=3 mean=99.0 max=100"]])],
});

module.exports = { lessons };
