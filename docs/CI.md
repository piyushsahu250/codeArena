# Continuous integration

Workflow: `.github/workflows/ci.yml`. Runs on every push to `main` and `ci/**`, on every pull request, and by hand (Actions tab, "Run workflow"). A newer push to the same branch cancels the older run.

| Job | What it checks | Time |
|---|---|---|
| `lint` | Undefined variables in the whole frontend (and React hooks rules) and the whole backend, using `oxlint` with `frontend/.oxlintrc.json` and `backend/.oxlintrc.json`. No installs needed. | ~15 s |
| `backend` | Prisma schema validates and generates, and the unit tests (`npm run test:unit`) pass. Includes tests for the assessment manifest rules, the permission registry, async-error handling and per-route metrics. | ~1.5 min |
| `frontend` | The production build succeeds. | ~20 s |
| `integration` | A throwaway Postgres 16, the real API (schema pushed, data seeded), the database-backed verify scripts (permissions, async errors, route metrics, attempt manifest), the built SPA served locally, then the full Playwright suite in Chromium: login, role access, every page on phone and laptop, dashboards, exam journeys, fullscreen, accessibility, dark-mode contrast, every lesson, resilience. | ~8 min |

First full run (`ci/full-gate`): all four jobs green; the browser suite ran about 6 minutes. A deliberately undefined variable pushed to a throwaway branch made the `lint` job fail and skip the rest, so the gate does reject real defects.

## Reading a failure

- Open the failed run in the Actions tab; the failing step is marked red. `integration` prints the last 80 lines of the API log on failure and uploads `playwright-results` (screenshots and `results.json`) as an artifact for 7 days.
- The CI database is disposable and seeded fresh each run. Test accounts are created by `backend/scripts/e2eSeed.js` and never touch production.

## What CI does not do

- It does **not** deploy. Vercel deploys the frontend as soon as `main` is pushed, in parallel with CI, and the backend deploys only when `scripts/deploy-aws-host.sh` runs on the host. A red CI therefore does not stop a deploy by itself. To make CI a real gate: work through pull requests and turn on branch protection for `main` (GitHub Settings > Branches > "Require status checks": `lint`, `backend`, `frontend`, `integration`), which needs a repository admin. Until then, treat a red run on `main` as "revert or fix now".
- It does not run the judge sandbox (it needs root and network rules) or anything needing real AI keys, email or the Electron secure-exam client.
- The `*.integration.test.js` backend tests are not run in CI yet.
- Chromium only.
