import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  // Parse optional targetClassId from request body
  let targetClassId: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    if (body && typeof body.targetClassId === 'string' && body.targetClassId.trim()) {
      targetClassId = body.targetClassId.trim()
    }
  } catch {
    // body is optional — fall through
  }

  try {
    const source = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: {
        class_id: true, name: true, topics_covered: true, tone: true, length: true,
        disciplines: { select: { name: true, category: true, is_custom: true } },
      },
    })

    if (!source) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    // Resolve the class to duplicate into; default to the source class
    const resolvedClassId = targetClassId ?? source.class_id

    // If a targetClassId was provided, validate it belongs to the same organisation
    if (targetClassId && targetClassId !== source.class_id) {
      const targetClass = await prisma.class.findFirst({
        where: { id: targetClassId, organization_id: user.organizationId },
        select: { id: true },
      })
      if (!targetClass) {
        return NextResponse.json({ error: 'Target class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })
      }
    }

    const newSession = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.reportSession.create({
        data: {
          id: randomUUID(),
          organization_id: user.organizationId,
          class_id: resolvedClassId,
          name: `${source.name} (Copy)`,
          topics_covered: source.topics_covered,
          tone: source.tone,
          length: source.length,
          status: 'draft',
          progression_filters: [],
        },
        select: {
          id: true, class_id: true, name: true, topics_covered: true, tone: true,
          length: true, status: true, created_at: true, updated_at: true,
        },
      })

      if (source.disciplines.length > 0) {
        await tx.sessionDiscipline.createMany({
          data: source.disciplines.map((d) => ({
            session_id: created.id,
            name: d.name,
            category: d.category,
            is_custom: d.is_custom,
          })),
        })
      }

      const disciplines = await tx.sessionDiscipline.findMany({
        where: { session_id: created.id },
        select: { id: true, name: true, category: true, is_custom: true },
        orderBy: { created_at: 'asc' },
      })

      return { ...created, disciplines }
    })

    return NextResponse.json({ data: newSession }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
