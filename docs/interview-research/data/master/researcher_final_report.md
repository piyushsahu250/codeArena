# CodeArena question bank: final report (24 companies, 1,200 questions)

Research date: 2026-10-09. Region: India. Level: Fresher. Format: `codearena-interview-import/1` (one JSON per role, 37 files) plus the flat 55-column CSV (`all_questions_flat.csv`, 1,200 rows).

## Result
- 24 companies x 50 questions = 1,200. All 37 JSON files pass `validate_codearena.py` with 0 errors (remaining warnings: empty MCQ distractor notes, blank dates where a source shows none).
- Question types: Technical 437, Coding 282, MCQ 218, HR 158, Behavioral 105. Every coding sample output was produced by running a reference solution; MCQ answers were checked by hand.
- Evidence: 214 reported (B 198, C 16) and 986 original practice (D). No question is class A (documented by the company).

| Company | Questions | Reported (A/B/C) | Practice (D) |
|---|---|---|---|
| Accenture | 50 | 5 | 45 |
| Adobe | 50 | 5 | 45 |
| Amazon | 50 | 8 | 42 |
| Capgemini | 50 | 25 | 25 |
| Cisco | 50 | 1 | 49 |
| Cognizant | 50 | 12 | 38 |
| Deloitte | 50 | 7 | 43 |
| Goldman Sachs | 50 | 17 | 33 |
| Google | 50 | 3 | 47 |
| HCL Tech | 50 | 5 | 45 |
| IBM | 50 | 2 | 48 |
| Infosys | 50 | 23 | 27 |
| Intel | 50 | 8 | 42 |
| JPMorgan Chase | 50 | 1 | 49 |
| LTIMindtree | 50 | 16 | 34 |
| Microsoft | 50 | 2 | 48 |
| NVIDIA | 50 | 0 | 50 |
| Oracle | 50 | 2 | 48 |
| Qualcomm | 50 | 2 | 48 |
| SAP | 50 | 19 | 31 |
| TCS | 50 | 47 | 3 |
| Tech Mahindra | 50 | 1 | 49 |
| Wipro | 50 | 2 | 48 |
| Zoho | 50 | 1 | 49 |

## What changed in the final audit
1. **Stricter evidence rule.** Items whose source only names a *topic* (for example "OOP is reported", "puzzles are a topic") were reclassified from B to D. 87 items changed; the list is in `evidence_corrections.csv`. Earlier batches 1 to 5 used a looser rule, so counts in the earlier gap reports are higher than here. **Use this master set, not the earlier zips.**
2. Fixed one latent validator error (Accenture ACN-ASE-R5-001: a practice item with a report count) by setting its count to 0.
3. Duplicate check: no duplicate IDs; no prompt repeats inside one company. 50 prompts repeat across companies (32 coding, 10 HR, 5 technical, 2 MCQ, 1 behavioral). Examples: longest substring without repeats (7 companies), next greater element (4), longest increasing subsequence (4), LRU cache (4), number of islands (5). These are classics that real interviews at several firms share; they are left in place, but you may want to swap some if you want each company's set to feel distinct.

## Known gaps
1. **No official sources.** No company's careers page was fetched successfully for any round, so every round is REPORTED (or PROPOSED), never DOCUMENTED.
2. **Thin candidate evidence.** Most companies rest on one to four candidate reviews plus unattributed guides. Only TCS (47 reported), Capgemini (25), Infosys (23), SAP (19), Goldman Sachs (17) and LTIMindtree (16) have 15%+ of questions tied to a report; NVIDIA, Cisco, JPMorgan Chase, Tech Mahindra, Zoho, Microsoft and Oracle are essentially topic-aligned practice sets.
3. **Dates and experience level.** Several accounts are undated (Goldman Sachs, SAP) or may come from experienced hires (Adobe, SAP); some are older than 2025 (IBM 2019, Oracle 2023, TCS 2023). Each is flagged in item notes and company `_meta.json`.
4. **Formats that cannot be reproduced as text** (Amazon work-style items, IBM cognitive games, Zoho pen-and-paper, Deloitte Versant audio) are proxies.
5. **Coverage.** Your dropdown summary named 25 entries; 24 distinct companies are covered (HCL and HCL Tech are treated as one). Tell me if a 25th company is missing.
6. Salary, package, cutoff and offer-count figures were deliberately not used.

## Files
- `json/<company>/*.json`: import files, one per role, plus `_meta.json` (job description summary, skills, limitations).
- `all_questions_flat.csv`: all 1,200 rows in your flat format.
- `index.json`: file list with question counts.
- `evidence_corrections.csv`: the 87 reclassified items.
