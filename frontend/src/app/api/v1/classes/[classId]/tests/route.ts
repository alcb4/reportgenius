import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const CreateTestSchema = z.object({
  name: z.string().min(1, 'Test name is required').max(255),
  topics: z.array(z.string()).optional().default([]),
  max_mark: z.number().int().min(1),
  grade_boundaries: z.record(z.number()).optional().default({}),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  try {
    const classRow = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!classRow) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const tests = await prisma.test.findMany({
      where: { class_id: classId },
      select: {
        id: true, name: true, topics: true, max_mark: true, grade_boundaries: true, created_at: true,
        _count: { select: { results: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ data: tests })
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
    const classRow = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!classRow) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = CreateTestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const test = await prisma.test.create({
      data: {
        class_id: classId,
        name: parsed.data.name,
        topics: parsed.data.topics,
        max_mark: parsed.data.max_mark,
        grade_boundaries: parsed.data.grade_boundaries,
      },
      select: { id: true, name: true, topics: true, max_mark: true, grade_boundaries: true, created_at: true },
    })

    return NextResponse.json({ data: test }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
