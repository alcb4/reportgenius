---
name: Historical Progression + ReportStudio complete
description: Progression data endpoint, progression prompt integration, regenerate endpoint, and ReportStudio in-page editor
type: project
---

Historical Progression filter and ReportStudio editor implemented across two tasks.

## Task 6 — Historical Progression

**Backend changes:**

- `GET /api/v1/sessions/:sessionId/progression-data?studentId=<optional>` added to `backend/src/routes/sessions.ts`
  - Finds most recently completed session in same class (status='complete', ordered by updated_at DESC)
  - If no studentId param, picks any student with ratings via a Rating lookup
  - Matches disciplines by name across current and previous session
  - Returns `{ previousSession: { id, name, completed_at }, matchedDisciplines: [{ name, currentScore, previousScore, trend }] }`

- `ProgressionItem` interface added to `backend/src/adapters/llm/types.ts`
  - Fields: `{ name, trend: "improved"|"declined"|"maintained", previous: number, current: number }`
  - Added as optional `progression?: ProgressionItem[]` field on `ReportPrompt`

- `buildProgressionSection()` and `trendPhrase()` helpers added to `backend/src/adapters/llm/prompt-builder.ts`
  - Tone-aware phrasing: gentle/balanced/direct each produce different natural language
  - Appended to prompt only when `payload.progression` is non-empty

- `generateSingleReport()` in `backend/src/services/report.service.ts` updated:
  - Added `class_id` to session select
  - Auto-fetches progression inline when not passed in options (prevSession lookup + rating comparison)
  - Accepts `progression?: ProgressionItem[]` in `GenerateReportOptions`

- `POST /api/v1/sessions/:sessionId/reports/:studentId/regenerate` added to `backend/src/routes/reports.ts`
  - Body: `{ filters?: { disciplineIds?, tone?, overviewSummary? } }`
  - Filters disciplines, fetches progression inline, calls buildPrompt + LLM adapter
  - Upserts the Report row (update existing or create new)
  - Returns `{ report: string, reportId: string }`

**Frontend changes:**

- `ProgressionData` type and `MatchedDisciplineProgression` added to session page
- `progressionData` + `includedProgressionItems` state added
- Progression data fetched non-fatally on session load alongside metadata
- "Historical Progression" filter card rendered below Tests card when previousSession is non-null and matchedDisciplines.length > 0
  - Checkboxes per discipline showing trend (green=improved, red=declined, gray=maintained)
  - Score arrows: `3 → 4`
  - Select all / Clear links

## Task 7 — ReportStudio

**New component:** `frontend/src/components/ReportStudio.tsx`

Props: `sessionId, classId, students, disciplines, initialStudentId, session`

Features:
- Student nav header with Prev/Next cycling, progress bar, pronoun label, status badge
- Collapsible filters panel: tone toggle (gentle/balanced/direct), discipline checkboxes (pill style), class context note textarea
- `isDirty` flag: set when filterState differs from `lastAppliedFilter.current`; Regenerate button glows indigo when dirty
- Report textarea (mono font, 12 rows, resizable) with live word + char count
- Auto-save on blur: PUT /api/v1/reports/:reportId
- Regenerate: POST /api/v1/sessions/:sessionId/reports/:studentId/regenerate with filters
- Mark Final + Next: PUT /api/v1/reports/:reportId with status='final', then advances studentIdx
- Export PDF button (downloads session ZIP)

**Session page wiring:**

- `ReportStudio` imported in session page
- `ReportsTab` component updated to accept `session` and `gridDisciplines` props
- "Open Studio" button in Reports tab bulk actions bar replaces "Review All Reports" as primary CTA
- "Review All Reports" kept as secondary link-style button
- Studio opens inline (replaces table view with Back button), no modal/navigation needed

**Why:** `progressionData` fetch is non-fatal — if no completed previous session exists the card simply doesn't render. `lastAppliedFilter.current` ref tracks what was last sent to the LLM so the dirty indicator is accurate across student navigation.
