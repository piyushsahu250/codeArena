# Python Zero to Hero (course content and tooling)

**Status (2026-11-03): content complete, not yet deployed or reviewed in the live app.** Modules 1 to 23 (Phases 0 to 5, plus the interview and placement modules of Phase 7) and the Phase 6 project catalogue (15 mini and 6 major projects) are authored and machine-verified, and seed as a **Draft** course. Nothing here is visible to students until an administrator publishes and assigns the course. The remaining open items are listed under Known limitations.

## How the course maps onto the existing LMS (nothing duplicated)

| Spec concept | Existing structure used | Notes |
| --- | --- | --- |
| Course | `Course` (`slug python-zero-to-hero`, `kind LEARNING`) | Created `DRAFT`, `isActive false`, no assignments |
| Phase | Prefix in the `CourseModule.title` ("Phase 0 - Module 1: ...") | The schema has no Phase entity; adding one would touch every LMS screen for little gain |
| Module | `CourseModule` | One per spec module |
| Chapter | `Chapter` | One chapter per module in the pilot |
| Topic / Lesson | `Lesson` with `content` HTML | **Student pages render `content` only, not `blocks`** (`LessonView.jsx` never reads `blocks`), so lessons are HTML with inline SVG |
| Topic quiz | `PracticeQuestion` types `MCQ`, `OUTPUT_PREDICTION`, `DEBUG`, `FILL_BLANK` | Graded server-side; answers never reach students |
| Hands-on task | `PracticeQuestion` type `CODING`, `evaluationType STDIO`, language `python` | Runs on the existing judge; hidden cases are used for Submit |
| Module assessment | `ModuleCodingTest` (a Level on the first chapter) + `Question` rows | Python only, `proctoring true`, 3 attempts, pass mark 60%, **unpublished** |
| Proctored / semi-proctored | `ModuleCodingTest.securityLevel`, `proctoring`, `requireFullscreen`, `requireWebcam`, `requireMicrophone` | Seeded as STANDARD with violation tracking on. An admin raises it per assessment. No new engine |
| Projects | `CourseProject` + `ProjectTask` | 21 projects (Phase 6). Mini = `MINI_PROJECT`, major = `COURSE_PROJECT`. Auto-judged tasks use `evaluationType STDIO`; the others are manual (self-marked) |
| Versioning | `LessonContentVersion` | Edits to a published lesson go through versions, which never reset student progress |
| Certificates | `Course.certificateEnabled` + the existing certificate engine | Thresholds are the engine's; see Known limitations |
| Institute isolation | `CourseInstituteAssignment`, `CourseAcademicGroupAssignment`, `courseEligibility.js` | Unchanged. Covered by the integration test |

No schema change and no migration are needed.

## Files

- `backend/content/python/render.js` renders one lesson spec into HTML through a single 20-part template (learning goals, why, real-world use, simple and detailed explanation, syntax, diagram, example with verified output, line by line, dry run, real example, mistakes, best practices, interview view, practice questions, revision, optional Hinglish, then quiz and coding task from `PracticeQuestion`). Helpers draw accessible SVG flowcharts (`role="img"`, `<title>`, `<desc>`, theme-aware colours, sideways scroll on phones) and terminal illustrations.
- `backend/content/python/m01.js` ... `m23.js`: the authored modules (Module 15 is assembled from `m15a-d.js`, Modules 18 to 20 from `m18a-c.js`, `m19a-c.js` and `m20a-c.js`; Module 21 from `m21a-f.js`; Module 22 from `m22a-c.js`; Module 23 from `m23a-b.js`). `index.js` lists them in teaching order.
- **Packages the examples need** (installed in the CI virtual environment; judged tasks stay standard-library only): `sqlalchemy>=2.0,<2.1`, `requests`, `flask`, `fastapi`, `httpx`, `pytest`, `ruff`, `black`, `numpy`, `pandas`, `matplotlib`, `openpyxl`, `scikit-learn` (Module 19 outputs were checked with NumPy 2.5, pandas 3.1, Matplotlib 3.11; Module 20 with scikit-learn 1.9, whose printed scores are rounded and could differ in the last digit on another platform). The Module 18 Git examples also need the `git` command (any 2.32 or newer).
- `backend/content/python/p06.js` (Phase 6) assembles `pa.js` to `pc.js` (mini projects 1-5, 6-10, 11-15) and `pd.js`, `pe.js` (major projects 1-3, 4-6). The Python of each major project is kept as real files in `backend/content/python/proj/<project>/` (program, tests, sample input and output) and loaded by `proj/load.js`, so the guide shows exactly the code the validator ran.
- `backend/scripts/validatePythonContent.js`: the quality gate (below).
- `backend/scripts/seedPythonCourse.js`: idempotent seed.
- `backend/test/pythonCourse.integration.test.js`: HTTP test of the whole flow.

## Inventory (as validated 2026-11-03)

| | Count |
| --- | --- |
| Modules | 24: Modules 1 to 23 (Phase 0: Modules 1-2; Phase 1: Modules 3-9; Phase 2: Modules 10-13; Phase 3: Modules 14-15; Phase 4: Modules 16-18; Phase 5: Modules 19-20; Phase 7: Modules 21-23) plus the Phase 6 projects module |
| Lessons | 197: 176 in Modules 1 to 23 (25 to 70 minutes each; Modules 15 and 18 have four chapters, Modules 19 and 20 three, Module 21 six, Module 22 three chapters, Module 23 three chapters) and 21 project guides (90 to 480 minutes) |
| Projects | 21 (15 mini, 6 major, 2 of them build-from-scratch) with 77 project tasks (25 auto-judged, 52 manual) |
| Quiz questions | 1,054 (MCQ, output prediction, debugging, fill in the blank) |
| Coding tasks in lessons | 420 (224 of them the tagged interview bank), each with 2 sample and at least 1 hidden case |
| Module assessments | 23, with 92 coding questions in total, plus 4 timed mock tests with 13 questions |
| Diagrams | 159 (one per lesson in Modules 1-21; the Module 22 question lessons have none) plus terminal illustrations in the setup lessons |
| Python executions during validation | 3,974 (every example, every reference solution against every case, every project sample run and project unit-test run) |

Module 1 topics 1 to 16 and its three practicals, Module 2 topics 1 to 28, and Module 3 topics are grouped into lessons; every bullet of the spec appears inside a lesson.

## The coding-interview problem bank (Module 21)

Module 21 holds 224 original problems (76 easy, 117 medium, 31 hard) across arrays and prefix sums, strings, hashing, two pointers and sliding windows, stacks and queues, binary search and sorting, recursion/backtracking/bits/math, trees and graphs, dynamic programming, and greedy/heap/interval problems. The index is `docs/PYTHON_PROBLEM_BANK.md` (regenerate with `node backend/scripts/listPythonBank.js`).

Each problem is a `PracticeQuestion` of type CODING that uses the table's own structured fields: `difficulty`, `tags` (topic tags plus a **style** tag), `estimatedTimeMin`, `timeComplexity`, `spaceComplexity`, `inputFormat`, `outputFormat`, `constraints`, `edgeCases`, `hints`, and the learning objective in `notes`. The seed maps them from the `meta` object built by `prob()` in `lib.js`. The validator rejects a bank problem that lacks a difficulty, three tags, `O(...)` complexities, a learning objective, formats or a hint, rejects company names in tags, objectives and hints, and requires at least 200 problems.

**Honesty rules.** The style tag (`campus online-assessment`, `product-company interview`, `advanced interview or contest`) describes the kind of assessment practised; no problem is claimed to come from any named company. Every reference solution is executed against four cases per problem, and the expected outputs were written independently of the solutions, so a disagreement showed up as a validator failure (it caught, for example, two wrong expected outputs of mine and one wrong recalled value that a brute-force search then settled). The stated time and space complexities are reasoned by hand for the reference solution and are **not** machine-checked.

## The technical-interview question bank (Module 22)

Module 22 holds 160 interview questions in ten lessons (data types and operators, functions and scope, collections, iterators and generators, classes, exceptions and context managers, decorators and functional tools, memory and internals, concurrency and asyncio, standard library and idioms). Each question is a short program with: the question, the program, the exact output (or the exception it raises), an explanation, the common misconceptions, and a follow-up question with its answer. The four answer options of the quiz are the true output plus three wrong outputs that each reflect a misconception.

These lessons use a separate renderer (`renderQa` in `render.js`): the program is shown first and the answer, explanation, misconceptions and follow-up sit inside a collapsed details element, so a student can try before looking. They intentionally have no diagram or 20-part template. The questions become `OUTPUT_PREDICTION` practice questions, so they are graded server-side by the existing quiz engine.

**Verification.** `validatePythonContent.js --run` executes every program and compares its output (or the named exception) with the declared answer, so the answers are what Python really does. It cannot check that the three wrong options are wrong in the way the misconception text claims; only that they differ from the right answer. Behaviour that changes between Python versions was avoided or flagged in the text (for example `sum()` of floats is compensated since Python 3.12); the programs need Python 3.11 or newer (`except*`, `TaskGroup`).

## Placement assessment preparation (Module 23)

Module 23 has seven lessons: a strategy lesson (test formats, time plans, input/output templates, partial credit), four **practice sets** (30 concept multiple-choice questions, 24 output-prediction questions, 20 find-the-error questions and 20 code-completion questions), a debugging lesson with eight fix-the-program coding tasks, and an interview simulation (technical, project and HR rounds, think-aloud script, STAR method). The practice sets use a third renderer (`renderSet` in `render.js`) that shows the question first and the answer behind a details element; each item becomes a PracticeQuestion of type MCQ, OUTPUT_PREDICTION, DEBUG or FILL_BLANK.

The validator checks them by execution: an output-prediction program must print the declared output; for find-the-error the buggy program must show the stated symptom and the fixed program the stated output; for code completion the answer is put into the blank and the program run. A debugging task's buggy starter must fail at least one test and the reference solution must pass them all.

**Timed mock tests.** Four mocks (campus online-assessment style, 45 min; service-company online-test style, 75 min; product-company interview style, 60 min, proctored; advanced contest style, 90 min, proctored) are created by the seed as additional `ModuleCodingTest` Levels on the module's first chapter, each with its own time limit, pass mark and security level, and **left unpublished**. The names describe the style of test; none is claimed to be a real company's test. The existing engine supplies the timer, auto-submit and violation tracking. Mocks contain coding questions only: the aptitude and multiple-choice parts of a real test are covered by the practice sets, not by a timed multiple-choice engine, which the platform does not have.

**Not covered:** aptitude and reasoning (quantitative, logical, verbal) is not part of the Python course; the interview simulation is a guide and rubric, not an interactive interview tool.

## Real-world projects (Phase 6)

Module "Phase 6 - Real-World Projects" holds 21 projects in two chapters: **15 mini projects** (Calculator, Number Guessing Game, Password Generator, Student Grade Management, ATM Simulation, Contact Management System, Expense Tracker, Task Book, Library Management, Quiz Application, File Management Automation, Weather API Application, CSV Data Analyzer, Web Scraping Demonstration, Personal Portfolio CLI) and **6 major projects** (Student Management System, Personal Expense Tracker, Online Quiz and Examination System, Job Application Tracker, REST API-Based Task Management System, Placement Readiness Analytics). Each is a lesson rendered by `renderProject` into the 19 parts the specification lists (problem, scenario, objectives, prerequisites, requirements, architecture diagram, flowchart, database schema, step-by-step implementation, complete source code, explanation of components, sample input and output, testing instructions, common bugs, extension challenges, GitHub preparation, README, interview questions, rubric of 100 points) and creates a `CourseProject` with `ProjectTask` rows: 25 auto-judged tasks (stdin/stdout, standard library only) and 52 manual tasks (plan, tests, extension, publish).

**Two build-from-scratch projects** (Contact Management System, Job Application Tracker) publish milestones and acceptance tests only; the reference solution lives only in the content files (it is used by the validator) and is not stored in the database by the seed, so students and admin screens never see it.

**Verification.** `--run` executes, for every project: the sample run (compared with the declared output), the project's own unit tests, and every judged task's reference solution against every case. The major projects run real code: SQLite databases, PBKDF2 password hashing with an injected clock, a FastAPI application driven through `TestClient`, and pandas and matplotlib (a chart is drawn and checked to be a valid PNG). The REST API was additionally started once with uvicorn and `/health`, `/docs` and a registration were requested by hand; that server start is not part of CI.

**Honesty notes.**
- The Weather API Application and the Web Scraping Demonstration contact no real website in the tests: they use a local fake server (the weather response imitates the documented shape of the Open-Meteo forecast API; the live call itself was not made by the validator, and the guide tells students to check the live documentation). The scraping project teaches robots.txt, an honest User-Agent and rate limiting, and asks students to write an ethics note.
- The Placement Readiness dataset is **synthetic** (made up for the exercise) and says so in the code, the report and the guide. The report states that the data cannot show cause and effect.
- The hand-rolled signed token in the REST API project is for learning; the guide says to use a reviewed library in production.
- Passwords and tokens in the examples are fictitious demo values.

## Quality gate

`node backend/scripts/validatePythonContent.js` checks structure: every required section present, no placeholder wording, a titled and described diagram, at least 3 quiz questions with explanations and valid answer indexes, at least 2 sample and 1 hidden case per task, no duplicate lessons, titles or prompts, thin lessons (under 4,000 characters) rejected.

`node backend/scripts/validatePythonContent.js --run` additionally executes with Python every code example (comparing declared output, including expected errors), every reference solution against every test case, and confirms the starter code does **not** already pass. Set `PYTHON=/path/to/python` to choose the interpreter. CI runs it on every push before the integration test, and the seed refuses to write if the lint fails.

## Version-sensitive facts

Checked against python.org and docs.python.org on **2 November 2026**: latest stable Python 3.15.2 (25 October 2026); supported branches 3.11 to 3.15, 3.10 end-of-life; the Windows Python install manager is the documented route and the traditional installer is deprecated since 3.14 and will not be produced for 3.16 or later; the macOS installer and `Install Certificates.command`; venv activation commands. The course states a minimum of Python 3.12. Examples were executed on Python 3.14.7 (author machine) and on the CI runner's system Python (first CI run: Module 1 passed all 45 executions). Re-check these facts when a new Python version is released.

## Deploying

1. Merge the branch (CI green on the merge commit). No schema push is needed.
2. On the backend host run, once: `docker exec codearena-backend node scripts/seedPythonCourse.js` (use `--plan` first to list what would be created; it touches no data).
3. In **Learning Management**: review the course, publish the course, modules, chapters and lessons, publish the module assessments, then assign the course to institutes or groups. Until the assignment exists no student sees it.
4. To refresh lesson text after editing content files: `node scripts/seedPythonCourse.js --sync` (updates lesson HTML and practice questions that exist; never deletes). For a course that students are already using, prefer editing through the lesson version history.

## Adding the next module

1. Create `backend/content/python/mNN.js` following `m03.js` (lessons, quiz, tasks, assessment).
2. Add it to `index.js`.
3. Run the validator with `--run` and fix every reported problem.
4. Look at the lessons in the app (desktop, phone, dark mode) before publishing.

## Known limitations and open items

- **Not configured:** whole-course checks such as a final exam or certificate gating (for example "two approved major projects"). They are an administrator's decision in the existing certificate and gating screens.
- **Projects have not been tried by students.** The programs, tests and judged tasks run; whether the time estimates (90 to 480 minutes) and the difficulty are right needs a real trial. Manual project tasks are self-marked; faculty review of repository links happens outside the platform.
- **CI on Linux:** all Phase 6 checks were run on the author's Windows machine with Python 3.14.7. The CI run on Linux with the system Python (3.12) for Modules 18 to Phase 6 was not checked when this was written.
- **Versions:** the major projects use `fastapi`, `httpx`, `pandas` and `matplotlib` (versions listed above). With starlette 1.x the test client prints a deprecation warning about `httpx`; it is harmless to the result. `uvicorn` is needed only to serve the API by hand and is not installed in CI.
- **No real screenshots.** Setup lessons use drawn terminal illustrations and flowcharts. Real screenshots of installers would age with every release.
- **Hinglish** is a short optional note per lesson, not a full translation.
- **Rendering was checked** through the same sanitiser the student page uses (DOMPurify), on desktop, a 375 px phone viewport and dark mode. It has **not** been checked inside the live student page or on a real device.
- **Completion criteria and certificate thresholds** (70 % score, two approved projects, final exam) rely on the existing certificate and gating engine; whether every proposed criterion is configurable there was **not verified**, and no projects exist yet.
- **Similarity/plagiarism checks, weekly leaderboard, learning XP and badges** were not inspected or extended; the judge's existing XP on accepted practice submissions applies.
- **Webcam/identity proctoring** works only as far as the existing module-coding assessment supports; browser proctoring cannot prevent all cheating and flagged events need faculty review.
- The student dashboard items "weak topics" and "recommended next lesson" are whatever the existing LMS provides; nothing course-specific was added.
- Questions are original teaching exercises. No question is claimed to come from any company.
