import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { exportClassPDF, PDFExportError } from '@/lib/services/export.service'
import { rateLimitOrNull } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function safeFilename(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || 'file'
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const limited = await rateLimitOrNull(req, 'export', 'pdf')
  if (limited) return limited

  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  const cls = await prisma.class.findFirst({
    where: { id: classId, organization_id: user.organizationId },
    select: { name: true },
  })
  if (!cls) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

  try {
    const className = safeFilename(cls.name)

    console.log(JSON.stringify({ event: 'export.route.pdf.class', classId, organizationId: user.organizationId }))

    const zipBuffer = await exportClassPDF(classId, user.organizationId)

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${className}_reports.zip"`,
        'Content-Length': String(zipBuffer.length),
      },
    })
  } catch (err: unknown) {
    if (err instanceof PDFExportError) {
      return NextResponse.json({ error: err.userFacingMessage, code: err.code, userFacing: true }, { status: 503 })
    }
    if (err !== null && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
      const domainErr = err as { statusCode: number; code: string; message: string }
      return NextResponse.json({ error: domainErr.message, code: domainErr.code }, { status: domainErr.statusCode })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
