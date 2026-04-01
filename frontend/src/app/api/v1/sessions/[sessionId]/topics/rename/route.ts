import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const RenameTopicSchema = z.object({
  oldName: z.string().min(1).max(255),
  newName: z.string().min(1).max(255),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: user.organizationId },
    select: { id: true, topics_covered: true },
  })
  if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

  try {
    const body = await req.json()
    const parsed = RenameTopicSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 422 }
      )
    }

    const { oldName, newName } = parsed.data

    if (!session.topics_covered.includes(oldName)) {
      return NextResponse.json(
        { error: `Topic "${oldName}" does not exist in this session`, code: 'TOPIC_NOT_FOUND' },
        { status: 422 }
      )
    }

    if (session.topics_covered.includes(newName)) {
      return NextResponse.json(
        { error: `Topic "${newName}" already exists in this session`, code: 'TOPIC_ALREADY_EXISTS' },
        { status: 422 }
      )
    }

    const updatedTopics = session.topics_covered.map((t) => (t === oldName ? newName : t))

    const { renamedRatingsCount } = await prisma.$transaction(async (tx) => {
      await tx.reportSession.update({
        where: { id: sessionId },
        data: { topics_covered: updatedTopics },
      })

      const { count } = await tx.topicRating.updateMany({
        where: { session_id: sessionId, topic_name: oldName },
        data: { topic_name: newName },
      })

      return { renamedRatingsCount: count }
    })

    console.log(JSON.stringify({
      event: 'session.topic.renamed',
      sessionId,
      organizationId: user.organizationId,
      oldName,
      newName,
      renamedRatingsCount,
    }))

    return NextResponse.json({ data: { renamedRatingsCount } })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
