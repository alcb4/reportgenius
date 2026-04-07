import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CreateSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required').max(255),
  topics_covered: z.array(z.string()).optional().default([]),
  tone: z.enum(['gentle', 'balanced', 'direct']).optional().default('balanced'),
  length: z.enum(['short', 'medium', 'long']).optional().default('medium'),
  templateDisciplineIds: z.array(z.string().uuid()).optional().default([]),
  customDisciplines: z.array(z.object({
    name: z.string().min(1).max(100),
    category: z.string().max(100).optional(),
  })).optional().default([]),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  try {
    const cls = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!cls) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const sessions = await prisma.reportSession.findMany({
      where: { class_id: classId, organization_id: user.organizationId },
      select: {
        id: true, name: true, topics_covered: true, tone: true, length: true,
        status: true, is_template: true, source_template_id: true, created_at: true, updated_at: true,
        _count: { select: { disciplines: true, reports: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ data: sessions })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  try {
    const cls = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!cls) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = CreateSessionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { name, topics_covered, tone, length, templateDisciplineIds, customDisciplines } = parsed.data

    let templateDisciplines: Array<{ name: string; category: string | null }> = []
    if (templateDisciplineIds.length > 0) {
      const templates = await prisma.disciplineTemplate.findMany({
        where: { id: { in: templateDisciplineIds } },
        select: { name: true, category: true },
      })
      templateDisciplines = templates
    }

    const disciplineData = [
      ...templateDisciplines.map((t) => ({ name: t.name, category: t.category, is_custom: false })),
      ...customDisciplines.map((c) => ({ name: c.name, category: c.category ?? null, is_custom: true })),
    ]

    const session = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.reportSession.create({
        data: {
          organization_id: user.organizationId,
          class_id: classId,
          name,
          topics_covered,
          tone,
          length,
          status: 'draft',
          progression_filters: [],
        },
        select: {
          id: true, organization_id: true, class_id: true, name: true,
          topics_covered: true, tone: true, length: true, status: true,
          created_at: true, updated_at: true,
        },
      })

      if (disciplineData.length > 0) {
        await tx.sessionDiscipline.createMany({
          data: disciplineData.map((d) => ({
            session_id: created.id,
            name: d.name,
            category: d.category,
            is_custom: d.is_custom,
          })),
        })
      }

      const disciplines = await tx.sessionDiscipline.findMany({
        where: { session_id: created.id },
        select: { id: true, name: true, category: true, is_custom: true, created_at: true },
        orderBy: { created_at: 'asc' },
      })

      return { ...created, disciplines, _count: { disciplines: disciplines.length, reports: 0 } }
    })

    return NextResponse.json({ data: session }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
