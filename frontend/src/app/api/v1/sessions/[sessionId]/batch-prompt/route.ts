import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { buildBatchPrompt, resolveTestInstructionFromConfig } from '@/lib/adapters/llm/prompt-builder'
import { ReportLength, BatchStudentPayload, TestContextItem } from '@/lib/adapters/llm/types'

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
        tone: true,
        length: true,
        topics_covered: true,
        class_id: true,
        test_filters: true,
        disciplines: { select: { id: true, name: true }, orderBy: { created_at: 'asc' } },
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

    const testFilters = (sessionFull.test_filters ?? {}) as Record<string, {
      includeMark?: boolean
      includePercentage?: boolean
      includeGrade?: boolean
      includeLowMention?: boolean
    }>

    // Derive included test IDs from test_filters keys (tests may be class-level with no session_id,
    // so we query by ID directly rather than relying on the session→tests Prisma relation).
    const configuredTestIds = Object.keys(testFilters)
    const allIncludedTests = configuredTestIds.length > 0
      ? await prisma.test.findMany({
          where: { id: { in: configuredTestIds }, class_id: sessionFull.class_id },
          select: { id: true, name: true, max_mark: true },
        })
      : []

    // Rule 6 instruction derived from config — fires regardless of whether results exist yet
    const testInstruction = resolveTestInstructionFromConfig(
      testFilters,
      allIncludedTests.map((t) => t.id)
    )

    // Only tests with score flags need DB results fetched
    const scoredTestIds = allIncludedTests
      .filter((t) => {
        const f = testFilters[t.id]
        return f && (f.includePercentage || f.includeGrade || f.includeLowMention || f.includeMark)
      })
      .map((t) => t.id)

    const [allRatings, allTopicRatings, allTestResults] = await Promise.all([
      prisma.rating.findMany({
        where: { student_id: { in: studentIds }, session_discipline_id: { in: disciplineIds } },
        select: { student_id: true, score: true, comment: true, session_discipline: { select: { name: true } } },
      }),
      prisma.topicRating.findMany({
        where: { session_id: sessionId, student_id: { in: studentIds }, organization_id: user.organizationId },
        select: { student_id: true, topic_name: true, score: true },
        orderBy: { topic_name: 'asc' },
      }),
      scoredTestIds.length > 0
        ? prisma.testResult.findMany({
            where: { test_id: { in: scoredTestIds }, student_id: { in: studentIds } },
            select: { test_id: true, student_id: true, score: true, calculated: true },
          })
        : Promise.resolve([]),
    ])

    // Group fetched data by student
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

    const testResultsByStudent = new Map<string, Map<string, { score: number; calculated: unknown }>>()
    for (const tr of allTestResults) {
      const byTest = testResultsByStudent.get(tr.student_id) ?? new Map()
      byTest.set(tr.test_id, { score: tr.score, calculated: tr.calculated })
      testResultsByStudent.set(tr.student_id, byTest)
    }

    // Preserve the order of studentIds as passed (deterministic batches)
    const orderedStudents = studentIds
      .map((id) => students.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)

    const batchPayloads: BatchStudentPayload[] = orderedStudents.map((student) => {
      const ratings = ratingsByStudent.get(student.id) ?? []
      const topicRatingRows = topicsByStudent.get(student.id) ?? []
      const studentTestResults = testResultsByStudent.get(student.id)

      const rawRatings = ratings.map((r) => ({
        name: r.session_discipline.name,
        score: r.score,
        comment: r.comment,
      }))

      const topicRatings =
        topicRatingRows.length > 0
          ? topicRatingRows.map((tr) => ({ topicName: tr.topic_name, score: tr.score }))
          : undefined

      let testContext: TestContextItem[] | undefined
      if (allIncludedTests.length > 0) {
        const items: TestContextItem[] = []
        for (const test of allIncludedTests) {
          const filter = testFilters[test.id]
          const isScored = filter.includePercentage || filter.includeGrade || filter.includeLowMention || filter.includeMark
          if (isScored) {
            const result = studentTestResults?.get(test.id)
            if (!result) continue  // no result yet — skip from block (Rule 6 still fires via testInstruction)
            const calc = result.calculated as { percentage: number; grade: string | null }
            const item: TestContextItem = { testName: test.name }
            if (filter.includePercentage || filter.includeLowMention) item.percentage = calc.percentage
            if (filter.includeGrade) item.grade = calc.grade
            if (filter.includeLowMention) item.lowMention = true
            if (filter.includeMark) item.mark = `${result.score}/${test.max_mark}`
            items.push(item)
          } else {
            // Qualitative only — always include with just test name; no result needed
            items.push({ testName: test.name })
          }
        }
        if (items.length > 0) testContext = items
      }

      return {
        id: student.id,
        firstName: student.first_name,
        gender: student.gender ?? 'unspecified',
        ratings: rawRatings,
        topics: sessionFull.topics_covered,
        topicRatings,
        testContext,
      }
    })

    const prompt = buildBatchPrompt(batchPayloads, {
      tone: sessionFull.tone,
      length: sessionFull.length as ReportLength,
      testInstruction,
    })

    return NextResponse.json({ prompt })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
