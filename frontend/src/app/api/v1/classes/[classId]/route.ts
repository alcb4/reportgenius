import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const UpdateClassSchema = z.object({
  name: z.string().min(1, 'Class name is required').max(255).optional(),
  year_group: z.string().max(100).nullable().optional(),
  subject: z.string().max(100).nullable().optional(),
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
      select: {
        id: true, name: true, year_group: true, subject: true,
        archived: true, created_at: true, updated_at: true,
        students: {
          select: { id: true, first_name: true, last_name: true, student_ref_id: true, gender: true, created_at: true },
          orderBy: { first_name: 'asc' },
        },
        sessions: {
          select: {
            id: true, name: true, topics_covered: true, tone: true, length: true,
            status: true, is_template: true, source_template_id: true, created_at: true, updated_at: true,
            _count: { select: { disciplines: true, reports: true } },
          },
          orderBy: { created_at: 'desc' },
        },
      },
    })

    if (!cls) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    return NextResponse.json({ data: cls })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { classId } = await params

  try {
    const existing = await prisma.class.findFirst({
      where: { id: classId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Class not found', code: 'CLASS_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = UpdateClassSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const updated = await prisma.class.update({
      where: { id: classId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.year_group !== undefined ? { year_group: parsed.data.year_group } : {}),
        ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
      },
      select: { id: true, name: true, year_group: true, subject: true, archived: true, created_at: true, updated_at: true },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
