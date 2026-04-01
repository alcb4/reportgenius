import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { exportReportPDF } from '@/lib/services/export.service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function safeFilename(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || 'file'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { reportId } = await params

  try {
    const report = await prisma.report.findFirst({
      where: { id: reportId, organization_id: user.organizationId },
      select: { student: { select: { first_name: true } } },
    })

    if (!report) return NextResponse.json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' }, { status: 404 })

    const firstName = safeFilename(report.student.first_name)
    const pdfBuffer = await exportReportPDF(reportId, user.organizationId)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${firstName}_report.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (err: unknown) {
    if (err !== null && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
      const domainErr = err as { statusCode: number; code: string; message: string }
      return NextResponse.json({ error: domainErr.message, code: domainErr.code }, { status: domainErr.statusCode })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
