import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const BulkCreateStudentsSchema = z.object({
  students: z.array(
    z.object({
      first_name: z.string().min(1, 'first_name must be at least 1 character').max(100),
      last_name: z.string().min(1, 'last_name must be at least 1 character').max(100),
      student_ref_id: z.string().max(100).nullable().optional(),
      gender: z.string().nullable().optional().transform((val) => {
        if (!val) return null
        const upper = val.trim().toUpperCase()
        if (upper === 'M') return 'M'
        if (upper === 'F') return 'F'
        if (upper === 'OTHER') return 'Other'
        return null
      }),
      internal_notes: z.string().optional(),
    })
  ).min(1, 'students array must not be empty').max(100, 'Cannot import more than 100 students at once'),
})

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
    const parsed = BulkCreateStudentsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const studentsData = parsed.data.students.map((s) => ({
      organization_id: user.organizationId,
      class_id: classId,
      first_name: s.first_name,
      last_name: s.last_name,
      student_ref_id: s.student_ref_id ?? null,
      gender: s.gender ?? null,
      internal_notes: s.internal_notes ?? null,
      anonymous_token: randomUUID(),
    }))

    await prisma.student.createMany({ data: studentsData })

    const created = await prisma.student.findMany({
      where: { class_id: classId, organization_id: user.organizationId },
      select: { id: true, first_name: true, last_name: true, student_ref_id: true, gender: true, created_at: true },
      orderBy: { first_name: 'asc' },
    })

    return NextResponse.json({ data: created, count: studentsData.length }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
