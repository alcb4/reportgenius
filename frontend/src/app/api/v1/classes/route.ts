import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const CreateClassSchema = z.object({
  name: z.string().min(1, 'Class name is required').max(255),
  year_group: z.string().max(100).optional(),
  subject: z.string().max(100).optional(),
})

export async function GET(req: NextRequest) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  try {
    const classes = await prisma.class.findMany({
      where: { organization_id: user.organizationId },
      select: {
        id: true, name: true, year_group: true, subject: true,
        archived: true, created_at: true, updated_at: true,
        _count: { select: { students: true, sessions: true } },
      },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ data: classes })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  try {
    const body = await req.json()
    const parsed = CreateClassSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { name, year_group, subject } = parsed.data
    const newClass = await prisma.class.create({
      data: { organization_id: user.organizationId, name, year_group: year_group ?? null, subject: subject ?? null, archived: false },
      select: { id: true, name: true, year_group: true, subject: true, archived: true, created_at: true, updated_at: true },
    })

    return NextResponse.json({ data: newClass }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
