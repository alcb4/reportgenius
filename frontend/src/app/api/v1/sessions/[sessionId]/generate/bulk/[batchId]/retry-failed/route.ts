import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/authenticate'
import { retryFailedJobs } from '@/lib/services/bulk-report.service'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; batchId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { batchId } = await params

  try {
    const result = await retryFailedJobs(batchId, user.organizationId)
    return NextResponse.json(result)
  } catch (err: unknown) {
    if (err !== null && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
      const domainErr = err as { statusCode: number; code: string; message: string }
      return NextResponse.json({ error: domainErr.message, code: domainErr.code }, { status: domainErr.statusCode })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
