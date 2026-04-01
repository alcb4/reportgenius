import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  try {
    const templates = await prisma.disciplineTemplate.findMany({
      select: { id: true, category: true, name: true, is_default: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })

    const grouped: Record<string, Array<{ id: string; name: string; is_default: boolean }>> = {}
    for (const t of templates) {
      if (!grouped[t.category]) grouped[t.category] = []
      grouped[t.category]!.push({ id: t.id, name: t.name, is_default: t.is_default })
    }

    const data = Object.entries(grouped).map(([category, disciplines]) => ({ category, disciplines }))

    return NextResponse.json({ data, total: templates.length })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
