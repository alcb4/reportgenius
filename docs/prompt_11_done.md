
TASK: BATCH PROMPT BUILDER — REPLACE WITH SHARED BUILDER

PROBLEM:
Batch generation uses a completely separate, outdated prompt
builder that is missing:
  - Test score / % inclusion
  - Historical progression section
  - Banned phrases list
  - Proper paragraph structure instructions
  - Tone-specific instructions
  - Per-student pronoun handling beyond basic
  - Topics covered (qualitative, not just listed)

The individual prompt was correctly updated. Batch was not.
They must produce identical per-student content.

═══════════════════════════════════════════════════════
ROOT CAUSE
═══════════════════════════════════════════════════════

There are TWO prompt builders in the backend:

  A) Individual: backend/src/adapters/llm/prompt-builder.ts
     → Full, detailed, up to date ✓

  B) Batch: likely inline in the batch route handler or a
     separate buildBatchPrompt() function
     → Old, simplified, NOT updated ✗

Find the batch builder. Search for:
  □ "Generate reports for"
  □ "valid JSON array"
  □ buildBatchPrompt
  □ bulk prompt / batch prompt in routes/sessions.ts
     or routes/reports.ts

═══════════════════════════════════════════════════════
THE FIX — USE SHARED BUILDER FOR EACH STUDENT
═══════════════════════════════════════════════════════

Do NOT maintain a separate batch prompt. Instead, call the
existing buildPrompt() once per student and combine:

  BEFORE (wrong — one big prompt for all students):
    const batchPrompt = buildBatchPrompt(students)
    // sends one prompt with all students listed

  AFTER (correct — individual prompt per student, batched):
    const studentPrompts = students.map(student =>
      buildPrompt(student, session, ratings[student.id], options)
    )

── Option A: Parallel individual API calls (Lets do option A as its better long term) ──

  const results = await Promise.all(
    students.map(student =>
      llm.generate(buildPrompt(student, session, ratings[student.id], options))
    )
  )

  Pros: identical output to individual generation
  Cons: N API calls instead of 1

── Option B: Keep single API call, use shared per-student sections ──

  If token cost/rate limits make N calls impractical, structure
  the batch prompt by embedding each student's FULL individual
  prompt as a section:

  const batchPrompt = `
You are a school teacher writing end-of-term report comments.
Generate reports for ${students.length} students.

CRITICAL INSTRUCTIONS:
1. Respond ONLY with a valid JSON array. No other text.
2. Format: [{ "studentId": "<id>", "report": "<text>" }, ...]
3. Each report must follow the per-student instructions below EXACTLY.

${students.map(student => `
=== STUDENT ${student.id} ===
${buildStudentSection(student, session, ratings[student.id], options)}
`).join('\n')}
`

  Where buildStudentSection() uses the SAME logic as buildPrompt()
  but formats it as an embedded section rather than a standalone prompt.
  Critically it must include:
    - test score if session.include_test_score ✓
    - progression history ✓
    - pronouns ✓
    - topics ✓

═══════════════════════════════════════════════════════
WHICHEVER OPTION — SYNC THESE FIELDS
═══════════════════════════════════════════════════════

Per student in batch, confirm these match individual:

  □ test_score + include_test_score flag
  □ grade (if boundaries set)
  □ progression history (ratingsHistory)
  □ pronouns from gender
  □ topics_covered
  □ tone
  □ reportLength
  □ banned phrases list
  □ paragraph structure instructions

═══════════════════════════════════════════════════════
VERIFY
═══════════════════════════════════════════════════════

1. Batch with include_test_score: true
   → Each student section contains test score ✓
2. Batch prompt matches individual prompt structure ✓
3. Progression history present per student in batch ✓
4. Banned phrases instruction present in batch ✓
5. Generate batch → reports reference test scores naturally ✓
6. Individual generate still works unchanged ✓

End with: "Batch uses shared prompt builder, output matches individual generation."