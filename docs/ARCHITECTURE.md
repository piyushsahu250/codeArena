# Architecture

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

## 1. High-Level Component Diagram

```
                         ┌─────────────────────────────┐
                         │   Browser (React 19 SPA)     │
                         │   Vite build, client-rendered │
                         │   frontend/src/**              │
                         └──────────────┬────────────────┘
                                        │ HTTPS, JSON, Bearer JWT
                                        ▼
                         ┌─────────────────────────────┐
                         │   Express API (Node 20)       │
                         │   backend/src/index.js         │
                         │   helmet, compression,         │
                         │   CORS allowlist, rate limiter │
                         └──────────────┬────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
         ┌────────────────┐  ┌───────────────────┐ ┌──────────────────┐
         │ authenticate    │  │ requireRole(...)   │ │ attachRequester   │
         │ (JWT verify)    │  │ (role allowlist)   │ │ Institute          │
         │ middleware/auth │  │ middleware/auth     │ │ middleware/institute│
         └────────────────┘  └───────────────────┘ └──────────────────┘
                    │                   │                   │
                    └───────────────────┼───────────────────┘
                                        ▼
                         ┌─────────────────────────────┐
                         │  Route handler (31 files,      │
                         │  backend/src/routes/*.js)      │
                         │  business logic + validation   │
                         └──────────────┬────────────────┘
                                        │
                    ┌───────────────────┼────────────────────┐
                    ▼                   ▼                    ▼
         ┌────────────────┐  ┌────────────────────┐ ┌─────────────────┐
         │ Prisma Client    │  │ Judge / Compiler     │ │ Claude API        │
         │ → PostgreSQL      │  │ (backend/src/utils/  │ │ (backend/src/     │
         │                   │  │  judge.js — spawns    │ │  utils/aiClient)  │
         │                   │  │  gcc/g++/javac/java/  │ │  question gen,    │
         │                   │  │  python3 as child     │ │  resume review,   │
         │                   │  │  processes)           │ │  interview        │
         │                   │  │                       │ │  feedback         │
         └────────────────┘  └────────────────────┘ └─────────────────┘
```

## 2. Request Data Flow (typical protected route)

```
Client (React component, e.g. StudentProfile.jsx)
  ↓  axios call (frontend/src/api.js — attaches Authorization: Bearer <JWT>)
Express route (e.g. backend/src/routes/profile.js)
  ↓  authenticate  — verifies JWT (HS256 only), attaches req.user {id, role, ...}
  ↓  requireRole(...)  — 403s if req.user.role not in the allowlist
  ↓  attachRequesterInstitute (institute-scoped routes only) — loads req.user's own
     instituteId onto req.requesterInstituteId
  ↓  route handler — validates input, checks institute/ownership scoping explicitly
     (req.requesterInstituteId comparison), runs business logic
  ↓  Prisma query/mutation → PostgreSQL
  ↓  JSON response
Client (React state update → re-render)
```

Public/unauthenticated routes (login, register, forgot-password, certificate/marksheet/interview verification-by-code pages) skip `authenticate` entirely — see [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for the exact list.

## 3. Frontend

- **Framework**: React 19, functional components + hooks only (no class components found).
- **Routing**: `react-router-dom` v7, all routes declared in one table in `frontend/src/App.jsx` (see that file for the authoritative, current route list — 90+ routes as of this doc).
- **Route protection**: a single `<Protected roles={[...]}>` wrapper component (defined inline in `App.jsx`) does client-side role gating, redirects to `/login` if unauthenticated, to `/change-password` if `mustChangePassword` is set, and to `/profile` if the student's profile-completion gate is active. **This is UX convenience only — the real enforcement is server-side** (see [SECURITY.md](SECURITY.md)).
- **State management**: React Context (`AuthContext`, `GamificationContext`, `ThemeContext`, `ToastContext`, `ConfirmContext`, `SidebarContext`) — no Redux/Zustand/etc. found.
- **Styling**: hand-written CSS files per page/component (no CSS-in-JS library, no Tailwind found) plus CSS custom properties for theming (dark/light mode via `ThemeContext`).
- **Code-splitting**: `React.lazy()` + `Suspense` used for heavy pages (TestTaking, LessonView, InterviewSession, ModuleCodingAssessment, AdminDashboard, StaffDashboard, StudentPerformance, InterviewProgress, InterviewReports) specifically to keep Monaco/TensorFlow/recharts out of the initial bundle for users who never visit those pages.
- **Build tool**: Vite 8, with `manualChunks` configured (per prior session work) to split Monaco/recharts/tfjs into separate chunks — see `frontend/vite.config.js` for the current chunking strategy (NOT re-verified in this documentation pass; treat as **NOT VERIFIED** until re-read).

## 4. Backend

- **Framework**: Express 4, single process, `backend/src/index.js` as the entry point.
- **Route organization**: one file per module in `backend/src/routes/`, each exporting an `express.Router()`, mounted under an `/api/<prefix>` in `index.js`. 31 route files, 394 endpoints total (see [API_DOCUMENTATION.md](API_DOCUMENTATION.md)).
- **Middleware stack** (global, applied to every request): `helmet` (security headers), `compression`, a CORS allowlist (restricted to known frontend origins — see [SECURITY.md](SECURITY.md)), a global rate limiter (`express-rate-limit`, keyed by authenticated user id when a valid JWT is present, else by IP), and `timingMiddleware`/structured JSON logging (`backend/src/utils/logger.js`, dependency-free, pino-shaped output — see that file's own comment for why it avoids the actual `pino` package).
- **Per-route middleware**: `authenticate` (JWT verify), `requireRole(...roles)` (role allowlist), `attachRequesterInstitute` (institute scoping) — composed per-route as needed. Some routes also have route-specific rate limiters (e.g. `execLimiter` on code-execution routes, `loginLimiter` on `/auth/login`, `draftGenLimiter`/`aiInsightsLimiter`/`improveLimiter`/`aiReviewLimiter` on Claude-backed routes).
- **Error handling**: individual route try/catch blocks (the dominant pattern), plus one global 4-arg Express error-handling middleware (added in this session's QA pass) that catches Multer file-size-limit errors and any other error a route explicitly forwards via `next(err)`, returning clean JSON instead of Express's default HTML/text error page.
- **Background jobs**: three `setInterval`-based in-process schedulers started at boot (`backend/src/utils/aiRefreshScheduler.js`, `backend/src/utils/talentPoolReminderScheduler.js`, `backend/src/utils/challengeScheduler.js`) — no external job queue (no Redis/Bull/cron service). NOT VERIFIED beyond their presence in `index.js`; read each file directly for exact interval/behavior before relying on this description further.

## 5. Database

PostgreSQL via Prisma Client. 76 models. See [DATABASE.md](DATABASE.md) for the full model index and [DATA_DICTIONARY.md](DATA_DICTIONARY.md) for field-level detail. Notable architectural facts:
- No formal Prisma Migrate history (`backend/prisma/migrations/` does not exist in this repo). Schema changes ship via `npx prisma db push --accept-data-loss` inside the Docker container's boot command, run on every deploy, before a chain of one-time/idempotent Node backfill scripts, before `npm start`.
- Institute-level multi-tenancy is enforced at the application layer (via `attachRequesterInstitute` + explicit `instituteId` comparisons in route handlers), not via PostgreSQL row-level security or a schema-level tenant partition.

## 6. Authentication

JWT bearer tokens (`jsonwebtoken`), issued on login, verified on every protected route with an explicit `algorithms: ["HS256"]` allowlist (a hardening fix from an earlier security audit this session's history references — prevents an `alg: none` or asymmetric-key confusion attack). See [AUTHENTICATION.md](AUTHENTICATION.md).

## 7. File Storage

NOT VERIFIED in full during this documentation pass beyond what's referenced elsewhere in this doc set: uploaded documents (`StudentDocument`) appear to be stored as external links (`documentLink` field — confirmed via this session's QA audit, which found `studentDocuments.js` never uses Multer, i.e. documents are links to externally-hosted files, not binary uploads to this platform's own storage). Bulk-upload spreadsheets and profile-photo/logo assets ARE handled via Multer (`multer.memoryStorage()`, 5MB limit) for in-request processing (parsed immediately, not persisted to disk). See [FILE_STORAGE.md](FILE_STORAGE.md) for what could be confirmed and what remains NOT VERIFIED.

## 8. APIs

REST, JSON request/response bodies, `/api/<module>` prefix per route file. No GraphQL, no gRPC found. Full endpoint list: [API_DOCUMENTATION.md](API_DOCUMENTATION.md).

## 9. External Services

- **Anthropic Claude API** (`backend/src/utils/aiClient.js`) — question generation, resume AI review/rewrite, interview feedback/coaching, learning-module coding hints, interview question/pattern-note draft generation. Requires `ANTHROPIC_API_KEY`; features check `isConfigured()` and degrade to a controlled "AI not configured" error rather than crashing when the key is absent.
- **Email delivery** (`backend/src/utils/mailer.js`) — provider NOT VERIFIED in this pass (would need a direct read of that file); used for welcome emails, password-reset, login alerts, result-published notifications, etc.
- No payment gateway, SMS provider, or third-party cloud storage integration was found.

## 10. Deployment

- **Backend**: Docker image, deployed to Render as `sanjivani-codearena-backend-docker`. See `backend/Dockerfile` for the exact boot sequence (system package install for the judge's compiler toolchains, `npm install`, `prisma generate`, then the `CMD` chain of migration scripts → `prisma db push` → backfill scripts → seed → `npm start`).
- **Frontend**: Vercel, auto-deploy on push to `main` (`frontend/vercel.json` present — NOT re-read in full this pass, treat exact config as NOT VERIFIED).
- See [DEPLOYMENT.md](DEPLOYMENT.md) and [DEVOPS.md](DEVOPS.md) for the full process and the established push/verify pattern.

## 11. Environment Configuration

See [ENVIRONMENT.md](ENVIRONMENT.md) for the full variable list (names only — no values are ever documented here). Key ones referenced across this doc set: `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `PORT`, `FRONTEND_URL`.
