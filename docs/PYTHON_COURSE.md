# Python Zero to Hero (course content and tooling)

**Status (2026-11-02): pilot only.** Modules 1 to 3 are authored, machine-verified and seeded as a **Draft** course. Modules 4 to 23, the project catalogue and the 200-problem placement bank are **not written yet**. Nothing here is visible to students until an administrator publishes and assigns the course.

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
| Projects | `CourseProject` + `ProjectTask` | None seeded yet |
| Versioning | `LessonContentVersion` | Edits to a published lesson go through versions, which never reset student progress |
| Certificates | `Course.certificateEnabled` + the existing certificate engine | Thresholds are the engine's; see Known limitations |
| Institute isolation | `CourseInstituteAssignment`, `CourseAcademicGroupAssignment`, `courseEligibility.js` | Unchanged. Covered by the integration test |

No schema change and no migration are needed.

## Files

- `backend/content/python/render.js` renders one lesson spec into HTML through a single 20-part template (learning goals, why, real-world use, simple and detailed explanation, syntax, diagram, example with verified output, line by line, dry run, real example, mistakes, best practices, interview view, practice questions, revision, optional Hinglish, then quiz and coding task from `PracticeQuestion`). Helpers draw accessible SVG flowcharts (`role="img"`, `<title>`, `<desc>`, theme-aware colours, sideways scroll on phones) and terminal illustrations.
- `backend/content/python/m01.js`, `m02.js`, `m03.js`: the authored modules. `index.js` lists them in teaching order.
- `backend/scripts/validatePythonContent.js`: the quality gate (below).
- `backend/scripts/seedPythonCourse.js`: idempotent seed.
- `backend/test/pythonCourse.integration.test.js`: HTTP test of the whole flow.

## Pilot inventory (as validated 2026-11-02)

| | Count |
| --- | --- |
| Modules | 3 (Introduction to Programming; Installation and Environment Setup; Syntax and Basic Concepts) |
| Lessons | 20 (6 + 7 + 7), 25 to 45 minutes each |
| Quiz questions | 93 (MCQ, output prediction, debugging, fill in the blank) |
| Coding tasks in lessons | 24, each with 2 sample and at least 1 hidden case |
| Module assessments | 3, with 10 coding questions in total |
| Diagrams | 20 (one per lesson) plus terminal illustrations in the setup lessons |
| Python executions during validation | 172 (every example, every reference solution against every case) |

Module 1 topics 1 to 16 and its three practicals, Module 2 topics 1 to 28, and Module 3 topics are grouped into lessons; every bullet of the spec appears inside a lesson.

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

- **Not authored:** Modules 4 to 23, Phase 4 to 7 content, the 15 mini and 6 major projects, 200+ placement problems, 150+ interview questions, mock tests. The structure and tooling are ready for them.
- **No real screenshots.** Setup lessons use drawn terminal illustrations and flowcharts. Real screenshots of installers would age with every release.
- **Hinglish** is a short optional note per lesson, not a full translation.
- **Rendering was checked** through the same sanitiser the student page uses (DOMPurify), on desktop, a 375 px phone viewport and dark mode. It has **not** been checked inside the live student page or on a real device.
- **Completion criteria and certificate thresholds** (70 % score, two approved projects, final exam) rely on the existing certificate and gating engine; whether every proposed criterion is configurable there was **not verified**, and no projects exist yet.
- **Similarity/plagiarism checks, weekly leaderboard, learning XP and badges** were not inspected or extended; the judge's existing XP on accepted practice submissions applies.
- **Webcam/identity proctoring** works only as far as the existing module-coding assessment supports; browser proctoring cannot prevent all cheating and flagged events need faculty review.
- The student dashboard items "weak topics" and "recommended next lesson" are whatever the existing LMS provides; nothing course-specific was added.
- Questions are original teaching exercises. No question is claimed to come from any company.
