# Testing

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Automated Test Coverage

**No dedicated automated test suite (unit/integration/e2e) was found in this repository** — no `__tests__` directories, no `*.test.js`/`*.spec.js` files, no Jest/Vitest/Mocha/Playwright/Cypress configuration observed during this documentation pass. Treat this as **NOT VERIFIED as absolutely zero** (a targeted repo-wide file search for test files was not exhaustively re-run in this exact pass) but it is consistent with everything else observed: `frontend/package.json`'s `scripts` has no `test` entry, only `lint` (`oxlint`); `backend/package.json`'s `scripts` has no `test` entry either.

## What Verification Actually Happens

1. **CI gate** (`.github/workflows/ci.yml`) — `prisma validate` + `prisma generate` (schema syntax only) + `npm run build` for both frontend and backend. Catches broken builds and invalid schema, not behavioral regressions.
2. **Manual code review** — the dominant verification method throughout this project's history.
3. **Live deploy + browser walkthrough** — for UI-affecting changes, the established practice (per [AI_HANDOVER.md](AI_HANDOVER.md) and this session's own work) is to push, verify the deploy via `/api/health`'s commit hash, then manually exercise the feature in a browser.
4. **Periodic QA/security audit passes** — this platform has been through multiple dedicated audit passes (background-agent-assisted code review across RBAC, data integrity, performance, error handling) rather than relying on regression tests to catch issues.

## Implication for Future Work

Because there is no regression suite, **every change carries real risk of silently breaking an unrelated feature** — this is exactly why [BUSINESS_RULES.md](BUSINESS_RULES.md) and [AI_HANDOVER.md](AI_HANDOVER.md) emphasize "smallest safe change" and "test affected + related functionality" as a discipline, not a formality. When making a change:
- Identify what else reads/writes the same model or calls the same route.
- Manually verify the golden path plus at least one edge case, in a browser where the change is UI-visible.
- Prefer additive, backward-compatible changes over restructuring, specifically because there's no safety net to catch a subtle behavioral regression.

## Recommendation (not implemented)

Introducing even a lightweight test suite (e.g. Vitest for frontend component/util tests, a handful of Supertest-based backend route tests for the highest-risk RBAC/institute-scoping paths) would meaningfully reduce regression risk going forward — flagged here as a recommendation, not something to silently start building without the user's go-ahead, since it's new infrastructure, not a fix.
