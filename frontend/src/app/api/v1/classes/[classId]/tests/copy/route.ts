import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const CopyTestSchema = z.object({
  testId: z.string().uuid(),
  targetClassId: z.string().uuid(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  try {
    const sourceClass = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!sourceClass) return NextResponse.json({ error: 'Source class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = CopyTestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { testId, targetClassId } = parsed.data

    const sourceTest = await prisma.test.findFirst({
      where: { id: testId, class_id: classId },
      select: { id: true, name: true, topics: true, max_mark: true, grade_boundaries: true },
    })
    if (!sourceTest) return NextResponse.json({ error: 'Test not found', code: 'TEST_NOT_FOUND' }, { status: 404 })

    const targetClass = await prisma.class.findFirst({
      where: { id: targetClassId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!targetClass) return NextResponse.json({ error: 'Target class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const newTest = await prisma.test.create({
      data: {
        class_id: targetClassId,
        name: sourceTest.name,
        topics: sourceTest.topics,
        max_mark: sourceTest.max_mark,
        grade_boundaries: sourceTest.grade_boundaries as Record<string, number>,
      },
      select: { id: true, name: true, class_id: true, created_at: true },
    })

    return NextResponse.json({ data: newTest }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
