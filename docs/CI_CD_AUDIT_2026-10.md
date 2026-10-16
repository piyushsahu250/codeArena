# CI/CD audit, October 2026

Everything below is either measured, read from a file in this repository, or labelled NOT VERIFIED. Nothing is inferred from YAML alone about what ran.

## 1. What exists (verified)

| Piece | Evidence |
|---|---|
| CI provider: **GitHub Actions** | `.github/workflows/` has `ci.yml`, `android.yml`, `docs-sync.yml`, `keep-warm.yml`; the run history is on github.com/piyushsahu250/codeArena/actions |
| Frontend hosting: **Vercel**, deployed from `main` on push | `frontend/vercel.json`; the Vercel status appears on every commit (observed) |
| Backend hosting: **AWS EC2**, deployed by hand with `scripts/deploy-aws-host.sh` over SSM | observed in this session: the script built the image and printed the deployed commit |
| Production revision visible at `GET /api/health` (`commit`) | observed after each deploy |
| Triggers: `ci.yml` runs on push to `main` and `ci/**`, pull requests to those, and manual dispatch | `ci.yml` header; a branch named `fix/...` never ran CI (observed once, 2026-10-15) |

## 2. Baseline (measured)

Run #856 on commit `132661e`, GitHub-hosted `ubuntu-latest`, taken from the Actions jobs API (per-step start and end times). One run, so treat the numbers as indicative.

| Job | Duration | Notes |
|---|---|---|
| lint | 15 s | frontend 7 s, backend 1 s |
| frontend | 30 s | `npm install` 12 s, build 4 s, node regression scripts under 1 s |
| backend | 57 s | `npm install` 26 s, apt (cairo/pango headers) 20 s, unit tests 2 s |
| **integration** | **9 min 35 s** | Browser suite **6 min 46 s** (one worker), verification scripts 62 s, backend install + schema + seed 42 s, apt 23 s, Postgres container start 21 s, SPA build 13 s, API start 3 s |
| Whole pipeline | 9 min 47 s | the critical path is the integration job; the other three finish in under a minute |

Other recorded runs of the same pipeline took 9 min 26 s to 10 min 38 s.

Frontend bundle served in production (measured with `curl`, gzip): initial page load is about **147 KB** (JS 130 KB across 6 files, CSS 17 KB). Large dependencies (the code editor, charts) load on demand. No action needed.

Baseline test results: lint, backend unit tests, frontend build and the integration job were green on the commits used for the deploys in this session. Pre-existing lint warnings exist (about 23 warnings: unused variables and `fetch` options in scripts); none fail the job.

## 3. Status by component

| Component | Status | Evidence |
|---|---|---|
| CI workflow triggers on `main` and `ci/**` | PASS | runs observed on both |
| Required checks defined (lint, backend, frontend, integration) | PASS | job names in `ci.yml`; `docs/BRANCH_PROTECTION.md` lists them |
| **`main` branch protection / required checks enforced** | **FAIL** | GitHub API, 2026-10-16: `main` `"protected": false`, no rulesets. Any push to `main` is accepted whether or not CI passed |
| **Frontend (Vercel) production deploy gated by CI** | **FAIL** | Vercel deploys `main` on push; with no required checks it does not wait for CI. The only gate today is the convention of merging after green CI |
| Backend deploy gated by CI | PASS (by reading and use) | `deploy-aws-host.sh` runs `scripts/check-ci-green.sh` and fails closed; it passed for each deploy this session. The failing-CI path was **not** exercised on production |
| Deployed revision traceable | PASS | `/api/health` returns the commit; the script prints `Deploying commit <sha>` |
| Rollback available | PASS | the script tags the previous image `rollback-<stamp>` and restores it if the new one is not healthy; recent checkpoints exist on the host |
| Schema-change safety | PASS | the script's schema guard refuses destructive changes (DROP TABLE/COLUMN/TYPE) unless explicitly overridden |
| Two deploys at once | **FAIL** (fixed on branch) | the script had no lock |
| Post-deploy smoke checks | NOT AUTOMATED | done by hand over SSM; nothing in Actions verifies production after a deploy |
| Secrets in logs / untrusted PRs | PASS (by reading) | `ci.yml` uses only dummy test values, no repository secrets; fork pull requests run without secrets. Repository secrets and environment settings were **NOT VERIFIED** (needs admin access) |
| Token permissions | FAIL (fixed on branch) | `ci.yml` had no `permissions:` block, so it used the repository default |
| Runtime matches production | FAIL (fixed on branch) | CI used Node 22; production image is `node:20-slim` |
| Deterministic installs | FAIL (not fixed) | CI runs `npm install`, not `npm ci`, because the lockfiles have drifted from `package.json` (documented in the workflow) |
| Linter pinned | FAIL (fixed on branch) | `oxlint@latest` meant a new release could change results with no code change |
| Job timeouts | FAIL (fixed on branch) | only `integration` had one (40 min); the others could hang up to GitHub's 6-hour default |
| Dependency vulnerability scanning | FAIL (partly addressed) | no Dependabot or audit existed. A report-only `npm audit` step was added; Dependabot was not |
| Failure notifications | NOT VERIFIED | GitHub emails the pusher on failed runs by default; the notification settings were not inspected |

## 4. Root causes and impact

1. **`main` is unprotected, so CI cannot stop a release (highest impact).** Vercel ships the frontend from `main` the moment a commit lands. A red or still-running CI does not delay it. Nothing technical prevents a push that skips CI. Fix needs repository admin settings (section 7).
2. **No deploy lock.** Overlapping deploys would race on the image tag and container name. Fixed: `flock` at the top of `deploy-aws-host.sh`.
3. **CI tested on a different runtime than production** (Node 22 vs 20). A feature that only works on 22 would pass CI and fail in production. Fixed for the backend and integration jobs.
4. **Slow critical path.** 70% of the 9.5 minutes is one single-worker browser suite. Not changed (section 6).
5. **Unpinned tooling and no timeouts** made results less reproducible and hung runs expensive. Fixed.

## 5. Changes made on `ci/ci-hardening`

| File | Change | Why |
|---|---|---|
| `.github/workflows/ci.yml` | `permissions: contents: read` | least-privilege token |
| | `timeout-minutes` on backend (15), frontend (15), lint (10); integration 40 to 25 | hung runs fail fast; 25 min is 2.4x the slowest measured run |
| | Node 20 for the backend and integration jobs | matches `backend/Dockerfile` |
| | `oxlint@1.88.0` instead of `@latest` | reproducible lint |
| | npm cache for the integration job; Playwright browser cache | fewer downloads. Effect is **not yet measured**: the first run populates the caches |
| | report-only `npm audit` (high and critical, production deps) in backend and frontend jobs | visibility without blocking; the step is `continue-on-error` and says so |
| `scripts/deploy-aws-host.sh` | `flock -n` deploy lock | prevent overlapping deploys. Syntax checked with `bash -n`; `flock` itself must be tested on the host |

Not changed: the deploy flow, the host, Vercel settings, secrets, or any application code.

## 6. Not done, with reasons

* **`npm ci`.** Needs the lockfiles regenerated with Node and npm, which are not installed on the working machine. Commands: in `backend/` and `frontend/` run `npm install`, commit the updated `package-lock.json`, then switch the workflow to `npm ci`.
* **Sharding the browser suite.** Two parallel runners could cut the 6 min 46 s roughly in half (an **estimate**, not measured), but every runner repeats about 2 minutes of setup and some specs may share seeded data. Needs a trial run before adopting.
* **Dependabot.** Opens pull requests automatically; left for your decision.
* **Pinning actions by commit SHA** and replacing `actions/*@v4`, which GitHub warns will move off Node 20. Low risk, not done.
* **Automated post-deploy smoke and drift check.** Not added: the deploy runs outside Actions. A scheduled check that compares `/api/health` `commit` with `main` is a cheap follow-up.
* **Failure-path tests of the release gate on production.** Deliberately not run against the live host.

## 7. Manual actions (need repository admin)

1. Create the ruleset in `docs/BRANCH_PROTECTION.md` (Settings, Rules, Rulesets): require `lint`, `backend`, `frontend`, `integration`; block force pushes and deletion. Allow the `github-actions` bot to bypass, because `docs-sync.yml` pushes to `main`.
2. In Vercel, confirm production deploys from `main` only, and consider "Only deploy after checks pass" so a red CI blocks the frontend too. (NOT VERIFIED, needs the Vercel dashboard.)
3. Review repository secrets and Actions settings (default workflow permissions: read) in Settings, Actions.

## 8. Verify it yourself

```
curl -s https://api.github.com/repos/piyushsahu250/codeArena/branches/main      # "protected" should become true after step 1
curl -s https://api.github.com/repos/piyushsahu250/codeArena/actions/runs/<run-id>/jobs   # per-step timings
curl -s https://api-aws.codearena.site/api/health                                # deployed commit
bash -n scripts/deploy-aws-host.sh                                               # syntax of the deploy script
```

## 9. Verdict

The pipeline's checks are real and cover a lot (database-backed API scripts, a browser suite, lint, a build), and backend releases are properly gated and reversible. It is **not production-ready as a release gate** until `main` is protected: today a frontend release is gated by habit, not by the system.
