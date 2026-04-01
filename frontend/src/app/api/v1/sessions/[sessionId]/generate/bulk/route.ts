import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate } from '@/lib/authenticate'
import { bulkGenerateReports } from '@/lib/services/bulk-report.service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BulkGenerateSchema = z.object({
  llmProvider: z.enum(['openai', 'claude', 'ollama']).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  try {
    const body = await req.json().catch(() => ({}))
    const parsed = BulkGenerateSchema.safeParse(body)

    const result = await bulkGenerateReports(sessionId, user.organizationId, {
      llmProvider: parsed.success ? parsed.data.llmProvider : undefined,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err: unknown) {
    if (err !== null && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
      const domainErr = err as { statusCode: number; code: string; message: string }
      return NextResponse.json({ error: domainErr.message, code: domainErr.code }, { status: domainErr.statusCode })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
