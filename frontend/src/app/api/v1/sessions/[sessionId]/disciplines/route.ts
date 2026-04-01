import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

const AddDisciplineSchema = z.object({
  templateId: z.string().uuid().optional(),
  name: z.string().min(1, 'Discipline name is required').max(100).optional(),
  category: z.string().max(100).optional(),
}).refine(
  (data) => data.templateId !== undefined || data.name !== undefined,
  { message: 'Provide either templateId (from library) or name (custom discipline)' }
)

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
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const disciplines = await prisma.sessionDiscipline.findMany({
      where: { session_id: sessionId },
      select: { id: true, name: true, category: true, is_custom: true, created_at: true },
      orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({ data: disciplines })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  try {
    const session = await prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: user.organizationId },
      select: { id: true },
    })
    if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

    const body = await req.json()
    const parsed = AddDisciplineSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    let disciplineName: string
    let disciplineCategory: string | null = null
    let isCustom = false

    if (parsed.data.templateId) {
      const template = await prisma.disciplineTemplate.findUnique({
        where: { id: parsed.data.templateId },
        select: { name: true, category: true },
      })
      if (!template) {
        return NextResponse.json({ error: 'Discipline template not found', code: 'TEMPLATE_NOT_FOUND' }, { status: 404 })
      }
      disciplineName = template.name
      disciplineCategory = template.category
      isCustom = false
    } else {
      disciplineName = parsed.data.name as string
      disciplineCategory = parsed.data.category ?? null
      isCustom = true
    }

    const discipline = await prisma.sessionDiscipline.create({
      data: { session_id: sessionId, name: disciplineName, category: disciplineCategory, is_custom: isCustom },
      select: { id: true, name: true, category: true, is_custom: true, created_at: true },
    })

    return NextResponse.json({ data: discipline }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
