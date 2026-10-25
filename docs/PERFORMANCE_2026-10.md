# Platform performance investigation, October 2026

Status: in progress. Everything below was measured on 2026-10-25 against production, read-only (a handful of ordinary requests from one workstation, plus read-only commands on the
server). No load test was run. Estimates are labelled as estimates.

## What was measured

### Frontend delivery (measured from a workstation in India)
| Item | Result |
|---|---|
| Site (Vercel, Mumbai edge) first byte, warm | 0.21 to 0.35 s |
| Entry JavaScript + CSS, compressed (brotli) | about 150 KB: `index` 53 KB, `vendor-react` 60 KB, `api` 20 KB, CSS 17 KB |
| Caching of assets | `public, max-age=31536000, immutable`; HTML `max-age=0, must-revalidate` |
| Route code splitting | present (lazy routes) |

Conclusion: the initial download is not the bottleneck.

### API path
| Item | Result |
|---|---|
| Trivial API call (`/api/health`), warm | 0.23 to 0.34 s |
| Same call on a cold connection | 1.1 s (DNS + TCP + TLS about 1.0 s) |
| Protocol | HTTP/1.1 (nginx); no HTTP/2 |
| CORS preflight (`OPTIONS`) | answered, but **without `Access-Control-Max-Age`**: browsers repeat it before authenticated calls once their 5 s default expires |
| `<link rel="preconnect">` to the API in `index.html` | none |

### Server (measured on the host, last 24 h of the real request log, 4,723 requests excluding health checks)
| Item | Result |
|---|---|
| Errors (HTTP 5xx) | 0 |
| Host load / memory | load 0.06; backend container 194 MB of 7.6 GB; 0.17 % CPU |
| Database | RDS PostgreSQL in the same region; `SELECT 1` median 0.8 ms (min 0.7, max 2.0) |
| Five concurrent `SELECT 1` | 96 ms total (new pool connections being opened: a warm-up cost, not query time) |
| `GET /dashboard` (student) | p50 83 ms, p95 223 ms, max 1,088 ms (494 calls) |
| `POST /login` | p50 87 ms, p95 182 ms (586 calls) |
| `GET /me` | p50 8 ms, p95 43 ms (1,083 calls) |
| `POST /forgot-password` | **p50 1,399 ms, p95 12,176 ms, max 16,331 ms** (106 calls) |
| `GET /super` | p50 914 ms, p95 1,253 ms (13 calls) |
| `GET /admin/stats` | p50 203 ms, p95 439 ms (16 calls) |
| AI endpoints | `generate-question` 3.6 s, `me/ai-review` 6.3 s (external model calls, expected) |
| Largest tables | Submission 65,922; EmailLog 56,941; Notification 54,235; AuditLog 43,222; LoginSession 17,671 |

Conclusion: the backend and database are fast. Page load time is dominated by the number of network round trips between the browser and the API, not by server work.

## Root causes found so far (evidence-based)

1. **No preflight caching.** Every authenticated API call is cross-origin with an `Authorization` header, so it needs a preflight. With no `Access-Control-Max-Age` the browser repeated the
   `OPTIONS` round trip about every 5 s, so a call cost two round trips (about 0.2 s each from India) instead of one. Fix: `maxAge: 7200` (backend `index.js`). Verified by
   `backend/scripts/verifyCorsPreflightCache.js`.
2. **Cold API connection on first call.** About 1 s of DNS, TCP and TLS was paid by the first API call after load. Fix: `<link rel="preconnect">` to the API origin in `frontend/index.html`
   (filled in from `VITE_API_URL` at build time).
3. **`POST /forgot-password` waited for the mail server.** The reply is identical whatever happens to the mail, but the request waited for SMTP: 1.4 s median, up to 16 s. It also let a caller
   tell a registered address from an unknown one by response time. Fix: the mail is sent in the background after the reset token is stored; a failure before the mail is queued still
   releases the 24-hour cooldown claim (`auth.service.js`).

## Not yet addressed / needs approval

* **HTTP/2 (or HTTP/3) on the API.** nginx answers HTTP/1.1 only, so a page that fires several API calls at once queues behind the browser's six-connections-per-origin limit. Enabling
  `http2` on the nginx `listen 443 ssl` line is a host configuration change: **needs explicit approval; not done.**
* `GET /super` (p50 0.9 s) and `GET /stats` (p95 1.15 s): slow relative to the rest; query plans not yet inspected.
* Student dashboard runs about ten database steps one after another (deliberate, to protect the connection pool). Measured server time is still only 83 ms at the median, so this is not the
  user-visible bottleneck at present.
* Per-page request counts (how many sequential API calls each page makes) have not been measured in a real browser against production; the local probe numbers (LCP 0.12 to 0.55 s) were
  taken against a local server and are a floor, not a field measurement.
* Interaction to Next Paint could not be measured (no automated interaction trace).

## Rule applied
Nothing here caches authentication, permissions, exam state or other private data. No production configuration, infrastructure or paid service was changed.
