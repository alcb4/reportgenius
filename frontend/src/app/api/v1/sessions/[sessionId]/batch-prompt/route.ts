import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { formatRatingSummary, buildPrompt } from '@/lib/adapters/llm/prompt-builder'
import { ReportLength, ProgressionItem, TestContextItem } from '@/lib/adapters/llm/types'

export const dynamic = 'force-dynamic'

const StudentIdsSchema = z.union([z.string(), z.array(z.string())]).transform((v) =>
  Array.isArray(v) ? v : [v]
)

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
      select: { id: true, tone: true, length: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const { searchParams } = new URL(req.url)
    const rawStudentIds = searchParams.getAll('studentIds')
    const flatIds = rawStudentIds.flatMap((s) => s.split(','))
    const studentIdsParsed = StudentIdsSchema.safeParse(flatIds.length > 0 ? flatIds : searchParams.get('studentIds'))

    if (!studentIdsParsed.success || studentIdsParsed.data.length === 0) {
      return NextResponse.json({ error: 'studentIds query param required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const studentIds = studentIdsParsed.data

    if (studentIds.length > 5) {
      return NextResponse.json({ error: 'Maximum 5 students per batch prompt', code: 'BATCH_TOO_LARGE' }, { status: 422 })
    }

    const sessionFull = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: {
        tone: true, length: true, topics_covered: true, class_id: true, test_filters: true,
        disciplines: { select: { id: true, name: true }, orderBy: { created_at: 'asc' } },
        tests: { select: { id: true, name: true } },
      },
    })
    if (!sessionFull) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, organization_id: user.organizationId },
      select: { id: true, first_name: true, gender: true },
    })

    if (students.length !== studentIds.length) {
      return NextResponse.json({ error: 'One or more students not found', code: 'STUDENT_NOT_FOUND' }, { status: 404 })
    }

    const disciplineIds = sessionFull.disciplines.map((d) => d.id)

    const [allRatings, allTopicRatings] = await Promise.all([
      prisma.rating.findMany({
        where: { student_id: { in: studentIds }, session_discipline_id: { in: disciplineIds } },
        select: { student_id: true, score: true, comment: true, session_discipline: { select: { name: true } } },
      }),
      prisma.topicRating.findMany({
        where: { session_id: sessionId, student_id: { in: studentIds }, organization_id: user.organizationId },
        select: { student_id: true, topic_name: true, score: true },
        orderBy: { topic_name: 'asc' },
      }),
    ])

    const ratingsByStudent = new Map<string, typeof allRatings>()
    for (const r of allRatings) {
      const arr = ratingsByStudent.get(r.student_id) ?? []
      arr.push(r)
      ratingsByStudent.set(r.student_id, arr)
    }

    const topicsByStudent = new Map<string, typeof allTopicRatings>()
    for (const tr of allTopicRatings) {
      const arr = topicsByStudent.get(tr.student_id) ?? []
      arr.push(tr)
      topicsByStudent.set(tr.student_id, arr)
    }

    const studentPrompts = students.map((student) => {
      const ratings = ratingsByStudent.get(student.id) ?? []
      const topicRatingRows = topicsByStudent.get(student.id) ?? []

      const ratingSummary = formatRatingSummary(
        ratings.map((r) => ({ disciplineName: r.session_discipline.name, score: r.score, comment: r.comment }))
      )

      const topicRatings = topicRatingRows.length > 0
        ? topicRatingRows.map((tr) => ({ topicName: tr.topic_name, score: tr.score }))
        : undefined

      return buildPrompt({
        firstName: student.first_name,
        gender: student.gender ?? 'unspecified',
        ratingSummary,
        topics: sessionFull.topics_covered,
        tone: sessionFull.tone,
        length: sessionFull.length as ReportLength,
        topicRatings,
      })
    })

    const studentSections = students
      .map((student, i) => [`=== STUDENT ${student.id} ===`, studentPrompts[i]].join('\n'))
      .join('\n\n')

    const prompt = [
      `You are a school teacher writing end-of-term report comments.`,
      `Generate reports for ${students.length} student${students.length !== 1 ? 's' : ''}.`,
      ``,
      `CRITICAL INSTRUCTIONS:`,
      `1. Respond ONLY with a valid JSON array. No other text before or after.`,
      `2. Format: [{ "studentId": "<id>", "report": "<text>" }, ...]`,
      `3. Include one object per student in the array.`,
      `4. Follow the per-student instructions below EXACTLY for each student's report.`,
      ``,
      studentSections,
    ].join('\n')

    return NextResponse.json({ prompt })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
