/**
 * HTML template builder for student report PDFs.
 *
 * buildReportHTML() produces a fully self-contained, print-friendly HTML
 * document with inline CSS only (no external stylesheets or fonts).
 * Designed for A4 page size at 96 dpi.
 *
 * Privacy: only first_name is used — no last names, birthdates, or PII.
 */

export interface ReportHTMLData {
  /** Student first name only — no last name. */
  firstName: string;
  /** Class name, e.g. "Year 4 Science" */
  className: string;
  /** Term label, e.g. "Term 2 2025" */
  term: string | null;
  /** The final report text (may contain newlines). */
  reportText: string;
  /** ISO timestamp of when the report was generated. */
  generatedAt: Date;
}

/**
 * Format a Date as a human-readable string: "26 March 2026".
 */
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Escape characters that have special meaning in HTML.
 * Prevents XSS if report text contains angle brackets or ampersands.
 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert newlines to <br> tags for display inside a <p>.
 * Input must already be HTML-escaped.
 */
function nl2br(escaped: string): string {
  return escaped.replace(/\n/g, "<br>");
}

export function buildReportHTML(data: ReportHTMLData): string {
  const { firstName, className, term, reportText, generatedAt } = data;

  const safeName = escapeHtml(firstName);
  const safeClass = escapeHtml(className);
  const safeTerm = term ? escapeHtml(term) : "";
  const safeBody = nl2br(escapeHtml(reportText));
  const dateStr = formatDate(generatedAt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Student Report — ${safeName}</title>
  <style>
    /* ── Reset & base ─────────────────────────────────────────────── */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      width: 210mm;
      font-family: Georgia, "Times New Roman", Times, serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: #ffffff;
    }

    /* ── Page layout ──────────────────────────────────────────────── */
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm 22mm 20mm 22mm;
      display: flex;
      flex-direction: column;
    }

    /* ── Header ───────────────────────────────────────────────────── */
    .header {
      border-bottom: 2px solid #2c3e50;
      padding-bottom: 10pt;
      margin-bottom: 18pt;
    }

    .header-title {
      font-size: 18pt;
      font-weight: bold;
      color: #2c3e50;
      letter-spacing: 0.5pt;
      text-transform: uppercase;
    }

    .header-subtitle {
      font-size: 10pt;
      color: #555555;
      margin-top: 3pt;
      font-style: italic;
    }

    /* ── Meta table ───────────────────────────────────────────────── */
    .meta {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20pt;
      font-size: 10.5pt;
    }

    .meta td {
      padding: 4pt 8pt 4pt 0;
      vertical-align: top;
    }

    .meta .label {
      font-weight: bold;
      color: #2c3e50;
      white-space: nowrap;
      width: 120pt;
    }

    .meta .value {
      color: #1a1a1a;
    }

    /* ── Divider ──────────────────────────────────────────────────── */
    .divider {
      border: none;
      border-top: 1px solid #cccccc;
      margin: 14pt 0;
    }

    /* ── Report body ──────────────────────────────────────────────── */
    .report-section-heading {
      font-size: 11pt;
      font-weight: bold;
      color: #2c3e50;
      text-transform: uppercase;
      letter-spacing: 0.8pt;
      margin-bottom: 10pt;
    }

    .report-body {
      font-size: 11pt;
      line-height: 1.7;
      color: #1a1a1a;
      text-align: justify;
      flex: 1;
    }

    /* ── Footer ───────────────────────────────────────────────────── */
    .footer {
      margin-top: auto;
      padding-top: 12pt;
      border-top: 1px solid #cccccc;
      font-size: 8.5pt;
      color: #888888;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* ── Print media ──────────────────────────────────────────────── */
    @media print {
      html, body {
        width: 210mm;
      }
      .page {
        padding: 15mm 20mm;
        min-height: 0;
      }
      @page {
        size: A4 portrait;
        margin: 0;
      }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <header class="header">
      <div class="header-title">Student Report</div>
      <div class="header-subtitle">Confidential — for educational use only</div>
    </header>

    <!-- Student / class meta -->
    <table class="meta">
      <tbody>
        <tr>
          <td class="label">Student Name</td>
          <td class="value">${safeName}</td>
        </tr>
        <tr>
          <td class="label">Class</td>
          <td class="value">${safeClass}</td>
        </tr>
        ${safeTerm ? `
        <tr>
          <td class="label">Term</td>
          <td class="value">${safeTerm}</td>
        </tr>` : ""}
        <tr>
          <td class="label">Date Generated</td>
          <td class="value">${dateStr}</td>
        </tr>
      </tbody>
    </table>

    <hr class="divider" />

    <!-- Report content -->
    <section>
      <div class="report-section-heading">Teacher's Report</div>
      <div class="report-body">${safeBody}</div>
    </section>

    <!-- Footer -->
    <footer class="footer">
      <span>Generated by ReportGenius</span>
      <span>${dateStr}</span>
    </footer>

  </div>
</body>
</html>`;
}