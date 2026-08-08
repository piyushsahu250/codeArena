# Security

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## Authentication & Authorization
See [AUTHENTICATION.md](AUTHENTICATION.md), [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md). Every protected route: `authenticate` (JWT, HS256-only) → `requireRole(...)` (role allowlist) → `attachRequesterInstitute` (institute scoping, where applicable) → handler-level ownership checks.

## Institute Isolation
Application-layer only (no DB row-level security). **This is the single most repeated bug class on this platform** — a route that should be institute-scoped but omits the `attachRequesterInstitute` + ownership-comparison pattern. Confirmed instances found and fixed across multiple sessions, most recently `institutes.js` (this session, see [FIXED_ISSUES.md](FIXED_ISSUES.md) FI-001). **Any new institute-scoped route must include this check** — copy the pattern from `institutes.js`'s `GET /:id/profile-completion-stats`.

## Staff Ownership Isolation
Question Bank enforces per-staff-member privacy within an institute (`ownsQuestionRow()`/`questionVisibilityWhere()`) — confirmed clean, no gaps found in this session's audit. **The Interview Question Bank has no equivalent** — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-001.

## IDOR Protection (student-facing routes)
Confirmed clean (this session's audit) across `submissions.js`, `resume.js`, `profile.js`, `moduleCoding.js` — every student-facing route scopes to `req.user.id`, never a client-supplied id.

## File Access
- Uploaded documents (`StudentDocument`) are external links, not binary storage on this platform.
- A prior SSRF vulnerability in the document-download proxy was fixed (see [FIXED_ISSUES.md](FIXED_ISSUES.md) "Pre-existing fixes" summary — NOT independently re-verified in this pass, re-confirm before relying on it).
- Bulk-upload files are processed in-memory (`multer.memoryStorage()`, 5MB limit) and never persisted to disk.

## API Security
- CORS restricted to a known-origins allowlist (not `*`).
- `helmet` sets standard security headers.
- Global rate limiter (`express-rate-limit`, keyed by authenticated user id when available, else IP) plus several route-specific limiters on expensive/abusable endpoints (login, code execution, AI calls).
- Global 4-arg error handler (added this session) prevents raw error/stack-trace leakage on unhandled errors, and specifically converts Multer file-size errors into clean JSON.

## Session Management
See [AUTHENTICATION.md](AUTHENTICATION.md) — `LoginSession` tracking, `singleSessionOnly` enforcement, self-service session revocation.

## Password Handling
`bcryptjs` hashing, complexity/history/expiration policy, never logged or returned in any response.

## Rate Limiting
See above — multiple purpose-specific limiters beyond the global one: `loginLimiter`, `execLimiter` (code execution routes), `runLimiter` (practice/challenge runs), `draftGenLimiter`/`aiInsightsLimiter`/`improveLimiter`/`aiReviewLimiter` (Claude-backed routes).

## Input Validation
Per-route, hand-written (no shared schema-validation library like Zod/Joi found in this codebase — validation is inline `if` checks in each handler). This means validation completeness depends on each route author, not a shared contract — worth keeping in mind when adding new routes.

## Audit Logging
`AuditLog` model, written on key admin/security actions. Never logs passwords/tokens/secrets. Some high-traffic writes (login) are fire-and-forget specifically to avoid coupling audit-log latency/failures to the primary action.

## Data Protection
- `StudentProfile` PII fields encrypted at rest (`PII_ENCRYPTION_KEY` env var — see [ENVIRONMENT.md](ENVIRONMENT.md); losing/rotating this key without a migration plan has previously caused profile-save failures in production).
- The judge's child-process code execution previously leaked the full server environment (including secrets) to sandboxed student code — fixed (per project history; NOT independently re-verified in this pass).

## Known Security Gaps (as of this documentation pass)
See [KNOWN_ISSUES.md](KNOWN_ISSUES.md): KI-001 (Interview Question Bank isolation), KI-003 (admin.js platform-data routes not institute-scoped — NOT VERIFIED as intentional).

## Security Review History
This platform has had at least two dedicated security-audit passes (per project task history) plus this session's QA/RBAC audit. See [FIXED_ISSUES.md](FIXED_ISSUES.md)'s "Pre-existing fixes" section for the list of prior security fixes (JWT algorithm allowlist, judge env leakage, SSRF, login rate limiting/enumeration, institute-scoping gaps, unsanitized HTML rendering, missing file-type validation, PII encryption).
