# Prompt Assembly Parity — Individual vs Batch Fix

## Root Cause
The backend (`backend/src/adapters/llm/`) was running the **OLD** prompt-builder implementation — the version that predates all three bug fixes. The frontend (`frontend/src/lib/adapters/llm/`) had already received the correct modern implementation.

The backend path is used by:
- `POST /api/v1/sessions/:sessionId/students/:studentId/generate` → `generateSingleReport()` in report.service.ts
- `POST /api/v1/reports/:reportId/redo` → `generateSingleReport()` in report.service.ts
- `POST /api/v1/sessions/:sessionId/reports/:studentId/regenerate` → inline in reports.ts
- `GET /api/v1/sessions/:sessionId/batch-prompt` → inline in reports.ts

## What Was Wrong

### backend/src/adapters/llm/types.ts
- Used `ratingSummary: string` (pre-formatted) instead of `ratings: RawRating[]`
- Missing `testInstruction`, `contextNote` fields on `ReportPrompt`
- Missing `RawRating`, `BatchStudentPayload`, `BatchSessionConfig`, `LENGTH_WORD_RANGE`

### backend/src/adapters/llm/prompt-builder.ts
- Old single-function `buildPrompt()` — no `buildHeader()` / `buildStudentBlock()` split
- No `resolveTestInstructionFromConfig()` function
- No Rule 6 ("TESTS") in Writing Rules — used inline `testLines` before CRITICAL INSTRUCTIONS instead
- No injection sanitization
- No `buildBatchPrompt()`

### backend/src/services/report.service.ts
- Passed `ratingSummary` (formatted string) not `ratings` array
- Did not call `resolveTestInstructionFromConfig()`
- Did not pass `testInstruction` to prompt builder
- Only checked `includePercentage || includeGrade || includeLowMention` (missing `includeMark`)
- Did not handle qualitative-only tests (no score flags)

### backend/src/routes/reports.ts — batch-prompt route
- Used old `buildPrompt()` per student + ad-hoc container prompt
- Did not call `resolveTestInstructionFromConfig()`
- Missing `includeMark` in filter check
- No qualitative-only test handling

### backend/src/routes/reports.ts — regenerate route
- Same old `ratingSummary`-based approach
- Missing `resolveTestInstructionFromConfig()` + `testInstruction`
- Missing `includeMark` support
- No qualitative-only test handling
- `tests` select missing `max_mark`

## Fix Applied

1. **`backend/src/adapters/llm/types.ts`** — full replacement with modern types matching frontend:
   - Added `RawRating`, `BatchStudentPayload`, `BatchSessionConfig`, `LENGTH_WORD_RANGE`
   - Updated `ReportPrompt` to use `ratings: RawRating[]`, added `testInstruction`, `contextNote`

2. **`backend/src/adapters/llm/prompt-builder.ts`** — full replacement with modern shared implementation:
   - `buildHeader()` — shared, generates Writing Rules including conditional Rule 6
   - `buildStudentBlock()` — shared, generates per-student data block with Tests section
   - `buildPrompt()` — individual mode (header + 1 block)
   - `buildBatchPrompt()` — batch mode (header + N blocks)
   - `resolveTestInstructionFromConfig()` — canonical Rule 6 derivation from session config
   - Prompt injection sanitization on all string fields
   - `formatRatingSummary()` kept as legacy export for safety

3. **`backend/src/services/report.service.ts`** — updated to new API:
   - Uses `rawRatings: RawRating[]` array instead of formatted string
   - Calls `resolveTestInstructionFromConfig()` → passes `testInstruction`
   - Full `includeMark` support + qualitative-only test handling
   - `max_mark` included in test select

4. **`backend/src/routes/reports.ts`** — batch-prompt + regenerate routes:
   - batch-prompt: replaced ad-hoc loop with `buildBatchPrompt(batchStudents, batchConfig)` via `BatchStudentPayload[]` + `BatchSessionConfig`
   - regenerate: updated to `ratings` array, `resolveTestInstructionFromConfig()`, `testInstruction`, `contextNote`, full `includeMark` + qualitative support, `max_mark` in session select

## Invariant After Fix
Both individual and batch modes in **both backend and frontend** use identical `buildHeader()` + `buildStudentBlock()` functions from the same shared prompt-builder pattern. Rule 6 appears when any test display option is configured. Tests appear in student block when a result exists and a score flag is set (or always for qualitative-only tests).
