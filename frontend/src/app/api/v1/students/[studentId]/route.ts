import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

export async function DELETE(
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

    const finalReportCount = await prisma.report.count({
      where: { student_id: studentId, status: 'final' },
    })

    if (finalReportCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete student with final reports. Archive the session instead.', code: 'STUDENT_HAS_FINAL_REPORTS' },
        { status: 409 }
      )
    }

    await prisma.student.delete({ where: { id: studentId } })

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
