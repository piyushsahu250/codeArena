# Search

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08 · **Routes:** `backend/src/routes/search.js` (global), `users.js` `GET /search`/`/browse` (student-specific)

## Global Search
`GET /api/search` — any authenticated role, +Institute-scoped. Covers Students, Staff, Courses, Questions (per project history's "Global Search expansion" — Staff/Courses/Questions coverage added to what was originally student-only). Backed by a PostgreSQL `pg_trgm` GIN index (fuzzy/partial matching) added via a boot-time script, not a full external search engine (no Elasticsearch/Algolia/etc.).

## Student-Specific Search
`GET /api/users/search`, `/browse` (ADMIN/STAFF/CLERK, +Institute) — searchable by **PRN, Roll Number, name, email, mobile**. Confirmed indexed for PRN (`@@unique([registrationNumber])` doubles as an index) and Roll Number (`@@index([rollNumber])`) — see [DATABASE.md](DATABASE.md), [BUSINESS_RULES.md](BUSINESS_RULES.md) §1–2.

## Role Scoping
Every search surface is institute-scoped for scoped accounts — a Staff/Clerk/Admin at Institute A cannot search students at Institute B. STUDENT role has no broad search capability (the frontend's `StudentSearch.jsx` page is Admin/Staff/Clerk-only per `App.jsx`'s route table).

## Related
[BUSINESS_RULES.md](BUSINESS_RULES.md), [DATABASE.md](DATABASE.md) §5 (indexes), [PERFORMANCE.md](PERFORMANCE.md).
