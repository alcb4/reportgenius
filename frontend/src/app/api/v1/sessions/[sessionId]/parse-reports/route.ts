import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { rateLimitOrNull } from '@/lib/ratelimit'
import { getAliasMap, validateAndRemapResponse, buildAliasToNameMap, replaceAliasesInText } from '@/lib/services/alias.service'

export const dynamic = 'force-dynamic'

// Hard limits — protect against accidental or malicious oversized payloads.
// 500 KB is generous for a full class batch (~500 words × 50 students × 8 chars/word ≈ 200 KB).
const MAX_RAW_BYTES = 500_000   // 500 KB character cap
const MAX_REPORTS_PER_BATCH = 50 // max items in the parsed JSON array

const ParseReportsSchema = z.object({
  raw: z
    .string()
    .min(1)
    .max(MAX_RAW_BYTES, 'Pasted content is too large'),
  studentIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_REPORTS_PER_BATCH, `Too many student IDs — maximum ${MAX_REPORTS_PER_BATCH} per batch`),
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

    // Get alias map for this session and remap LLM response
    const aliasMap = await getAliasMap(sessionId)
    const validation = validateAndRemapResponse(raw, aliasMap, studentIds)

    // Build alias→name map for replacing aliases back to real names in report text
    const allClassStudents = await prisma.student.findMany({
      where: { class_id: (await prisma.reportSession.findFirst({
        where: { id: sessionId },
        select: { class_id: true },
      }))?.class_id },
      select: { id: true, first_name: true },
    })
    const aliasToName = buildAliasToNameMap(allClassStudents, aliasMap)

    // Guard: reject if the parsed array itself exceeds the per-batch cap.
    if (validation.reports.length + validation.errors.length > MAX_REPORTS_PER_BATCH) {
      console.warn(JSON.stringify({
        event: 'parse_reports.input_too_large',
        sessionId,
        organizationId: user.organizationId,
        itemsReceived: validation.reports.length + validation.errors.length,
        rawLengthChars: raw.length,
        cap: MAX_REPORTS_PER_BATCH,
      }))
      return NextResponse.json(
        {
          error: `Input exceeds maximum allowed size — received ${validation.reports.length + validation.errors.length} report items, maximum is ${MAX_REPORTS_PER_BATCH}`,
          code: 'INPUT_TOO_LARGE',
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

    // Process validation errors
    for (const err of validation.errors) {
      failedCount++
      const sid = err.studentId ?? 'unknown'
      const student = studentMap.get(sid)
      results.push({
        studentId: sid,
        name: student?.first_name ?? err.alias ?? 'Unknown',
        success: false,
        error: err.error,
      })
    }

    // Save remapped reports
    for (const remapped of validation.reports) {
      const student = studentMap.get(remapped.studentId)
      if (!student) {
        failedCount++
        results.push({ studentId: remapped.studentId, name: 'Unknown', success: false, error: 'Student not found after remap' })
        continue
      }

      if (!studentIds.includes(remapped.studentId)) {
        failedCount++
        results.push({ studentId: remapped.studentId, name: student.first_name, success: false, error: 'Student not in the requested batch' })
        continue
      }

      const reportText = replaceAliasesInText(remapped.report, aliasToName)
      const wordCount = reportText.split(/\s+/).filter(Boolean).length

      try {
        const upserted = await prisma.report.upsert({
          where: { session_id_student_id: { session_id: sessionId, student_id: remapped.studentId } },
          create: {
            organization_id: user.organizationId,
            student_id: remapped.studentId,
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
          studentId: remapped.studentId,
          reportId: upserted.id,
          organizationId: user.organizationId,
        }))

        savedCount++
        results.push({ studentId: remapped.studentId, name: student.first_name, success: true })
      } catch (dbErr) {
        failedCount++
        results.push({ studentId: remapped.studentId, name: student.first_name, success: false, error: 'Database error saving report' })
        console.error(dbErr)
      }
    }

    console.log(JSON.stringify({
      event: 'reports.parse_and_save',
      sessionId,
      organizationId: user.organizationId,
      saved: savedCount,
      failed: failedCount,
      flaggedForReview: validation.flaggedForReview,
      reviewReasons: validation.reviewReasons,
    }))

    return NextResponse.json({
      results,
      saved: savedCount,
      failed: failedCount,
      flaggedForReview: validation.flaggedForReview,
      reviewReasons: validation.reviewReasons,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
