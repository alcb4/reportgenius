
TASK 1: FIX PDF EXPORT 404 (INDIVIDUAL + BULK)

PROBLEM:
Both "Export All to PDF" and individual PDF export return 404.
XLSX works, so the export route exists — PDF endpoint is either
missing or at the wrong path.

═══════════════════════════════════════════════════════
DIAGNOSE FIRST
═══════════════════════════════════════════════════════

Check the browser network tab when clicking PDF export:
  - What URL is being requested?
  - Does that route exist in backend/src/routes/?

Compare working XLSX route vs broken PDF route:

  XLSX (works):   GET /api/v1/sessions/:id/export/xlsx
  PDF (404):      GET /api/v1/sessions/:id/export/pdf   ← does this exist?

Search codebase for:
  □ router.get('...pdf...')  → does a PDF route handler exist?
  □ export/pdf in routes     → registered in server.ts/app.ts?
  □ frontend export call     → what URL is it hitting?

═══════════════════════════════════════════════════════
LIKELY CAUSES
═══════════════════════════════════════════════════════

A) PDF route handler was never implemented
   → Stub exists in frontend but no backend route
   → Fix: implement the route (see below)

B) PDF route exists but not registered in server.ts
   → Fix: add app.use('/api/v1', pdfRouter) or equivalent

C) PDF route path mismatch
   → Frontend calls /export/pdf, backend has /pdf-export
   → Fix: align the paths

═══════════════════════════════════════════════════════
PDF ROUTE IMPLEMENTATION (if missing)
═══════════════════════════════════════════════════════

Install if not present:
  npm install puppeteer   OR   npm install @sparticuz/chromium puppeteer-core

── Individual PDF ──────────────────────────────────────

  router.get('/sessions/:sessionId/export/pdf/:studentId',
    authenticate, async (req, res) => {
      const { sessionId, studentId } = req.params
      // fetch report for student
      // render HTML template with report content
      // generate PDF via puppeteer
      // res.setHeader('Content-Type', 'application/pdf')
      // res.send(pdfBuffer)
  })

── Bulk PDF (all students) ─────────────────────────────

  router.get('/sessions/:sessionId/export/pdf',
    authenticate, async (req, res) => {
      // fetch all reports for session
      // render each as HTML page
      // combine into single PDF (one student per page)
      // res.setHeader('Content-Disposition', 'attachment; filename="reports.pdf"')
      // res.send(pdfBuffer)
  })

═══════════════════════════════════════════════════════
VERIFY TASK 1
═══════════════════════════════════════════════════════

1. Individual PDF → downloads single student report ✓
2. Export All PDF → downloads all students, one per page ✓
3. XLSX still works ✓
