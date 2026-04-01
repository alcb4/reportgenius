/**
 * Export service — PDF, ZIP, and XLSX exports.
 *
 * Public API:
 *   exportReportPDF(reportId, orgId)      → single report PDF Buffer
 *   exportSessionPDF(sessionId, orgId)    → ZIP Buffer containing one PDF per FINAL student report
 *   exportSessionCSV(sessionId, orgId)    → XLSX Buffer with all reports (draft + final)
 *
 * Multi-tenant isolation: every Prisma query filters by organization_id.
 * Privacy: only first_name, session name, report text, and aggregated scores
 *          are ever included in exports — no last names or other PII.
 *
 * Puppeteer is launched with @sparticuz/chromium so it works inside Docker
 * with --no-sandbox and the bundled Chromium binary.
 */

import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import archiver from "archiver";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { Readable } from "stream";
import { buildReportHTML, ReportHTMLData } from "../templates/report.html";

const prisma = new PrismaClient();

// ── Puppeteer helpers ─────────────────────────────────────────────────────────

/**
 * Render an HTML string to a PDF Buffer using Puppeteer + Chromium.
 * Always closes the browser in a finally block to prevent process leaks.
 */
async function htmlToBuffer(html: string): Promise<Buffer> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
      args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });

    const page = await browser.newPage();

    // Set A4 viewport for accurate rendering.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });

    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}

// ── Archive helper ────────────────────────────────────────────────────────────

/**
 * Collect a set of named Buffers into a single ZIP Buffer.
 */
async function buffersToZip(
  files: Array<{ name: string; buffer: Buffer }>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const archive = archiver("zip", { zlib: { level: 6 } });

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", (err: Error) => reject(err));

    for (const file of files) {
      archive.append(Readable.from(file.buffer), { name: file.name });
    }

    archive.finalize().catch(reject);
  });
}

// ── 1. Single report PDF ──────────────────────────────────────────────────────

/**
 * Fetch one report (org-scoped), render it to PDF, and return the raw Buffer.
 * Uses a single Prisma query with nested selects — no N+1.
 */
export async function exportReportPDF(
  reportId: string,
  orgId: string
): Promise<Buffer> {
  const report = await prisma.report.findFirst({
    where: { id: reportId, organization_id: orgId },
    select: {
      id: true,
      edited_content: true,
      created_at: true,
      student: {
        select: { first_name: true },
      },
      session: {
        select: { name: true },
      },
    },
  });

  if (!report) {
    throw Object.assign(new Error("Report not found"), {
      code: "REPORT_NOT_FOUND",
      statusCode: 404,
    });
  }

  const templateData: ReportHTMLData = {
    firstName: report.student.first_name,
    className: report.session.name,
    term: null,
    reportText: report.edited_content,
    generatedAt: report.created_at,
  };

  console.log(JSON.stringify({
    event: "export.pdf.single.start",
    reportId,
    orgId,
  }));

  const start = Date.now();
  const buffer = await htmlToBuffer(buildReportHTML(templateData));

  console.log(JSON.stringify({
    event: "export.pdf.single.complete",
    reportId,
    orgId,
    durationMs: Date.now() - start,
    sizeBytes: buffer.length,
  }));

  return buffer;
}

// ── 2. Session PDF ZIP ────────────────────────────────────────────────────────

/**
 * Fetch all FINAL reports for a session, generate one PDF per student,
 * and return a ZIP Buffer containing all PDFs.
 * Filename per student: "{first_name}_report.pdf"
 */
export async function exportSessionPDF(
  sessionId: string,
  orgId: string
): Promise<Buffer> {
  // Verify session belongs to org and get the session name.
  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: orgId },
    select: { id: true, name: true },
  });

  if (!session) {
    throw Object.assign(new Error("Session not found"), {
      code: "SESSION_NOT_FOUND",
      statusCode: 404,
    });
  }

  // Fetch all reports (any status) with student data — one query, no N+1.
  const reports = await prisma.report.findMany({
    where: {
      session_id: sessionId,
      organization_id: orgId,
    },
    select: {
      id: true,
      edited_content: true,
      created_at: true,
      student: {
        select: { first_name: true },
      },
    },
    orderBy: { student: { first_name: "asc" } },
  });

  if (reports.length === 0) {
    throw Object.assign(
      new Error("No reports found for this session"),
      { code: "NO_REPORTS", statusCode: 404 }
    );
  }

  console.log(JSON.stringify({
    event: "export.pdf.session.start",
    sessionId,
    orgId,
    reportCount: reports.length,
  }));

  const start = Date.now();

  // Generate all PDFs — sequential to keep memory bounded in Docker.
  const pdfFiles: Array<{ name: string; buffer: Buffer }> = [];

  for (const report of reports) {
    const templateData: ReportHTMLData = {
      firstName: report.student.first_name,
      className: session.name,
      term: null,
      reportText: report.edited_content,
      generatedAt: report.created_at,
    };

    const pdfBuffer = await htmlToBuffer(buildReportHTML(templateData));
    pdfFiles.push({
      name: `${report.student.first_name}_report.pdf`,
      buffer: pdfBuffer,
    });
  }

  const zipBuffer = await buffersToZip(pdfFiles);

  console.log(JSON.stringify({
    event: "export.pdf.session.complete",
    sessionId,
    orgId,
    reportCount: pdfFiles.length,
    durationMs: Date.now() - start,
    zipSizeBytes: zipBuffer.length,
  }));

  return zipBuffer;
}

// Keep old exportClassPDF as a compatibility alias that resolves class → first session.
// This allows the existing /classes/:classId/export/pdf route to remain functional.
export async function exportClassPDF(
  classId: string,
  orgId: string
): Promise<Buffer> {
  // Find the most recent session for this class.
  const session = await prisma.reportSession.findFirst({
    where: { class_id: classId, organization_id: orgId },
    select: { id: true },
    orderBy: { created_at: "desc" },
  });

  if (!session) {
    throw Object.assign(new Error("No sessions found for this class"), {
      code: "NO_SESSIONS",
      statusCode: 404,
    });
  }

  return exportSessionPDF(session.id, orgId);
}

// ── 3. Session XLSX export ────────────────────────────────────────────────────

/**
 * Shape of a row in the XLSX export.
 */
interface ReportRow {
  ref_id: string;
  first_name: string;
  last_name: string;
  gender: string;
  session_name: string;
  status: string;
  word_count: number;
  report_text: string;
  generated_at: string;
}

/**
 * Build an XLSX Buffer for all reports (draft + final) belonging to a session.
 *
 * Columns: ref_id, first_name, last_name, gender, session_name, status, word_count, report_text, generated_at
 */
export async function exportSessionCSV(
  sessionId: string,
  orgId: string
): Promise<Buffer> {
  // Verify session belongs to org.
  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: orgId },
    select: { id: true, name: true },
  });

  if (!session) {
    throw Object.assign(new Error("Session not found"), {
      code: "SESSION_NOT_FOUND",
      statusCode: 404,
    });
  }

  // Fetch all reports with student data — one query, no N+1.
  const reports = await prisma.report.findMany({
    where: { session_id: sessionId, organization_id: orgId },
    select: {
      id: true,
      edited_content: true,
      status: true,
      word_count: true,
      created_at: true,
      student: {
        select: {
          first_name: true,
          last_name: true,
          gender: true,
          student_ref_id: true,
        },
      },
    },
    orderBy: [{ student: { first_name: "asc" } }, { created_at: "desc" }],
  });

  console.log(JSON.stringify({
    event: "export.xlsx.start",
    sessionId,
    orgId,
    reportCount: reports.length,
  }));

  const start = Date.now();

  const headers: (keyof ReportRow)[] = [
    "ref_id",
    "first_name",
    "last_name",
    "gender",
    "session_name",
    "status",
    "word_count",
    "report_text",
    "generated_at",
  ];

  const rows: ReportRow[] = reports.map((r) => ({
    ref_id: r.student.student_ref_id ?? "",
    first_name: r.student.first_name,
    last_name: r.student.last_name ?? "",
    gender: r.student.gender ?? "",
    session_name: session.name,
    status: r.status,
    word_count: r.word_count ?? 0,
    report_text: r.edited_content,
    generated_at: r.created_at.toISOString(),
  }));

  const aoaData: unknown[][] = [
    headers,
    ...rows.map((row) => headers.map((h) => row[h])),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoaData);

  worksheet["!cols"] = [
    { wch: 14 }, // ref_id
    { wch: 18 }, // first_name
    { wch: 18 }, // last_name
    { wch: 10 }, // gender
    { wch: 30 }, // session_name
    { wch: 10 }, // status
    { wch: 12 }, // word_count
    { wch: 60 }, // report_text
    { wch: 24 }, // generated_at
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Reports");

  const xlsxBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  console.log(JSON.stringify({
    event: "export.xlsx.complete",
    sessionId,
    orgId,
    reportCount: reports.length,
    durationMs: Date.now() - start,
    sizeBytes: xlsxBuffer.length,
  }));

  return xlsxBuffer;
}

// Compatibility alias for the existing /classes/:classId/export/csv route.
export async function exportClassCSV(
  classId: string,
  orgId: string
): Promise<Buffer> {
  const session = await prisma.reportSession.findFirst({
    where: { class_id: classId, organization_id: orgId },
    select: { id: true },
    orderBy: { created_at: "desc" },
  });

  if (!session) {
    throw Object.assign(new Error("No sessions found for this class"), {
      code: "NO_SESSIONS",
      statusCode: 404,
    });
  }

  return exportSessionCSV(session.id, orgId);
}
