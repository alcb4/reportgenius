import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; disciplineId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId, disciplineId } = await params

  try {
    const session = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const discipline = await prisma.sessionDiscipline.findFirst({
      where: { id: disciplineId, session_id: sessionId },
      select: { id: true },
    })
    if (!discipline) {
      return NextResponse.json({ error: 'Discipline not found in this session', code: 'DISCIPLINE_NOT_FOUND' }, { status: 404 })
    }

    const ratingCount = await prisma.rating.count({ where: { session_discipline_id: disciplineId } })
    if (ratingCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete discipline with existing ratings. Delete ratings first.', code: 'DISCIPLINE_HAS_RATINGS' },
        { status: 409 }
      )
    }

    await prisma.sessionDiscipline.delete({ where: { id: disciplineId } })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
