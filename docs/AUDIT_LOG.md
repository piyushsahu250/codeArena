# Audit Log

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Model:** `AuditLog` · **Viewer routes:** `GET /api/users/audit-log`, `/audit-log/actions` · **Frontend:** `AuditLogPage.jsx`

## What's Recorded
`action` (a defined set of `AUDIT_ACTIONS` constants — e.g. institute config changes, account activation/deactivation, password resets, document verification, question bank changes), `adminId`/`adminName`/`actorRole`, `studentId` (when relevant), `instituteId`, `details` (JSON — free-form context per action type), `createdAt`.

## What's Never Recorded
Passwords, tokens, API keys, or other secrets — enforced by convention (every `logAudit()` call site is expected to pass only safe fields in `details`), not by a mechanical redaction filter. **If you add a new audit-log call site, manually verify `details` contains no secret.**

## Access
`GET /audit-log`, `/audit-log/actions` — ADMIN/STAFF/CLERK, +Institute. Clerk's inclusion here is deliberate (unlike Learning Management/Question Bank, which exclude Clerk entirely) — see [CLERK_MODULE.md](CLERK_MODULE.md).

## Write Pattern
Most writes are synchronous (`await logAudit(...)`), but at least one high-traffic path (login) uses a fire-and-forget write specifically to avoid coupling audit-log latency/failure to the primary action — a deliberate performance/reliability tradeoff from an earlier hardening pass, not an oversight.

## Retention
No explicit retention/purge policy found in this codebase — `AuditLog` rows appear to accumulate indefinitely. NOT VERIFIED whether this is a deliberate choice or simply hasn't been addressed yet; worth flagging if storage growth ever becomes a concern.

## IP/Device Info
`LoginSession` (a separate model) tracks session/device info for active-session management — NOT the same as `AuditLog`, and NOT VERIFIED whether `AuditLog.details` ever includes IP/device data on any specific action without checking each call site directly.

## Related
[SECURITY.md](SECURITY.md), [AUTHENTICATION.md](AUTHENTICATION.md) (`LoginSession`), [BUSINESS_RULES.md](BUSINESS_RULES.md) §10.
