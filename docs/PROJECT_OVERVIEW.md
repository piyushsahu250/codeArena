# Project Overview

**Documentation Version:** 1.0.0 · **Last Updated:** 2026-08-08

This file expands on [README.md](README.md) with narrative context — what the platform does end-to-end for each kind of user, and how it fits together. For the reference tables (tech stack, module index, endpoint list), see [README.md](README.md) and the linked docs.

## What Problem CodeArena Solves

An engineering institute (or a group of institutes) needs to: teach and assess coding skills, run a structured curriculum, help students prepare for placements (interviews, resumes, documents), track attendance, publish results, and give staff/clerks/admins the tools to manage all of that — without stitching together five separate SaaS tools. CodeArena is that in one platform, single sign-on, one data model.

## A Student's Journey Through the Platform

1. **Onboarding**: account created by an Admin (individually or via bulk upload with a Registration Number/PRN — see [BUSINESS_RULES.md](BUSINESS_RULES.md)), forced password change on first login, then profile completion (mandatory fields, unlocks full access at 80%).
2. **Learning**: browses assigned courses (only courses explicitly assigned to their institute/group are visible), works through modules/chapters/lessons, takes in-lesson practice questions and module-end coding assessments (with a capped number of attempts).
3. **Assessment**: takes formal tests assigned to their class/academic group — proctored (tab-switch detection, face detection, keyboard-shortcut blocking), timed server-side (not trusting the client clock).
4. **Placement Prep**: builds a resume (AI-reviewed), practices AI mock interviews across multiple formats (HR/Technical/Aptitude/Coding/System Design/Behavioral/Managerial/Company-Round), uploads verification documents, tracks placement offers, may be added to a Talent Pool for placement-drive eligibility.
5. **Progress tracking**: dashboard with gamification (XP, badges, streaks, leaderboards), daily/weekly coding challenges, attendance record, published results/marksheets with QR verification, and a unified certificate wallet.

## A Staff Member's Journey

Manages their own (or shared) Question Bank content, creates/edits formal tests, marks attendance for the subjects they're assigned to teach (possibly across multiple staff on the same class, one per subject), reviews AI mock interview sessions and resumes, has read-only visibility into Learning Management content with one explicit exception (resetting a student's coding-assessment attempts).

## A Clerk's Journey

Placement Cell operator: searches/views student profiles, verifies placement offers and documents, manages results entry, works with the Company Master — deliberately excluded from Learning Management and Question Bank/Test management (see [RBAC_PERMISSIONS.md](RBAC_PERMISSIONS.md)).

## An Admin's Journey

Full platform administration, either for one institute (scoped) or platform-wide (unscoped/Super Admin) — see [USER_ROLES.md](USER_ROLES.md) for the critical distinction. Manages institutes, academic groups, accounts, courses, question banks, tests, attendance structure, talent pools, results, certificates, and system monitoring.

## How the Platform Grew

This codebase has an extensive incremental development history — well over 600 discrete work items recorded in this session's own task tracker alone, spanning feature builds, redesigns, security hardening passes, and performance optimization passes. It is not a green-field rewrite target; it's a mature, actively-maintained system with its own established conventions (see [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) for how to work within them). Treat existing patterns (the `attachRequesterInstitute` scoping convention, the `safeErrorMessage` error-handling convention, the additive-schema-only discipline) as the house style to follow, not as things to redesign.

## Current State (as of this documentation pass)

Nearly every module described in [README.md](README.md) is `ACTIVE` and has been through at least one dedicated audit pass. The confirmed gaps are enumerated in [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — most notably, no continuous-absence-alert feature exists, and the Interview Question Bank lacks the institute/creator isolation the main Question Bank has. Neither is silently assumed fixed anywhere else in this documentation set.
