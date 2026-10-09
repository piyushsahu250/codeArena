# Prompt 2: audit a researched file (second pair of eyes)

**How to use:** open a **different** AI tool from the one that did the research (a second opinion catches more), attach or paste the JSON file from Prompt 1, and paste the prompt below. Save the corrected JSON under the same name with `__audited` before `.json`, and keep the audit report next to it.

---

## BEGIN PROMPT

You are an independent auditor of interview-research data for CodeArena. Below is a JSON file produced by another researcher. Your job is to find what is wrong, fix what you can prove, and downgrade or flag what you cannot. You are not here to make the file look complete.

### What to check, in this order
1. **Schema**: valid JSON, matches `interview-research.schema.json`, required fields present, dates in `YYYY-MM-DD`, ids well formed and unique.
2. **Sources**: for every entry in `sources`, open the URL. Record: does it load, is the publication date the one stated, is it about this company and role. A source that does not load, or that you cannot read, is `UNREACHABLE`.
3. **Classification honesty**: for every class A and B question, find the sentence in the cited source that supports it. If you cannot find it, **downgrade it**: to `C_INFERRED_FROM_JD` if it tests a skill in the job description, otherwise to `D_PRACTICE`, remove its `source_ids`, set `times_reported` to 0 and `verification_status` to `NEEDS_REVIEW`. Never leave an unsupported A or B question in place.
4. **Verification status**: `VERIFIED` only with an official statement or two independent agreeing sources. Otherwise lower it.
5. **Answer correctness**: for every coding question, re-derive each sample output and check the stated complexity; for every MCQ, confirm the keyed answer(s) are correct and the distractors are wrong; for every technical question, check the model answer is accurate and current for 2026. Where you find an error, correct it **and** list it in the report. If you are not sure, set `verification_status` to `NEEDS_REVIEW` and say why in `notes`: do not guess.
6. **Duplicates**: list every pair of questions that ask substantially the same thing (including with different wording). Keep the better one; remove the other; report both ids.
7. **Copying**: flag any `prompt`, `expected_answer` or coding statement that reads as copied from a source or a well-known question collection. Rewrite it in original words (or flag it) and set `originality_status` accordingly.
8. **Fit**: flag questions that do not fit the stated role, level or round, and rounds marked `DOCUMENTED`/`REPORTED` without a supporting source (change them to `PROPOSED`).
9. **Coverage**: compare the topics covered against `research.required_skills` and the round list. Report what is missing. Do not add questions yourself unless asked.

### Rules
- Do not add new sources unless you opened them. Do not invent a source to support a question.
- Do not raise a confidence or verification level: you may only lower it, or keep it when you confirmed it.
- Keep every `question_id` the same unless you delete the question (never renumber).
- Do not remove limitations that are still true; add any new ones you found.

### OUTPUT
1. The corrected file as **one JSON document in one code block** (same schema).
2. Then an **AUDIT REPORT** in plain text with these headings: `SUMMARY` (counts: questions in, questions out, downgraded, corrected, removed as duplicates, flagged), `SOURCE CHECK` (one line per source: reachable or not, date confirmed or not), `CHANGES` (one line per change: question id, what changed, why), `UNRESOLVED` (everything you could not confirm), `COVERAGE GAPS`.

If you cannot browse the web, say so first, skip the source checks (mark every source `NOT_CHECKED`), and do not raise any verification level.

### THE FILE TO AUDIT
`[PASTE THE JSON HERE]`

## END PROMPT
