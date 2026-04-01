import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const UpdateSessionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  topics_covered: z.array(z.string()).optional(),
  tone: z.enum(['gentle', 'balanced', 'direct']).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
  status: z.enum(['draft', 'in_progress', 'complete']).optional(),
  test_filters: z.record(z.object({
    includeMark: z.boolean().optional(),
    includePercentage: z.boolean().optional(),
    includeGrade: z.boolean().optional(),
    includeLowMention: z.boolean().optional(),
  })).nullable().optional(),
  progression_filters: z.array(z.string()).optional(),
  enable_progression: z.boolean().optional(),
  allow_negative_progression: z.boolean().optional(),
  class_overview: z.string().max(2000).nullable().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  try {
    const session = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: {
        id: true, organization_id: true, class_id: true, name: true,
        topics_covered: true, tone: true, length: true, status: true,
        is_template: true, source_template_id: true, test_filters: true,
        progression_filters: true, enable_progression: true,
        allow_negative_progression: true, class_overview: true,
        created_at: true, updated_at: true,
        disciplines: {
          select: { id: true, name: true, category: true, is_custom: true, created_at: true },
          orderBy: { created_at: 'asc' },
        },
      },
    })

    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const disciplineIds = session.disciplines.map((d) => d.id)

    const students = await prisma.student.findMany({
      where: { class_id: session.class_id, organization_id: user.organizationId },
      select: {
        id: true, first_name: true, last_name: true, gender: true,
        ratings: {
          where: { session_discipline_id: { in: disciplineIds } },
          select: { session_discipline_id: true, score: true, comment: true },
        },
      },
      orderBy: { first_name: 'asc' },
    })

    return NextResponse.json({ data: { session, students, disciplines: session.disciplines } })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  try {
    const existing = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: { id: true, topics_covered: true },
    })
    if (!existing) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = UpdateSessionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const updateData: Prisma.ReportSessionUpdateInput = {}
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name
    if (parsed.data.topics_covered !== undefined) updateData.topics_covered = parsed.data.topics_covered
    if (parsed.data.tone !== undefined) updateData.tone = parsed.data.tone
    if (parsed.data.length !== undefined) updateData.length = parsed.data.length
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status
    if (parsed.data.test_filters !== undefined) updateData.test_filters = parsed.data.test_filters as Prisma.InputJsonValue ?? Prisma.JsonNull
    if (parsed.data.progression_filters !== undefined) updateData.progression_filters = parsed.data.progression_filters
    if (parsed.data.enable_progression !== undefined) updateData.enable_progression = parsed.data.enable_progression
    if (parsed.data.allow_negative_progression !== undefined) updateData.allow_negative_progression = parsed.data.allow_negative_progression
    if (parsed.data.class_overview !== undefined) updateData.class_overview = parsed.data.class_overview ?? null

    const newTopics = parsed.data.topics_covered
    const removedTopics = newTopics !== undefined
      ? existing.topics_covered.filter((t) => !newTopics.includes(t))
      : []

    const selectFields = {
      id: true, name: true, topics_covered: true, tone: true, length: true,
      status: true, test_filters: true, progression_filters: true,
      enable_progression: true, allow_negative_progression: true,
      class_overview: true, created_at: true, updated_at: true,
    } as const

    let updated

    if (removedTopics.length > 0) {
      updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.topicRating.deleteMany({
          where: { session_id: sessionId, topic_name: { in: removedTopics } },
        })
        return tx.reportSession.update({ where: { id: sessionId }, data: updateData, select: selectFields })
      })
    } else {
      updated = await prisma.reportSession.update({ where: { id: sessionId }, data: updateData, select: selectFields })
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
