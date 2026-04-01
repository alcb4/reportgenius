import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const CopySessionSchema = z.object({
  sourceSessionId: z.string().uuid('sourceSessionId must be a UUID'),
  targetClassIds: z.array(z.string().uuid()).min(1, 'At least one target class is required'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  const cls = await prisma.class.findFirst({
    where: { id: classId, organization_id: user.organizationId },
    select: { id: true },
  })
  if (!cls) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

  try {
    const body = await req.json()
    const parsed = CopySessionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { sourceSessionId, targetClassIds } = parsed.data

    const sourceSession = await prisma.reportSession.findFirst({
      where: { id: sourceSessionId, organization_id: user.organizationId },
      select: {
        id: true,
        name: true,
        topics_covered: true,
        tone: true,
        length: true,
        disciplines: { select: { name: true, category: true, is_custom: true } },
      },
    })
    if (!sourceSession) {
      return NextResponse.json({ error: 'Source session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })
    }

    const targetClasses = await prisma.class.findMany({
      where: { id: { in: targetClassIds }, organization_id: user.organizationId },
      select: { id: true, name: true },
    })
    if (targetClasses.length !== targetClassIds.length) {
      return NextResponse.json({ error: 'One or more target classes not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })
    }

    const created = await prisma.$transaction(async (tx) => {
      const results: Array<{ classId: string; sessionId: string; className: string }> = []

      for (const targetClass of targetClasses) {
        const newSessionId = randomUUID()
        await tx.reportSession.create({
          data: {
            id: newSessionId,
            organization_id: user.organizationId,
            class_id: targetClass.id,
            name: sourceSession.name,
            topics_covered: sourceSession.topics_covered,
            tone: sourceSession.tone,
            length: sourceSession.length,
            status: 'draft',
            source_template_id: sourceSessionId,
            progression_filters: [],
          },
        })

        if (sourceSession.disciplines.length > 0) {
          await tx.sessionDiscipline.createMany({
            data: sourceSession.disciplines.map((d) => ({
              session_id: newSessionId,
              name: d.name,
              category: d.category,
              is_custom: d.is_custom,
            })),
          })
        }

        results.push({ classId: targetClass.id, sessionId: newSessionId, className: targetClass.name })
      }

      return results
    })

    console.log(JSON.stringify({
      event: 'session.copied',
      sourceSessionId,
      organizationId: user.organizationId,
      targetCount: created.length,
    }))

    return NextResponse.json({ created, total: created.length }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
