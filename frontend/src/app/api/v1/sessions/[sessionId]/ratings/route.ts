import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const BulkRatingsSchema = z.object({
  ratings: z.array(z.object({
    studentId: z.string().uuid('studentId must be a valid UUID'),
    sessionDisciplineId: z.string().uuid('sessionDisciplineId must be a valid UUID'),
    score: z.number().int().min(1).max(5),
    comment: z.string().max(2000).nullish(),
  })).min(1).max(10000),
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
      select: { id: true, class_id: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = BulkRatingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { ratings: incomingRatings } = parsed.data
    const incomingStudentIds = [...new Set(incomingRatings.map((r) => r.studentId))]
    const incomingDisciplineIds = [...new Set(incomingRatings.map((r) => r.sessionDisciplineId))]

    const validStudents = await prisma.student.findMany({
      where: { id: { in: incomingStudentIds }, class_id: session.class_id, organization_id: user.organizationId },
      select: { id: true },
    })
    const validStudentIdSet = new Set(validStudents.map((s) => s.id))
    const invalidStudentId = incomingStudentIds.find((id) => !validStudentIdSet.has(id))
    if (invalidStudentId !== undefined) {
      return NextResponse.json(
        { error: `Student ${invalidStudentId} does not belong to this session's class`, code: 'STUDENT_NOT_IN_CLASS' },
        { status: 422 }
      )
    }

    const validDisciplines = await prisma.sessionDiscipline.findMany({
      where: { id: { in: incomingDisciplineIds }, session_id: sessionId },
      select: { id: true },
    })
    const validDisciplineIdSet = new Set(validDisciplines.map((d) => d.id))
    const invalidDisciplineId = incomingDisciplineIds.find((id) => !validDisciplineIdSet.has(id))
    if (invalidDisciplineId !== undefined) {
      return NextResponse.json(
        { error: `Discipline ${invalidDisciplineId} does not belong to this session`, code: 'DISCIPLINE_NOT_IN_SESSION' },
        { status: 422 }
      )
    }

    const upsertResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingRatings = await tx.rating.findMany({
        where: {
          student_id: { in: incomingStudentIds },
          session_discipline_id: { in: incomingDisciplineIds },
        },
        select: { id: true, student_id: true, session_discipline_id: true },
      })

      const existingMap = new Map<string, string>()
      for (const r of existingRatings) {
        existingMap.set(`${r.student_id}|${r.session_discipline_id}`, r.id)
      }

      const toCreate: Array<{ student_id: string; session_discipline_id: string; score: number; comment: string | null }> = []
      const updatePromises: Array<Promise<unknown>> = []

      for (const rating of incomingRatings) {
        const key = `${rating.studentId}|${rating.sessionDisciplineId}`
        const existingId = existingMap.get(key)

        if (existingId !== undefined) {
          updatePromises.push(
            tx.rating.update({ where: { id: existingId }, data: { score: rating.score, comment: rating.comment ?? null } })
          )
        } else {
          toCreate.push({
            student_id: rating.studentId,
            session_discipline_id: rating.sessionDisciplineId,
            score: rating.score,
            comment: rating.comment ?? null,
          })
        }
      }

      await Promise.all(updatePromises)
      if (toCreate.length > 0) await tx.rating.createMany({ data: toCreate })

      return { updated: updatePromises.length, created: toCreate.length }
    })

    await prisma.report.updateMany({
      where: { session_id: sessionId, student_id: { in: incomingStudentIds }, organization_id: user.organizationId },
      data: { ratings_changed_at: new Date() },
    })

    return NextResponse.json({
      message: 'Ratings saved',
      created: upsertResult.created,
      updated: upsertResult.updated,
      total: incomingRatings.length,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

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
      select: { id: true, class_id: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const [disciplines, students] = await Promise.all([
      prisma.sessionDiscipline.findMany({
        where: { session_id: sessionId },
        select: { id: true, name: true, category: true, is_custom: true },
        orderBy: { created_at: 'asc' },
      }),
      prisma.student.findMany({
        where: { class_id: session.class_id, organization_id: user.organizationId },
        select: {
          id: true, first_name: true, last_name: true, gender: true,
          ratings: {
            where: { session_discipline: { session_id: sessionId } },
            select: { session_discipline_id: true, score: true, comment: true },
          },
        },
        orderBy: { first_name: 'asc' },
      }),
    ])

    return NextResponse.json({ students: students ?? [], disciplines: disciplines ?? [] })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
