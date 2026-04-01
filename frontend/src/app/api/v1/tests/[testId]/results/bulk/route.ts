import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const BulkTestResultsSchema = z.object({
  results: z.array(z.object({
    studentId: z.string().uuid(),
    score: z.number().int().min(0),
    comment: z.string().optional().nullable(),
  })),
})

function computeGrade(
  score: number,
  maxMark: number,
  boundaries: Record<string, number>
): { percentage: number; grade: string | null } {
  const percentage = maxMark > 0 ? Math.round((score / maxMark) * 100) : 0
  const sorted = Object.entries(boundaries)
    .map(([grade, threshold]) => ({ grade, threshold }))
    .sort((a, b) => b.threshold - a.threshold)
  const grade = sorted.find((b) => percentage >= b.threshold)?.grade ?? null
  return { percentage, grade }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ testId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { testId } = await params

  try {
    const test = await prisma.test.findFirst({
      where: { id: testId, class: { organization_id: user.organizationId } },
      select: { id: true, max_mark: true, grade_boundaries: true },
    })
    if (!test) return NextResponse.json({ error: 'Test not found', code: 'TEST_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = BulkTestResultsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const boundaries = (test.grade_boundaries ?? {}) as Record<string, number>

    const upserts = parsed.data.results.map((r) => {
      const calculated = computeGrade(r.score, test.max_mark, boundaries)
      return prisma.testResult.upsert({
        where: { test_id_student_id: { test_id: testId, student_id: r.studentId } },
        create: { test_id: testId, student_id: r.studentId, score: r.score, comment: r.comment ?? null, calculated },
        update: { score: r.score, comment: r.comment ?? null, calculated },
        select: { id: true, student_id: true, score: true, calculated: true },
      })
    })

    const savedResults = await prisma.$transaction(upserts)

    return NextResponse.json({ data: savedResults, count: savedResults.length })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
