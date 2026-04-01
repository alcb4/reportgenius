import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string; testId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId, testId } = await params

  try {
    const classRow = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!classRow) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const test = await prisma.test.findFirst({
      where: { id: testId, class_id: classId },
      select: {
        id: true, name: true, topics: true, max_mark: true, grade_boundaries: true, created_at: true,
        _count: { select: { results: true } },
      },
    })
    if (!test) return NextResponse.json({ error: 'Test not found', code: 'TEST_NOT_FOUND' }, { status: 404 })

    return NextResponse.json({ data: test })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
