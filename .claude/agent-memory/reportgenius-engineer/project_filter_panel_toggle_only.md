---
name: Filter Panel Toggle-Only Close Behaviour
description: CompactFilterBar panel now only closes via its toggle button — outside-click and Escape handlers removed
type: project
---

**Bug fixed:** Filter card/panel was closing on any click inside it due to a document-level `mousedown` event listener.

**Root cause:** `CompactFilterBar` had a `useEffect` (formerly around lines 268–285) that registered:
- `document.addEventListener("mousedown", handleClick)` — closed panel when click target was outside `panelRef`
- `document.addEventListener("keydown", handleKey)` — closed panel on Escape

Also used a `panelRef = useRef<HTMLDivElement>(null)` attached to the outer wrapper div.

**Fix applied** in `/home/relic/report_genius/frontend/src/components/CompactFilterBar.tsx`:
1. Removed the entire `useEffect` block (outside-click + Escape handlers)
2. Removed `const panelRef = useRef<HTMLDivElement>(null)` declaration
3. Removed `ref={panelRef}` from the outer `<div className="relative mb-3">`
4. `useRef` import retained (still used for `overviewTimerRef` debounce)

**Correct behaviour after fix:**
- Panel opens/closes **only** via the "Filters ▼/▲" toggle button (`onClick={() => setOpen((v) => !v)}`)
- Clicking inside the panel (checkboxes, selects, tone buttons, textarea) does NOT close it
- No outside-click, blur, or Escape key closes it

**Scope:** Both affected pages use the shared `CompactFilterBar` component, so one fix covers both:
- Ratings tab: `frontend/src/app/(app)/classes/[id]/sessions/[sessionId]/page.tsx`
- Review page: `frontend/src/app/(app)/classes/[id]/sessions/[sessionId]/review/page.tsx`

`ReportStudio.tsx` has its own separate filter panel (different component, not shared) and was not affected — it already had no outside-click handler.
