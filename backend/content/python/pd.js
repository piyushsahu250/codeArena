// Phase 6, major projects 1-3: Student Management System, Personal Expense Tracker, Online Quiz and Examination System.
// The Python of each project lives in proj/<id>/ as real files (run and tested by the validator); this file holds the guide.
"use strict";
const { chain, flow } = require("./render");
const { task, rubric } = require("./lib");
const { read, files } = require("./proj/load");

const judged = (title, statement, starter, solution, cases, hints) => ({ ...task(title, statement, starter, solution, cases), hints });
const manual = (title, instructions, hints) => ({ title, instructions, hints });
const lessons = [];

// ---------------------------------------------------------------- 1 Student Management System
lessons.push({
  title: "Major Project 1: Student Management System",
  minutes: 360,
  project: {
    id: "student-management-system", kind: "MAJOR", difficulty: "MEDIUM", minutes: 360, packages: [],
    problem: "Build a student management system with an object-oriented design and a SQLite database. It must create, read, update and delete students, filter and search them, record marks and report averages, and reject invalid data at every entry point.",
    scenario: "A department office tracks students in spreadsheets: duplicate roll numbers, typos in emails and no way to ask 'who is in year 3 of CSE?'. A small system with a real database, validation in one place and clear errors replaces the chaos, and it is the same shape as thousands of admin tools in industry.",
    objectives: ["Design classes with clear responsibilities (a validated value object, a repository, a command handler)", "Use SQLite with a normalised schema, constraints, foreign keys and parameterised queries", "Implement CRUD, filtering and search without SQL injection", "Validate and clean input in one place and turn failures into clear messages", "Test a database-backed program with an in-memory database"],
    prerequisites: ["Classes, dataclasses and exceptions (Modules 11 to 13)", "SQL basics and the sqlite3 module (Module 16)", "Regular expressions for validation", "Modules and unit testing (Modules 14 and 15)"],
    requirements: ["Student has a roll number, name, email, course (CSE, ECE, ME, CIVIL) and year (1 to 4); roll numbers and emails are unique", "add, update, delete and show by roll number; only name, email, course and year can be changed", "list with optional filters course= and year=, and search by part of the name or email (ignoring case)", "mark ROLL SUBJECT SCORE records a score from 0 to 100; recording the same subject again replaces the score", "report prints every student's number of subjects and average, and the average per course", "Deleting a student also deletes the marks; all SQL uses placeholders; every failure prints Error: and a message, never a traceback"],
    architecture: chain("Student management architecture", "Commands arrive as text lines. The command handler parses them and calls the repository. The repository is the only code that talks SQL; it uses the Student class, which validates raw input into a clean object. SQLite stores the data.",
      [{ k: "io", t: "command\nlines" }, { k: "proc", t: "handle()\nparse + print" }, { k: "proc", t: "Student\nvalidation" }, { k: "proc", t: "StudentRepository\nall SQL" }, { k: "proc", t: "SQLite\ntables" }], { w: 140, gap: 26, hgt: 62 }),
    flowchart: flow("Student management flowchart", "Read a command, parse its arguments, validate them, run the database operation, and print the result or an Error line; repeat until the input ends.", ["start", "read a line", "known command and\nright arguments?", "validate the data", "run the SQL\noperation", "print result\nor Error:"], { loop: true }),
    schema: [
      { table: "students", columns: [["id", "INTEGER PRIMARY KEY", "Internal key; never shown to users"], ["roll_no", "INTEGER NOT NULL UNIQUE", "The number users type; unique"], ["name", "TEXT NOT NULL", "2 to 60 letters"], ["email", "TEXT NOT NULL UNIQUE", "Stored in lower case"], ["course", "TEXT NOT NULL", "CSE, ECE, ME or CIVIL"], ["year", "INTEGER NOT NULL", "CHECK between 1 and 4"]] },
      { table: "marks", columns: [["id", "INTEGER PRIMARY KEY", ""], ["student_id", "INTEGER NOT NULL", "FOREIGN KEY to students(id) ON DELETE CASCADE"], ["subject", "TEXT NOT NULL", "UNIQUE together with student_id"], ["score", "INTEGER NOT NULL", "CHECK between 0 and 100"]] },
    ],
    steps: [["Design the data.", "Two tables: students and marks (one student has many marks). Decide which columns are unique and which values are allowed, and write them as constraints in the schema, so the database protects the data even if the Python code has a bug."], ["Write the Student value object.", "A frozen dataclass whose create() class method cleans and validates raw text (trim, lower-case the email, upper-case the course, check ranges). Every other part of the program receives only valid Student objects."], ["Write the repository.", "StudentRepository gets the connection and runs the schema. add, get, update, delete, list and search each use ? placeholders. Catch sqlite3.IntegrityError and translate it into a ValidationError with a friendly message."], ["Handle updates safely.", "update() loads the current student, replaces one field, runs the whole object through Student.create again (so the new value is validated like a new one) and only then writes."], ["Filter and search.", "list() builds its WHERE clause from fixed text fragments and passes the values as parameters. search() uses instr(lower(name), ?) so that % and _ in the search term are ordinary characters."], ["Record marks and report.", "add_mark() uses INSERT ... ON CONFLICT DO UPDATE (an upsert). The report uses LEFT JOIN with GROUP BY so that students without marks still appear."], ["Write the command handler.", "handle(repo, line) returns a list of output lines and converts ValidationError and NotFound into Error: lines, so main() is a three-line loop."], ["Test with an in-memory database.", "connect(':memory:') makes a fresh database for every test: validation rules, duplicates, updates, filters, wildcard-safe search, SQL-injection text, marks, cascade delete and the commands."]],
    files: files("student-system", ["student_system.py", "test_student_system.py"]),
    run: "student_system.py", test: "test_student_system.py", stdin: read("student-system", "input.txt"), sample: { out: read("student-system", "output.txt") },
    explain: [["Student.create", "The single door through which text becomes data. Because it is a frozen dataclass, a Student cannot be changed after validation, so a valid object stays valid."], ["StudentRepository", "Repository pattern: all SQL is in one class. The rest of the program does not know which database is used, which makes testing and later replacement easy."], ["Placeholders (?)", "Values are sent to SQLite separately from the SQL text, so a name such as x'); DROP TABLE students; -- is only data. Never build SQL by joining strings with user input."], ["IntegrityError translation", "The database enforces uniqueness; Python turns the low-level error into a message a user understands."], ["Upsert for marks", "ON CONFLICT (student_id, subject) DO UPDATE keeps one score per subject without a separate check-then-insert (which could race)."], ["ON DELETE CASCADE + PRAGMA foreign_keys", "SQLite ignores foreign keys unless you switch them on for each connection; connect() does it."], ["handle()", "Pure command-to-lines function; easy to test without touching standard input."]],
    testing: ["Run python student_system.py < input.txt and compare with the sample output line by line.", "Run python -m unittest test_student_system -v (11 tests).", "Try to break it: an email without a dot, year 0, a name with digits, a very long name, the same email twice, search for %, a score of 101.", "Open a real database file (connect('students.db')), add data, restart the program and check that the data survived."],
    bugs: [["sqlite3.OperationalError: no such table", "The schema was not created on this connection; run executescript(SCHEMA) in the repository constructor."], ["Marks are not deleted with the student", "PRAGMA foreign_keys = ON must be executed on every new connection."], ["Search for 'a%' returns everything", "You used LIKE with user text; use instr() or escape the wildcards."], ["Duplicate marks for the same subject", "Add UNIQUE (student_id, subject) and use an upsert."], ["Emails differ only by case but are both accepted", "Lower-case the email before saving and before comparing."], ["AVG() is None in the report", "A student without marks has no rows to average; handle None before formatting."]],
    extensions: ["Store the database in a file and add a command-line argument for its path.", "Add a courses table and make course a foreign key instead of a text column.", "Import and export students as CSV, validating every row and reporting the bad ones.", "Add an attendance table and a report of students below 75% attendance.", "Replace the command loop by a small FastAPI or Flask web interface that uses the same repository."],
    interview: ["Why is validation in a single factory method better than checks scattered around the program?", "What is the repository pattern and what does it buy you?", "How do placeholders prevent SQL injection, and when can they not be used?", "What does ON DELETE CASCADE do, and why did the foreign keys have to be switched on?", "How would you test code that uses a database without slowing the tests down?", "How would you change the design to support thousands of students and several concurrent users?"],
    rubric: rubric("All commands behave as specified; the sample output is reproduced", "Database design: constraints, foreign keys, parameterised queries, upsert, validation in one place"),
    tasks: [
      judged("Student system: grade report", "Write the reporting part of the student system. Each input line is ROLL | NAME | SUBJECT | SCORE. A score that is not a whole number from 0 to 100 prints Error: score must be between 0 and 100. at once and the line is skipped. A repeated subject for the same roll number replaces the earlier score. After the input print one line per student in roll order as ROLL NAME: K subject(s), average A.AA (use 'subject' when K is 1), then Top: NAME (A.AA) for the highest average (the lower roll number wins a tie). With no valid marks print No marks.", "# Write the report here\n", `import sys

marks, names = {}, {}
for line in sys.stdin:
    if not line.strip():
        continue
    roll, name, subject, score = [part.strip() for part in line.split("|")]
    try:
        value = int(score)
    except ValueError:
        value = -1
    if not 0 <= value <= 100:
        print("Error: score must be between 0 and 100.")
        continue
    names[int(roll)] = name
    marks.setdefault(int(roll), {})[subject] = value
rows = []
for roll in sorted(marks):
    scores = list(marks[roll].values())
    average = sum(scores) / len(scores)
    rows.append((roll, names[roll], average))
    print(f"{roll} {names[roll]}: {len(scores)} {'subject' if len(scores) == 1 else 'subjects'}, average {average:.2f}")
if rows:
    best = max(rows, key=lambda row: (row[2], -row[0]))
    print(f"Top: {best[1]} ({best[2]:.2f})")
else:
    print("No marks.")`, [["101 | Asha Rao | Maths | 88\n101 | Asha Rao | Physics | 83\n103 | Zoya Khan | Maths | 70\n101 | Asha Rao | Maths | 90\n103 | Zoya Khan | Chemistry | 101\n", "Error: score must be between 0 and 100.\n101 Asha Rao: 2 subjects, average 86.50\n103 Zoya Khan: 1 subject, average 70.00\nTop: Asha Rao (86.50)"], ["", "No marks."], ["5 | Eve | Maths | 80\n2 | Bob | Maths | 80\n", "2 Bob: 1 subject, average 80.00\n5 Eve: 1 subject, average 80.00\nTop: Bob (80.00)"], ["7 | Kim | A | abc\n7 | Kim | B | -1\n7 | Kim | C | 80\n7 | Kim | D | 85\n7 | Kim | E | 90\n", "Error: score must be between 0 and 100.\nError: score must be between 0 and 100.\n7 Kim: 3 subjects, average 85.00\nTop: Kim (85.00)"]],
        ["Keep a dictionary of dictionaries: marks[roll][subject] = score. Assigning again replaces the old score.", "Validate with int(); catch ValueError.", "max(rows, key=...) with a key such as (average, -roll) breaks ties towards the lower roll number."]),
      manual("Student system: design on paper", "Draw the tables with their constraints, then list the classes with one sentence each. Write which errors each layer (Student, repository, handler) raises or handles. Commit it as DESIGN.md before you write code.", ["Which rules belong to the database and which to Python? Some belong to both."]),
      manual("Student system: build and test it", "Build the system (you may follow the steps in this guide). Add at least five tests of your own, for example for a rule that you invented: a maximum number of subjects, a unique name per course, or a minimum email length.", ["Write the failing test first, then the code."]),
      manual("Student system: extend it", "Pick one extension challenge, implement it with tests, and describe in the README what you changed and why.", []),
      manual("Student system: publish it", "Follow the GitHub and README sections: repository, .gitignore, README with the sample session, tests, small commits. Submit the link.", []),
    ],
  },
});

// ---------------------------------------------------------------- 2 Personal Expense Tracker
lessons.push({
  title: "Major Project 2: Personal Expense Tracker",
  minutes: 360,
  project: {
    id: "personal-expense-tracker", kind: "MAJOR", difficulty: "MEDIUM", minutes: 360, packages: ["matplotlib"],
    problem: "Build an expense tracker with SQLite storage, exact money arithmetic, monthly reports with percentages, per-category budgets that warn when exceeded, a text trend and a bar chart image.",
    scenario: "People lose track of where their money goes. A tracker that stores every expense, shows the monthly total by category and warns when a budget is exceeded gives them control; the same techniques (exact decimals, SQL aggregation, charts) are used in finance and analytics tools.",
    objectives: ["Store money as whole cents and format it exactly", "Design a three-table schema and write GROUP BY / JOIN reports", "Validate dates, amounts and categories, including edge cases", "Produce a chart with matplotlib without a display", "Separate storage and reporting from text formatting so that both can be tested"],
    prerequisites: ["Decimal and float errors (Module 3)", "SQLite and aggregation (Module 16)", "Dates with datetime", "matplotlib basics (Module 19)"],
    requirements: ["add DATE AMOUNT CATEGORY [NOTE] records an expense; dates in the future, amounts that are not positive and amounts with more than two decimals are rejected", "Categories are case-insensitive and created on first use", "budget CATEGORY AMOUNT sets a monthly budget (setting it again replaces it)", "report YYYY-MM prints the total, each category's amount and percentage (largest first) and the budget status (left or OVER by)", "delete ID removes an expense; trend prints a text bar per month; chart FILE saves a bar chart as a PNG", "A today command sets the date used for the future check so that sessions are repeatable"],
    architecture: chain("Expense tracker architecture", "The command handler calls the Tracker class, which validates input and runs SQL on SQLite. Reports come back as plain data; separate functions format them as text, and chart.py draws them with matplotlib.",
      [{ k: "io", t: "commands" }, { k: "proc", t: "handle()" }, { k: "proc", t: "Tracker\nvalidate + SQL" }, { k: "proc", t: "SQLite\n3 tables" }, { k: "proc", t: "format_*() /\nchart.py" }, { k: "io", t: "text, PNG" }], { w: 125, gap: 22, hgt: 62 }),
    flowchart: flow("Expense tracker flowchart", "Parse the command, validate the date, amount and category, store the expense, and for reports query the month, compute percentages and budget status, then format the output.", ["start", "read a command", "input valid?", "store / query\nSQLite", "report or chart?", "print or save"], { loop: true }),
    schema: [
      { table: "categories", columns: [["id", "INTEGER PRIMARY KEY", ""], ["name", "TEXT NOT NULL UNIQUE", "Lower case, 2 to 30 letters"]] },
      { table: "expenses", columns: [["id", "INTEGER PRIMARY KEY", "Shown to the user for delete"], ["spent_on", "TEXT NOT NULL", "ISO date; indexed"], ["amount_cents", "INTEGER NOT NULL", "CHECK > 0; whole cents, never floats"], ["category_id", "INTEGER NOT NULL", "FOREIGN KEY to categories(id)"], ["note", "TEXT NOT NULL", "Free text, may be empty"]] },
      { table: "budgets", columns: [["category_id", "INTEGER PRIMARY KEY", "FOREIGN KEY to categories(id); one budget per category"], ["monthly_cents", "INTEGER NOT NULL", "CHECK > 0"]] },
    ],
    steps: [["Decide how to store money.", "Floats cannot represent 0.1 exactly, so 0.1 + 0.2 != 0.3. Parse text with Decimal, multiply by 100, insist that the result is a whole number, and store integer cents."], ["Write parse_amount, parse_date and clean_category.", "Each returns clean data or raises TrackerError with a clear message: not a number, nan or infinity, zero or negative, more than two decimals, too large, bad date, future date."], ["Create the schema.", "Three tables with CHECK constraints, a foreign key and an index on the date, so reports for one month are fast."], ["Write Tracker.add and delete.", "Look up or create the category with INSERT OR IGNORE, then insert the expense. delete reports an unknown id."], ["Write the month report.", "SQL: join expenses to categories, filter with substr(spent_on, 1, 7) = ?, GROUP BY category, ORDER BY total DESC. Budgets are a second query; combine them in Python."], ["Format the output.", "Pure functions turn the report dictionary into lines: percentages with one decimal, money with thousands separators, OVER by or left."], ["Add the trend and the chart.", "monthly_totals() groups by month. chart.py imports matplotlib only when asked, switches to the Agg backend (no window) and saves a PNG."], ["Test.", "Money edge cases, every validation rule, categories ignoring case, report totals and order, budget status, deleting, the trend, and that the chart file really is a PNG."]],
    files: files("expense-tracker", ["tracker.py", "chart.py", "test_tracker.py"]),
    run: "tracker.py", test: "test_tracker.py", stdin: read("expense-tracker", "input.txt"), sample: { out: read("expense-tracker", "output.txt") },
    explain: [["parse_amount", "Decimal gives exact decimal arithmetic. The checks for is_finite() and for a whole number of cents reject nan, infinity and 12.345."], ["amount_cents", "Integers add exactly. money() converts to text only at the edge, when displaying."], ["Tracker(conn, today)", "The clock is a parameter, so 'future date' can be tested without waiting for tomorrow."], ["month_report", "Returns data (dictionary), not text. This is why the same report can be shown as text, saved to a file or charted."], ["format_report / format_trend", "Presentation only; they never touch the database."], ["chart.save_chart", "matplotlib is imported inside the function, so the tracker works without it; matplotlib.use('Agg') draws into a file without a window."], ["handle()", "Maps command text to Tracker calls and turns TrackerError into Error: lines."]],
    testing: ["Run python tracker.py < input.txt and compare with the sample; a file monthly.png appears in the folder (open it and look at it).", "Run python -m unittest test_tracker -v (11 tests).", "Check the numbers by hand with a calculator or spreadsheet for one month.", "Try: 0.30 added three times (the total must be exactly 0.90), a negative amount, 1e20, nan, the date 2026-02-30, and a month that has no expenses."],
    bugs: [["Totals are off by a cent", "Floats were used for money; use Decimal for input and integer cents for storage."], ["The percentages do not add up to 100", "Rounding each share to one decimal can leave a remainder of 0.1; that is normal. Do not 'fix' it by adjusting data."], ["A report mixes two years", "Filter on the full YYYY-MM prefix, not on the month number."], ["matplotlib tries to open a window or fails on a server", "Select the Agg backend before importing pyplot."], ["Budget shows spent 0 for a category with expenses", "Category names must be cleaned the same way when budgets and expenses are saved."], ["Chart file is empty or missing", "Call fig.savefig before plt.close, and check the path."]],
    extensions: ["Recurring expenses (rent on the first of each month).", "Export a month to CSV and import expenses from a bank statement CSV with validation.", "Add income and show savings per month.", "A pie chart of one month by category.", "Currency support with an exchange-rate table (store the rate used with each expense)."],
    interview: ["Why should money never be stored as a float?", "How do you aggregate by month and category in SQL?", "Why does report() return data and not text?", "How would you test code that depends on today's date?", "What are the trade-offs of storing amounts in cents versus using DECIMAL columns in another database?", "How would you let two people share one tracker?"],
    rubric: rubric("Reports, budgets, trend and chart work; the sample output is reproduced exactly", "Money handling is exact; SQL aggregation is correct; chart is generated without a display"),
    tasks: [
      judged("Expense tracker: monthly report", "Write the report of the expense tracker. The first input line is the month (YYYY-MM). Each later line is DATE AMOUNT CATEGORY. A line is invalid when it does not have exactly three fields or when the amount is not a positive number with at most two decimals: print Error: line N is invalid. (N counts input lines, the month line is line 1) and skip it. Expenses outside the month are ignored. Categories are case-insensitive. Then print Total: X (with thousands separators and two decimals) and one line per category, largest first (equal amounts in name order), as '  NAME: AMOUNT (P%)' with the share to one decimal. With no expenses in the month print No expenses in MONTH. Use Decimal for the money.", "# Write the report here\n", `import sys
from decimal import Decimal, InvalidOperation

lines = sys.stdin.read().splitlines()
month = lines[0].strip()
totals = {}
for number, line in enumerate(lines[1:], 2):
    if not line.strip():
        continue
    try:
        day, amount, category = line.split()
        value = Decimal(amount)
        if not value.is_finite() or value <= 0 or value != value.quantize(Decimal("0.01")):
            raise ValueError
    except (ValueError, InvalidOperation):
        print(f"Error: line {number} is invalid.")
        continue
    if day[:7] == month:
        totals[category.lower()] = totals.get(category.lower(), Decimal(0)) + value
if not totals:
    print(f"No expenses in {month}.")
else:
    total = sum(totals.values())
    print(f"Total: {total:,.2f}")
    for name, amount in sorted(totals.items(), key=lambda item: (-item[1], item[0])):
        print(f"  {name}: {amount:,.2f} ({float(amount) * 100 / float(total):.1f}%)")`, [["2026-10\n2026-10-01 1200 rent\n2026-10-03 250.50 Food\n2026-10-20 640 food\n2026-09-30 99 food\n2026-10-21 0 food\n2026-10-22 12.345 food\n2026-10-23 abc food\n2026-10-09 199.99 transport\n", "Error: line 6 is invalid.\nError: line 7 is invalid.\nError: line 8 is invalid.\nTotal: 2,290.49\n  rent: 1,200.00 (52.4%)\n  food: 890.50 (38.9%)\n  transport: 199.99 (8.7%)"], ["2026-12\n2026-10-01 5 food\n", "No expenses in 2026-12."], ["2026-10\n2026-10-01 10 b\n2026-10-02 10 a\n", "Total: 20.00\n  a: 10.00 (50.0%)\n  b: 10.00 (50.0%)"], ["2026-10\n2026-10-01 0.1 x\n2026-10-02 0.2 x\n", "Total: 0.30\n  x: 0.30 (100.0%)"], ["2026-10\n2026-10-01 1500000 rent\n2026-10-01 5 food extra\n", "Error: line 3 is invalid.\nTotal: 1,500,000.00\n  rent: 1,500,000.00 (100.0%)"]],
        ["Decimal(text) raises InvalidOperation for text that is not a number.", "value != value.quantize(Decimal('0.01')) detects more than two decimals.", "Sort with key=(-amount, name).", "format(value, ',.2f') adds the thousands separators."]),
      manual("Expense tracker: design the schema", "Draw the three tables and write the SQL query for 'total per category for one month'. Run it by hand on five rows of sample data and write down the result before you write any Python.", []),
      manual("Expense tracker: build it and prove the money is exact", "Build the tracker. Write a test that adds 0.10 and 0.20 and checks that the total equals 0.30 cents-exactly, and a test that a float-based version would fail.", ["0.1 + 0.2 == 0.3 is False in Python."]),
      manual("Expense tracker: open the chart", "Run the chart command, open the PNG, and improve it (title, labels, colours that are readable for colour-blind people). Put the picture in your README.", []),
      manual("Expense tracker: publish it", "Create the repository with README (include the chart picture), requirements.txt (matplotlib), tests and small commits. Submit the link.", []),
    ],
  },
});

// ---------------------------------------------------------------- 3 Online Quiz and Examination System
lessons.push({
  title: "Major Project 3: Online Quiz and Examination System",
  minutes: 420,
  project: {
    id: "online-exam-system", kind: "MAJOR", difficulty: "HARD", minutes: 420, packages: [],
    problem: "Build the engine of an online examination system: registration and login with hashed passwords, admin and student roles, a question bank, exams with a time limit, automatic scoring, results with a review of wrong answers and an admin report.",
    scenario: "Colleges and training companies run online tests every day. The hard parts are not the questions: they are trust and fairness. Passwords must be stored safely, students must not see answers or other people's attempts, the time limit must be enforced by the server and the scoring must be automatic and repeatable.",
    objectives: ["Store passwords with salted PBKDF2 and compare them in constant time", "Implement roles and authorisation checks in the service layer", "Enforce a time limit with an injectable clock", "Model an exam with five related tables and score it with SQL", "Avoid information leaks: one error for login failures, hidden answers, other people's attempts look missing"],
    prerequisites: ["Hashing and security basics (Modules 17 and 20)", "SQLite joins and aggregation (Module 16)", "Dataclasses, exceptions, datetime", "Unit testing with fake clocks (Module 15)"],
    requirements: ["Public registration always creates a student; the first admin is created by a separate bootstrap call that works once", "Username 3 to 20 lower-case letters, digits or underscores; password at least 8 characters with letters and digits", "Login failures (unknown user, wrong password) give the same message", "Admins add questions (2 to 6 different options, one correct) and create exams (title, minutes, pass percent, list of questions)", "A student gets exactly one attempt per exam and receives the paper without the correct answers", "Answers are accepted until the deadline; answering after it fails with 'time is up'; a student can change an answer before finishing", "Finishing scores the attempt; the result shows score, percent, PASS or FAIL, whether it was finished late, and the wrong answers with the correct ones; students cannot see another person's attempt", "Admins get a report: finished attempts, average, highest, passed, and the percentage of correct answers per question"],
    architecture: chain("Examination system architecture", "A client (here the demo script) calls the ExamSystem service. The service applies authentication and authorisation, enforces the rules, uses the security module for hashing and talks to SQLite. The clock is injected so that time limits can be tested.",
      [{ k: "io", t: "client\n(demo / web)" }, { k: "proc", t: "ExamSystem\nrules + roles" }, { k: "proc", t: "security.py\nPBKDF2" }, { k: "proc", t: "clock\n(injected)" }, { k: "proc", t: "SQLite\n5 tables" }], { w: 130, gap: 26, hgt: 62 }),
    flowchart: flow("Taking an exam flowchart", "A student logs in, starts the single attempt, answers while the time lasts, finishes, and sees the scored result; late answers are refused.", ["start", "log in", "already started?", "start the attempt\n(paper without answers)", "time left?", "record answer or\nrefuse; finish; score"], { loop: false }),
    schema: [
      { table: "users", columns: [["id", "INTEGER PRIMARY KEY", ""], ["username", "TEXT NOT NULL UNIQUE", "Lower case"], ["password_hash", "TEXT NOT NULL", "pbkdf2_sha256$iterations$salt$hash; never the password"], ["role", "TEXT NOT NULL", "CHECK admin or student"]] },
      { table: "questions", columns: [["id", "INTEGER PRIMARY KEY", ""], ["topic", "TEXT NOT NULL", "For grouping"], ["text", "TEXT NOT NULL", ""], ["options", "TEXT NOT NULL", "JSON list of 2 to 6 options"], ["correct_index", "INTEGER NOT NULL", "Position of the right option"]] },
      { table: "exams", columns: [["id", "INTEGER PRIMARY KEY", ""], ["title", "TEXT NOT NULL UNIQUE", ""], ["duration_minutes", "INTEGER NOT NULL", "CHECK > 0"], ["pass_percent", "INTEGER NOT NULL", "CHECK 1 to 100"]] },
      { table: "exam_questions", columns: [["exam_id", "INTEGER", "FK to exams; part of the primary key"], ["question_id", "INTEGER", "FK to questions; part of the primary key"], ["position", "INTEGER NOT NULL", "Order on the paper"]] },
      { table: "attempts", columns: [["id", "INTEGER PRIMARY KEY", ""], ["user_id / exam_id", "INTEGER NOT NULL", "UNIQUE together: one attempt per student per exam"], ["started_at", "TEXT NOT NULL", "ISO time; the deadline is computed from it"], ["finished_at / score / total", "TEXT / INTEGER / INTEGER", "NULL until finished"]] },
      { table: "answers", columns: [["attempt_id / question_id", "INTEGER", "Primary key together: one answer per question"], ["chosen", "INTEGER NOT NULL", "Index of the option chosen"], ["answered_at", "TEXT NOT NULL", ""]] },
    ],
    steps: [["Write security.py first.", "hash_password makes a random salt and runs PBKDF2-HMAC-SHA256 with many iterations; verify_password recomputes and compares with hmac.compare_digest. Test it before anything else uses it."], ["Design the six tables.", "Constraints encode rules: unique usernames, the role check, one attempt per user and exam, one answer per question and attempt."], ["Accounts and roles.", "register() always makes a student; bootstrap_admin() works only if there is no admin. login() returns the same error for every failure. _require(user, role) is the one authorisation check."], ["Question bank and exams.", "Validate every option list; create an exam and its questions in one transaction."], ["Start an attempt.", "Insert the attempt (the UNIQUE constraint enforces one per student) and return the paper as (id, text, options) triples; the correct answer is never selected."], ["Accept answers.", "Check ownership, not finished, deadline not passed, question belongs to the exam, choice in range; then upsert so that an answer can be changed."], ["Finish, score, review.", "Score with a JOIN of answers to questions; compute late, percent and PASS/FAIL; build the review list of wrong answers."], ["Reports and tests.", "Average, highest, passed and per-question percentages with SQL; test authorisation, the clock (exactly at the limit is allowed), invalid choices, double finish and report maths."]],
    files: files("exam-system", ["security.py", "exam.py", "test_exam.py"]),
    run: "exam.py", test: "test_exam.py", stdin: "", sample: { out: read("exam-system", "output.txt") },
    explain: [["hash_password / verify_password", "A salt makes equal passwords hash differently; many iterations make guessing slow; compare_digest avoids leaking information through timing."], ["register vs bootstrap_admin", "Nobody can make themselves an admin through public sign-up. This is the most common mistake in role systems."], ["login", "One message for unknown user and wrong password, so attackers cannot discover which usernames exist."], ["_require", "Authorisation is checked in the service, not only in the user interface, because a client can be bypassed."], ["clock parameter", "The deadline is computed from the stored start time and the injected clock; tests move the clock instead of sleeping."], ["_attempt", "Someone else's attempt raises the same 'no such attempt' as a missing one, so ids cannot be probed."], ["finish / result", "Scoring is a SQL JOIN; results are only available after finishing; late is the difference between finish time and deadline."], ["iterations=1000 in the demo and tests", "Only to keep them fast. Production uses the default of 200,000."]],
    testing: ["Run python exam.py and compare with the sample: it plays a complete scenario with a fake clock.", "Run python -m unittest test_exam -v (17 tests).", "Read the sample line by line and find the rule that produces each Error: line.", "Think like an attacker: can a student read the answer key, take the exam twice, change another student's answers, or answer after the deadline? Write a test for each question you ask."],
    bugs: [["Everyone becomes a student, even the teacher", "That is correct for register(); create the first admin with bootstrap_admin()."], ["Students can see the correct answers", "The paper query must not select correct_index."], ["The time limit is never enforced", "Compare the injected clock with started_at plus the duration on every answer."], ["Login reveals which usernames exist", "Return the same error for both failures."], ["A second attempt overwrites the first", "Rely on the UNIQUE (user_id, exam_id) constraint and translate IntegrityError."], ["Scores are wrong when a student changes an answer", "Use an upsert so there is one answer per question."]],
    extensions: ["Shuffle the order of questions and options per student (store the order in the attempt).", "Question types beyond multiple choice (multiple correct answers, numeric answers).", "Negative marking and partial credit.", "A FastAPI layer with tokens (see Major Project 5) on top of this service.", "Proctoring-friendly extras: log when the student leaves the page (as a signal, not proof)."],
    interview: ["How do you store passwords, and why salt and iterate?", "Why must authorisation checks live on the server?", "How do you enforce a time limit that the client cannot cheat?", "Why return the same error for an unknown user and a wrong password?", "How would you design the database so that a student can have only one attempt?", "How would you scale this to 10,000 students starting at the same time?"],
    rubric: rubric("Accounts, roles, exams, timed attempts, scoring and reports work; the sample is reproduced", "Security: hashed passwords, roles, no answer leaks, no peeking at other attempts; the time limit uses an injectable clock"),
    tasks: [
      judged("Exam system: score the attempts", "Write the scoring part of the exam system. The first input line is DURATION PASS_PERCENT (minutes, percent). The second line is the answer key: the index of the correct option of each question, in order. Each later line is a student: NAME followed by answers written as QUESTION:CHOICE@MINUTE (question numbers start at 1). Ignore an answer when the question number is outside the key, when it is not written in that form, or when MINUTE is greater than DURATION (time is up). A later accepted answer to the same question replaces an earlier one. For each student print NAME: SCORE/TOTAL (P%) PASS or FAIL with the percent to one decimal (PASS when the percent is at least PASS_PERCENT). End with Passed: X of Y.", "# Write the scoring here\n", `import re
import sys

lines = sys.stdin.read().splitlines()
duration, pass_percent = map(int, lines[0].split())
key = list(map(int, lines[1].split()))
total = passed = 0
for line in lines[2:]:
    if not line.strip():
        continue
    name, *items = line.split()
    chosen = {}
    for item in items:
        match = re.fullmatch(r"(\\d+):(\\d+)@(\\d+)", item)
        if not match:
            continue
        question, choice, minute = map(int, match.groups())
        if 1 <= question <= len(key) and minute <= duration:
            chosen[question] = choice
    score = sum(1 for question, choice in chosen.items() if key[question - 1] == choice)
    percent = score * 100 / len(key)
    ok = percent >= pass_percent
    print(f"{name}: {score}/{len(key)} ({percent:.1f}%) {'PASS' if ok else 'FAIL'}")
    total += 1
    passed += ok
print(f"Passed: {passed} of {total}")`, [["30 60\n1 0 1 2 0\nasha 1:1@5 2:0@6 3:1@7 4:0@9 5:0@31\nravi 2:0@3 4:2@4 5:1@6 1:0@8\nkabir\n", "asha: 3/5 (60.0%) PASS\nravi: 2/5 (40.0%) FAIL\nkabir: 0/5 (0.0%) FAIL\nPassed: 1 of 3"], ["10 50\n1 1\n", "Passed: 0 of 0"], ["30 50\n1 1 1 1\nzed 1:0@1 1:1@2 2:1@3 2:0@40 9:1@1 oops 3:x@1\n", "zed: 2/4 (50.0%) PASS\nPassed: 1 of 1"], ["60 100\n2 2\nfull 1:2@60 2:2@60\nalmost 1:2@61 2:2@1\n", "full: 2/2 (100.0%) PASS\nalmost: 1/2 (50.0%) FAIL\nPassed: 1 of 2"]],
        ["re.fullmatch(r'(\\d+):(\\d+)@(\\d+)', item) checks the form and extracts the numbers.", "Keep the accepted answers in a dictionary: chosen[question] = choice; a later one replaces an earlier one.", "An answer at exactly DURATION minutes is still accepted.", "A bool is an int in Python: passed += ok works."]),
      manual("Exam system: threat model", "Write a table of ten ways a dishonest student or an outsider could attack the system (read the answers, take the exam twice, guess usernames, become admin, answer late, read another person's result...). For each one, write which rule or test in your code stops it.", ["Use the requirements list: every rule exists because of an attack or a mistake."]),
      manual("Exam system: build it and attack it", "Build the system. Then write one test per row of your threat model, run them and fix anything that fails.", []),
      manual("Exam system: add a question type", "Add questions that allow several correct answers, with scoring that gives credit only when exactly the right set is chosen. Change the schema, the validation, the scoring, the review and the tests.", []),
      manual("Exam system: publish it", "Create the repository with README (include the threat model), tests and small commits. Submit the link.", []),
    ],
  },
});

module.exports = { lessons };
