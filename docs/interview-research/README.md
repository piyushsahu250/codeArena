# Company-wise interview research (2026)

How to collect realistic, honest interview-question data for CodeArena mock interviews, and hand it over for import.

## Files in this folder

| File | Purpose |
|---|---|
| `PROMPT_1_RESEARCH.md` | Prompt to research **one company + role + level**. Needs an AI tool that can browse the web. |
| `PROMPT_2_VERIFY.md` | Prompt for an independent audit of a researched file (use a different AI tool). |
| `interview-research.schema.json` | The exact JSON format (attach it to Prompt 1). |
| `EXAMPLE__ExampleCorp__...json` | A fictional file showing the format. **Never import it.** |
| `questions-template.csv` | Flat spreadsheet alternative (one row per question). Delete the example row. |
| `coverage-tracker.csv` | Track which company/role pairs are done. |

## Workflow

1. Add a row to `coverage-tracker.csv` for each company + role + level you plan to cover.
2. Run **Prompt 1** once per row. One run = one company, one role, one level, one region, at most 25 questions.
3. Save the answer as `COMPANY__ROLE__EXPERIENCE__2026.json`, for example `TCS__Software-Engineer__Fresher__2026.json`. A second run for the same pair: add `__part2`.
4. Open three source URLs from the file yourself and confirm they exist and say what is claimed.
5. Run **Prompt 2** in a different AI tool. Save the result as `...__audited.json` and keep its audit report beside it.
6. Update the tracker row, then share the audited files (and reports) with me.

## The four evidence classes

| Class | Meaning | Shown to students as |
|---|---|---|
| `A_DOCUMENTED` | Company or official source states it | Official |
| `B_CANDIDATE_REPORTED` | A candidate says they were asked it | Candidate reported |
| `C_INFERRED_FROM_JD` | Written to test a skill the job description requires | Role-based practice |
| `D_PRACTICE` | Realistic practice question, no claim anyone was asked it | Practice |

Nothing may be labelled "asked by company X" unless it is class A or B with a real source.

## What happens after you share files

1. **Dry run only.** I parse, validate, deduplicate (within the files and against the existing question bank) and produce a report. Nothing is written to the database.
2. You review the report. Questions that pass are imported **only as pending-review drafts**, never published and never touching approved records.
3. Imports are idempotent: re-running the same file creates no duplicates.
4. Admins approve, edit or reject drafts in the existing review screen.

Files named `EXAMPLE__*` or naming `ExampleCorp` are rejected by the importer.

## Rules for the data

- Real, opened sources only. No private or leaked question banks.
- Paraphrase; do not copy question text or answers from sources.
- A short honest `limitations` list is better than padding with invented questions.
