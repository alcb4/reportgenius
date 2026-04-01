import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const BulkRatingsSchema = z.object({
  ratings: z.array(z.object({
    studentId: z.string().uuid(),
    topicName: z.string().min(1).max(255),
    score: z.number().int().min(1).max(5),
  })).min(1),
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
      select: { id: true, class_id: true, topics_covered: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = BulkRatingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 422 }
      )
    }

    const { ratings } = parsed.data

    const topicsSet = new Set(session.topics_covered)
    const invalidTopics = ratings.map((r) => r.topicName).filter((t) => !topicsSet.has(t))
    if (invalidTopics.length > 0) {
      return NextResponse.json(
        { error: `Topic(s) not in session: ${[...new Set(invalidTopics)].join(', ')}`, code: 'INVALID_TOPIC' },
        { status: 422 }
      )
    }

    const inputStudentIds = [...new Set(ratings.map((r) => r.studentId))]
    const validStudents = await prisma.student.findMany({
      where: { id: { in: inputStudentIds }, class_id: session.class_id, organization_id: user.organizationId },
      select: { id: true },
    })
    const validStudentIdSet = new Set(validStudents.map((s) => s.id))
    const invalidStudentIds = inputStudentIds.filter((id) => !validStudentIdSet.has(id))
    if (invalidStudentIds.length > 0) {
      return NextResponse.json(
        { error: `Student(s) not in session's class: ${invalidStudentIds.join(', ')}`, code: 'INVALID_STUDENT' },
        { status: 422 }
      )
    }

    const existing = await prisma.topicRating.findMany({
      where: { session_id: sessionId, student_id: { in: inputStudentIds }, organization_id: user.organizationId },
      select: { id: true, student_id: true, topic_name: true },
    })

    const existingMap = new Map<string, string>(
      existing.map((e) => [`${e.student_id}|${e.topic_name}`, e.id])
    )

    const toCreate: Prisma.TopicRatingUncheckedCreateInput[] = []
    const toUpdate: Array<{ id: string; score: number }> = []

    for (const r of ratings) {
      const key = `${r.studentId}|${r.topicName}`
      const existingId = existingMap.get(key)
      if (existingId !== undefined) {
        toUpdate.push({ id: existingId, score: r.score })
      } else {
        toCreate.push({
          organization_id: user.organizationId,
          session_id: sessionId,
          student_id: r.studentId,
          topic_name: r.topicName,
          score: r.score,
        })
      }
    }

    await prisma.$transaction([
      ...toCreate.map((data) => prisma.topicRating.create({ data })),
      ...toUpdate.map(({ id, score }) => prisma.topicRating.update({ where: { id }, data: { score } })),
    ])

    await prisma.report.updateMany({
      where: { session_id: sessionId, student_id: { in: inputStudentIds }, organization_id: user.organizationId },
      data: { ratings_changed_at: new Date() },
    })

    return NextResponse.json({
      data: { created: toCreate.length, updated: toUpdate.length, total: toCreate.length + toUpdate.length },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
