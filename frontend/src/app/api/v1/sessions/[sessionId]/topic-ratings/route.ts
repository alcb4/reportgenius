import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

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
      select: { id: true, topics_covered: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const topicRatings = await prisma.topicRating.findMany({
      where: { session_id: sessionId, organization_id: user.organizationId },
      select: { student_id: true, topic_name: true, score: true },
      orderBy: [{ student_id: 'asc' }, { topic_name: 'asc' }],
    })

    return NextResponse.json({
      topics: session.topics_covered,
      ratings: topicRatings.map((r) => ({ studentId: r.student_id, topicName: r.topic_name, score: r.score })),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
