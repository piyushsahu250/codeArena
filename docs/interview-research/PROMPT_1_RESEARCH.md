# Prompt 1: research one company + role

**How to use:** fill in the block marked FILL IN, then paste everything from "BEGIN PROMPT" to "END PROMPT" into an AI tool that can **browse the web** (and, if it allows, attach `interview-research.schema.json` as a file; otherwise paste the schema at the end where marked). Run **one prompt per company + role + experience level + region**. Save the answer as `COMPANY__ROLE__EXPERIENCE__2026.json` (see README.md).

If the tool cannot browse the web, the prompt tells it to say so and produce practice questions only. Do not accept an answer that quietly makes up sources.

---

## BEGIN PROMPT

You are a technical interview researcher and data curator preparing source material for CodeArena, a placement-preparation platform. A human will review everything you produce before any student sees it. Accuracy and honesty about evidence matter far more than volume.

### FILL IN
- Company: `[COMPANY NAME]`
- Exact job role (as in the job description): `[ROLE TITLE]`
- Experience level: `[FRESHER | 0-1_YEARS | 1-3_YEARS | 3-5_YEARS | 5_PLUS_YEARS]`
- Hiring region: `[CITY / COUNTRY]`
- Target year: `2026`
- Official job description: `[URL, or paste the text]`
- Other sources I want you to use (optional): `[URLS OR PASTED TEXT]`
- How many questions: `[NUMBER, maximum 25 per run]`
- Question numbering starts at: `[001, or the next number if this is a second run for the same company and role]`

### STEP 0: can you browse?
If you cannot open web pages in this session, say so in one sentence at the top of your answer, then produce **only class D (practice) questions** and list in `research.limitations` that no web research was possible. Do not pretend to have visited pages.

### STEP 1: research order
1. The company's official careers page and the current job description for this role.
2. The company's own engineering or hiring blog, official interview-preparation pages, and official social posts about hiring.
3. Public candidate interview experiences (reputable interview-experience sites, forums, blog posts) from 2026 first, then 2025 as clearly dated supporting context. Prefer reports from the same role, level and region.
4. Reputable technical interview guides for the skills in the job description.

Open and read each page you cite. **Only cite a URL you actually opened in this session.** Never reconstruct a URL from memory. If a page is behind a login or paywall, do not cite it as evidence.

### STEP 2: classify every question (this is the most important rule)
Each question gets exactly one `evidence_class`:

| Class | Use it only when | `source_ids` |
|---|---|---|
| `A_DOCUMENTED` | The company or an official source states this question, or a very close equivalent, is asked | required |
| `B_CANDIDATE_REPORTED` | A candidate says, in a source you opened, that they were asked it | required |
| `C_INFERRED_FROM_JD` | You wrote it to test a skill the official job description requires. Nobody is claimed to have been asked it | required (the job description) |
| `D_PRACTICE` | You wrote it as a realistic practice question for preparation | must be empty |

Rules:
- **Never invent a question and call it A or B.** If you cannot point to a source that says it, it is C or D.
- **Never write that a C or D question "will appear" or "was asked".**
- Set `times_reported` to the number of **independent** sources that report the same question (0 for C and D). Two articles that copy each other count as one.
- `verification_status = VERIFIED` only if an official source states it, or two independent sources agree. One candidate report is `UNVERIFIED`. Sources that disagree about the same question: `CONFLICTING`, and describe both in `notes`. Never silently pick one.
- Do not claim access to private, leaked, confidential or proprietary question banks, and do not use content that appears to be one.

### STEP 3: copyright and originality
- Do **not** copy questions or answers word for word from any source, and do not reproduce large parts of a question collection. Restate each question **in your own words** (a short phrase under 15 words may be quoted if it is essential). Set `originality_status` to `PARAPHRASED` or `ORIGINAL` accordingly.
- A coding problem must be your own problem covering the same skill, not a copy of a named platform's problem. If a question is clearly a well-known public problem, say so in `notes` and describe it by name rather than reproducing its statement.

### STEP 4: rounds
List the rounds in `rounds`. Mark `evidence` as `DOCUMENTED` or `REPORTED` only when a source supports that the round exists. Otherwise mark it `PROPOSED`, which means "a suggested preparation structure". Do not force every round onto every role: use only rounds that fit this role (online assessment, aptitude, coding assessment, DSA, core technical, role-specific technical, project discussion, system design, case study, managerial/behavioral, HR).

### STEP 5: write the questions
For every question fill in all of: `question_id`, `round_id`, `topic`, `subtopic`, `question_type`, `difficulty`, `prompt` (the complete question), `relevance_to_role` (which part of the job description it tests), `evidence_class`, `source_ids`, `times_reported`, `verification_status`, `confidence`, `originality_status`, `expected_answer`, `rubric` (3 to 6 criteria with weights 1 to 10), `key_concepts`, `follow_ups` (realistic ones), `common_mistakes`, `suggested_time_min`, `tags`, `notes`.

- **Coding** questions also need the `coding` object: language-neutral problem statement, input format, output format, constraints, at least 2 sample inputs with outputs, edge cases, expected algorithm, time and space complexity, and hidden-test categories. **Work out each sample output by hand and re-check it.** Only add `hidden_tests` if you verified the expected outputs; otherwise leave them out.
- **MCQ / MULTI_SELECT** need the `mcq` object: 4 plausible options, the zero-based `correct_options`, an explanation, and notes on why the wrong options are tempting. Check there is genuinely one correct answer (or exactly the set you list).
- **BEHAVIORAL / HR** need the `behavioral` object: the competency, STAR-style guidance, positive and negative signals.
- The mix must match the role and level. A fresher software role should not be mostly system design. Do not pad with generic questions that have no link to the job description.
- Do not ask the same thing twice with different wording.

### STEP 6: be honest about gaps
Put everything you could not find or verify in `research.limitations` (for example: "No 2026 candidate reports found for the managerial round", "Job description gave no salary or round information", "Only two sources, both from 2025"). A short honest list is better than an empty one.

### STEP 7: self-check before you answer
Before replying, check and fix:
1. Every `source_id` used by a question or round exists in `sources`, and every source in `sources` is used.
2. Every class A, B and C question has at least one source; every class D question has none.
3. No class A or B question lacks a source that really says it.
4. `question_id` values are unique and follow the pattern `COMPANY-ROLE-ROUND-NNN` (capital letters, digits and hyphens), numbered from the start number above.
5. Every coding sample output and every MCQ answer is correct (re-solve them).
6. No two questions are near-duplicates.
7. The JSON is valid and matches the schema: no trailing commas, no comments, all dates `YYYY-MM-DD`.

### OUTPUT
Reply with **one JSON document inside a single code block**, matching `interview-research.schema.json` exactly, and nothing after it except a short plain-text list titled `GAPS` (what is missing or weak). No other prose inside the code block.

Set `schema_version` to `codearena-interview-import/1`, `target_year` to 2026, `researched_on` to today's date, and `researcher` to the name of the tool you are.

(If the schema file was not attached, it is the one published with this prompt as `interview-research.schema.json`: paste it here: `[PASTE SCHEMA]`)

## END PROMPT

---

## Tips

- One run = one company, one role, one level. Do not ask for "all roles at Company X" in one go: the quality drops and the sources get mixed.
- If a run returns fewer questions than you asked for, that is correct behavior when evidence is thin. Do not push the tool to "add more": ask it for more **class D** practice questions in a second run (numbering from the next number) instead.
- Spot-check three source URLs from every file yourself (open them; confirm the page exists and says what is claimed). If any is wrong, treat the whole file as unreliable and send it through Prompt 2.
- Then run **Prompt 2** (`PROMPT_2_VERIFY.md`) on the result, ideally in a different AI tool from the one that researched it.
