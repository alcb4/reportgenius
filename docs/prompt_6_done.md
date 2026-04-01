TASK: HISTORICAL PROGRESSION FILTER — REPORT SESSION FILTERS

Add "Historical Progression" filter card to report sessions.
Compares current discipline ratings against most recent previous
complete session in same class.

═══════════════════════════════════════════════════════
PART 1 — BACKEND: PROGRESSION DATA ENDPOINT
File: backend/src/routes/sessions.ts
═══════════════════════════════════════════════════════

GET /api/v1/sessions/:sessionId/progression-data?studentId=<optional>

Returns:
{
  previousSession: { 
    id: string, 
    name: string, 
    completed_at: DateTime 
  } | null,
  matchedDisciplines: [
    {
      name: string,           // "Behaviour"
      currentScore: number,   // 4
      previousScore: number,  // 3  
      trend: "improved" | "declined" | "maintained"
    }
  ]
}

Logic for given studentId (or first student if omitted):
1. Get currentSession.class_id
2. Find most recent complete ReportSession in same class:
   WHERE class_id = current.class_id 
   AND status = 'complete' 
   AND id != currentSession.id
   ORDER BY completed_at DESC LIMIT 1
3. If no previous session: return { previousSession: null, matchedDisciplines: [] }
4. Get current student's discipline ratings from currentSession
5. Get same student's discipline ratings from previousSession  
6. For each discipline name in currentSession:
   - If same name exists in previous → compare scores:
     * diff = currentScore - previousScore
     * "improved" if diff > 0
     * "declined" if diff < 0  
     * "maintained" if diff === 0
   - Only include matching disciplines
7. Return matchedDisciplines array

═══════════════════════════════════════════════════════
PART 2 — FRONTEND: PROGRESSION FILTER CARD
File: Report session filters area (same location as discipline/tests cards)
═══════════════════════════════════════════════════════

New filter card below Tests (if present):
┌─────────────────────────────┐
│ Historical Progression │
└─────────────────────────────┘
Behaviour [☐ "improved 3→4"]
Attainment [☐ "maintained 5"]
Effort [☐ "declined 4→2"]

text

Features:
- Auto-populates checkboxes for disciplines that exist in BOTH
  current + previous session
- Checkbox label = `${name} "${trend} ${prev→current}"`
- Disabled if no previous session exists
- GET /sessions/:sessionId/progression-data on session load
- Re-fetch when switching students (if studentId param used)

═══════════════════════════════════════════════════════
PART 3 — PROMPT BUILDER INTEGRATION
File: backend/src/adapters/llm/prompt-builder.ts
═══════════════════════════════════════════════════════

If progression data provided + checkboxes active:
Append to prompt:
"Historical progression (reference only checked disciplines):
${checkedDisciplines.map(d =>
${d.name}: ${d.trend} from ${d.previousScore} to ${d.currentScore}
).join('\n')}

Incorporate these trends naturally into the Strengths / Areas to Improve
sections. Use phrasing appropriate to the selected report tone."

text

Data passed from frontend → backend as:
progression: [
{ name: "Behaviour", trend: "improved", previous: 3, current: 4 }
]

text

═══════════════════════════════════════════════════════
PART 4 — TONE INTEGRATION (no new logic needed)
═══════════════════════════════════════════════════════

Existing Tone slider controls progression phrasing:
- Gentle: "Behaviour shows positive development from last term"
- Balanced: "Behaviour improved from 3 to 4" 
- Direct: "Behaviour rating improved from weak to good"

═══════════════════════════════════════════════════════
VERIFY:
═══════════════════════════════════════════════════════

1. Session with no previous complete session → Progression card hidden
2. Session with previous session → matched disciplines auto-populate
3. Checkbox labels show correct trend + score delta
4. Toggle checkboxes → progression data included/excluded from prompt
5. Generate report → natural prose referencing progression
6. Different tone settings → progression phrasing adapts
7. Switch students → progression updates for new student

End with: "Historical progression filter complete. Compares ratings
across sessions, feeds trends to LLM with natural phrasing."