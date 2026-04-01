TASK: TEST SCORES — CLASS-LEVEL WITH COPY + REPORT INTEGRATION

Add test scores as a new class-level feature. Tests are scoped to
individual classes but can be copied between classes.

═══════════════════════════════════════════════════════
PART 1 — PRISMA SCHEMA
═══════════════════════════════════════════════════════

ADD models:

model Test {
  id              String        @id @default(uuid())
  class_id        String        @db.Uuid
  name            String
  topics          String[]      // optional link to report topics
  max_mark        Int
  grade_boundaries Json         // { "A*": 90, "A": 80, ... }
  created_at      DateTime      @default(now())
  
  class           Class         @relation(fields: [class_id], references: [id])
  results         TestResult[]
  
  @@map("tests")
}

model TestResult {
  id         String  @id @default(uuid())
  test_id    String  @db.Uuid
  student_id String  @db.Uuid
  score      Int
  comment    String?
  calculated Json    // { percentage: 84, grade: "A" }
  
  test       Test    @relation(fields: [test_id], references: [id])
  student    Student @relation(fields: [student_id], references: [id])
  
  @@unique([test_id, student_id])
  @@map("test_results")
}

npx prisma migrate dev --name add_tests

═══════════════════════════════════════════════════════
PART 2 — CLASS PAGE: TESTS CARD
═══════════════════════════════════════════════════════

File: src/app/(app)/classes/[id]/page.tsx

Add third card below Students + Report Sessions:
┌──────────────┐
│   Tests      │
│ + New Test   │
│ Year 7 Maths │
│ English...   │
└──────────────┘

Card actions:
- [+ New Test] → modal form
- Test row → Edit test details
- Three-dot menu → Copy to other class, Delete test

NEW TEST MODAL:
Name: [Year 7 Maths]
Topic: [Algebra]  [Link to Report Session Topics]
Max Mark: [50]

Grade Boundaries (table):
A* 90-100  A 80-89  B 70-79  C 60-69  D 50-59  U 0-49
[Edit Custom] [Load UK Primary] [Load GCSE]

Save → POST /api/v1/classes/:classId/tests

COPY TEST:
→ Select target class → POST /api/v1/classes/:classId/tests/copy
Creates identical test in target class (same max_mark, boundaries)

═══════════════════════════════════════════════════════
PART 3 — TESTS DATA ENTRY PAGE
═══════════════════════════════════════════════════════

New route: /classes/[classId]/tests/[testId]/entry
Like ratings grid but for test scores.

GET /api/v1/classes/:classId/tests → list tests
GET /api/v1/tests/:testId/results → student scores for this test
POST /api/v1/tests/:testId/results/bulk → save scores

Table columns:
Student Name | Score [/max] | % | Grade | Comment | Actions

Score input: accepts "42/50" or "42" → splits automatically
Live calculation: % and Grade update as teacher types
Grade from boundaries JSON (percentage → letter)
Auto-save on blur, amber dot unsaved indicator

═══════════════════════════════════════════════════════
PART 4 — REPORT SESSION: TESTS FILTER CARD
═══════════════════════════════════════════════════════

File: Report session filter area (same place as discipline cards)

New card below Disciplines:
┌──────────────┐
│   Tests      │
└──────────────┘

For each test in class.tests:
✓ Year 7 Maths
  [Include] [Mark] [Percentage] [Grade] [Low score <40%]

Prompt builder receives test data when checkboxes active:
"Test results:
Year 7 Maths: 42/50 [mark] [84%] [A grade] [if checked]
Low scores (<40%) get: 'needs improvement in this area'"

Tests Card:
✓ Year 7 Maths
  [☐ Include test result]
  └─ [☐ Mark] [☐ %] [☐ Grade]  [☐ Low score mention]
How it works:

text
[Include] + [Mark]:           "42/50 in Year 7 Maths"
[Include] + [%]:              "84% in Year 7 Maths" 
[Include] + [Grade]:          "A grade in Year 7 Maths"
[Include] + [Mark] + [%]:     "42/50 (84%) in Year 7 Maths"
[Include] + all three:        "42/50 (84%, A grade) in Year 7 Maths"
[Low score mention]:          "needs improvement in this area" (if <40%)

═══════════════════════════════════════════════════════
PART 5 — TONE MASTER CONTROL
════════════════════════════════════════════════════──

Above all filter cards, add:
Report Tone: Gentle ○ Balanced ● Direct
- Gentle: no negative phrasing
- Balanced: constructive criticism (ratings 1-2, tests <40%)
- Direct: stronger language ("well below expected")

Single slider replaces individual negativity checkboxes.

═══════════════════════════════════════════════════════
VERIFY:
═══════════════════════════════════════════════════════

1. Class page shows Tests card with + New Test
2. New test modal → saves with grade boundaries
3. Copy test to another class → identical test created
4. Tests entry page → score input "42/50" → calculates %/grade
5. Report session → Tests filter card appears with checkboxes
6. Generate report → test data flows into prompt correctly
7. Tone slider → changes negativity level in generated reports

End with: "Tests feature complete. Class-level tests with copy,
data