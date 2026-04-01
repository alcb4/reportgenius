import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const CreateSessionTestSchema = z.object({
  name: z.string().min(1, 'Test name is required').max(255),
  topics: z.array(z.string()).optional().default([]),
  max_mark: z.number().int().min(1),
  grade_boundaries: z.record(z.number()).optional().default({}),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: user.organizationId },
    select: { id: true, class_id: true },
  })
  if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

  try {
    const tests = await prisma.test.findMany({
      where: { session_id: sessionId, class_id: session.class_id },
      select: {
        id: true,
        name: true,
        topics: true,
        max_mark: true,
        grade_boundaries: true,
        created_at: true,
        _count: { select: { results: true } },
      },
      orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({ data: tests })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: user.organizationId },
    select: { id: true, class_id: true },
  })
  if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

  try {
    const body = await req.json()
    const parsed = CreateSessionTestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const test = await prisma.test.create({
      data: {
        class_id: session.class_id,
        session_id: sessionId,
        name: parsed.data.name,
        topics: parsed.data.topics,
        max_mark: parsed.data.max_mark,
        grade_boundaries: parsed.data.grade_boundaries,
      },
      select: {
        id: true,
        name: true,
        topics: true,
        max_mark: true,
        grade_boundaries: true,
        session_id: true,
        class_id: true,
        created_at: true,
      },
    })

    console.log(JSON.stringify({
      event: 'test.created_for_session',
      testId: test.id,
      sessionId,
      classId: session.class_id,
      organizationId: user.organizationId,
    }))

    return NextResponse.json({ data: test }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
