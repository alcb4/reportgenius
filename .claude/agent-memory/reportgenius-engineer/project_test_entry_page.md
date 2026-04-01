---
name: Test Score Entry Page
description: Added GET /:classId/tests/:testId backend endpoint and test entry frontend page at /classes/[id]/tests/[testId]/entry
type: project
---

Added missing single-test fetch endpoint and full test score entry UI.

**Backend change:** Added `GET /:classId/tests/:testId` to `backend/src/routes/classes.ts` (inserted before the POST handler). Verifies org ownership via class lookup. Returns same fields as the list endpoint: id, name, topics, max_mark, grade_boundaries, created_at, _count.results.

**Frontend page:** `frontend/src/app/(app)/classes/[id]/tests/[testId]/entry/page.tsx`
- "use client" — uses `useParams<{ id, testId }>()` from next/navigation (established pattern, not page-prop params which are Promises in Next.js 16)
- Three parallel fetches on load: test detail, class+students, existing results
- Local state: `Map<studentId, ResultRow>` with scoreInput, comment, percentage, grade, dirty flag
- Score input accepts "42/50" (numerator taken) or "42"; grade/% computed live via `calculateGrade()` (mirrors backend logic)
- Amber dot per row when dirty; "Unsaved changes" indicator in header
- Auto-save on blur (per-row, guarded by `autoSavingRef` to prevent concurrent saves)
- "Save All" button saves all dirty rows in one bulk POST to `/api/v1/tests/:testId/results/bulk`
- `NonNullable<typeof r>` type predicate used to satisfy strict TS on filter

**Why:** The route `/classes/[id]/tests/[testId]/entry` was returning 404 because the page file did not exist. The backend already had bulk-result endpoints but was missing the single-test GET.

**How to apply:** When adding new class-scoped test routes, insert them in `classes.ts` before the POST handler (to keep list before get-single before create order). The classesRouter is mounted twice in server.ts: at `/api/v1/classes` (for class-scoped paths) and at `/api/v1` (for test-level paths like `/tests/:testId/...`).
