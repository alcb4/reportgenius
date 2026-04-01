---
name: Task 8.2 — Dual Rating Mode
description: SparklineGrid music-staff view added alongside existing Table View in RatingsGrid
type: project
---

Task 8.2 implemented a dual-mode rating interface (Table View / Sparkline View) with a segmented pill toggle.

**Why:** Teachers need a more visual, spatially-rich way to rate multiple students quickly — the music-staff metaphor gives far more vertical resolution than the compact button grid.

**How to apply:** When making changes to rating state, both views share the same state/callbacks from RatingsGrid — no dual state to maintain.

Key architectural decisions:
- `SparklineGrid` is a pure presentation+interaction component — it receives `getScore`, `onScoreChange`, `getComment`, `onCommentChange`, `onCommentBlur` callbacks from `RatingsGrid`. It owns no state of its own.
- The Table View container is hidden via `style={{ display: viewMode === "table" ? undefined : "none" }}` rather than conditional rendering. This preserves the drag overlay ref and keyboard focus state when switching back.
- SVG uses a 1000-unit-wide viewBox with fixed pixel `height={VH}` (108px). X positions are logical viewBox units (scale with width); Y positions are literal pixels (consistent with `yToScore()` math using `STAFF_H=90`, `STAFF_PAD_V=12`).
- Container div refs (`containerRefs`) are used for `getBoundingClientRect()` on mousedown/click — not the SVG refs directly.
- `dragActivatedRef` flag suppresses the click event that fires after a drag mouseup.
- `viewMode` state is local to `RatingsGrid`, resets on page reload.
