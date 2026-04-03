---
name: Filter Bar Layout Polish + Generate CTA Move
description: CompactFilterBar wired into session detail page; old FilterPanel removed; Generate CTA moved from bulk footer into progress bar row
type: project
---

CompactFilterBar is now used on both the session detail page (Ratings tab) and the review page. The old `FilterPanel` local function in `page.tsx` was deleted entirely.

**Why:** FilterPanel was a legacy expanded-card layout. CompactFilterBar is the canonical compact single-row UI with expansion panel.

**Changes made:**
- `frontend/src/app/(app)/classes/[id]/sessions/[sessionId]/page.tsx`: Removed `FilterPanel` function, added `CompactFilterBar` import with aliased types (`FilterBarClassTest`, `FilterBarProgressionData`), updated `handleFilterSave` type to `FilterBarPatch`, added `enable_progression` and `allow_negative_progression` to `SessionDetail` interface.
- `frontend/src/components/RatingsGrid.tsx`: Merged "Bulk generation footer" into the progress bar row. Generate CTA sits on the far right of the progress bar as a flex-none button. The separate footer div was deleted.

**How to apply:** When adding new filter controls, put them in CompactFilterBar (not session page.tsx). The Generate CTA is in the progress bar div inside RatingsGrid — do not add a separate footer below the grid.
