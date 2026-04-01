---
name: Filter Bar Final Polish 2.0
description: SelectTestsModal replaces inline test rows; progression UI simplified to checkboxes only (no scores); tone buttons h-10; disciplines flex-wrap pills with no truncation
type: project
---

Tests modal, progression simplification, and core width fixes applied to CompactFilterBar.

**Why:** Inline test rows in expansion panel were cluttered; score numbers in progression were noisy; tone buttons were too small; discipline list was truncating on long lists.

**How to apply:** SelectTestsModal is a separate component above CompactFilterBar in the file. The `onAddSessionTest` prop was removed from CompactFilterBar (AddSessionTestModal still exists for class-level test creation). Progression "Allow negative" toggle moved to bottom of discipline list, separated by a border-t. Tone buttons use `h-10 px-4`. Disciplines rendered as `<span>` pills in a `flex flex-wrap gap-x-1.5 gap-y-1` container — no truncate/max-w. Hint tooltip on "Low score" test filter uses `group/cb` scoped group class. `as const` on tuple with optional `hint` field causes TS error — solved by typing hint as `string | undefined` on each entry explicitly.
