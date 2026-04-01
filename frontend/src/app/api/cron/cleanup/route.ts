import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // Hard delete organisations marked deleted > 30 days ago
  const cutoff30 = new Date(now)
  cutoff30.setDate(cutoff30.getDate() - 30)

  const deletedOrgs = await prisma.organization.deleteMany({
    where: { deleted_at: { lte: cutoff30 } },
  })

  // Delete report sessions older than end of last academic year (July, 1 year back)
  const cutoffSessions = new Date(now)
  cutoffSessions.setFullYear(cutoffSessions.getFullYear() - 1)
  cutoffSessions.setMonth(6) // July

  const deletedSessions = await prisma.reportSession.deleteMany({
    where: { created_at: { lte: cutoffSessions } },
  })

  console.log(JSON.stringify({
    event: 'cron.cleanup',
    deletedOrgs: deletedOrgs.count,
    deletedSessions: deletedSessions.count,
    ran: now.toISOString(),
  }))

  return NextResponse.json({ ok: true, ran: now.toISOString(), deletedOrgs: deletedOrgs.count, deletedSessions: deletedSessions.count })
}
