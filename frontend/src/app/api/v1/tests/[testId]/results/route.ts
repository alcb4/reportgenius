import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

export async function GET(
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

    const results = await prisma.testResult.findMany({
      where: { test_id: testId },
      select: {
        id: true, student_id: true, score: true, comment: true, calculated: true,
        student: { select: { id: true, first_name: true, last_name: true, student_ref_id: true } },
      },
      orderBy: { student: { first_name: 'asc' } },
    })

    return NextResponse.json({ data: results })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
