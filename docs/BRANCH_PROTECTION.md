# Branch protection for `main` (instructions for a repository administrator)

**Current state, checked 2026-10-09 against the GitHub API:** `main` is **not protected** (`"protected": false`, required status checks enforcement `off`, no rulesets). Anyone with write access can push straight to `main`, and Vercel deploys the frontend on every such push. **Deployment is therefore not protected by CI yet.** This document must not be read as saying otherwise until the verification at the bottom has been done after the settings are switched on.

The repository is public, under the personal account `piyushsahu250`. Both branch protection rules and rulesets are available for public repositories on every plan. The settings below need the Admin role on the repository.

## The checks that must be required

These are the exact names GitHub reports (read from the check-runs API for a real commit, all produced by the `CI` workflow in `.github/workflows/ci.yml`):

| Required check (exact name) | What it proves |
|---|---|
| `lint` | No undefined variables anywhere in the frontend or backend; React hooks rules |
| `backend` | Prisma schema valid, unit tests pass |
| `frontend` | The production build succeeds |
| `integration` | Real API plus throwaway database, the database-backed verify scripts, and the full browser suite |

`Vercel` also appears as a status on commits; it is the deployment itself and is optional as a required check (see "Vercel" below). Do **not** mark `Docs Sync` or `Keep Backend Warm` as required.

Note on a past flaw: a run on `main` used to be cancelled when a second commit landed seconds later, which would have left a required check "cancelled" and blocked merging. The workflow now never cancels runs on `main` (`cancel-in-progress` is false there), so this cannot happen.

## Option A (recommended): a ruleset

GitHub, repository **Settings > Rules > Rulesets > New ruleset > New branch ruleset**.

1. **Ruleset name:** `main release gate`. **Enforcement status:** `Active`.
2. **Bypass list:** leave **empty** if you want nobody (including admins) to bypass. If you are the only maintainer and want an emergency path, add yourself with `Bypass mode: Always` knowing that it defeats the protection for you; prefer `For pull requests only`.
3. **Target branches:** `Add target > Include default branch` (this is `main`).
4. **Branch rules**, tick:
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging**
     - Required approvals: **1** if there is a second maintainer; **0** if you work alone (GitHub does not let an author approve their own pull request, so 1 would lock a solo maintainer out).
     - **Dismiss stale pull request approvals when new commits are pushed**
     - **Require review from Code Owners** only when a second person exists; `.github/CODEOWNERS` already lists the sensitive paths (workflows, deploy script, Prisma schema, auth, permissions, session and exam-security code, Dockerfile).
     - **Require conversation resolution before merging**
   - **Require status checks to pass**
     - **Require branches to be up to date before merging**
     - **Add checks:** `lint`, `backend`, `frontend`, `integration` (they appear in the picker only after they have run at least once in the last week, which they have).
5. **Create.**

## Option B: classic branch protection

**Settings > Branches > Add branch protection rule**, pattern `main`:
- Require a pull request before merging (approvals as above)
- Require status checks to pass before merging, and require branches to be up to date; select `lint`, `backend`, `frontend`, `integration`
- Require conversation resolution before merging
- **Do not allow bypassing the above settings** (this is what stops admins pushing straight to `main`)
- Do not allow force pushes; do not allow deletions
- "Restrict who can push to matching branches" exists only for organization-owned repositories; on this personal repository the pull-request requirement is what blocks direct pushes.

## Vercel

Once direct pushes to `main` are blocked, the frontend only reaches production through a merged pull request whose four checks passed, because Vercel builds the branch only when it changes. Vercel also builds a preview for each pull request branch. Optionally add the `Vercel` status as a required check so a failing build also blocks the merge.

## The backend is deployed by hand, and now has its own gate

The backend deploys only when someone runs `scripts/deploy-aws-host.sh` on the AWS host. That script now calls `scripts/check-ci-green.sh` first and **refuses to deploy a commit unless `lint`, `backend`, `frontend` and `integration` all succeeded for exactly that commit** (it stops on red, still-running, cancelled or missing checks, or when GitHub cannot be reached). The emergency override is `SKIP_CI_CHECK=1`, and it prints a warning. This protects backend deploys today, independent of the GitHub settings above.

## Workflow after protection is on

Work on a branch, open a pull request into `main`, wait for the four checks, merge. Do not push directly to `main` any more (it will be refused). Test CI changes on a `ci/<name>` branch.

## Verification (do this after switching it on; do not skip)

1. Settings: re-open the ruleset or rule and confirm it shows `Active` and lists the four checks.
2. API: `GET https://api.github.com/repos/piyushsahu250/codeArena/branches/main` should now say `"protected": true`.
3. Direct push refused: from a clone, `git push origin HEAD:main` with a harmless commit should be rejected with "protected branch hook declined" or "changes must be made through a pull request".
4. Failing check blocks: open a pull request that deliberately uses an undefined variable (as in the earlier negative test); the `lint` check turns red and the **Merge** button must be disabled.
5. Passing check allows: a harmless pull request with four green checks can be merged.

Record the date and who verified it here: ______ (not yet done; as of this writing the protection is **not** enabled).
