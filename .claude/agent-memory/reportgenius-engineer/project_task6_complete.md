---
name: Task 6 — PDF/ZIP/XLSX Exports complete
description: What was built and key decisions made in Task 6 (export layer)
type: project
---

Task 6 delivered three export endpoints backed by a dedicated service and HTML template.

**Files created:**
- `backend/src/templates/report.html.ts` — `buildReportHTML(ReportHTMLData): string`, inline-CSS A4 template, escapes HTML, nl2br for body text.
- `backend/src/services/export.service.ts` — `exportReportPDF`, `exportClassPDF`, `exportClassCSV`; all org-scoped Prisma queries.
- `backend/src/routes/exports.ts` — three GET routes mounted at `/api/v1`; `safeFilename()` strips illegal chars for Content-Disposition.

**Route registration:** `exportsRouter` added to `server.ts` at `/api/v1`.

**Dependencies added (all approved):** `puppeteer-core`, `@sparticuz/chromium`, `archiver`, `@types/archiver`, `xlsx`.

**Key implementation decisions:**
- `@sparticuz/chromium` v3+ only exports `{ args, executablePath, graphicsMode }` — no `.headless` property. Use `headless: "shell"` directly in `puppeteer.launch()`.
- `puppeteer.defaultArgs({ args: chromium.args, headless: "shell" })` combines chromium's sandbox-safe args with puppeteer's defaults.
- Browser always closed in `finally` block to prevent process leaks in Docker.
- Class PDF generation is sequential (not parallel) to keep Docker memory bounded.
- Discipline scores are mapped to canonical columns (`behaviour_score`, `homework_score`, `participation_score`, `progress_score`) via a slug normaliser + `SLUG_MAP` lookup. Unrecognised discipline names result in an empty string in the XLSX — not an error.
- XLSX uses `aoa_to_sheet` (array-of-arrays) for full column-width control.
- ZIP uses `archiver` with `Readable.from(buffer)` — each PDF streamed into the archive, not temp files.

**Why:** Exports are the final teacher deliverable — PDF for distribution to parents, XLSX for record-keeping/admin.

**How to apply:** When extending exports (e.g. adding more score columns), extend `SLUG_MAP` with new discipline name slugs. When modifying PDF template, always test HTML escaping — report text comes from LLM and may contain special characters.
