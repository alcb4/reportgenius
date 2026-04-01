---
name: Parse-reports DB save fix + Report unique constraint
description: Root cause and fix for parse-reports silently failing to persist reports; added @@unique([session_id, student_id]) to Report model
type: project
---

The `POST /api/v1/sessions/:sessionId/parse-reports` endpoint used `prisma.report.create()` with a bare `catch {}` (no logging). Any Prisma error (e.g. duplicate key on re-parse, connection issue) was silently swallowed, incrementing `failedCount` but with no server-side trace.

**Fix applied (2026-03-27):**
1. Added `@@unique([session_id, student_id])` to the `Report` model in `prisma/schema.prisma`.
2. Created migration `20260327_add_report_unique_session_student` with the corresponding `ALTER TABLE` statement.
3. Changed `prisma.report.create()` to `prisma.report.upsert()` using the `session_id_student_id` compound unique key.
4. Added `console.log` before each upsert attempt and `console.error` in the catch block — errors now surface in backend logs.
5. The catch block now binds `dbErr` and logs `dbErr.message`.

**Why:** The `@@unique` constraint is semantically correct (one report per student per session) and is required for Prisma's `upsert` `where` clause to work with compound keys.

**How to apply:** After any `prisma generate`, must copy `.prisma/client` from root into `backend/node_modules/.prisma/client` before `tsc --noEmit` will pass — the generated types include the compound unique key name used in `upsert`.
