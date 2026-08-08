# RBAC Permission Matrix

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08
**Source:** derived directly from [API_DOCUMENTATION.md](API_DOCUMENTATION.md)'s endpoint-by-endpoint role extraction — every cell below traces to a real `requireRole(...)` call, not an assumption. "+Inst" means the permission is further restricted to the actor's own institute (via `attachRequesterInstitute` + ownership check) when the actor is institute-scoped; an unscoped Super Admin/Staff is unrestricted.

Legend: **V**=View, **C**=Create, **E**=Edit, **D**=Delete, **Vf**=Verify, **P**=Publish, **X**=Export, **R**=Reset, **M**=Manage(full CRUD+config) · `—` = no access · `own` = own-record-only.

## Institute Management
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| List institutes | V | V | — | — |
| Create institute | C (unscoped only, in practice) | — | — | — |
| Edit / Deactivate institute | E +Inst | — | — | — |
| Delete institute | D +Inst | — | — | — |
| View course-analytics | V +Inst | — | — | — |
| View profile-completion stats | V +Inst | V +Inst | V +Inst | — |

## Academic Groups
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| List groups | V +Inst | V +Inst | V +Inst | — |
| View group's students | V +Inst | V +Inst | — | — |
| Bulk reset passwords for a group | R +Inst | — | — | — |
| Delete group | D +Inst | — | — | — |

## Classes (legacy/parallel to Academic Groups)
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| List / view students | V +Inst | V +Inst | — | — |
| Create / Edit / Delete | M +Inst | — | — | — |
| Bulk reset passwords | R +Inst | — | — | — |

## User / Account Management
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| List all users | V | — | — | — |
| Create account (any role) | C +Inst | — | — | — |
| Edit any account | E +Inst | — | — | — |
| Bulk upload students | C +Inst | — | — | — |
| Search / Browse students | V +Inst | V +Inst | V +Inst | — |
| View own profile / edit own | — | — | — | own |
| Reset another user's password | R +Inst | R +Inst | — | — |
| Bulk regenerate passwords | R (unscoped pattern) | — | — | — |
| Delete account | D | — | — | — |
| View own active sessions / revoke | — | — | — | own (any role, via `/users/me/sessions`) |
| View password-reset history | V +Inst | V +Inst | — | — |
| View audit log | V +Inst | V +Inst | V +Inst | — |
| View student performance report | V | V | V | own |

## Learning Management (Courses / Modules / Chapters / Lessons)
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Browse courses/lessons | V | V | — | V (assigned-institute only) |
| Create/Edit/Delete course | M | — | — | — |
| Assign course to institute/group | M +Inst | — | — | — |
| Create/Edit/Delete module, chapter, lesson, practice question | M | — | — | — |
| View module/chapter/lesson tree (admin CMS) | V | V (read-only) | — | — |
| Submit lesson progress / practice run / quiz | — | — | — | own |
| Download course certificate | — | — | — | own |

**Staff is explicitly read-only across all Learning Management write routes** — confirmed zero `STAFF` in any create/edit/delete `requireRole(...)` call in `learning.js`.

## Question Bank
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Create/View/Edit/Delete question | M +Inst | M +Inst (own-created only — see below) | — | — |
| Create/manage folders | M +Inst | M +Inst (own-created only) | — | — |
| Bulk move/delete/copy | M +Inst | M +Inst (own-created only) | — | — |
| Bulk import/export | M +Inst | M +Inst (own-created only) | — | — |

Staff and Admin have identical route-level role access (`requireRole("ADMIN","STAFF")` throughout `questions.js`), but **application-level ownership filtering** (`questionVisibilityWhere`/`ownsQuestionRow`, confirmed clean by this session's audit) restricts a Staff member to `createdById: null` (shared/legacy) or their own `createdById` — an Admin has no such restriction. See [QUESTION_BANK.md](QUESTION_BANK.md).

## Coding Assessment (Module Coding Tests)
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Create/Edit/Delete test, questions, bulk import | M | — | — | — |
| View test/attempt (admin CMS) | V | V | — | — |
| View institute's attempts, export | V +Inst | V +Inst (view only) | — | — |
| **Reset a student's attempts** | R +Inst | **R +Inst (explicitly permitted exception)** | — | — |
| Start / Run / Submit / Finalize own attempt | — | — | — | own |

## Formal Tests (Question-Bank-based exams)
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Create/Edit/Duplicate test | M +Inst | M +Inst (own-institute) | — | — |
| Publish/Unpublish test | P | P | — | — |
| Delete test | D | — | — | — |
| View test list/detail | V +Inst | V +Inst | — | V (eligible tests only) |
| Grant reattempt | R +Inst | R +Inst | — | — |
| View results | V +Inst | V +Inst | — | own |
| Start / submit attempt | — | — | — | own |

## Attendance
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Manage Departments/Rules | M +Inst | — | — | — |
| View staff/batches/group-table | V +Inst | — | — | — |
| Manage staff-subject assignments | M +Inst | — | — | — |
| View own assignments | — | V +Inst | — | — |
| Create/manage lecture plans (own assignment) | — | M +Inst | — | — |
| Bulk-upload lecture plans | — | C +Inst | — | — |
| Execute/mark attendance | — | M +Inst (own assignment/subject only) | — | — |
| View reports / export | V +Inst | V +Inst | — | — |
| View own attendance record | — | — | — | own |

## Document Verification
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Upload own document | — | — | — | own |
| View / edit / delete own (pre-verification) | — | — | — | own |
| View a student's documents | V +Inst | V +Inst | V +Inst | — |
| Verify / reject (with remarks) | Vf +Inst | Vf +Inst | Vf +Inst | — |
| Bulk verify | Vf +Inst | Vf +Inst | Vf +Inst | — |
| Admin delete | D +Inst | — (removed — Staff delete rights revoked) | — | — |
| Download a student's document | V +Inst | V +Inst | V +Inst | — |

## Certificates
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| View own certificates / download | — | — | — | own |
| Public verification by code | Public (no auth) for anyone with the code | | | |
| Manual issuance | C +Inst | C +Inst | — | — |
| Revoke | D +Inst | — | — | — |
| View institute's certificates (admin list) | V +Inst | V +Inst | — | — |

## Placement
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Manage own placement offers (add/edit/delete) | — | — | — | own |
| View own offer summary | — | — | — | own |
| View a student's offers | V +Inst | V +Inst | V +Inst | — |
| Verify an offer | Vf +Inst | Vf +Inst | Vf +Inst | — |
| Set department eligibility | E +Inst | E +Inst | — | — |
| Set clerk-managed eligibility | E +Inst | — | E +Inst | — |
| View placement analytics/reports/export | V +Inst | V +Inst | V +Inst | — |

## Talent Pool
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Create/Edit/Delete pool | M +Inst | — | — | — |
| View pool / list / analytics | V +Inst | V +Inst | — | — |
| Manage members (add/remove/transfer) | M +Inst | M +Inst | — | — |
| Bulk import members / template | M +Inst | — | — | — |
| Manage auto-selection rule | M +Inst | V (read-only) | — | — |
| Manage linked tests | M +Inst | V (read-only) | — | — |
| Manage interview configs | M +Inst | V (read-only) | — | — |
| Manage attendance ownership (claim) | M +Inst | M +Inst (self-claim) | — | — |
| View leaderboard | V +Inst | V +Inst | — | V (own pool membership) |
| View dashboard / report.pdf | V +Inst | V +Inst | — | — |
| View own pool memberships | — | — | — | own |

## Result Management / Marksheet
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Create examination | C +Inst | — | — | — |
| Edit/Delete examination | E +Inst / D +Inst | — | — | — |
| Publish/Unpublish | P +Inst | — | — | — |
| View examinations / entries | V +Inst | V +Inst | V +Inst | — |
| Create/Edit/Delete entry | M +Inst | M +Inst | M +Inst | — |
| Bulk import entries | C +Inst | C +Inst | C +Inst | — |
| View marksheet/QR (admin) | V +Inst | V +Inst | V +Inst | — |
| View analytics/search/export | V +Inst | V +Inst | V +Inst | — |
| View own result / marksheet / QR | — | — | — | own |
| Public marksheet verification by code | Public (no auth) | | | |

## Mock Interview (AI)
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Take a session (start/answer/finalize/violation) | — | — | — | own |
| View own report/history/leaderboard/certificate | — | — | — | own |
| Manage question bank (CRUD, import/export) | M (**platform-wide, no institute scope**) | M (**platform-wide, no institute scope**) | — | — |
| Manage company profiles | M | V + C-profile create is ADMIN-only for POST | — | — |
| Manage AI-generated drafts (approve/reject) | M | M | — | — |
| View admin stats/students/analytics/sessions/reports/export | V +Inst | V +Inst | — | — |

**The Interview Question Bank has no institute isolation at the route or schema level** — see [KNOWN_ISSUES.md](KNOWN_ISSUES.md). Every other "Institute Management"-style module above genuinely enforces `+Inst` scoping; this one is the confirmed exception.

## Daily/Weekly Challenges
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Schedule/toggle/delete challenge | M | — | — | — |
| View scheduled challenges (admin) | V | V | — | — |
| Attempt today's/current challenge | — | — | — | own |
| View own stats/history | — | — | — | own |

## Bulk Upload (cross-module)
See [BULK_UPLOAD.md](BULK_UPLOAD.md) for the full per-template list. Every bulk-upload route observed is ADMIN-only, or ADMIN+STAFF+CLERK for result-entry bulk import specifically — the module-by-module RBAC tables above already capture each one's role gate.

## Search
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Global search (`/api/search`) | V +Inst | V +Inst | V +Inst | V (self/allowed scope — NOT VERIFIED in detail; the route has no `requireRole`, only `authenticate` + `attachRequesterInstitute`) |

## Notifications
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| View/mark own notifications read | own | own | own | own |

No role restriction on notifications routes beyond authentication — every role manages only their own notification feed (`req.user.id` scoped in the handler; not independently re-verified in this documentation pass beyond the route's `requireRole` absence — flag as **NOT VERIFIED at the ownership-check level**, only at the route-role level).

## Companies (Company Master)
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| View list | V | V | V | V (any authenticated) |
| Create/Edit | C/E | — | C/E | — |

## Backups & Exports
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| Trigger DB backup (pg_dump) | X +Inst (route allows +Inst, but a full DB dump is realistically a Super Admin action — NOT VERIFIED whether scoped Admins get a filtered dump or the whole DB) | — | — | — |
| Export center (students/staff/results/etc.) | X +Inst | X +Inst | X +Inst | — |

## System Monitoring / Email Logs / Question Audit
| Action | Admin | Staff | Clerk | Student |
|---|---|---|---|---|
| View | V | — | — | — |

All ADMIN-only, unscoped in the routes observed (`admin.js` has no `attachRequesterInstitute` on any of its four routes — meaning a scoped Admin can currently see **platform-wide** stats/email-logs/monitoring/question-audit, not just their own institute's. This was **not** flagged as a bug by this session's audits, but it is worth independent verification if institute-level confidentiality of this data matters — treat as **NOT VERIFIED as intentional**.)

---

For the full endpoint-level source of every row above, see [API_DOCUMENTATION.md](API_DOCUMENTATION.md). For the business-rule *why* behind several of these (e.g. why Staff gets a Coding-Assessment reset exception, why Clerk excludes Learning Management), see [BUSINESS_RULES.md](BUSINESS_RULES.md).
