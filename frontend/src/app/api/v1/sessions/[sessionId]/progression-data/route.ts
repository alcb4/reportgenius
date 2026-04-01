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
  const { searchParams } = new URL(req.url)
  const studentIdParam = searchParams.get('studentId')
  const requestedStudentId = studentIdParam && studentIdParam.length > 0 ? studentIdParam : null

  try {
    const currentSession = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: {
        id: true,
        class_id: true,
        disciplines: { select: { id: true, name: true }, orderBy: { created_at: 'asc' } },
      },
    })
    if (!currentSession) {
      return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })
    }

    const previousSession = await prisma.reportSession.findFirst({
      where: {
        class_id: currentSession.class_id,
        organization_id: user.organizationId,
        status: 'complete',
        id: { not: sessionId },
      },
      select: {
        id: true,
        name: true,
        updated_at: true,
        disciplines: { select: { id: true, name: true }, orderBy: { created_at: 'asc' } },
      },
      orderBy: { updated_at: 'desc' },
    })

    if (!previousSession) {
      return NextResponse.json({ previousSession: null, matchedDisciplines: [] })
    }

    let resolvedStudentId: string | null = requestedStudentId

    if (!resolvedStudentId) {
      const currentDisciplineIds = currentSession.disciplines.map((d) => d.id)
      const firstRating = await prisma.rating.findFirst({
        where: { session_discipline_id: { in: currentDisciplineIds } },
        select: { student_id: true },
      })
      resolvedStudentId = firstRating?.student_id ?? null
    }

    if (!resolvedStudentId) {
      return NextResponse.json({
        previousSession: { id: previousSession.id, name: previousSession.name, completed_at: previousSession.updated_at },
        matchedDisciplines: [],
      })
    }

    const studentCheck = await prisma.student.findFirst({
      where: { id: resolvedStudentId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!studentCheck) {
      return NextResponse.json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' }, { status: 404 })
    }

    const currentDisciplineIds = currentSession.disciplines.map((d) => d.id)
    const previousDisciplineIds = previousSession.disciplines.map((d) => d.id)

    const [currentRatings, previousRatings] = await Promise.all([
      prisma.rating.findMany({
        where: { student_id: resolvedStudentId, session_discipline_id: { in: currentDisciplineIds } },
        select: { score: true, session_discipline: { select: { name: true } } },
      }),
      prisma.rating.findMany({
        where: { student_id: resolvedStudentId, session_discipline_id: { in: previousDisciplineIds } },
        select: { score: true, session_discipline: { select: { name: true } } },
      }),
    ])

    const currentScoreByName = new Map<string, number>()
    for (const r of currentRatings) currentScoreByName.set(r.session_discipline.name, r.score)

    const previousScoreByName = new Map<string, number>()
    for (const r of previousRatings) previousScoreByName.set(r.session_discipline.name, r.score)

    type Trend = 'improved' | 'declined' | 'maintained'
    const matchedDisciplines: Array<{ name: string; currentScore: number; previousScore: number; trend: Trend }> = []

    for (const [name, currentScore] of currentScoreByName) {
      const previousScore = previousScoreByName.get(name)
      if (previousScore === undefined) continue
      const trend: Trend = currentScore > previousScore ? 'improved' : currentScore < previousScore ? 'declined' : 'maintained'
      matchedDisciplines.push({ name, currentScore, previousScore, trend })
    }

    return NextResponse.json({
      previousSession: { id: previousSession.id, name: previousSession.name, completed_at: previousSession.updated_at },
      matchedDisciplines,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
