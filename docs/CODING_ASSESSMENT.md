# Coding Assessment

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

Covers two related-but-distinct systems — do not conflate them.

## 1. Module Coding Tests (`backend/src/routes/moduleCoding.js`)
Graded coding assessments attached to a Learning Management module. Model chain: `ModuleCodingTest` → `ModuleCodingAttempt` (per-student, attempt-limited) → `ModuleCodingAttemptQuestion`/`ModuleCodingSubmission` (per-question state/verdict) + `ProctoringViolation`.

- **Student flow**: `GET /module/:moduleId` → `POST .../start` → `POST /attempts/:id/run` (sample cases, rate-limited) → `/autosave` → `/submit-code` (hidden cases, rate-limited) → `/violation` (proctoring) → `/finalize`.
- **Admin CMS**: full CRUD on tests/questions, bulk-import (template + import), per-language starter code authoring.
- **Staff**: view-only on the CMS, **plus the one explicit exception**: `DELETE /admin/tests/:id/students/:studentId/attempts` (reset a student's attempts) — ADMIN/STAFF, +Institute. See [BUSINESS_RULES.md](BUSINESS_RULES.md) §8.
- **Attempts export**: ADMIN only, +Institute, capped (per project history's performance pass).

## 2. Formal Tests with Coding Questions (`backend/src/routes/tests.js` + `submissions.js`)
A `Test` (which may mix MCQ/CODING/SQL questions from the Question Bank) taken via `TestAttempt`/`Submission`. Server-side timing (clock-offset-synced, not trusting the client), shuffled question/option order persisted per-student (`TestAttempt.questionOrder`/`optionOrder`), premature-finalize protection (a client "time's up" auto-submit is only honored once the server's own clock agrees, within a grace window).

- **Run vs Submit**: Run executes against sample/visible test cases only (no score saved); Submit executes against hidden cases and saves the verdict. This distinction is enforced identically across all 4 coding surfaces on the platform (Formal Test, Module Coding Test, Practice/Lesson coding, Mock Interview coding) per project history's "compiler workflow standardization" pass.
- **Reattempt**: ADMIN/STAFF can grant a reattempt (+Institute).

## Compiler / Judge
Self-hosted (`backend/src/utils/judge.js`) — spawns `gcc`/`g++`/`javac`+`java`/`python3` as child processes, plus in-process SQLite for the SQL question type. Sandboxing hardened over multiple passes (env-var leakage fix, privilege-drop work — see [FIXED_ISSUES.md](FIXED_ISSUES.md) and [SECURITY.md](SECURITY.md)). FUNCTION-mode questions (LeetCode-style, signature-driven starter code + driver generation) via `backend/src/utils/functionHarness.js`; STDIO-mode also supported, and FUNCTION-mode questions accept both a bare function submission and a full program (dual-mode acceptance, per project history).

## Related
[LEARNING_MANAGEMENT.md](LEARNING_MANAGEMENT.md), [QUESTION_BANK.md](QUESTION_BANK.md), [PERFORMANCE.md](PERFORMANCE.md) (judge concurrency), [API_DOCUMENTATION.md](API_DOCUMENTATION.md).
