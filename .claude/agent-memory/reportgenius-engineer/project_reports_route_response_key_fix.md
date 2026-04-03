---
name: Reports listing route response key fix — { data } → { reports } + student_id in select
description: Root cause and fix for "parse and save reports" appearing to succeed but reports not showing and student names re-appearing in Generate Reports
type: project
---

## Symptom
- User completes parse-reports workflow (progress bar fills, green success notifications)
- Clicking "Reports" tab shows no reports
- Going back to "Generate Reports" shows the same 5 students as if nothing was saved

## Root Cause
The Next.js API route `GET /api/v1/sessions/[sessionId]/reports` (file: `frontend/src/app/api/v1/sessions/[sessionId]/reports/route.ts`) returned `{ data: reports }` but every consumer expected `{ reports: [...] }`:

- `GenerateReportsPanel.loadExisting()` → `result.reports.map(r => r.student_id)` → `undefined.map()` silently caught → empty Set → all students marked as "not generated"
- `session page loadReports()` → `for (const r of result.reports)` → iterating undefined silently caught → empty reports map
- `ReportStudio` → `result.reports.find(...)` → undefined → no report found

The save itself (the `parse-reports` upsert) worked correctly every time. The bug was entirely in the read path — the listing response used the wrong envelope key.

A secondary issue: `student_id` (the FK column) was also missing from the Prisma `select`, meaning even if callers had handled the envelope correctly, the `GridReport.student_id` field would have been `undefined`.

## Fix Applied (2026-04-02)
File: `frontend/src/app/api/v1/sessions/[sessionId]/reports/route.ts`

1. Changed `return NextResponse.json({ data: reports })` → `return NextResponse.json({ reports })`
2. Added `student_id: true` to the Prisma `select` block

## Affected Consumers (all now work correctly)
- `GenerateReportsPanel` — `loadExisting()` sets `generatedStudentIds` correctly; saved students no longer reappear
- Session page `loadReports()` — `reports` Map populated correctly; Reports tab shows reports
- `ReportStudio` — finds existing report correctly

## How to Verify
After saving reports via parse-reports, `GET /api/v1/sessions/:id/reports` must return `{ reports: [{ id, student_id, status, word_count, ... }] }`.
