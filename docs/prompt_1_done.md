TASK: THREE SPARKLINE + REPORT EDITOR POLISH FIXES

═══════════════════════════════════════════════════════
FIX 1 — SPARKLINE GHOST SPACE AFTER REMOVING TOPIC TABLE
File: src/components/SparklineGrid.tsx
═══════════════════════════════════════════════════════

The topic ratings table was removed but its wrapping container
remains, leaving a visible empty gap below each sparkline row.

Audit the JSX returned for each student row. Find any wrapper
div/section that previously contained the topic score buttons —
even if the inner content was removed, the container itself
(with padding, margin, or min-height) likely still renders.

Remove the wrapper container entirely, not just its children.
Verify no gap/whitespace remains below the sparkline staff.

═══════════════════════════════════════════════════════
FIX 2 — SPARKLINE CROSSHAIR COORDINATE OFFSET
File: src/components/SparklineGrid.tsx
═══════════════════════════════════════════════════════

The crosshair/hover indicator is appearing at wrong positions:
- Shows before the first discipline column (too far left)
- Shows after the last topic column (too far right, overlapping
  the comment box area)

This suggests the x-coordinate calculation includes padding or
offset columns (student name column, comment column) in the
index range.

Audit the coordinate mapping logic:

1. The columns used for x-position calculation should be ONLY
   the rating columns (discipline + topic) — not the student
   name column on the left or the comment/action columns
   on the right.

2. Check the index offset: if column index 0 is the student
   name, then rating columns start at index 1. The x-position
   for rating column[i] should map from i=0 not i=1.

3. Verify the total width calculation excludes non-rating columns.

4. If using a columns array to derive x positions, ensure the
   array contains only rateable columns:
   const ratingColumns = [...disciplineColumns, ...topicColumns]
   // excludes: name, comment, generate button columns

Fix the coordinate calculation so crosshair snaps correctly to
the centre of each rating column, first discipline to last topic.

═══════════════════════════════════════════════════════
FIX 3 — REPORT EDITOR LARGE WHITE CARD SPACE
File: src/components/ReportEditor.tsx (or similar)
═══════════════════════════════════════════════════════

The report editor card has excessive white space below the report
text content. Visible in attached screenshot — the text ends
roughly halfway down the card but the card extends much further
with empty white space before the action buttons.

The card/textarea likely has a fixed height or min-height set.

Fix:
1. Find the report content area (textarea or contenteditable div)
2. Remove any fixed height (h-64, h-96, height: 400px etc.)
3. Replace with:
   - min-h-[200px] so short reports don't collapse
   - max-h-none or no max-height constraint
   - If textarea: add resize-none and use rows={} derived from
     content length, OR use auto-resize on content change
   - If contenteditable div: height should be auto, driven by content

4. The card wrapper itself should also NOT have a fixed height —
   it should grow with its content. Remove any h-* or min-h-*
   from the card container that wraps the report text area.

5. Action buttons (Redo, Export PDF, Mark Final + Next) should
   sit flush below the report content, not float at the bottom
   of a fixed-height card.

═══════════════════════════════════════════════════════
VERIFY:
═══════════════════════════════════════════════════════

1. Sparkline rows: no ghost gap below staff, layout tight
2. Sparkline crosshair: hover snaps to first discipline column
   correctly, last intercept point is last topic column
3. Crosshair does not appear in name column or comment column area
4. Report editor: card height matches content height
5. Short report: card is compact, no large white void
6. Long report: card expands naturally to fit content
7. Action buttons sit directly below report text

End with: "Sparkline ghost space removed, crosshair coordinates
fixed, report card height now content-driven."