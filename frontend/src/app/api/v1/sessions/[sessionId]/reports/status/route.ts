import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const BulkStatusSchema = z.object({
  reportIds: z.array(z.string().min(1)).min(1),
  status: z.enum(['draft', 'edited', 'final']),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  try {
    const session = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = BulkStatusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { reportIds, status } = parsed.data

    const result = await prisma.report.updateMany({
      where: {
        id: { in: reportIds },
        session_id: sessionId,
        organization_id: user.organizationId,
      },
      data: { status },
    })

    return NextResponse.json({ updated: result.count })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
