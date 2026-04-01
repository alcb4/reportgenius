import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { studentId } = await params

  try {
    const student = await prisma.student.findFirst({
      where: { id: studentId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!student) return NextResponse.json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' }, { status: 404 })

    const reports = await prisma.report.findMany({
      where: { student_id: studentId, organization_id: user.organizationId },
      select: {
        id: true, status: true, word_count: true, edited_content: true,
        created_at: true, updated_at: true,
        session: {
          select: {
            id: true, name: true,
            class: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ data: reports })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
