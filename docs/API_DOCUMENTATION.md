# API Documentation

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08
**Source:** mechanically extracted from every `router.get/post/patch/put/delete(...)` declaration across all 31 files in `backend/src/routes/`, cross-checked against `backend/src/index.js`'s mount table, as of commit `d67d7ef`. **394 endpoints total.**

Every endpoint is mounted under its route file's prefix (see the mount table below). All endpoints require `authenticate` (valid JWT) unless marked **PUBLIC**. Role column lists the `requireRole(...)` allowlist; blank = any authenticated role. `+Institute` means the route also runs `attachRequesterInstitute` (institute-scoped for scoped Admin/Staff/Clerk accounts, unrestricted for unscoped/Super accounts).

This is a **method/path/role index**, not a full request/response schema reference — for exact request bodies, validation rules, and response shapes, read the linked route file directly (each row implicitly points to `backend/src/routes/<file>`).

## Mount Table (`backend/src/index.js`)

| Prefix | File |
|---|---|
| `/api/auth` | auth.js |
| `/api/tests` | tests.js |
| `/api/questions` | questions.js |
| `/api/submissions` | submissions.js |
| `/api/users` | users.js |
| `/api/classes` | classes.js |
| `/api/academic-groups` | academicGroups.js |
| `/api/institutes` | institutes.js |
| `/api/admin` | admin.js |
| `/api/learning` | learning.js |
| `/api/dashboard` | dashboard.js |
| `/api/gamification` | gamification.js |
| `/api/resume` | resume.js |
| `/api/interview` | interview.js **and** interviewDrafts.js (both mounted at this prefix) |
| `/api/module-coding` | moduleCoding.js |
| `/api/search` | search.js |
| `/api/certificates` | certificates.js |
| `/api/backup` | backup.js |
| `/api/export` | exports.js |
| `/api/ai/questions` | aiQuestions.js |
| `/api/challenges` | challenges.js |
| `/api/attendance` | attendance.js |
| `/api/profile` | profile.js |
| `/api/companies` | companies.js |
| `/api/placement` | placementOffers.js |
| `/api/documents` | studentDocuments.js |
| `/api/talent-pools` | talentPools.js |
| `/api/notifications` | notifications.js |
| `/api/results` | resultManagement.js |
| `/api/staff-clerk` | staffClerk.js |

---

## academicGroups.js (`/api/academic-groups`)
| Method | Path | Role |
|---|---|---|
| GET | `/` | ADMIN, STAFF, CLERK +Institute |
| GET | `/:id/students` | ADMIN, STAFF +Institute |
| POST | `/:id/bulk-reset-password` | ADMIN +Institute |
| DELETE | `/:id` | ADMIN +Institute |

## admin.js (`/api/admin`)
| Method | Path | Role |
|---|---|---|
| GET | `/stats` | ADMIN |
| GET | `/question-audit` | ADMIN |
| GET | `/email-logs` | ADMIN |
| GET | `/monitoring` | ADMIN |

## aiQuestions.js (`/api/ai/questions`)
| Method | Path | Role |
|---|---|---|
| GET | `/status` | ADMIN, STAFF |
| POST | `/generate-question` | ADMIN, STAFF |

## attendance.js (`/api/attendance`)
| Method | Path | Role |
|---|---|---|
| GET/POST/PATCH/DELETE | `/admin/departments`, `/admin/departments/:id` | ADMIN +Institute |
| GET/PATCH | `/admin/rules` | ADMIN +Institute |
| GET | `/admin/staff`, `/admin/batches`, `/admin/group-table` | ADMIN +Institute |
| POST/PATCH/DELETE | `/admin/staff-assignments`, `/admin/staff-assignments/:id` | ADMIN +Institute |
| GET | `/my-assignments` | ADMIN, STAFF +Institute |
| GET | `/assignments/:assignmentId`, `/assignments/:assignmentId/plans` | ADMIN, STAFF +Institute |
| POST | `/assignments/:assignmentId/plans` | ADMIN, STAFF +Institute |
| GET | `/assignments/:assignmentId/plans/template` | ADMIN, STAFF +Institute |
| POST | `/assignments/:assignmentId/plans/bulk-upload` (file upload) | ADMIN, STAFF +Institute |
| PATCH/DELETE | `/assignments/:assignmentId/plans/:planId` | ADMIN, STAFF +Institute |
| GET | `/assignments/:assignmentId/plans/:planId/execute` | ADMIN, STAFF +Institute |
| POST | `/assignments/:assignmentId/plans/:planId/attendance` | ADMIN, STAFF +Institute |
| GET | `/reports` | ADMIN, STAFF +Institute |
| GET | `/my-records` | STUDENT |

## auth.js (`/api/auth`)
| Method | Path | Role |
|---|---|---|
| POST | `/register` | **PUBLIC** |
| POST | `/login` (rate-limited) | **PUBLIC** |
| POST | `/logout` | any authenticated |
| POST | `/forgot-password` | **PUBLIC** |
| POST | `/reset-password` | **PUBLIC** |

## backup.js (`/api/backup`)
| Method | Path | Role |
|---|---|---|
| GET | `/database` (pg_dump) | ADMIN +Institute |

## certificates.js (`/api/certificates`)
| Method | Path | Role |
|---|---|---|
| GET | `/me` | STUDENT |
| GET | `/:id/download` | STUDENT |
| GET | `/verify/:code` | **PUBLIC** |
| POST | `/manual` | ADMIN, STAFF +Institute |
| POST | `/:id/revoke` | ADMIN +Institute |
| GET | `/admin` | ADMIN, STAFF +Institute |

## challenges.js (`/api/challenges`)
| Method | Path | Role |
|---|---|---|
| GET | `/stats`, `/daily/today`, `/daily/history`, `/weekly/current` | STUDENT |
| POST | `/daily/:id/run`, `/daily/:id/submit`, `/weekly/:id/run`, `/weekly/:id/submit` (rate-limited) | STUDENT |
| GET | `/admin/daily`, `/admin/weekly` | ADMIN, STAFF |
| POST/PATCH/DELETE | `/admin/daily`, `/admin/daily/:id`, `/admin/daily/:id/toggle` | ADMIN |
| POST/PATCH/DELETE | `/admin/weekly`, `/admin/weekly/:id`, `/admin/weekly/:id/toggle` | ADMIN |

## classes.js (`/api/classes`)
| Method | Path | Role |
|---|---|---|
| GET | `/` | ADMIN, STAFF +Institute |
| POST | `/` | ADMIN +Institute |
| PATCH/DELETE | `/:id` | ADMIN +Institute |
| GET | `/:id/students` | ADMIN, STAFF +Institute |
| POST | `/:id/bulk-reset-password` | ADMIN +Institute |

## companies.js (`/api/companies`)
| Method | Path | Role |
|---|---|---|
| GET | `/` | any authenticated |
| POST/PATCH | `/`, `/:id` | ADMIN, CLERK |

## dashboard.js (`/api/dashboard`)
| Method | Path | Role |
|---|---|---|
| GET | `/student` | STUDENT |

## exports.js (`/api/export`)
| Method | Path | Role |
|---|---|---|
| GET | `/:entity` | ADMIN, STAFF, CLERK +Institute |

## gamification.js (`/api/gamification`)
| Method | Path | Role |
|---|---|---|
| GET | `/me` | STUDENT |
| GET | `/leaderboard`, `/badges` | any authenticated |
| GET | `/xp-rules` | ADMIN, STAFF |
| PATCH | `/xp-rules/:activity` | ADMIN |
| POST/PATCH/DELETE | `/badges`, `/badges/:id` | ADMIN |
| POST | `/leaderboard/reset` | ADMIN |
| GET | `/admin/stats` | ADMIN, STAFF +Institute |

## institutes.js (`/api/institutes`)
| Method | Path | Role |
|---|---|---|
| GET | `/` | ADMIN, STAFF |
| POST | `/` | ADMIN |
| PATCH/DELETE | `/:id` | ADMIN +Institute (ownership-checked as of this session's QA fix) |
| GET | `/:id/course-analytics` | ADMIN +Institute (ownership-checked) |
| GET | `/:id/profile-completion-stats` | ADMIN, STAFF, CLERK +Institute |

## interview.js + interviewDrafts.js (`/api/interview`)
This is the largest route file (63 endpoints across the two files). Student-facing session lifecycle (all STUDENT-only): `GET /summary`, `POST /sessions`, `GET /sessions`, `GET /sessions/:id`, `GET /sessions/:id/ai-insights` (rate-limited), `POST /sessions/:id/run-code`, `POST/GET /sessions/:id/questions/:questionId/draft`, `POST /sessions/:id/answer`, `POST /sessions/:id/rounds/advance`, `POST /sessions/:id/finalize`, `POST /sessions/:id/violation`, `GET /sessions/:id/report/pdf`, `GET /leaderboard`, `GET /progress`, `GET /companies/browse`, `GET /questions/browse`, `GET /certificate`, `GET /certificate/pdf`.
Any authenticated role (no `requireRole`): `GET /subjects`, `GET /companies`, `GET /companies/:company/pattern` (interviewDrafts.js).
Public (no JWT at all): `GET /certificate/verify/:code`.
Admin/Staff CMS (ADMIN, STAFF unless noted): `GET/POST /admin/questions`, `PATCH/DELETE /admin/questions/:id`, `GET /admin/questions/bulk-template`, `GET /admin/questions/export`, `POST /admin/questions/import` (file upload), `GET /admin/company-profiles` — **POST/PATCH/DELETE `/admin/company-profiles*` are ADMIN-only**, `GET /admin/stats|students|weak-topics|sessions|analytics` (+Institute), `GET /admin/students/:studentId/sessions`, `GET /admin/sessions/:sessionId/violations|report|report/pdf` (+Institute), `GET /admin/sessions/export` (+Institute).
Drafts (interviewDrafts.js, ADMIN+STAFF unless noted): `POST /admin/drafts/questions/generate` (rate-limited), `GET/PATCH/DELETE /admin/drafts/questions*`, `POST /admin/drafts/questions/:id/approve|reject`, `POST /admin/drafts/patterns/generate` (rate-limited), `GET/PATCH/DELETE /admin/drafts/patterns*`, `POST /admin/drafts/patterns/:id/approve|reject`, `GET /admin/questions/:id/analytics`, `GET /companies/catalog`.

**No `instituteId`/`createdById` scoping exists on any `interview.js` question/company-profile route** — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## learning.js (`/api/learning`)
| Method | Path | Role |
|---|---|---|
| GET | `/courses`, `/courses/:slug`, `/lessons/:id` | any authenticated (visibility filtered server-side) |
| POST | `/lessons/:id/progress`, `/lessons/:id/test-submit` | STUDENT |
| POST | `/practice/:id/check`, `/practice/:id/run` (rate-limited), `/practice/:id/submit` (rate-limited), `/practice/:id/hint` (rate-limited), `/practice/:id/autosave` | STUDENT |
| GET | `/practice/:id/history`, `/practice/:id/draft` | STUDENT |
| GET | `/courses/:slug/certificate` | STUDENT |
| GET | `/certificate/verify/:code` | **PUBLIC** |
| GET/POST | `/courses/:slug/certificate/download` | STUDENT |
| POST/PATCH/DELETE | `/courses`, `/courses/:id` | ADMIN |
| GET | `/courses/:id/assignments` | ADMIN, STAFF |
| POST/DELETE | `/courses/:id/assignments`, `/courses/assignments/bulk` | ADMIN +Institute |
| POST/PATCH/DELETE | `/courses/:id/modules`, `/modules/:id` | ADMIN |
| GET | `/modules/:id/chapters` | ADMIN, STAFF |
| POST/PATCH/DELETE | `/modules/:id/chapters`, `/chapters/:id` | ADMIN |
| GET | `/chapters/:id/lessons` | ADMIN, STAFF |
| POST/PATCH/DELETE | `/modules/:id/lessons`, `/chapters/:id/lessons`, `/lessons/:id`, `/lessons/:id/questions` | ADMIN |
| PATCH/DELETE | `/practice/:id` | ADMIN |
| GET | `/practice/:id` | ADMIN, STAFF |

## moduleCoding.js (`/api/module-coding`)
| Method | Path | Role |
|---|---|---|
| GET | `/module/:moduleId` | STUDENT |
| POST | `/module/:moduleId/start` | STUDENT |
| POST | `/attempts/:attemptId/run` (rate-limited), `/autosave`, `/submit-code` (rate-limited), `/violation`, `/finalize` | STUDENT |
| GET | `/admin/module/:moduleId`, `/admin/tests/:id`, `/admin/tests` | ADMIN, STAFF |
| POST | `/admin/module/:moduleId` | ADMIN |
| GET/POST | `/admin/chapter/:chapterId/levels` | GET: ADMIN, STAFF · POST: ADMIN |
| PATCH/DELETE | `/admin/tests/:id` | ADMIN |
| POST | `/admin/tests/:id/questions` | ADMIN |
| GET | `/admin/tests/:id/questions/bulk-template` | ADMIN |
| POST | `/admin/tests/:id/questions/bulk-import` (file upload) | ADMIN |
| PATCH/DELETE | `/admin/questions/:id` | ADMIN |
| GET | `/admin/tests/:id/attempts`, `/admin/attempts/:attemptId` | ADMIN, STAFF +Institute |
| DELETE | `/admin/tests/:id/students/:studentId/attempts` (reset attempts) | ADMIN, STAFF +Institute |
| GET | `/admin/tests/:id/export` | ADMIN +Institute |

## notifications.js (`/api/notifications`)
| Method | Path | Role |
|---|---|---|
| GET | `/`, `/unread-count` | any authenticated |
| PATCH | `/:id/read` | any authenticated |
| POST | `/mark-all-read` | any authenticated |

## placementOffers.js (`/api/placement`)
| Method | Path | Role |
|---|---|---|
| GET/POST/PATCH/DELETE | `/offers/me`, `/offers`, `/offers/:id` | STUDENT |
| GET | `/offers/summary/me` | STUDENT |
| GET | `/offers/student/:studentId` | ADMIN, STAFF, CLERK +Institute |
| PATCH | `/offers/:id/verify` | ADMIN, STAFF, CLERK +Institute |
| PATCH | `/students/:studentId/department-eligibility` | STAFF, ADMIN +Institute |
| PATCH | `/students/:studentId/clerk-eligibility` | CLERK, ADMIN +Institute |
| GET | `/analytics/registration`, `/analytics/offers`, `/analytics/department`, `/analytics/report.pdf`, `/analytics/documents` | ADMIN, STAFF, CLERK +Institute |

## profile.js (`/api/profile`)
| Method | Path | Role |
|---|---|---|
| GET/PATCH | `/me` | STUDENT |
| GET | `/:studentId` | ADMIN, STAFF, CLERK +Institute |
| PATCH | `/students/:studentId/cgpa` | ADMIN, STAFF +Institute |
| GET | `/:studentId/report.pdf` | ADMIN, STAFF, CLERK +Institute |

## questions.js (`/api/questions`)
| Method | Path | Role |
|---|---|---|
| POST | `/preview-starter-code` | ADMIN, STAFF |
| POST/GET | `/` | ADMIN, STAFF +Institute |
| GET | `/meta/filters` | ADMIN, STAFF +Institute |
| GET/POST | `/folders` | ADMIN, STAFF +Institute |
| PATCH/DELETE | `/folders/:id` | ADMIN, STAFF +Institute |
| GET | `/folders/:id/delete-preview` | ADMIN, STAFF +Institute |
| POST | `/folders/:id/merge`, `/folders/:id/clear` | ADMIN, STAFF +Institute |
| POST | `/bulk-move`, `/bulk-delete`, `/bulk-copy` | ADMIN, STAFF +Institute |
| GET | `/bulk-template` | ADMIN, STAFF |
| GET | `/export` | ADMIN, STAFF +Institute |
| POST | `/bulk-import`, `/bulk-import-coding` (file upload) | ADMIN, STAFF +Institute |
| GET/PATCH/DELETE | `/:id` | ADMIN, STAFF +Institute |

## resultManagement.js (`/api/results`)
| Method | Path | Role |
|---|---|---|
| GET | `/me`, `/me/:entryId`, `/me/:entryId/qr.png`, `/me/:entryId/marksheet.pdf` | STUDENT |
| GET | `/verify/:code` | **PUBLIC** |
| GET | `/admin/examinations`, `/admin/examinations/:id`, `/admin/examinations/:id/entries` | ADMIN, STAFF, CLERK +Institute |
| POST | `/admin/examinations` | ADMIN +Institute |
| PATCH/DELETE | `/admin/examinations/:id` | ADMIN +Institute |
| PATCH | `/admin/examinations/:id/publish`, `/unpublish` | ADMIN +Institute |
| POST/PATCH/DELETE | `/admin/examinations/:id/entries`, `/entries/:entryId` | ADMIN, STAFF, CLERK +Institute |
| GET | `/entries/:entryId/marksheet`, `/qr.png`, `/marksheet.pdf` | ADMIN, STAFF, CLERK +Institute |
| GET | `/admin/examinations/:id/bulk-template` | ADMIN, STAFF, CLERK +Institute |
| POST | `/admin/examinations/:id/bulk-import` (file upload) | ADMIN, STAFF, CLERK +Institute |
| GET | `/admin/analytics`, `/admin/search`, `/admin/export` | ADMIN, STAFF, CLERK +Institute |

## resume.js (`/api/resume`)
| Method | Path | Role |
|---|---|---|
| GET/PATCH | `/me` | STUDENT |
| POST | upload route (multipart, see file directly for exact path) | STUDENT |
| POST | `/me/clear-all`, `/me/clear-section`, `/me/improve` (rate-limited), `/me/ai-review` (rate-limited), `/me/autofill`, `/me/versions/:id/restore` | STUDENT |
| GET | `/job-roles`, `/me/role-analysis`, `/me/versions`, `/me/versions/:id`, `/me/versions/:id/pdf`, `/me/docx`, `/me/ats-score`, `/me/pdf` | STUDENT |
| PATCH | `/me/target-role` | STUDENT |
| DELETE | `/me/versions/:id`, `/me/versions` | STUDENT |
| GET | `/admin/stats`, `/admin/students`, `/admin/:studentId`, `/admin/:studentId/pdf` | ADMIN, STAFF +Institute |
| POST | `/admin/:studentId/feedback` | ADMIN, STAFF +Institute |
| GET | `/field-config` | ADMIN, STAFF |
| PATCH | `/field-config` | ADMIN |

## search.js (`/api/search`)
| Method | Path | Role |
|---|---|---|
| GET | `/` | any authenticated +Institute |

## staffClerk.js (`/api/staff-clerk`)
All routes: **ADMIN only** (`const guard = [authenticate, requireRole("ADMIN"), attachRequesterInstitute]`).
| Method | Path |
|---|---|
| GET | `/overview`, `/`, `/:id`, `/:id/sessions`, `/:id/permissions` |
| PATCH | `/:id/status` |
| DELETE | `/:id/sessions/:sessionId` |

## studentDocuments.js (`/api/documents`)
| Method | Path | Role |
|---|---|---|
| GET | `/types` | any authenticated |
| GET/POST/PATCH/DELETE | `/me`, `/`, `/:id` | STUDENT |
| GET | `/student/:studentId` | ADMIN, STAFF, CLERK +Institute |
| PATCH | `/:id/verify` | ADMIN, STAFF, CLERK +Institute |
| POST | `/bulk-verify` | ADMIN, STAFF, CLERK +Institute |
| DELETE | `/:id/admin` | ADMIN +Institute (**not** STAFF — Staff delete rights were removed per this session's document-verification plan) |
| GET | `/:id/download` | ADMIN, STAFF, CLERK +Institute |

## submissions.js (`/api/submissions`)
| Method | Path | Role |
|---|---|---|
| GET | `/queue-status` | any authenticated |
| POST | `/run` (rate-limited), `/autosave`, `/submit-code` (rate-limited), `/submit` (rate-limited) | STUDENT |
| POST | `/finalize/:attemptId` | STUDENT |

## talentPools.js (`/api/talent-pools`)
| Method | Path | Role |
|---|---|---|
| GET | `/` | ADMIN, STAFF +Institute |
| POST | `/` | ADMIN +Institute |
| GET | `/my-pools` | STUDENT |
| GET | `/analytics` | ADMIN, STAFF +Institute |
| GET | `/:id` | ADMIN, STAFF +Institute |
| PATCH/DELETE | `/:id` | ADMIN +Institute |
| GET/POST/DELETE | `/:id/members*` | ADMIN, STAFF +Institute |
| GET | `/:id/bulk-import-template` | ADMIN +Institute |
| POST | `/:id/bulk-import` (file upload) | ADMIN +Institute |
| GET/PUT | `/:id/auto-rule` | GET: ADMIN, STAFF · PUT: ADMIN +Institute |
| POST | `/:id/auto-rule/preview`, `/:id/auto-rule/run` | ADMIN +Institute |
| GET/POST | `/:id/tests` | GET: ADMIN, STAFF · POST: ADMIN +Institute |
| DELETE | `/:id/tests/:testId` | ADMIN +Institute |
| GET/POST/PATCH/DELETE | `/:id/interview-configs*` | GET: ADMIN, STAFF · write: ADMIN +Institute |
| GET/POST/DELETE | `/:id/attendance-owners*` | ADMIN, STAFF +Institute |
| GET | `/:id/leaderboard` | ADMIN, STAFF, STUDENT +Institute |
| GET | `/:id/dashboard`, `/:id/report.pdf` | ADMIN, STAFF +Institute |

## tests.js (`/api/tests`)
| Method | Path | Role |
|---|---|---|
| POST/PATCH | `/`, `/:id` | ADMIN, STAFF +Institute |
| POST | `/:id/duplicate` | ADMIN, STAFF +Institute |
| DELETE | `/:id` | ADMIN |
| PATCH | `/:id/publish` | ADMIN, STAFF |
| GET | `/`, `/:id` | any authenticated +Institute (visibility filtered server-side) |
| POST | `/:id/start` | STUDENT |
| POST | `/attempts/:attemptId/violation` | STUDENT |
| POST | `/:testId/attempts/:studentId/reattempt` | ADMIN, STAFF +Institute |
| GET | `/:id/results` | ADMIN, STAFF +Institute |
| GET | `/:id/my-result` | STUDENT |

## users.js (`/api/users`)
| Method | Path | Role |
|---|---|---|
| PATCH | `/me` | any authenticated |
| GET/DELETE | `/me/sessions`, `/me/sessions/:sessionId` | any authenticated |
| GET | `/` | ADMIN |
| POST | `/` (create account) | ADMIN +Institute |
| PATCH | `/:id` | ADMIN +Institute |
| GET | `/bulk-template` | ADMIN |
| POST | `/bulk-upload` (file upload) | ADMIN +Institute |
| GET | `/lookup/:query` | ADMIN +Institute |
| GET | `/search`, `/browse` | ADMIN, STAFF, CLERK +Institute |
| GET | `/password-reset-history` | ADMIN, STAFF +Institute |
| GET | `/audit-log`, `/audit-log/actions` | ADMIN, STAFF, CLERK +Institute |
| GET | `/migration-status` | ADMIN |
| GET | `/:id` | ADMIN +Institute |
| GET | `/:id/performance`, `/:id/performance/report.xlsx`, `/:id/performance/report.pdf` | ADMIN, STAFF, CLERK, STUDENT (self-scoped for STUDENT) |
| POST | `/:id/reset-password` | ADMIN, STAFF +Institute |
| POST | `/bulk-regenerate-password` | ADMIN |
| DELETE | `/:id` | ADMIN |

---

## Public (unauthenticated) endpoints — full list

These are the only routes reachable with no JWT at all:
- `POST /api/auth/register`, `/login`, `/forgot-password`, `/reset-password`
- `GET /api/certificates/verify/:code`
- `GET /api/interview/certificate/verify/:code`
- `GET /api/learning/certificate/verify/:code`
- `GET /api/results/verify/:code`

Every other endpoint requires a valid JWT at minimum. A small additional set requires a valid JWT but no specific role (`authenticate` with no `requireRole`) — e.g. `GET /api/companies`, `GET /api/gamification/leaderboard`, `GET /api/gamification/badges`, `GET /api/notifications*`, `GET /api/search`, `GET /api/submissions/queue-status`, `GET /api/interview/subjects`, `GET /api/interview/companies`, `GET /api/interview/companies/:company/pattern`, `GET /api/documents/types` — see each section above for the complete per-file list.
