TASK: REPORT EDITOR → REPORT STUDIO WITH LIVE FILTERS

Transform the single-student report editor into a full "Report Studio"
with all session filters + live regenerate. Individual student focus only.

═══════════════════════════════════════════════════════
PART 1 — COMPONENT REFACTOR
File: src/components/ReportEditor.tsx → src/components/ReportStudio.tsx
═══════════════════════════════════════════════════════

Replace existing ReportEditor with ReportStudio.

Layout:
┌─────────────────────────────────────────────────────┐
│ Emma Johnson [she/her] [← Prev] [Next Student →] │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ Filters & Tone: │
│ ┌ Disciplines ┐ ┌ Tests ┐ ┌ Progression ┐ │
│ │ ☑ Effort │ │ ☑Maths│ │ ☑Behaviour │ Tone ● │
│ │ ☑ Behaviour │ │ [Mark]│ │ "3→4 impr" │Balanced │
│ └──────────────┘ └──────┘ └────────────┘ │
│ [Overview Summary] "Class showed good progress..." │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ Generated Report: │
│ [Full editable report text - textarea] │
│ [Character count] │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ [⚡ Regenerate] [Export PDF] [Export XLSX] [Mark Final]│
└─────────────────────────────────────────────────────┘

text

═══════════════════════════════════════════════════════
PART 2 — LIVE FILTERS PANEL
═══════════════════════════════════════════════════════

**Replicate exact same filter checkboxes** from the session ratings page:
- Discipline checkboxes (Effort, Behaviour, etc.)
- Test checkboxes (Mark / % / Grade / Low score)
- Historical Progression checkboxes (if available)
- Tone slider (Gentle/Balanced/Direct)
- Overview Summary textarea

**State sync:**
- On load: fetch session's current filter state + student's report
- Filters mirror session defaults but can be overridden per student
- Changes to filters → immediately enable Regenerate button

═══════════════════════════════════════════════════════
PART 3 — LIVE REGENERATE
═══════════════════════════════════════════════════════

[⚡ Regenerate] button:
1. Take current filter state (checkboxes + tone + summary)
2. POST /api/v1/sessions/:sessionId/reports/:studentId/regenerate
   Body: { filters: currentFilterState, studentId }
3. Backend re-runs prompt builder with new filters
4. Update report textarea with fresh content
5. Keep student's custom edits if any (merge intelligently)

Button states:
- Default: disabled (fresh content)
- After filter change: enabled with glow
- During regen: loading spinner

═══════════════════════════════════════════════════════
PART 4 — BACKEND: REGENERATE ENDPOINT
File: backend/src/routes/reports.ts
═══════════════════════════════════════════════════════

POST /api/v1/sessions/:sessionId/reports/:studentId/regenerate
Body: { 
  filters: {           // full filter state override
    disciplines: string[],
    test_filters: {...},
    progression: string[],
    tone: "balanced",
    overview_summary: string
  } 
}

Logic:
1. Fetch student data, ratings, test scores from session
2. Override session defaults with provided filters
3. Run prompt builder → generate new report content
4. UPSERT report row:
   - content = new content
   - filters_used = body.filters (for audit)
   - regenerated_at = now()
5. Return: { report: newContent }

═══════════════════════════════════════════════════════
PART 5 — NAVIGATION & STUDENT SWITCHING
═══════════════════════════════════════════════════════

Header:
Emma Johnson [she/her] [← Prev Student] [Next Student →]

text

- Prev/Next cycles through students in session with reports
- Filters state **persists** across students (session-level defaults)
- Report content + any per-student overrides load instantly
- [Mark Final] → save current state → move to next unmarked student

═══════════════════════════════════════════════════════
PART 6 — REPORT TEXTAREA
═══════════════════════════════════════════════════════

- Editable textarea (not readonly)
- Live character count
- Preserve teacher's manual edits on regenerate (don't wipe)
- Syntax highlight or subtle markdown preview if using markdown

═══════════════════════════════════════════════════════
VERIFY:
═══════════════════════════════════════════════════════

1. ReportStudio loads with session's default filters populated
2. Toggle discipline checkbox → Regenerate enabled
3. Click Regenerate → report updates with new filter state
4. Change Tone slider → regenerate reflects tone change
5. Edit report text manually → edits preserved on next regenerate
6. Prev/Next student → filters persist, report changes
7. Mark Final → saves current state, advances to next
8. Export buttons work (existing PDF/XLSX)

End with: "Report Studio complete. Live filters + regenerate working,
individual student editing with persistent session filters."