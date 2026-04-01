import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  try {
    // Hard delete in correct FK cascade order within a single transaction
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Delete all data tied to the organisation
      // Prisma cascade handles the child tables via onDelete: Cascade on the schema,
      // but we delete session-level data explicitly for clarity.

      const orgId = user.organizationId

      // Reports (includes llm data)
      await tx.report.deleteMany({ where: { organization_id: orgId } })

      // Ratings
      await tx.rating.deleteMany({
        where: { student: { organization_id: orgId } },
      })

      // Topic ratings
      await tx.topicRating.deleteMany({ where: { organization_id: orgId } })

      // Test results — via tests which are in classes
      const classIds = await tx.class.findMany({
        where: { organization_id: orgId },
        select: { id: true },
      })
      const classIdList = classIds.map((c) => c.id)

      const testIds = await tx.test.findMany({
        where: { class_id: { in: classIdList } },
        select: { id: true },
      })
      await tx.testResult.deleteMany({ where: { test_id: { in: testIds.map((t) => t.id) } } })
      await tx.test.deleteMany({ where: { id: { in: testIds.map((t) => t.id) } } })

      // Session disciplines
      const sessionIds = await tx.reportSession.findMany({
        where: { organization_id: orgId },
        select: { id: true },
      })
      await tx.sessionDiscipline.deleteMany({ where: { session_id: { in: sessionIds.map((s) => s.id) } } })

      // Sessions, students, classes
      await tx.reportSession.deleteMany({ where: { organization_id: orgId } })
      await tx.student.deleteMany({ where: { organization_id: orgId } })
      await tx.class.deleteMany({ where: { organization_id: orgId } })

      // User
      await tx.user.deleteMany({ where: { organization_id: orgId } })

      // Organisation itself
      await tx.organization.delete({ where: { id: orgId } })
    })

    console.log(JSON.stringify({
      event: 'account.deleted',
      userId: user.userId,
      organizationId: user.organizationId,
    }))

    return NextResponse.json({ ok: true, message: 'Your account and all data has been permanently deleted.' })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
