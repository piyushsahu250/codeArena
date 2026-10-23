# First login: choosing a personal password

**Source:** `backend/src/modules/auth/*` (login, `change-temporary-password`), `backend/src/utils/password.js` (policy), `frontend/src/pages/Login.jsx`, `frontend/src/utils/passwordPolicy.js`, `frontend/src/utils/firstLogin.js`.
**Related:** [AUTHENTICATION.md](AUTHENTICATION.md), [SECURITY.md](SECURITY.md), [BULK_UPLOAD.md](BULK_UPLOAD.md) (where temporary passwords come from).

## What a student sees

1. They enter the e-mail address and the temporary password an administrator gave them, on the ordinary login page.
2. If the server says this account must choose a new password, **the page stays where it is**. The same form gains two fields. The e-mail and temporary password stay filled in, the page says
   *"Welcome to CodeArena! Please create your personal password before continuing."* and the button reads **Change Password & Login**.
3. As they type, five rules each turn from a red cross to a green check by themselves (uppercase, lowercase, number, special character, at least 8 characters), and the confirmation field says
   *"Passwords do not match."* or *"Passwords match."* (nothing while it is empty). The button is enabled only when every rule is met and both fields agree.
4. On success they are signed in and land on their dashboard with *"Password changed successfully. Welcome to CodeArena!"*. Signing in later is the ordinary sign-in.

The same page serves any role whose account carries the flag (staff, clerks and administrators created with temporary passwords), and accounts whose password has passed the institute's expiry window (wording: *"Your password has expired. Please create a new password before continuing."*).

## The flow before this change (kept here as the record the work started from)

| Step | What happened | Where |
|---|---|---|
| 1 | `POST /auth/login` checked the password and **issued a full session** (token + `LoginSession` row) even when `mustChangePassword` was true, returning `user.mustChangePassword: true` | `auth.service.js` `login` |
| 2 | The login page stored the token and the user object in `localStorage`, then navigated to a separate page, `/change-password` | `Login.jsx`, `AuthContext.jsx` |
| 3 | Route guards sent every protected route to `/change-password` **based on `user.mustChangePassword` read from `localStorage`** | `App.jsx` |
| 4 | `/change-password` asked for the temporary password again plus the new one and checked only `length >= 6` in the browser, then called `PATCH /users/me` | `ForceChangePassword.jsx` |
| 5 | The server verified the current password, applied complexity (8 characters, upper, lower, digit, special), history and "not the same", wrote the hash and cleared the flag, and returned a new session | `users.account.service.js` `updateOwnAccount` |

**Root causes found**

1. *The requirement was enforced only by the browser.* The server handed out a working token at step 1 and no server code looked at `mustChangePassword` again. Editing `localStorage` (`mustChangePassword: false`) or calling any API with the token skipped the change.
2. *The browser and the server disagreed about the policy* (6 characters versus 8 characters with four kinds), so the page accepted passwords the server then refused.
3. *The change was a second page.* A browser's password manager saw a sign-in with the temporary password that "worked" and then an unrelated form, and had no `autocomplete`/`name` hints to tell them apart.
4. *`PATCH /users/me` is not safe against two simultaneous requests* (both verify the same current password, both write), and a failure to open the new session after the password had changed surfaced as an error saying the change failed.

## The flow now

```
Login page --POST /auth/login--------------------------> server checks the password and the account state
                                                          wrong / unknown ......... 401 "Invalid email or password."   (unchanged)
                                                          deactivated ............. 403                              (unchanged)
                                                          must change the password  200 { passwordChangeRequired: true, reason, token: null, user: { mustChangePassword: true } }
                                                                                        NO session, NO token
              <-- same page shows the new-password fields
Login page --POST /auth/change-temporary-password------> server re-checks everything (below), replaces the password atomically,
              { email, temporaryPassword, newPassword, confirmPassword }
                                                          200 { token, user }                      session open, same shape as a login
                                                          200 { passwordChanged: true, signedIn: false, message }   changed, session could not be opened
                                                          400 / 401 / 403 / 429
```

*Nothing can be called with the answer to step 1*: there is no token, so the requirement cannot be skipped by editing the page, replaying the response or calling an API directly. The only route that accepts the temporary password is the change route.

### `POST /api/auth/change-temporary-password`

Public, because the account has no session yet; the temporary password in the body is the proof of identity. Body: four text fields (`email`, `temporaryPassword`, `newPassword`, `confirmPassword`); anything else (a missing field, a number, an object that Prisma would read as a filter) is a plain 400 before any lookup.

| Check, in order | Result |
|---|---|
| Body shape | 400 "Invalid request. Send your email address, temporary password, new password and its confirmation as text." |
| `newPassword !== confirmPassword` | 400 "Passwords do not match." |
| Password policy (below) | 400 with the first rule broken |
| Account exists and the temporary password matches (bcrypt, the same work whether or not the account exists) | else **401 "Invalid email or password."** |
| Account / institute active | else 403 (shown only to someone who proved the password) |
| The account's **stored state** requires a change (`mustChangePassword`, or expired) | else the **same 401**: the route cannot be used to change a password without signing in, and a student who already chose theirs learns nothing new |
| `newPassword !== temporaryPassword` | 400 "New password cannot be the same as your current password" |
| Not one of the institute's last `passwordHistoryDepth` passwords | 400 "You've used this password recently…" |
| **Compare-and-swap** inside one transaction: the stored hash is replaced only if it is still the hash that was just verified; the same transaction clears `mustChangePassword` and any outstanding reset link and writes the history row and `passwordChangedAt` | if it was not (two requests, a replay): **401**, nothing changes |
| After the commit: every session of the account is closed, the change is audited (`PASSWORD_CHANGED`, `via: first_login_temporary_password` or `expired_password`), an alert e-mail is queued, a session is opened (`LOGIN` audited, first-login alert as before) | `200 { token, user }` |
| If opening the session fails | `200 { passwordChanged: true, signedIn: false, message }`: **never an error**, because the password did change; the page tells the student to sign in with the new password |

Rate limit: it **shares the login's budget** (same key: client address + e-mail, 5 per 15 minutes) so a second endpoint does not double an attacker's guesses, but only a rejected credential (401) uses it up; a rejected *new* password (400) does not, so a student cannot be locked out of the step that lets them in.

### Login response for an account that must change its password

`{ "passwordChangeRequired": true, "reason": "TEMPORARY_PASSWORD" | "PASSWORD_EXPIRED", "token": null, "user": { "mustChangePassword": true } }`. `reason` is `PASSWORD_EXPIRED` whenever the institute's expiry window has elapsed (judged live), else `TEMPORARY_PASSWORD`. `token: null` and the one-key `user` exist so that a copy of the login page cached before this change fails safely (a "session expired" redirect) instead of writing the string "undefined" into `localStorage`, which would break the app on the next load.

## Password policy (one rule set, two places)

| Rule | Server (`validatePasswordComplexity`) | Page (`passwordPolicy.js`) |
|---|---|---|
| Uppercase | `/[A-Z]/` | same |
| Lowercase | `/[a-z]/` | same |
| Number | `/[0-9]/` | same |
| Special character | `/[^A-Za-z0-9]/` (anything that is not a letter A-Z/a-z or a digit, including a space, an underscore or an accented letter) | same |
| Length | at least 8 | same |

The server is the only place the rules are *enforced*. `backend/test/passwordPolicyConsistency.test.js` loads the page's own file and holds it to the server's verdict for a matrix of passwords, so the two cannot drift apart unnoticed. No maximum length exists (bcrypt reads only the first 72 bytes; see Limitations).

## What the page does (`Login.jsx`)

* **One `<form>`** for both steps. The e-mail and current-password inputs are the same elements in both, so a browser's password manager sees a single username / current-password / new-password form and not a sign-in followed by an unrelated one.
* Attributes: e-mail `type="email" name="username" autocomplete="username"`; sign-in / temporary password `name="password" autocomplete="current-password"`; new and confirmation `autocomplete="new-password"`. No hidden or decoy inputs, no `autocomplete="off"`, no scripts that touch the password manager.
* Show / hide is a **checkbox** ("Show passwords"), not a button, so the submit button stays the first button of the form (the existing browser tests click `form button`).
* A rule is never signalled by colour alone: a ✓ / ✕ glyph and a hidden "(requirement met / not met)" phrase accompany it. Colours are the theme's AA-tested status text tokens (`themeContrastRegression.mjs`).
* Keyboard and screen reader: focus moves to the new-password field when the step opens; the rule list is labelled and referenced by the field (`aria-describedby`); the confirmation message and the step change are polite live regions; errors are `role="alert"`.
* Nothing is stored by the page itself: the token and user object are stored by `AuthContext` after a successful change, as for any sign-in. The passwords live in component state only; they are never put in a URL, `localStorage`, `sessionStorage`, a cookie or a log.
* **Duplicate submission:** a ref set synchronously plus a disabled button; the server's compare-and-swap is the real guard.
* **Failures:** the form keeps its values after any recoverable failure. After a request that got **no usable answer** (network failure, timeout, 5xx) the page tries the new password once before it says anything, because the change may have gone through: if it signs in, the student is simply in; if the server answers "no", the message is "Your password was not changed. Please try again."; if there is still no answer it says the outcome is unknown and what to try.
* Older server: if the server still returns a token for a flagged account (the page was deployed first), the page falls back to the old `/change-password` route.

## Password managers: what is and is not known

Done: the standard form semantics above. **Not claimed:** that a save/update prompt appears; browsers and password managers decide that themselves. What was actually tested is listed in the report that accompanied this change; a manual check on staging (Chrome with Google Password Manager, Edge, Firefox, Safari) is still required. Design intent (not verified in any browser): the form never unmounts between the two steps, so that a browser does not treat the first step as a successful sign-in and offer to save the temporary password; it does unmount after the successful change, which is the moment a browser that supports it can offer to save or update the credential.

## Tests

| What | File | Where it runs |
|---|---|---|
| Rule independence, confirmation states, button enabling, failure wording, form attributes | `frontend/scripts/passwordPolicyRegression.mjs` | frontend CI job |
| Page rules == server rules | `backend/test/passwordPolicyConsistency.test.js` | backend CI job (unit) |
| Request validation, response shapes, reasons | `backend/test/authDomain.test.js` | backend CI job (unit) |
| The login contract for flagged accounts (200, no token) | `backend/test/snapshots/auth-contract.json` via `verifyAuthContract.js` | integration CI job |
| No session before the change; wrong-credential and unknown-e-mail answers identical; each rule refused; malformed bodies; atomic replace; temporary password single-use; replay; two simultaneous requests (one wins); sessions closed and one opened; audit rows; deactivated accounts; expiry; session-creation failure (fault injected) reported as "changed"; rate limits (only 401 counts, shared with login); admin reset still leads here; no password in the audit log, e-mail log or API log | `backend/scripts/verifyFirstLoginPasswordChange.js` | integration CI job |
| Browser journey: stays on `/login`, welcome text, button label, populated fields, rule-by-rule indicators, confirmation, show/hide, success lands on the dashboard with the toast, old password dead, nothing stored, forged `localStorage`, network failure and "changed but the answer was lost", double submit, autocomplete attributes, keyboard order, axe (light and dark) | `frontend/e2e/tests/firstLogin.spec.js` | integration CI job |

## Deployment and rollback

* **Order:** deploy the backend first, then the frontend (Vercel deploys the frontend on merge to `main`). A frontend that arrives first still works against the old server (it falls back to `/change-password`); an old frontend that meets the new server fails safely (see above).
* **No schema change, no new environment variable.**
* **Sessions that existed before the deploy** are not touched: an account that was signed in on a temporary password before the deploy keeps its session and its old `/change-password` page. To end those sessions (optional, changes production data, needs approval): close the active `LoginSession` rows of users whose `mustChangePassword` is still true.
* **Rollback:** redeploy the previous backend image (the deploy script keeps a `rollback-<stamp>` tag) and revert the frontend commit. The new column set is the old one; nothing needs migrating back.

## Limitations and observations

* *Self-service "forgot password" does not clear `mustChangePassword`* (`replacePasswordFromReset` in `auth.repository.js`): a student who set their own password through the e-mailed link is asked to choose another one at their next sign-in. Pre-existing; not changed here because the reset contract is pinned by `auth-contract.json`.
* bcrypt reads only the first 72 bytes of a password, so two passwords that share their first 72 bytes are the same password. There is no maximum length rule; one would be a policy decision.
* The older `/change-password` page (`ForceChangePassword.jsx`) still checks only `length >= 6` in the browser; the server refuses weaker passwords either way. It is reachable only by a session created before this change.
* `backend/scripts/reproduceProfilePatch400.js` (a one-off diagnostic) signs in as a flagged account and used to receive a token; it no longer does.
* Browser password-manager behaviour could not be tested in CI (headless Chromium has no password manager).
