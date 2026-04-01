import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { generateSingleReport } from '@/lib/services/report.service'
import { ReportLength } from '@/lib/adapters/llm/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BatchGenerateSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(20),
  llmProvider: z.enum(['openai', 'claude', 'ollama']).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  try {
    const session = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: { id: true, tone: true, length: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = BatchGenerateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { studentIds, llmProvider } = parsed.data

    const results = await Promise.allSettled(
      studentIds.map((studentId) =>
        generateSingleReport(studentId, sessionId, user.organizationId, {
          tone: session.tone,
          length: session.length as ReportLength,
          llmProvider,
        })
      )
    )

    const reports = results.map((r, i) =>
      r.status === 'fulfilled'
        ? { studentId: studentIds[i], reportId: r.value.id, status: 'completed' }
        : { studentId: studentIds[i], status: 'failed', error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
    )

    return NextResponse.json({
      total: reports.length,
      completed: reports.filter((r) => r.status === 'completed').length,
      failed: reports.filter((r) => r.status === 'failed').length,
      reports,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
