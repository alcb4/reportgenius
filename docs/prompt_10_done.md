
TASK 2: ADD LAST NAME + STUDENT ID TO XLSX EXPORT

PROBLEM:
XLSX export is missing Last Name and Student/Ref ID columns.

═══════════════════════════════════════════════════════
FIX — XLSX column order
═══════════════════════════════════════════════════════

Find the XLSX builder (likely in routes or a lib/export util).
Update the column headers and row data mapping:

BEFORE (likely):
  headers: ['Student', 'Behaviour', 'Effort', ...]
  row:     [student.firstName, ratings...]

AFTER:
  headers: ['Ref ID', 'First Name', 'Last Name', 'Behaviour', 'Effort', ...]
  row:     [student.student_id, student.firstName, student.lastName, ratings...]

In code:
  const headers = [
    'Ref ID',
    'First Name',
    'Last Name',
    ...disciplines.map(d => d.name),
    ...topicPerfCols.map(t => t.name),
    'Score %',     // if applicable
    'Grade',       // if applicable
    'Comment',
  ]

  const rows = students.map(student => [
    student.student_id,          // ← ADD
    student.first_name,
    student.last_name,           // ← ADD
    ...ratings.map(r => r.score),
    student.scorePercent ?? '',
    student.grade ?? '',
    student.comment ?? '',
  ])

═══════════════════════════════════════════════════════
VERIFY TASK 2
═══════════════════════════════════════════════════════

1. Download XLSX → first columns are Ref ID, First Name, Last Name ✓
2. Ref ID matches what's shown in the student table ✓
3. All existing columns still present ✓

End with: "PDF 404 fixed, XLSX includes Ref ID and Last Name."