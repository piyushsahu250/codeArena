# Authentication

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Source:** `backend/src/routes/auth.js`, `backend/src/middleware/auth.js`

## Mechanism
JWT bearer tokens. Issued on `POST /api/auth/login` (and `/register`), sent by the client as `Authorization: Bearer <token>`, verified by the `authenticate` middleware on every protected route.

## Token Verification
`authenticate` calls `jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] })` — the explicit `algorithms` allowlist is a deliberate hardening fix (prevents `alg: none` / algorithm-confusion attacks); do not remove it.

## Password Handling
- Hashed with `bcryptjs` before storage (`User.passwordHash`).
- Password complexity, history (`PasswordHistory`, depth configurable per institute via `passwordHistoryDepth`), and expiration (`passwordExpiryDays`) policies are enforced on signup/reset/change routes.
- `mustChangePassword` flag forces a redirect to `/change-password` on every route until cleared.

## Session / Device Tracking
- `LoginSession` records active sessions/devices.
- `singleSessionOnly` (per-institute setting) invalidates other active sessions on a new login when enabled.
- Users can view and revoke their own sessions: `GET /api/users/me/sessions`, `DELETE /api/users/me/sessions/:sessionId`.
- Login alert emails fire on first login, new device, and password change/reset (per project history — NOT independently re-verified in this pass).

## Password Reset Flow
`POST /api/auth/forgot-password` → `POST /api/auth/reset-password`, both public (no auth required, by necessity).

## Rate Limiting
`POST /api/auth/login` has a dedicated rate limiter (`loginLimiter`) — added specifically to prevent brute-force attempts and to close a user-enumeration gap in earlier error messages (see [FIXED_ISSUES.md](FIXED_ISSUES.md)).

## Logout
`POST /api/auth/logout` — invalidates the session server-side (exact mechanism — session record deletion vs. token blocklist — NOT VERIFIED without reading the route body directly; JWTs are stateless by design, so "logout" most likely means the frontend discards the token plus the server deletes the `LoginSession` row, not a token-revocation list).

## Related
[SECURITY.md](SECURITY.md), [USER_ROLES.md](USER_ROLES.md), [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md), [BUSINESS_RULES.md](BUSINESS_RULES.md) (special account states).
