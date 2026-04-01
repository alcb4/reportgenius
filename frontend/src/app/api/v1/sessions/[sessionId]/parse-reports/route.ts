import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { rateLimitOrNull } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

const ParseReportsSchema = z.object({
  // ~500 words × 30 students × 8 chars/word ≈ 120 KB; cap at 200 KB
  raw: z.string().min(1).max(200_000, 'Pasted content is too large'),
  studentIds: z.array(z.string().min(1)).min(1).max(200, 'Too many student IDs in one batch'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const limited = await rateLimitOrNull(req, 'llm', 'parse-reports')
  if (limited) return limited

  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId } = await params

  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: user.organizationId },
    select: { id: true },
  })
  if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

  try {
    const body = await req.json()
    const parsed = ParseReportsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { raw, studentIds } = parsed.data

    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, organization_id: user.organizationId },
      select: { id: true, first_name: true, anonymous_token: true },
    })
    const studentMap = new Map(students.map((s) => [s.id, s]))

    // Strip markdown fences and extract JSON array
    let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const firstBracket = cleaned.indexOf('[')
    const lastBracket = cleaned.lastIndexOf(']')

    if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
      return NextResponse.json(
        {
          error: 'Could not parse response as JSON',
          hint: 'The response must contain a JSON array [ ... ]. Make sure you copied the full response from the AI tool.',
          code: 'PARSE_ERROR',
        },
        { status: 422 }
      )
    }

    cleaned = cleaned.slice(firstBracket, lastBracket + 1)

    let items: unknown
    try {
      items = JSON.parse(cleaned)
    } catch {
      return NextResponse.json(
        {
          error: 'Could not parse response as JSON',
          hint: 'The JSON was malformed. Try copying the response again — make sure no text is cut off.',
          code: 'PARSE_ERROR',
        },
        { status: 422 }
      )
    }

    if (!Array.isArray(items)) {
      return NextResponse.json(
        {
          error: 'Response is not a JSON array',
          hint: 'Expected a JSON array like: [{ "studentId": "...", "report": "..." }]',
          code: 'PARSE_ERROR',
        },
        { status: 422 }
      )
    }

    interface ParseItemResult {
      studentId: string
      name: string
      success: boolean
      error?: string
    }

    const results: ParseItemResult[] = []
    let savedCount = 0
    let failedCount = 0

    for (const item of items) {
      if (
        item === null ||
        typeof item !== 'object' ||
        !('studentId' in item) ||
        !('report' in item) ||
        typeof (item as Record<string, unknown>)['studentId'] !== 'string' ||
        typeof (item as Record<string, unknown>)['report'] !== 'string'
      ) {
        failedCount++
        results.push({ studentId: 'unknown', name: 'Unknown', success: false, error: 'Invalid item structure — missing studentId or report' })
        continue
      }

      const typedItem = item as { studentId: string; report: string }
      const student = studentMap.get(typedItem.studentId)

      if (!student) {
        failedCount++
        results.push({ studentId: typedItem.studentId, name: typedItem.studentId, success: false, error: 'Student ID not found in this session' })
        continue
      }

      if (!studentIds.includes(typedItem.studentId)) {
        failedCount++
        results.push({ studentId: typedItem.studentId, name: student.first_name, success: false, error: 'Student ID not in the requested batch' })
        continue
      }

      const reportText = typedItem.report.trim()
      if (!reportText) {
        failedCount++
        results.push({ studentId: typedItem.studentId, name: student.first_name, success: false, error: 'Empty report text' })
        continue
      }

      const wordCount = reportText.split(/\s+/).filter(Boolean).length

      try {
        const upserted = await prisma.report.upsert({
          where: { session_id_student_id: { session_id: sessionId, student_id: typedItem.studentId } },
          create: {
            organization_id: user.organizationId,
            student_id: typedItem.studentId,
            session_id: sessionId,
            anonymous_token: student.anonymous_token,
            llm_model: 'free_model',
            llm_prompt: null,
            llm_raw_response: raw,
            edited_content: reportText,
            status: 'draft',
            word_count: wordCount,
          },
          update: {
            llm_model: 'free_model',
            llm_raw_response: raw,
            edited_content: reportText,
            status: 'draft',
            word_count: wordCount,
          },
          select: { id: true },
        })

        console.log(JSON.stringify({
          event: 'parse_reports.upsert_success',
          sessionId,
          studentId: typedItem.studentId,
          reportId: upserted.id,
          organizationId: user.organizationId,
        }))

        savedCount++
        results.push({ studentId: typedItem.studentId, name: student.first_name, success: true })
      } catch (dbErr) {
        failedCount++
        results.push({ studentId: typedItem.studentId, name: student.first_name, success: false, error: 'Database error saving report' })
        console.error(dbErr)
      }
    }

    console.log(JSON.stringify({
      event: 'reports.parse_and_save',
      sessionId,
      organizationId: user.organizationId,
      saved: savedCount,
      failed: failedCount,
    }))

    return NextResponse.json({ results, saved: savedCount, failed: failedCount })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
