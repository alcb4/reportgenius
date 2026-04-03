---
name: Report edit page shows "Generate Report" CTA instead of content — envelope key fix
description: Root cause and fix for clicking "Edit" on a paste-saved report opening the review page with no content and a "Generate Report" CTA
type: project
---

## Symptom
Clicking "Edit" on a report in the Reports tab opened the review page (`/classes/[id]/sessions/[sessionId]/review?student=<id>`) showing "No report yet for this student" + a "Generate Report" button, even though the report existed in the DB.

## Root Cause
The frontend Next.js API route `GET /api/v1/reports/[reportId]` (file: `frontend/src/app/api/v1/reports/[reportId]/route.ts`) returned `{ data: report }` but its only consumer, the review page (`review/page.tsx` line ~333-339), expected `{ report: FullReport }`:

```typescript
apiFetch<{ report: FullReport }>(`/api/v1/reports/${sessionReport.id}`)
  .then((r) => {
    setCurrentReport(r.report);        // r.report was undefined → null
    setEditedContent(r.report.edited_content);
    setIsEditable(r.report.status !== "final");
  })
```

Because `r.report` was `undefined`, `setCurrentReport(undefined)` left `currentReport` as `null`, which caused the editor to render the "Generate Report" CTA instead of the textarea.

A secondary issue: the GET select was missing `student_id`, `session_id`, and `llm_raw_response` — all fields required by the `FullReport` interface.

The PUT handler had the same envelope bug: it returned `{ data: updated }` but `saveContent()` in the review page expected `{ report: FullReport }`. This would have caused auto-save to silently fail by setting `currentReport` to `undefined` after the first save.

## Fix Applied (2026-04-02)
File: `frontend/src/app/api/v1/reports/[reportId]/route.ts`

**GET handler:**
1. Changed `return NextResponse.json({ data: report })` → `return NextResponse.json({ report })`
2. Added `student_id: true`, `session_id: true`, `llm_raw_response: true` to the Prisma `select` block

**PUT handler:**
1. Changed `return NextResponse.json({ data: updated })` → `return NextResponse.json({ report: updated })`
2. Added `student_id: true`, `session_id: true`, `llm_raw_response: true` to the Prisma `select` block

## Why paste-saved reports specifically surfaced this
The bug affects ALL reports opened via the Edit button — not just paste-saved reports. However, paste-saved reports were the newly-observed path since the prior fix (reports_route_response_key_fix) made them appear in the Reports tab for the first time, making the Edit button clickable for them. Reports generated in-app may have gone through a different code path (e.g. ReportStudio) that didn't use this broken GET endpoint.

## Affected consumers
- Review page `loadStudent()` — now correctly populates `currentReport` and `editedContent`
- Review page `saveContent()` (auto-save) — now correctly updates `currentReport` after save
- Review page `setSessionReports` update in `saveContent()` — now has `student_id` to key the map entry
