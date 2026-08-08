# Attendance

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/attendance.js` (largest single route file, 34 endpoints) · **Frontend:** `AttendanceHome.jsx`, `AttendanceAssignmentDetail.jsx`, `ExecuteAttendance.jsx`, `AttendanceReports.jsx`, `AttendanceStructure.jsx` (admin), `MyAttendance.jsx` (student)

## Data Model
`StaffClassAssignment` (staff+group+**subject**) → `LecturePlan` (a scheduled lecture) → `AttendanceSession` (the taken roll-call, 1:1 with a plan) → `AttendanceRecord` (per-student status). See [DATABASE.md](DATABASE.md) and [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## Multi-Staff-Per-Group, One-Per-Subject
`StaffClassAssignment.@@unique([academicGroupId, subject])` — deliberately not `[academicGroupId, staffId]`. This is what lets multiple different staff be assigned to the same academic group, as long as each is teaching a different subject. Confirmed structurally impossible to violate (this session's audit): cross-subject overwrite can't happen because the `LecturePlan → AttendanceSession` chain is scoped to one assignment's one subject.

## Duplicate Prevention
`AttendanceRecord.@@unique([sessionId, studentId])` plus a transactional delete-then-recreate save pattern — duplicate records for the same student/session are structurally impossible, not just policy-enforced.

## Status Values
PRESENT / ABSENT / LATE / LEAVE — plain string, validated server-side on both the mark route and the reports filter.

## Admin Structure (`/admin/*` sub-routes)
Departments, staff-subject assignments, attendance rules (institute-level minimum-percentage threshold), batch/group tables — all ADMIN, +Institute.

## Staff Workflow
`GET /my-assignments` → per-assignment lecture plans (create/bulk-upload/edit/delete) → `GET .../execute` (roster) → `POST .../attendance` (mark). All ADMIN/STAFF +Institute, scoped to the staff's own assignment.

## Reports
`GET /reports` (ADMIN/STAFF +Institute) — filterable, exportable (Excel/CSV/PDF). Roll Number/Name/PRN display confirmed clean (this session's audit) — the "PRN Not Set" placeholder only appears when the underlying DB value is genuinely null, not a query bug.

## Student Self-View
`GET /my-records` (STUDENT, self-scoped) — includes a `bySubject` summary.

## Talent Pool Integration
`LecturePlan.testId` links auto-generated plans to a Talent Pool's attendance-mandatory tests (`syncTalentPoolPlans`) — see [TALENT_POOL.md](TALENT_POOL.md).

## Known Gap
**Continuous absence alerts (3 consecutive working-day/subject absences) do not exist.** See [KNOWN_ISSUES.md](KNOWN_ISSUES.md) KI-002 — no scheduler, no alert model, confirmed absent, not silently built.

## Related
[BUSINESS_RULES.md](BUSINESS_RULES.md) §6, [ACADEMIC_GROUPS.md](ACADEMIC_GROUPS.md), [TALENT_POOL.md](TALENT_POOL.md), [API_DOCUMENTATION.md](API_DOCUMENTATION.md).
