TASK: REPORT SESSION COPY — TEMPLATE DUPLICATION ACROSS CLASSES

Add "Copy to other class" feature to Report Sessions. Teachers can
duplicate a report session's structure (disciplines, topics) to
parallel classes while keeping ratings blank.

Identical pattern to upcoming test copy feature.

═══════════════════════════════════════════════════════
PART 1 — PRISMA MIGRATION (minimal)
═══════════════════════════════════════════════════════

ADD to ReportSession model:
  is_template      Boolean      @default(false)
  source_template_id String?    @db.Uuid?

No other schema changes needed.

npx prisma migrate dev --name report_session_templates

═══════════════════════════════════════════════════════
═══════════════════════════════════════════════════════
PART 2 — BACKEND API ROUTES
═══════════════════════════════════════════════════════

File: backend/src/routes/sessions.ts

POST /api/v1/classes/:classId/sessions/copy
Body: { targetClassIds: string[], sourceSessionId: string }

Logic:
1. Fetch sourceClass = prisma.class.findUnique({ 
     where: { id: classId }, include: { sessions: true } 
   })
2. Validate sourceSessionId exists in sourceClass.sessions
3. Fetch sourceSession config (everything except ratings/reports):
```ts
const sourceConfig = await prisma.reportSession.findUnique({
  where: { id: sourceSessionId },
  select: {
    name: true,
    disciplines: true,
    topics_covered: true,
    grade_boundaries: true,
    tone_slider: true,           // if field exists
    test_filters: true,          // if field exists  
    overview_summary: true,
    is_template: true,
    // Prisma excludes relations automatically
  }
})
```
4. For each targetClassId in targetClassIds:
   - Validate targetClass belongs to same organization
   - Create new ReportSession:
```ts
const newSession = await prisma.reportSession.create({
  data: {
    class_id: targetClassId,
    name: `${sourceConfig!.name} (copied from ${sourceClass.name})`,
    disciplines: sourceConfig!.disciplines,
    topics_covered: sourceConfig!.topics_covered,
    grade_boundaries: sourceConfig!.grade_boundaries,
    tone_slider: sourceConfig!.tone_slider,
    test_filters: sourceConfig!.test_filters,
    overview_summary: sourceConfig!.overview_summary,
    is_template: sourceConfig!.is_template,
    source_template_id: sourceSessionId,
    // ratings/reports intentionally omitted (null/default)
  }
})
```
5. $transaction all creates → Return: 
```ts
{ 
  created: [{ classId: targetClassId, sessionId: newSession.id }], 
  total: targetClassIds.length 
}
```

PUT /api/v1/sessions/:sessionId/mark-template
Body: { is_template: boolean }
Simple prisma.reportSession.update({ data: { is_template } })

═══════════════════════════════════════════════════════
PART 3 — CLASS PAGE: REPORT SESSIONS CARD UPDATE
File: src/app/(app)/classes/[id]/page.tsx
═══════════════════════════════════════════════════════

Report Sessions card → each session row gets three-dot menu:
Biology End of Term [⋮]
├── [+ New Session] ← existing global button
├── [Edit] ← existing
├── [Copy to other classes] ← NEW
└── [Delete] ← existing

text

**Copy Modal:**
Copy "Biology End of Term" to:
☑ 8B (Year 8 Maths) [12 students]
☑ 8C (Year 8 Maths) [14 students]
☐ 8D (Year 8 Science) [11 students]

✅ Complete config: 5 disciplines, 3 topics, tone, filters, summary
──────────────
[Cancel] [Copy to 2 classes]

text

Auto-checks other classes in same organization (exclude self).
Student count from class.studentsCount.
POST /classes/${classId}/sessions/copy → success toast:
"Copied to 8B, 8C ✓"

Optional: Session list shows [📋 Template] badge if is_template=true.

═══════════════════════════════════════════════════════
PART 4 — SESSION DETAIL PAGE: TEMPLATE INDICATOR
File: src/app/(app)/classes/[id]/sessions/[sessionId]/page.tsx
═══════════════════════════════════════════════════════

If session.is_template = true:
- Show badge: "📋 Template — copy to other classes"
- Three-dot menu → [Copy to other classes] (same modal)

If session.source_template_id exists:
- Show badge: "📋 Copied from [source class name]"
- Subtle visual distinction (lighter background?)

No functional change to ratings/generation workflow.

═══════════════════════════════════════════════════════
PART 5 — PROMPT BUILDER: NO CHANGE REQUIRED
═══════════════════════════════════════════════════════

Copied sessions have identical disciplines/topics — prompt builder
works exactly the same. Ratings remain blank → normal flow.

═══════════════════════════════════════════════════════
VERIFY:
═══════════════════════════════════════════════════════

1. Session row → three-dot → Copy to other classes → modal opens
2. Select 2 target classes → Copy → 2 new sessions created
3. New sessions have identical name/disciplines/topics/grade_boundaries
4. New sessions have blank ratings (correct)
5. Source session unchanged
6. Copy across org boundary → 403 forbidden
7. Session detail page shows template/copied badges correctly
8. npx prisma migrate status → clean

End with: "Report session copy complete. Multi-class duplication
working with identical structure preservation."