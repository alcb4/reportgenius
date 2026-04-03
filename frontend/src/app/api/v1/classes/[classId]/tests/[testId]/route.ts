import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const UpdateTestSchema = z.object({
  name: z.string().min(1, 'Test name is required').max(255).optional(),
  topics: z.array(z.string()).optional(),
  max_mark: z.number().int().min(1).optional(),
  grade_boundaries: z.record(z.number()).optional(),
})

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

export async function PUT(
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

    const existing = await prisma.test.findFirst({
      where: { id: testId, class_id: classId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Test not found', code: 'TEST_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = UpdateTestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const updated = await prisma.test.update({
      where: { id: testId },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.topics !== undefined && { topics: parsed.data.topics }),
        ...(parsed.data.max_mark !== undefined && { max_mark: parsed.data.max_mark }),
        ...(parsed.data.grade_boundaries !== undefined && { grade_boundaries: parsed.data.grade_boundaries }),
      },
      select: {
        id: true, name: true, topics: true, max_mark: true, grade_boundaries: true, created_at: true,
        _count: { select: { results: true } },
      },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function DELETE(
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

    const existing = await prisma.test.findFirst({
      where: { id: testId, class_id: classId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Test not found', code: 'TEST_NOT_FOUND' }, { status: 404 })

    await prisma.test.delete({ where: { id: testId } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
