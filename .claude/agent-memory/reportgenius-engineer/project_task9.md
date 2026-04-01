---
name: Task 9 — Report Editor Review Page
description: Completed implementation of the focused student cycling review view (Task 9)
type: project
---

Task 9 complete as of 2026-03-26. Implemented the full report editor workflow.

**Backend changes (backend/src/routes/reports.ts):**
- Extended PUT /reports/:reportId to accept optional `status` + optional `edited_content` with a `.refine()` requiring at least one. Logic: content-only sets status="edited"; status-only updates status only; both uses explicit status.
- Added GET /students/:studentId/reports — org-scoped, returns reports with nested session + class, ordered by created_at DESC. Response: `{ reports: [...] }`.
- Added PATCH /sessions/:sessionId/reports/status — bulk updateMany filtered by reportIds IN list AND session_id AND organization_id. Response: `{ updated: count }`.

**Frontend changes:**
- RatingsGrid.tsx: added `word_count?: number | null` to GridReport interface.
- Session page (page.tsx): fixed `result.data` → `result.reports` bug in loadReports. Added `activeTab` state, tab bar UI between disciplines and grid, conditional render of RatingsGrid, new ReportsTab sub-component with bulk actions bar + student table + review links.
- New review page at `/classes/[id]/sessions/[sessionId]/review/page.tsx`: full cycling view with parallel data loading, auto-save (800ms debounce), mark final + advance, unlock, generate, redo with confirm dialog, ratings bar chart, history panel, mobile sticky footer.

**Why:** Task 9 in the 10-step build order — enables teachers to review and finalize individual student reports one at a time.

**How to apply:** The review page is self-contained. The session page's Reports tab links into it via `?student=<id>` query param. Navigation within the review page uses `router.replace` to avoid adding history entries per student.
