# Assessment manifest, delivery and scoring denominators

Written 2026-10-09 after a report that a 30-question assessment showed 28 questions to some students and scored them out of 28.

## 1. What was established from real data

Read-only audits against production (nothing was written):

| Check | Result |
|---|---|
| `scripts/auditAttemptManifests.js`: every attempt's locked question list (`TestAttempt.questionOrder`) against its test's configured count, duplicates and deleted questions | 28 tests, 2,045 attempts, **0 mismatches** |
| `scripts/reconcileAttemptScores.js` (dry run): stored score against a recomputation from the manifest, and the old maximum against the manifest maximum | 2,045 attempts, **0 differences**, none still pending evaluation |
| nginx logs, `POST /api/submissions/submit` (answer saves), last two logged days | 11,727 requests, **0 answered 429** |

So the stored data shows no attempt that was *given* 28 of 30 questions and none that was *scored* out of 28. **The root cause of the original report could not be proven from stored data.** What is missing is a concrete affected attempt (test name, student, or screenshot). If one is supplied, `node scripts/auditAttemptManifests.js --test=<testId>` and `reconcileAttemptScores.js --test=<testId>` show exactly what was delivered and scored for it.

## 2. Defects that were found and fixed

These are real, reproduced or read from the code, and each could produce "wrong count / wrong denominator" symptoms:

1. **Reports computed the maximum from the test's *current* question list instead of the student's own question list.** The results export did this (a question removed from the test after students started was counted as 0 points for them, and in RANDOM mode the whole bank would have been used); the Talent Pool averages summed the whole bank for RANDOM tests. All now use `utils/attemptManifest.js`.
2. **Nothing checked that the question set was complete before the exam started.** The server now validates the draw at start (no empty draw, no duplicate ids, every id belongs to the test, count equals the configured count). A test that cannot deliver its configured count (for example 30 per student from a 28-question bank) answers **409 `ASSESSMENT_CONFIG_INVALID`** with an actionable message; no shorter attempt is created.
3. **The browser accepted whatever arrived.** `GET /tests/:id` now returns a manifest (`expectedCount`, ids, `unavailableCount`); the page retries a short response up to three times and does not start the exam until the full unique set is present, otherwise it shows an actionable message.
4. **Answer saves shared the 20-per-minute code-execution rate limit.** A quick student could have saves rejected and lose answers. Quiz saves now have their own 240/min per-student limit. (Not observed in the logs above; fixed because it is a latent loss of answers.)
5. **A failed answer save was dropped and never retried.** Failed saves are now remembered, retried in order, and a manual submit warns when answers are still unsaved.
6. **The result showed only a score.** It now reports the maximum, the questions assigned, answered and unanswered (unanswered scores 0 and stays in the denominator).

Fixed earlier (see project notes): attempts whose test was edited after the student started no longer lose questions (hydrated from the `Question` table).

## 3. Definitions

| Term | Source |
|---|---|
| configured | `Test.questions.length` (FIXED) or `randomQuestionsPerStudent` (RANDOM) |
| expected / assigned | the attempt's manifest: `TestAttempt.questionOrder`, count frozen in `expectedQuestionCount` at start, with `manifestVersion` |
| delivered | questions the server sent in `GET /tests/:id` |
| answered | distinct manifest questions with a saved answer |
| evaluated | questions with a scored outcome |

The denominator for "out of N" is always **expected** (the manifest), never answered or rendered. `scoreBases()` in `utils/attemptManifest.js` is the one place that computes it. Attempts that predate the manifest fall back to the test's question list and are marked `LEGACY_TEST_CONFIG`; none exist today.

## 4. Scoring rules that were NOT changed

Test scoring here is points per question (best submission per question, MCQ all-or-nothing, coding proportional to passed cases). There is no negative marking or section-wise marking in formal tests, so none was added. Finalizing is idempotent: the score is recomputed from the saved submissions each time.

## 5. Database change

Additive only (applied by the deploy's guarded `prisma db push`): `TestAttempt.expectedQuestionCount Int?` and `TestAttempt.manifestVersion Int?`. Existing rows stay null and are never back-filled with a guess. **Rollback:** redeploy the previous image (`codearena-backend:rollback-*`, automatic if the health check fails); the two nullable columns can stay unused.

## 6. Monitoring

Structured log lines (grep the container logs):
- `assessment_manifest_invalid`: a start was refused.
- `assessment_count_mismatch`: expected, manifest and delivered counts disagree for an attempt.

Run `scripts/auditAttemptManifests.js` and `scripts/reconcileAttemptScores.js` on a schedule or after any edit to a live test.

## 7. Verification

`scripts/verifyAttemptManifest.js` (against the running API, disposable data): 30-question delivery, manifest contents, refresh/reconnect returns the same set, concurrent starts, answered/unanswered scoring out of 30, retried saves not double-counted, idempotent finalize, admin edits after start, results export denominators, RANDOM per-student draws and their denominator, refusal of an undeliverable configuration, deleted-question reporting, validator rules.

## 8. Remaining risks

- The original 28-of-30 report is unexplained by stored data (section 1).
- `ModuleCodingAttempt` and readiness assessments have their own question snapshots and were not audited here.
- A student with a hard-deleted assigned question is stopped with a message and needs a faculty correction; there is no automated "authorised correction" screen yet.
- Points edited on a question after submission change the maximum shown for past attempts (existing behaviour, unchanged).
