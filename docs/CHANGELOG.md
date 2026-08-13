# Changelog

All notable changes to CodeArena are recorded here, dated, going forward. Historical entries are never deleted or rewritten — only appended to.

Format per [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md):
```
## YYYY-MM-DD
### Added / Changed / Fixed / Removed / Database / Security / Performance / Documentation / Testing
```

---

## 2026-08-08

### Added
- `backend/src/utils/errors.js` — shared `safeErrorMessage()` helper to prevent raw Prisma error leakage.
- `backend/src/utils/studentIdentifiers.js`: new `resolveRollNumberAvoidingCollisions()` export.
- Global 4-arg Express error-handling middleware in `backend/src/index.js` (Multer file-size errors → clean JSON 413).
- Complete `/docs` documentation set (this pass) — see [README.md](README.md) for the full file list.

### Changed
- `backend/src/routes/institutes.js`: `PATCH /:id`, `DELETE /:id`, `GET /:id/course-analytics` now institute-ownership-checked.
- `backend/src/routes/users.js`: Roll Number handling on create/PATCH/bulk-upload now enforces same-Academic-Group uniqueness.
- ~20 route files: replaced raw `err.message` fallbacks with `safeErrorMessage()`.
- `backend/src/routes/submissions.js`: replaced generic one-word error messages with specific, actionable text.
- `frontend/src/pages/StudentProfile.jsx`: added `*` required-markers to 4 mandatory fields.

### Fixed
- See [FIXED_ISSUES.md](FIXED_ISSUES.md) FI-001 through FI-010.

### Removed
- `uuid` npm dependency (backend, unused).
- `frontend/public/favicon.svg`, `frontend/public/icons.svg`, `frontend/src/assets/hero.png`, `frontend/src/assets/vite.svg` (unused static assets).

### Database
- `LecturePlan`: added `@@index([createdById])`.
- `AttendanceSession`: added `@@index([markedById])`.
- (No destructive changes; both are additive index creations.)

### Security
- Fixed institute-scoped Admin cross-institute IDOR on `institutes.js` (FI-001).
- Fixed raw Prisma error-message leakage across ~20 routes (FI-003).

### Performance
- Added the two indexes above (FI-006).
- Capped `companies.js`'s previously-unbounded list query (FI-007).

### Documentation
- Created the full `/docs` documentation set for the first time (this entry) — 41 files, [README.md](README.md), [AI_HANDOVER.md](AI_HANDOVER.md), [platform-manifest.json](platform-manifest.json), and everything cross-referenced from them.
- Added `scripts/docSync.js` + `.github/workflows/docs-sync.yml`: a scheduled (daily 03:00 UTC) + schema/route-triggered job that mechanically recounts API endpoints and Prisma models/enums and auto-commits an update to `platform-manifest.json` + this file when they've drifted from what's recorded. **This does not use AI and does not rewrite prose** — it only keeps three numeric facts honest; narrative doc updates (steps 1-9 of [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)'s checklist) are still manual. Documenting this explicitly so it is never mistaken for full documentation automation.

### Testing
- No automated test suite exists; all fixes above were verified via code review plus a live deploy + `/api/health` commit-hash poll (backend commits `e4bf8a1`, `d67d7ef`; frontend commit `994c5b5` via Vercel auto-deploy). See [TESTING.md](TESTING.md).

---

*Entries before 2026-08-08 are not individually logged here — this changelog was introduced on this date. Prior project history exists in the repository's git log and in [FIXED_ISSUES.md](FIXED_ISSUES.md)'s "Pre-existing fixes" summary section, but was not retroactively broken into dated changelog entries during this initial documentation pass.*

## 2026-08-09 (auto-detected drift)
- Database model count: 76 -> 77 (review DATABASE.md, DATA_DICTIONARY.md)
- This entry was generated mechanically by `scripts/docSync.js` (counts only — no AI involved, no prose rewritten).
- Manual review needed: update the prose in the doc file(s) referenced above to describe what actually changed and why.

## 2026-08-13 (auto-detected drift)
- Database model count: 77 -> 81 (review DATABASE.md, DATA_DICTIONARY.md)
- Database enum count: 19 -> 20 (review DATABASE.md)
- This entry was generated mechanically by `scripts/docSync.js` (counts only — no AI involved, no prose rewritten).
- Manual review needed: update the prose in the doc file(s) referenced above to describe what actually changed and why.

## 2026-08-13 (auto-detected drift)
- API endpoint count: 394 -> 405 (review API_DOCUMENTATION.md)
- This entry was generated mechanically by `scripts/docSync.js` (counts only — no AI involved, no prose rewritten).
- Manual review needed: update the prose in the doc file(s) referenced above to describe what actually changed and why.

## 2026-08-13 (auto-detected drift)
- API endpoint count: 405 -> 407 (review API_DOCUMENTATION.md)
- This entry was generated mechanically by `scripts/docSync.js` (counts only — no AI involved, no prose rewritten).
- Manual review needed: update the prose in the doc file(s) referenced above to describe what actually changed and why.
