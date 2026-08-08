# Development Guide

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## For Anyone (Human or AI) Continuing Work on This Codebase

1. Read [AI_HANDOVER.md](AI_HANDOVER.md) first, then [README.md](README.md), then the specific module doc relevant to your task.
2. Check [KNOWN_ISSUES.md](KNOWN_ISSUES.md) before assuming a feature works a certain way.
3. Check [BUSINESS_RULES.md](BUSINESS_RULES.md) before changing any behavior that touches PRN/Roll Number, profile completion, course visibility, question bank isolation, attendance, or institute scoping — these rules have each been the subject of repeated bug fixes; a casual change risks reintroducing an already-fixed bug.
4. Check [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) before changing any route's role/institute-scoping — copy the established pattern (`attachRequesterInstitute` + explicit ownership comparison), don't improvise a new one.

## Making a Change Safely

Per this platform's own established discipline (echoed throughout its task history and this session's QA work):

1. **Identify dependencies.** What else reads/writes the model or route you're touching? Grep for it.
2. **Understand the current workflow** before changing it — read the full handler, not just the part that looks relevant.
3. **Make the smallest safe change.** Don't refactor, rename, or "clean up" adjacent code as a side effect of a targeted fix.
4. **Test the change directly** (manually — see [TESTING.md](TESTING.md), there is no automated suite).
5. **Test related functionality** — if you changed Roll Number derivation, also check bulk upload, attendance display, and search, since all three depend on it.
6. **Verify existing data isn't affected** — especially for any schema change, given `prisma db push --accept-data-loss` applies on every deploy (see [DATABASE.md](DATABASE.md) §1).
7. **No regressions.** Do not fix one module by breaking another.

## Deploying and Verifying

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full process. In short: commit, push to `main`, poll `GET /api/health` until the returned `commit` matches, and — for anything UI-visible — walk through it in a browser before calling the change done.

## Updating This Documentation Set

**Every change should update the relevant docs in the same work session it's made**, per the checklist below (this mirrors the spec that produced this documentation set in the first place — do not silently let it go stale):

1. Review the changed code.
2. Identify which module(s) it affects.
3. Update the relevant module doc (or [README.md](README.md)'s module list if a whole new module was added).
4. Update [CHANGELOG.md](CHANGELOG.md) with a new dated entry (Added/Changed/Fixed/Removed/Database/Security/Performance/Documentation/Testing sections, only include the ones that apply).
5. Update [API_DOCUMENTATION.md](API_DOCUMENTATION.md) if any route, method, path, or role requirement changed.
6. Update [DATABASE.md](DATABASE.md) / [DATA_DICTIONARY.md](DATA_DICTIONARY.md) if the schema changed.
7. Update [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md) if any permission changed.
8. Update [BUSINESS_RULES.md](BUSINESS_RULES.md) if a business rule changed (not just its implementation — if the *rule itself* changed, that's significant enough to note prominently).
9. Move the relevant [KNOWN_ISSUES.md](KNOWN_ISSUES.md) entry to [FIXED_ISSUES.md](FIXED_ISSUES.md) if the change fixes a tracked issue — **never delete the entry, only move/append it** with a cross-reference.
10. Bump [platform-manifest.json](platform-manifest.json)'s `documentationVersion` (patch bump for a small fix, minor bump for a new feature, major bump for an architectural change) and `lastUpdated` date.
11. Never silently edit documentation without a corresponding [CHANGELOG.md](CHANGELOG.md) entry recording *why*.

**Partial automation exists for step 10's counts only** (added 2026-08-08): `.github/workflows/docs-sync.yml` runs daily and on schema/route changes, recounting API endpoints and Prisma models/enums from source and auto-committing an update to `platform-manifest.json` + a CHANGELOG.md entry if they've drifted. It does **not** perform steps 1-9 — it cannot tell you *why* a count changed or update any prose doc. Treat its CHANGELOG entries as a todo list, not a completed update.

## Verifying Before Trusting a Claim in Any Doc

Per [README.md](README.md)'s accuracy policy: a memory or doc entry that names a specific function, file, route, or flag is a claim that it existed *at the time it was written*. Before recommending or relying on it for something the user will act on, check the file still exists / the route is still there / the flag is still read — code changes; documentation can go stale. If you find a discrepancy, fix the documentation (with a CHANGELOG entry) rather than silently trusting either the stale doc or your own assumption.

## Data Safety Reminders (repeated deliberately — see also [AI_HANDOVER.md](AI_HANDOVER.md) §14, [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md))

- Never delete a table/model/column just because it looks unused without grepping every route file for it.
- Never assume an orphan-looking record is safe to delete — it may be historical/audit/legally-relevant.
- When in doubt, don't delete — archive, flag for review, or ask.
- There is no automated database backup — treat destructive changes with correspondingly more caution than you would on a platform that has one.
