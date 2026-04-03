---
name: CompactFilterBar extracted to shared component
description: CompactFilterBar moved from session page.tsx to frontend/src/components/CompactFilterBar.tsx and wired into review/page.tsx
type: project
---

CompactFilterBar was extracted from the session detail page into a standalone shared component at `frontend/src/components/CompactFilterBar.tsx`.

**Why:** The review page needed the same filter bar so teachers can edit tone, tests, progression, and class overview without leaving the report editing flow.

**What was done:**
- Created `frontend/src/components/CompactFilterBar.tsx` with exported types: `TestFilterState`, `LocalTestFilterState`, `ClassTest`, `ProgressionData`, `FilterBarSession`, `FilterBarDiscipline`, `FilterBarPatch`, and default export `CompactFilterBar`
- `SelectTestsModal` is co-located inside the same file (private, not exported)
- `page.tsx` now imports `CompactFilterBar`, `ClassTest`, `ProgressionData`, `TestFilterState`, `LocalTestFilterState` from the shared component file; the inline definitions are removed
- `review/page.tsx` additions:
  - Imports `CompactFilterBar`, `ClassTest`, `ProgressionData`, `FilterBarPatch`
  - State: `classTests`, `progressionData`, `filtersChangedSinceGenerate`
  - `handleFilterSave` (debounced 600ms) calls PUT /api/v1/sessions/:sessionId and sets `filtersChangedSinceGenerate = true`
  - classTests fetched via GET /api/v1/classes/:classId/tests (non-fatal)
  - progressionData fetched via GET /api/v1/sessions/:sessionId/progression-data (non-fatal)
  - `<CompactFilterBar>` rendered full-width between student nav bar and two-column content grid, inside a `bg-gray-50 border-b` wrapper
  - Mini filter summary bar ("Filters: Direct · Disciplines: 6...") removed entirely
  - Regenerate button is secondary/outlined style: `border-indigo-600 text-indigo-600 bg-transparent hover:bg-indigo-50`; adds `animate-pulse` and label "Regenerate (filters changed)" when `filtersChangedSinceGenerate` is true; otherwise label is "Regenerate"
  - "Mark Final + Next" remains primary filled style (bg-indigo-600 text-white) — clear visual hierarchy
  - `filtersChangedSinceGenerate` resets to false on regenerate click

**How to apply:** When adding filter editing to any new page, import from `@/components/CompactFilterBar` — do not redefine inline.
