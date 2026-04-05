import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { createLLMAdapter } from '@/lib/adapters/llm/factory'
import { buildPrompt, resolveTestInstructionFromConfig } from '@/lib/adapters/llm/prompt-builder'
import { ReportLength, RawRating, ProgressionItem, TestContextItem } from '@/lib/adapters/llm/types'
import { decryptApiKey } from '@/lib/encryption'
import { rateLimitOrNull } from '@/lib/ratelimit'
import { getOrCreateAliases, buildNameReplacementMap, buildAliasToNameMap, replaceAliasesInText } from '@/lib/services/alias.service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RegenerateSchema = z.object({
  filters: z.object({
    disciplineIds: z.array(z.string()).optional(),
    tone: z.enum(['gentle', 'balanced', 'direct']).optional(),
    overviewSummary: z.string().max(2000).optional(),
  }).optional(),
  customNote: z.string().max(1000).optional(),
})

function sanitiseLlmResponse(raw: string): string {
  const lines = raw.split('\n')
  const firstLine = lines[0].trim()
  const isTitleLine =
    /^(\*{1,2})?student report[:\s]/i.test(firstLine) || /^#{1,3}\s/.test(firstLine)
  if (isTitleLine) {
    let rest = lines.slice(1)
    while (rest.length > 0 && rest[0].trim() === '') rest = rest.slice(1)
    return rest.join('\n').trim()
  }
  return raw.trim()
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; studentId: string }> }
) {
  const limited = await rateLimitOrNull(req, 'llm', 'regenerate')
  if (limited) return limited

  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  const { sessionId, studentId } = await params

  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: user.organizationId },
    select: {
      id: true,
      tone: true,
      length: true,
      topics_covered: true,
      class_id: true,
      class_overview: true,
      progression_filters: true,
      test_filters: true,
      disciplines: { select: { id: true, name: true }, orderBy: { created_at: 'asc' } },
    },
  })
  if (!session) return NextResponse.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, { status: 404 })

  try {
    const body = await req.json().catch(() => ({}))
    const parsed = RegenerateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { filters, customNote } = parsed.data

    const student = await prisma.student.findFirst({
      where: { id: studentId, organization_id: user.organizationId },
      select: { id: true, first_name: true, gender: true, anonymous_token: true },
    })
    if (!student) return NextResponse.json({ error: 'Student not found', code: 'STUDENT_NOT_FOUND' }, { status: 404 })

    // Determine active disciplines (apply filter if provided)
    const allDisciplineIds = session.disciplines.map((d) => d.id)
    let activeDisciplineIds = allDisciplineIds
    if (filters?.disciplineIds && filters.disciplineIds.length > 0) {
      const filterSet = new Set(filters.disciplineIds)
      activeDisciplineIds = session.disciplines.filter((d) => filterSet.has(d.id)).map((d) => d.id)
    }

    const ratings = await prisma.rating.findMany({
      where: { student_id: studentId, session_discipline_id: { in: activeDisciplineIds } },
      select: {
        score: true,
        comment: true,
        session_discipline: { select: { name: true } },
      },
      orderBy: { session_discipline: { name: 'asc' } },
    })

    if (ratings.length === 0) {
      return NextResponse.json(
        { error: 'Student has no ratings for the selected disciplines — add ratings before generating', code: 'NO_RATINGS' },
        { status: 422 }
      )
    }

    const rawRatings: RawRating[] = ratings.map((r) => ({
      name: r.session_discipline.name,
      score: r.score,
      comment: r.comment,
    }))

    const topicRatingRows = await prisma.topicRating.findMany({
      where: { session_id: sessionId, student_id: studentId, organization_id: user.organizationId },
      select: { topic_name: true, score: true },
      orderBy: { topic_name: 'asc' },
    })
    const topicRatings =
      topicRatingRows.length > 0
        ? topicRatingRows.map((tr) => ({ topicName: tr.topic_name, score: tr.score }))
        : undefined

    // Build test context
    const testFilters = (session.test_filters ?? {}) as Record<string, {
      includeMark?: boolean
      includePercentage?: boolean
      includeGrade?: boolean
      includeLowMention?: boolean
    }>

    // Derive included test IDs from test_filters keys (tests may be class-level with no session_id,
    // so we query by ID directly rather than relying on the session→tests Prisma relation).
    const configuredTestIds = Object.keys(testFilters)
    const allIncludedTests = configuredTestIds.length > 0
      ? await prisma.test.findMany({
          where: { id: { in: configuredTestIds }, class_id: session.class_id },
          select: { id: true, name: true, max_mark: true },
        })
      : []

    const testInstruction = resolveTestInstructionFromConfig(
      testFilters,
      allIncludedTests.map((t) => t.id)
    )

    const scoredTestIds = allIncludedTests
      .filter((t) => {
        const f = testFilters[t.id]
        return f && (f.includePercentage || f.includeGrade || f.includeLowMention || f.includeMark)
      })
      .map((t) => t.id)

    let testContext: TestContextItem[] | undefined
    if (allIncludedTests.length > 0) {
      const testResults = scoredTestIds.length > 0
        ? await prisma.testResult.findMany({
            where: { test_id: { in: scoredTestIds }, student_id: studentId },
            select: { test_id: true, score: true, calculated: true },
          })
        : []
      const resultByTestId = new Map(testResults.map((r) => [r.test_id, r]))
      const items: TestContextItem[] = []
      for (const test of allIncludedTests) {
        const filter = testFilters[test.id]
        const isScored = filter.includePercentage || filter.includeGrade || filter.includeLowMention || filter.includeMark
        if (isScored) {
          const result = resultByTestId.get(test.id)
          if (!result) continue
          const calc = result.calculated as { percentage: number; grade: string | null }
          const item: TestContextItem = { testName: test.name }
          if (filter.includePercentage || filter.includeLowMention) item.percentage = calc.percentage
          if (filter.includeGrade) item.grade = calc.grade
          if (filter.includeLowMention) item.lowMention = true
          if (filter.includeMark) item.mark = `${result.score}/${test.max_mark}`
          items.push(item)
        } else {
          items.push({ testName: test.name })
        }
      }
      if (items.length > 0) testContext = items
    }

    // Build progression data
    let progression: ProgressionItem[] | undefined
    const previousSession = await prisma.reportSession.findFirst({
      where: { class_id: session.class_id, organization_id: user.organizationId, status: 'complete', id: { not: sessionId } },
      select: { id: true, disciplines: { select: { id: true, name: true } } },
      orderBy: { updated_at: 'desc' },
    })

    if (previousSession) {
      const prevDisciplineIds = previousSession.disciplines.map((d) => d.id)
      const [currentRatingsForProg, previousRatings] = await Promise.all([
        prisma.rating.findMany({
          where: { student_id: studentId, session_discipline_id: { in: activeDisciplineIds } },
          select: { score: true, session_discipline: { select: { name: true } } },
        }),
        prisma.rating.findMany({
          where: { student_id: studentId, session_discipline_id: { in: prevDisciplineIds } },
          select: { score: true, session_discipline: { select: { name: true } } },
        }),
      ])
      const currentScoreByName = new Map<string, number>()
      for (const r of currentRatingsForProg) currentScoreByName.set(r.session_discipline.name, r.score)
      const previousScoreByName = new Map<string, number>()
      for (const r of previousRatings) previousScoreByName.set(r.session_discipline.name, r.score)

      const matched: ProgressionItem[] = []
      for (const [name, currentScore] of currentScoreByName) {
        const previousScore = previousScoreByName.get(name)
        if (previousScore === undefined) continue
        const trend: ProgressionItem['trend'] =
          currentScore > previousScore ? 'improved' : currentScore < previousScore ? 'declined' : 'maintained'
        matched.push({ name, trend, previous: previousScore, current: currentScore })
      }
      if (matched.length > 0) progression = matched
    }

    const effectiveTone = filters?.tone ?? session.tone
    const effectiveLength = session.length as ReportLength
    const overviewNote = filters?.overviewSummary?.trim() ?? (session.class_overview?.trim() || undefined)
    const customNoteText = customNote?.trim()

    // Compose context note from optional overview + custom note
    const contextParts: string[] = []
    if (overviewNote) contextParts.push(`Class context: ${overviewNote}`)
    if (customNoteText) contextParts.push(`Additional context: ${customNoteText}`)
    const contextNote = contextParts.length > 0 ? contextParts.join(' — ') : undefined

    const reportPrompt = {
      firstName: student.first_name,
      gender: student.gender ?? 'unspecified',
      ratings: rawRatings,
      topics: session.topics_covered,
      tone: effectiveTone,
      length: effectiveLength,
      topicRatings,
      progression,
      testContext,
      testInstruction,
      contextNote,
    }

    // Apply alias for privacy before sending to LLM
    const aliasMap = await getOrCreateAliases(sessionId, session.class_id, [studentId])
    const alias = aliasMap.studentIdToAlias.get(studentId) ?? student.first_name

    // Fetch all session students for name→alias map
    const sessionStudents = await prisma.student.findMany({
      where: { class_id: session.class_id },
      select: { id: true, first_name: true },
    })
    const nameToAlias = buildNameReplacementMap(sessionStudents, aliasMap)

    const aliasedPrompt = {
      ...reportPrompt,
      firstName: alias,
    }

    const promptText = buildPrompt(aliasedPrompt, nameToAlias)

    // Resolve provider + API key from org DB settings (same source as Settings UI)
    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { settings: true },
    })
    const orgSettings = (org?.settings ?? {}) as Record<string, unknown>
    const provider = (orgSettings.llm_provider as string) ?? process.env.LLM_PROVIDER ?? 'openai'
    const encryptedKey = orgSettings.encrypted_api_key as string | undefined

    let apiKey: string
    if (provider === 'ollama') {
      apiKey = (orgSettings.ollama_url as string) ?? process.env.OLLAMA_URL ?? 'http://localhost:11434'
    } else if (encryptedKey) {
      try {
        apiKey = decryptApiKey(encryptedKey)
      } catch {
        return NextResponse.json({ error: 'Failed to decrypt stored API key', code: 'DECRYPT_ERROR' }, { status: 500 })
      }
    } else {
      apiKey = provider === 'claude' ? (process.env.CLAUDE_API_KEY ?? '') : (process.env.OPENAI_API_KEY ?? '')
    }

    if (provider !== 'ollama' && !apiKey) {
      return NextResponse.json(
        { error: `No API key configured for provider "${provider}". Add one in Settings.`, code: 'LLM_NO_API_KEY' },
        { status: 500 }
      )
    }

    const adapter = createLLMAdapter(provider, apiKey)

    console.log(JSON.stringify({ event: 'report.regenerate.start', sessionId, studentId, organizationId: user.organizationId, provider, tone: effectiveTone }))

    const startMs = Date.now()
    const rawResponse = await adapter.generateReport(reportPrompt)
    const durationMs = Date.now() - startMs

    // Replace aliases back to real names in the LLM response
    const aliasToName = buildAliasToNameMap(sessionStudents, aliasMap)
    const cleanedResponse = sanitiseLlmResponse(replaceAliasesInText(rawResponse, aliasToName))
    const wordCount = cleanedResponse.trim().split(/\s+/).filter(Boolean).length

    // Upsert report
    const existingReport = await prisma.report.findUnique({
      where: { session_id_student_id: { session_id: sessionId, student_id: studentId } },
      select: { id: true },
    })

    let reportId: string
    if (existingReport) {
      await prisma.report.update({
        where: { id: existingReport.id },
        data: { edited_content: cleanedResponse, llm_raw_response: rawResponse, llm_prompt: promptText, word_count: wordCount, ratings_changed_at: null },
      })
      reportId = existingReport.id
    } else {
      const created = await prisma.report.create({
        data: {
          organization_id: user.organizationId,
          student_id: studentId,
          session_id: sessionId,
          anonymous_token: student.anonymous_token,
          llm_model: provider,
          llm_prompt: promptText,
          llm_raw_response: rawResponse,
          edited_content: cleanedResponse,
          status: 'draft',
          word_count: wordCount,
        },
        select: { id: true },
      })
      reportId = created.id
    }

    console.log(JSON.stringify({ event: 'report.regenerate.complete', sessionId, studentId, reportId, organizationId: user.organizationId, durationMs, wordCount }))

    return NextResponse.json({ report: cleanedResponse, reportId })
  } catch (err: unknown) {
    if (err !== null && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
      const domainErr = err as { statusCode: number; code: string; message: string }
      return NextResponse.json({ error: domainErr.message, code: domainErr.code }, { status: domainErr.statusCode })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
