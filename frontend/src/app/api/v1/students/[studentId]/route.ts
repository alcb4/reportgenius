import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const UpdateStudentSchema = z.object({
  first_name: z.string().min(1, 'first_name is required').max(100).optional(),
  last_name: z.string().max(100).nullable().optional(),
  student_ref_id: z.string().max(100).nullable().optional(),
  gender: z.string().max(20).nullable().optional(),
})

export async function PUT(
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

    const body = await req.json()
    const parsed = UpdateStudentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const updateData: Record<string, string | null> = {}
    if (parsed.data.first_name !== undefined) updateData['first_name'] = parsed.data.first_name
    if (parsed.data.last_name !== undefined) updateData['last_name'] = parsed.data.last_name
    if (parsed.data.student_ref_id !== undefined) updateData['student_ref_id'] = parsed.data.student_ref_id
    if (parsed.data.gender !== undefined) updateData['gender'] = parsed.data.gender

    const updated = await prisma.student.update({
      where: { id: studentId },
      data: updateData,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        student_ref_id: true,
        gender: true,
        created_at: true,
      },
    })

    return NextResponse.json({ data: updated }, { status: 200 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

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
