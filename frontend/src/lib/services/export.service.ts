/**
 * Export service — PDF, ZIP, and XLSX exports.
 *
 * PDF rendering uses one of two browser launch paths depending on DEPLOYMENT_MODE:
 *   - "hosted"   → @sparticuz/chromium + puppeteer-core (serverless / Vercel)
 *   - "standalone" (default) → full puppeteer (self-hosted, local Chromium)
 */

import archiver from 'archiver'
import ExcelJS from 'exceljs'
import { Readable } from 'stream'
import { prisma } from '@/lib/prisma'
import { buildReportHTML, ReportHTMLData } from '@/lib/templates/report.html'

// ── Custom error surfaced to API routes for user-friendly messaging ──────────

export class PDFExportError extends Error {
  constructor(
    message: string,
    public readonly userFacingMessage: string,
    public readonly code: string = 'PDF_EXPORT_ERROR',
  ) {
    super(message)
    this.name = 'PDFExportError'
  }
}

// ── Browser launch (conditional per deployment mode) ─────────────────────────

const isHosted = process.env.DEPLOYMENT_MODE === 'hosted'

async function launchBrowser(): Promise<unknown> {
  if (isHosted) {
    try {
      const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
        import('@sparticuz/chromium'),
        import('puppeteer-core'),
      ])

      return puppeteer.launch({
        args: puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
        defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 },
        executablePath: await chromium.executablePath(),
        headless: 'shell',
      })
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new PDFExportError(
        `Chromium launch failed on hosted deployment: ${detail}`,
        'PDF export is not available on the hosted demo. Self-host ReportGenius for full PDF export. View setup instructions at https://github.com/anomalyco/report_genius',
        'PDF_EXPORT_UNAVAILABLE',
      )
    }
  }

  // standalone — full Puppeteer with bundled Chromium
  const { default: puppeteer } = await import('puppeteer')
  return puppeteer.launch({ headless: true })
}

// ── HTML → PDF ───────────────────────────────────────────────────────────────

async function htmlToBuffer(html: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any = null

  try {
    browser = await launchBrowser()

    const page = await browser.newPage()
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'domcontentloaded' })

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    })

    return Buffer.from(pdfBuffer)
  } finally {
    if (browser !== null) {
      await browser.close()
    }
  }
}

async function buffersToZip(files: Array<{ name: string; buffer: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const archive = archiver('zip', { zlib: { level: 6 } })

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', (err: Error) => reject(err))

    for (const file of files) {
      archive.append(Readable.from(file.buffer), { name: file.name })
    }

    archive.finalize().catch(reject)
  })
}

export async function exportReportPDF(reportId: string, orgId: string): Promise<Buffer> {
  const report = await prisma.report.findFirst({
    where: { id: reportId, organization_id: orgId },
    select: {
      id: true,
      edited_content: true,
      created_at: true,
      student: { select: { first_name: true } },
      session: { select: { name: true } },
    },
  })

  if (!report) {
    throw Object.assign(new Error('Report not found'), {
      code: 'REPORT_NOT_FOUND',
      statusCode: 404,
    })
  }

  const templateData: ReportHTMLData = {
    firstName: report.student.first_name,
    className: report.session.name,
    term: null,
    reportText: report.edited_content,
    generatedAt: report.created_at,
  }

  return htmlToBuffer(buildReportHTML(templateData))
}

export async function exportSessionPDF(sessionId: string, orgId: string): Promise<Buffer> {
  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: orgId },
    select: { id: true, name: true },
  })

  if (!session) {
    throw Object.assign(new Error('Session not found'), {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    })
  }

  const reports = await prisma.report.findMany({
    where: { session_id: sessionId, organization_id: orgId },
    select: {
      id: true,
      edited_content: true,
      created_at: true,
      student: { select: { first_name: true } },
    },
    orderBy: { student: { first_name: 'asc' } },
  })

  if (reports.length === 0) {
    throw Object.assign(new Error('No reports found for this session'), {
      code: 'NO_REPORTS',
      statusCode: 404,
    })
  }

  const pdfFiles: Array<{ name: string; buffer: Buffer }> = []

  for (const report of reports) {
    const templateData: ReportHTMLData = {
      firstName: report.student.first_name,
      className: session.name,
      term: null,
      reportText: report.edited_content,
      generatedAt: report.created_at,
    }

    const pdfBuffer = await htmlToBuffer(buildReportHTML(templateData))
    pdfFiles.push({
      name: `${report.student.first_name}_report.pdf`,
      buffer: pdfBuffer,
    })
  }

  return buffersToZip(pdfFiles)
}

export async function exportClassPDF(classId: string, orgId: string): Promise<Buffer> {
  const session = await prisma.reportSession.findFirst({
    where: { class_id: classId, organization_id: orgId },
    select: { id: true },
    orderBy: { created_at: 'desc' },
  })

  if (!session) {
    throw Object.assign(new Error('No sessions found for this class'), {
      code: 'NO_SESSIONS',
      statusCode: 404,
    })
  }

  return exportSessionPDF(session.id, orgId)
}

interface ReportRow {
  ref_id: string
  first_name: string
  last_name: string
  gender: string
  session_name: string
  status: string
  word_count: number
  report_text: string
  generated_at: string
}

export async function exportSessionCSV(sessionId: string, orgId: string): Promise<Buffer> {
  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: orgId },
    select: { id: true, name: true },
  })

  if (!session) {
    throw Object.assign(new Error('Session not found'), {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    })
  }

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
    orderBy: [{ student: { first_name: 'asc' } }, { created_at: 'desc' }],
  })

  const keys: (keyof ReportRow)[] = [
    'ref_id', 'first_name', 'last_name', 'gender', 'session_name',
    'status', 'word_count', 'report_text', 'generated_at',
  ]

  const columnHeaders: Record<keyof ReportRow, string> = {
    ref_id: 'Ref ID',
    first_name: 'First Name',
    last_name: 'Last Name',
    gender: 'Gender',
    session_name: 'Session',
    status: 'Status',
    word_count: 'Word Count',
    report_text: 'Report Text',
    generated_at: 'Generated At',
  }

  const rows: ReportRow[] = reports.map((r) => ({
    ref_id: r.student.student_ref_id ?? '',
    first_name: r.student.first_name,
    last_name: r.student.last_name ?? '',
    gender: r.student.gender ?? '',
    session_name: session.name,
    status: r.status,
    word_count: r.word_count ?? 0,
    report_text: r.edited_content,
    generated_at: r.created_at.toISOString(),
  }))

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Reports')

  const colWidths = [14, 18, 18, 10, 30, 10, 12, 60, 24]
  worksheet.columns = keys.map((key, i) => ({
    header: columnHeaders[key],
    key,
    width: colWidths[i] ?? 15,
  }))

  for (const row of rows) {
    worksheet.addRow(keys.map((k) => row[k]))
  }

  const raw = await workbook.xlsx.writeBuffer()
  return Buffer.from(raw)
}

export async function exportClassCSV(classId: string, orgId: string): Promise<Buffer> {
  const session = await prisma.reportSession.findFirst({
    where: { class_id: classId, organization_id: orgId },
    select: { id: true },
    orderBy: { created_at: 'desc' },
  })

  if (!session) {
    throw Object.assign(new Error('No sessions found for this class'), {
      code: 'NO_SESSIONS',
      statusCode: 404,
    })
  }

  return exportSessionCSV(session.id, orgId)
}
