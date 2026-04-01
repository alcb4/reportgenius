TASK: GENERATE REPORTS TAB — API + FREE MODEL PATHS

Add a second tab to the session ratings page: "Generate Reports".
The existing "Ratings" tab must be completely untouched.

═══════════════════════════════════════════════════════
PART 1 — TAB STRUCTURE
═══════════════════════════════════════════════════════

File: src/app/(app)/classes/[id]/sessions/[sessionId]/page.tsx

Add a tab switcher at the top of the page content area:
  [⭐ Ratings]   [📋 Generate Reports]

- Default active tab: Ratings
- Ratings tab: renders existing RatingsGrid exactly as before, zero changes
- Generate Reports tab: renders new <GenerateReportsPanel> component
- Tab state: local useState, no URL change needed
- Styling: match existing tab/nav patterns in the codebase

═══════════════════════════════════════════════════════
PART 2 — GenerateReportsPanel COMPONENT
═══════════════════════════════════════════════════════

Create: src/components/GenerateReportsPanel.tsx

Props:
  sessionId: string
  students: Student[]   -- full student list for this session

Internal state:
  generatedStudentIds: Set<string>  -- students with a saved report
  batchStudents: Student[]          -- current batch of 5
  pasteValue: string                -- textarea content
  parseStatus: 'idle' | 'parsing' | 'success' | 'error'
  parseResults: { studentId: string, success: boolean }[]

On mount:
  Fetch existing reports for this session to pre-populate
  generatedStudentIds (students who already have a report are
  marked done and excluded from future batches)

─────────────────────────────────────────────────────
SECTION A — API PATH
─────────────────────────────────────────────────────

Header: "Generate with API"
Subtext: "Requires an API key configured in settings."

Button: [⚡ Generate All Remaining]
- Calls existing bulk generate endpoint for all students
  not yet in generatedStudentIds
- Shows per-student progress indicators as reports stream in
- On each success: adds studentId to generatedStudentIds
- On failure: shows inline error per student with retry button

─────────────────────────────────────────────────────
DIVIDER
─────────────────────────────────────────────────────

Visual: horizontal rule with centred "or" label

─────────────────────────────────────────────────────
SECTION B — FREE MODEL PATH
─────────────────────────────────────────────────────

Header: "Free Model"
Subtext: "Use ChatGPT, Gemini, Grok or any web LLM — no API key needed."

BATCH DISPLAY:
Show the current batch of 5 students as name chips/pills.
  Emma  James  Priya  Theo  Sofia    [🔀 New Batch]

Batch selection logic:
- Filter students: exclude any in generatedStudentIds
- From remaining, take first 5 alphabetically
- [🔀 New Batch] reshuffles the remaining pool and picks a
  different 5 — does NOT re-include already generated students
- If fewer than 5 remaining: show however many are left
- If 0 remaining: hide free model section, show
  "All reports generated ✅"

COPY PROMPT BUTTON:
  [📋 Copy Prompt for this Batch]

On click:
- Call GET /api/v1/sessions/:sessionId/batch-prompt
  with body: { studentIds: batchStudents.map(s => s.id) }
- Copy returned prompt string to clipboard
- Button changes to "✅ Copied!" for 2 seconds then resets
- Show helper text below:
  "Paste this into ChatGPT, Gemini, or Grok.
   Copy the full response and paste it below."

PASTE AREA:
  Label: "Paste the response here:"
  <textarea> — 10 rows, full width, monospace font
  Placeholder: "Paste the LLM response here..."

  [📥 Parse & Save Reports]

On parse click:
- Set parseStatus = 'parsing'
- Send pasteValue to POST /api/v1/sessions/:sessionId/parse-reports
- Display per-student result:
  ✅ Emma — saved
  ✅ James — saved
  ⚠️ Priya — not found in response (highlight amber)
  ✅ Theo — saved
  ✅ Sofia — saved
- On full success: add all batch studentIds to generatedStudentIds,
  clear textarea, auto-advance to next batch
- On partial success: add successful ones, leave failed ones
  in current batch highlighted, show:
  "2 reports saved. 1 student not found — try copying the prompt
   again or generate individually with API."

PROGRESS BAR:
  "Reports generated: 15 / 30"
  Progress bar filling left to right
  Derived from: generatedStudentIds.size / students.length

═══════════════════════════════════════════════════════
PART 3 — BACKEND: BATCH PROMPT ENDPOINT
═══════════════════════════════════════════════════════

File: backend/src/routes/reports.ts (or sessions.ts)

GET /api/v1/sessions/:sessionId/batch-prompt
Body: { studentIds: string[] }

- Validate sessionId + all studentIds belong to org
- For each studentId, fetch: student data, discipline ratings,
  topic ratings (if any)
- Build a single prompt string using the existing prompt builder,
  extended for batch mode:

Batch prompt structure:
  [System instructions — same tone/length/school context as single]

  Generate school reports for the following [n] students.
  You MUST respond with ONLY a valid JSON array.
  Do not include any text, explanation, or markdown outside the array.

  Required format:
  [
    { "studentId": "<id>", "report": "<report text>" },
    ...
  ]

  Students:
  ---
  Student ID: abc123
  Name: Emma
  Pronouns: she/her
  [discipline ratings summary]
  [topic ratings if present]
  ---
  Student ID: def456
  Name: James
  ...

- Return: { prompt: string }
- Max 5 studentIds — return 422 if more than 5 provided

═══════════════════════════════════════════════════════
PART 4 — BACKEND: PARSE REPORTS ENDPOINT
═══════════════════════════════════════════════════════

POST /api/v1/sessions/:sessionId/parse-reports
Body: { raw: string, studentIds: string[] }

Parsing logic (in order):
1. Strip markdown code fences if present:
   raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
2. Find first '[' and last ']' — extract substring between them
3. JSON.parse() the extracted string
4. Validate it is an array
5. For each item: validate { studentId: string, report: string }
6. Verify studentId exists in the session and in studentIds param

For each successfully parsed report:
- Upsert to the reports table (same as single generate save)
- Mark as source: 'free_model' (add source field to report if
  not already present — VARCHAR default 'api')

Return:
{
  results: [
    { studentId: string, name: string, success: boolean,
      error?: string }
  ],
  saved: number,
  failed: number
}

Error handling:
- If JSON.parse fails entirely: return 422 with
  { error: 'Could not parse response as JSON',
    hint: 'Ensure you copied the full response from the LLM' }
- Never 500 on bad paste input — always return structured error

═══════════════════════════════════════════════════════
VERIFY:
═══════════════════════════════════════════════════════

1. Ratings tab renders exactly as before — no visual change
2. Generate Reports tab renders with both sections visible
3. API section: Generate All triggers existing bulk generate flow
4. Free model — batch of 5 auto-selected from ungenerated students
5. [🔀 New Batch] picks a different 5 from remaining pool
6. [📋 Copy Prompt] copies valid JSON-format batch prompt to clipboard
7. Manually paste a valid JSON response → all 5 parse and save
8. Paste a response missing one student → 4 save, 1 flagged amber
9. Paste garbage text → 422 returned, friendly error shown
10. Paste ChatGPT response with ```json fences → strips cleanly, parses
11. Progress bar: reflects saved count correctly after each batch
12. All students generated: free model section replaced with ✅ message
13. Refresh page: generatedStudentIds re-hydrated from existing reports,
    progress bar correct

End with: "Generate Reports tab complete. API and free model paths
working, batch prompt copy and paste-parse flow verified."