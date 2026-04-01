---
name: Pre-Task 8 UI Foundations
description: Class detail, session detail, and dashboard pages built; PUT /students/:studentId added to backend
type: project
---

Pre-Task 8 UI foundations implemented. All TypeScript compiles clean (zero errors both backend and frontend).

**Backend addition:**
- Added `PUT /api/v1/students/:studentId` to `/backend/src/routes/students.ts`
  - Edits: first_name, last_name, student_ref_id, gender
  - Returns `{ student: updated }` with 200

**Frontend pages built/replaced:**

1. `/frontend/src/app/(app)/classes/[id]/page.tsx` — full class detail page
   - Header with Edit + Archive Class buttons, student count badge
   - Students table: add inline (row form), edit inline (row form), bulk add via textarea modal, remove with confirm dialog
   - Report Sessions list: cards with status badge, topics preview, discipline/report counts, clickable to session
   - Create Session Modal: name, topics (tag input), length radio, tone dropdown, disciplines from library (grouped, General pre-ticked, others expandable), custom disciplines, selected chips

2. `/frontend/src/app/(app)/classes/[id]/sessions/[sessionId]/page.tsx` — session detail page
   - Breadcrumb: Dashboard / Class / Session
   - Status controls: Mark In Progress / Mark Complete (confirm dialog for complete)
   - Disciplines bar with Add Discipline (blocked when complete)
   - Students table: rating count, report status badge, Generate / View+Edit actions per row
   - Bulk generate with 2s polling progress bar (GET /sessions/:id/generate/bulk/:batchId/status)
   - Export section: PDF ZIP + XLSX links

3. `/frontend/src/app/(app)/dashboard/page.tsx` — classes list
   - Show Archived toggle (only appears if archived classes exist)
   - Cards show: name, year group, subject, student count, session count, last activity date
   - Empty states for zero classes and all-archived states

4. `/frontend/src/app/(app)/classes/new/page.tsx` — simplified to match actual API
   - Removed: term, disciplines, topics (these don't belong on class creation — they live on sessions)
   - Now sends only: name, year_group, subject — which is exactly what POST /api/v1/classes accepts

**Why new class page was simplified:**
The old new-class page sent `term`, `disciplines`, and `topics_covered` but the POST /api/v1/classes endpoint only accepts `name`, `year_group`, `subject`. Disciplines and topics belong on report sessions, not classes. Fixed to match actual API contract.

**How to apply:**
Session disciplines are configured at session creation time (in the Create Session Modal). Teachers add students to class first, then create sessions with their own discipline/topic config.
