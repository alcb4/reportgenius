import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { generateSingleReport } from '@/lib/services/report.service'
import { ReportLength } from '@/lib/adapters/llm/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RedoSchema = z.object({
  llmProvider: z.enum(['openai', 'claude', 'ollama']).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { reportId } = await params

  try {
    const report = await prisma.report.findFirst({
      where: { id: reportId, organization_id: user.organizationId },
      select: { id: true, student_id: true, session_id: true },
    })
    if (!report) return NextResponse.json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' }, { status: 404 })

    const session = await prisma.reportSession.findFirst({
      where: { id: report.session_id },
      select: { tone: true, length: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const parsed = RedoSchema.safeParse(body)

    const newReport = await generateSingleReport(report.student_id, report.session_id, user.organizationId, {
      tone: session.tone,
      length: session.length as ReportLength,
      llmProvider: parsed.success ? parsed.data.llmProvider : undefined,
    })

    return NextResponse.json({ data: newReport }, { status: 201 })
  } catch (err: unknown) {
    if (err !== null && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
      const domainErr = err as { statusCode: number; code: string; message: string }
      return NextResponse.json({ error: domainErr.message, code: domainErr.code }, { status: domainErr.statusCode })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
