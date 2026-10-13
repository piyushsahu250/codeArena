# C language support in CodeArena

Finding of the audit: **C was already a supported language end to end** (selector, editor, judge, function mode, import, admin forms). This work did not add C from scratch; it found and fixed real defects, added the first automated C tests, and documents what is and is not verified.

## 1. How C is wired (single places of truth)

| Layer | Where | C entry |
|---|---|---|
| Frontend language list and starter | `frontend/src/utils/codeEditorDefaults.js` | `{ id: "c", label: "C", monaco: "c" }`, `defaultStarter("c")` (full program with `main`) |
| Frontend picks used by admin forms | `EvaluationTypeFields.jsx`, `LearningManagement.jsx` (allowed languages), `InterviewHub.jsx` | `"c"` listed |
| Server-side language validation | `backend/src/utils/judge.js` `RUNNERS` | an unknown language returns "Unsupported language" (COMPILE_ERROR); the browser's selector is never trusted |
| Compile and run | `judge.js` `RUNNERS.c` | `gcc -std=gnu17 -O2 -pipe sol.c -o sol_bin -lm`, argument array, never a shell string |
| Function-based harness | `backend/src/utils/functionHarness.js` | starter generator, trusted driver, language availability |
| Import and export | `backend/src/modules/questions/questions.import.domain.js` | column `Starter Code (C)`, language aliases |
| Error hints | `judge.js` `LINE_PATTERNS.c`, `RUNTIME_ERROR_PATTERNS.c` | compiler line numbers, segfault, abort, division by zero and similar |

Compiler: `gcc` (the production image installs Debian `build-essential`; the exact version of the running image is **not verified here**: check with `docker exec codearena-backend gcc --version` after a deploy). Standard: `-std=gnu17`, which is the explicit spelling of gcc's default dialect (C17 plus GNU extensions, so POSIX functions such as `strdup` still work). `-std=c17` was deliberately not chosen: it would hide POSIX declarations and break existing student programs.

## 2. Coverage matrix

| Area | C available | Evidence |
|---|---|---|
| Coding compiler, practice, challenges, module coding tests, formal tests, mock interview coding | yes: all use `CODE_LANGUAGES` and the one judge | code audit; the judge test below |
| Per-question restriction (`allowedLanguages`) | yes: admins can allow or exclude C per assessment | `LearningManagement.jsx` list |
| Question bank and bulk import | yes: `Starter Code (C)` column, language aliases | `questions.import.domain.js`, its unit tests |
| Function-based mode | scalars **and now arrays** (see below); `string[]` is the one shape not offered in C | `functionHarness.js`, `backend/test/judgeC.test.js` |
| MCQ-only modules | not applicable | n/a |

## 3. Defects found and fixed in this change

1. **`-lm` was missing.** `gcc file.c -o bin` does not link the math library, so any program calling `sqrt`, `pow`, `floor`, `sin` ... on a runtime value failed with an undefined-reference link error and was reported as a compile error. Fixed (library placed after the source). Covered by the `math.h` test.
2. **Function-mode doubles lost precision.** The trusted C driver printed doubles with `%g` (6 significant digits): `3.14159265358979` came out as `3.14159`, failing exact comparison. Now printed with the shortest precision that round-trips.
3. **C could not be used for array questions.** Function-based questions with array parameters or return values excluded C entirely. C now follows the LeetCode convention: an array parameter is a pointer plus an `int <name>Size` length; an array return is a `malloc`'d pointer with `*returnSize` set. Supported element types: `int`, `long`, `double`, `boolean` (as `int`). `string[]` stays unsupported. Existing questions are unchanged: they only gain a C starter the next time their signature is saved (the question-contract snapshot records the one declared change).
4. **A crashed C program was reported only as "Runtime Error".** GNU `time` records the death signal in its stats file and a wrapper shell reports `128+N`, so stderr was empty and the segmentation-fault hint never appeared. The judge now decodes both forms and appends the usual wording (Segmentation fault, Aborted, Floating point exception, Bus error, Illegal instruction). gcc `-O2` turns a provable null dereference into a trap (`SIGILL`), so that case has its own plain-language hint ("Invalid Operation").

## 4. Modes and rules

* **Full-program mode (STDIO):** the student writes `main`. Input arrives on stdin and output is compared by the question's comparison mode. Starter: `#include <stdio.h> int main(void) {...}`.
* **Function-based mode:** the student writes only the function; a trusted driver, generated from the validated signature, reads one value per line from stdin, calls the function and prints the result. A student who writes a complete program with `main` is also accepted (the judge detects it and runs it as a plain program). Reading: scalars with `scanf`; strings as the whole line (up to 4,095 characters); arrays as space-separated values on their line.
* Limits: default 2,000 ms per test case, 256 MB, 2 MB of output, 64 processes, 45 s compile budget; each configurable per question or by environment.
* Messages shown to students: compile errors keep the compiler line number and a hint; temporary server paths are removed.

## 5. Tests

`backend/test/judgeC.test.js` (runs in CI with gcc present, skipped without it) executes real C through the real judge: Hello World, input and output, even/odd, loops, arrays, strings with spaces, several test cases, 200,000-integer input, empty input, `math.h`, wrong answer, partial score, compile error (line number kept, no server path in the response), segfault and null dereference, infinite loop timeout, excessive memory, output flood, secrets in the environment, ten concurrent submissions, function-mode scalars/strings/booleans/doubles/arrays, starter code, plus regression runs for Python, JavaScript and C++.

## 6. What is NOT verified (be honest)

* **Not run on the production sandbox.** The CI tests run without `JUDGE_DROP_PRIVILEGES`, the network-denial rule and the dedicated `sandbox` user, so filesystem isolation, path traversal, outbound network and process-spawn restrictions for C were **not tested here**. Existing code and its comments describe them; they need a run inside the production container.
* Browser end-to-end journeys (student, assessment, admin, LMS), mobile editor behaviour, refresh and reconnect during execution: **NOT TESTED**.
* Load: only ten concurrent submissions in CI. No claim is made for 200, 500, 1,000 or 2,000 users; the judge is a small fixed-concurrency queue on one host.
* Reference-solution validation before publishing and the bulk-import path were audited by reading, not exercised with C data here.
* The running compiler version on the production image.
