import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const CreateStudentSchema = z.object({
  first_name: z.string().min(1, 'first_name is required').max(100),
  last_name: z.string().max(100).optional(),
  student_ref_id: z.string().max(100).optional(),
  gender: z.string().max(20).optional(),
  internal_notes: z.string().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  try {
    const cls = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!cls) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const students = await prisma.student.findMany({
      where: { class_id: classId, organization_id: user.organizationId },
      select: {
        id: true, first_name: true, last_name: true, student_ref_id: true,
        gender: true, created_at: true, updated_at: true,
      },
      orderBy: { first_name: 'asc' },
    })

    return NextResponse.json({ data: students })
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
    const cls = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!cls) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = CreateStudentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { first_name, last_name, student_ref_id, gender, internal_notes } = parsed.data

    const student = await prisma.student.create({
      data: {
        organization_id: user.organizationId,
        class_id: classId,
        first_name,
        last_name: last_name ?? null,
        student_ref_id: student_ref_id ?? null,
        gender: gender ?? null,
        internal_notes: internal_notes ?? null,
        anonymous_token: randomUUID(),
      },
      select: {
        id: true, first_name: true, last_name: true, student_ref_id: true,
        gender: true, created_at: true, updated_at: true,
      },
    })

    return NextResponse.json({ data: student }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
