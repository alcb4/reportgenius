/**
 * Report service — single report generation.
 *
 * generateSingleReport():
 *   1. Fetch student + their ratings for this session's disciplines + session topics
 *      in one Prisma query (no N+1).
 *   2. Build the LLM prompt (only first_name, gender, raw ratings, topics_covered,
 *      testContext, testInstruction, progression). No PII in the prompt.
 *   3. Call the LLM adapter.
 *   4. Persist the new Report row: session_id, anonymous_token, llm_prompt,
 *      llm_raw_response, edited_content (copy of raw), status=draft, word_count.
 *   5. Return the saved report.
 *
 * Multi-tenant isolation: every query filters by organizationId.
 * Privacy: LLM prompt contains ONLY first_name, gender, ratings, topics.
 *   last_name, student_ref_id, internal_notes are NEVER included.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { createLLMAdapter } from "../adapters/llm/factory";
import { buildPrompt, resolveTestInstructionFromConfig } from "../adapters/llm/prompt-builder";
import { ReportLength, RawRating, ProgressionItem, TestContextItem } from "../adapters/llm/types";
import { config } from "../config";

const prisma = new PrismaClient();

export interface GenerateReportOptions {
  tone: string;
  length: ReportLength;
  /** Override the default provider from config for this request. */
  llmProvider?: string;
  /**
   * Optional historical progression items to include in the prompt.
   * Passed through to buildPrompt — no PII, scores + trend only.
   */
  progression?: ProgressionItem[];
}

export interface GeneratedReport {
  id: string;
  organization_id: string;
  student_id: string;
  session_id: string;
  anonymous_token: string;
  llm_model: string | null;
  llm_prompt: string | null;
  llm_raw_response: string | null;
  edited_content: string;
  status: string;
  word_count: number | null;
  created_at: Date;
  updated_at: Date;
}

/** Count words in a string (split on whitespace). */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Strip any leading title line that the LLM may have emitted despite instructions.
 * Handles patterns like:
 *   "Student Report: Alice"
 *   "**Student Report: Alice**"
 *   "## Student Report: Alice"
 *   "# Alice"
 * Strips only the first line if it matches; leaves the rest intact.
 */
function sanitiseLlmResponse(raw: string): string {
  const lines = raw.split("\n");
  const firstLine = lines[0].trim();

  const isTitleLine =
    // "Student Report: ..." with optional surrounding ** or markdown #
    /^(\*{1,2})?student report[:\s]/i.test(firstLine) ||
    // Any markdown heading on the first line: "# ...", "## ...", "### ..."
    /^#{1,3}\s/.test(firstLine);

  if (isTitleLine) {
    // Drop the first line and any immediately following blank lines.
    let rest = lines.slice(1);
    while (rest.length > 0 && rest[0].trim() === "") {
      rest = rest.slice(1);
    }
    return rest.join("\n").trim();
  }

  return raw.trim();
}

/**
 * Generate (or re-generate) a single report for a student within a session.
 * Re-generation creates a NEW Report row; the old one is preserved.
 */
export async function generateSingleReport(
  studentId: string,
  sessionId: string,
  orgId: string,
  options: GenerateReportOptions
): Promise<GeneratedReport> {
  const { tone, length, llmProvider, progression: optionsProgression } = options;
  const provider = llmProvider ?? config.llmProvider;

  // ── 1. Fetch session + student + ratings in one compound query ─────────────
  //    Two parallel queries to avoid deep nesting — zero N+1.
  const [session, student] = await Promise.all([
    prisma.reportSession.findFirst({
      where: { id: sessionId, organization_id: orgId },
      select: {
        id: true,
        class_id: true,
        topics_covered: true,
        tone: true,
        length: true,
        test_filters: true,
        disciplines: {
          select: { id: true, name: true },
          orderBy: { created_at: "asc" },
        },
      },
    }),
    prisma.student.findFirst({
      where: { id: studentId, organization_id: orgId },
      select: {
        id: true,
        first_name: true,
        // last_name intentionally excluded — NEVER goes into LLM prompts.
        gender: true,
        anonymous_token: true,
        // internal_notes intentionally excluded — NEVER goes into LLM prompts.
      },
    }),
  ]);

  if (!session) {
    throw Object.assign(
      new Error("Session not found or does not belong to this organization"),
      { code: "SESSION_NOT_FOUND", statusCode: 404 }
    );
  }

  if (!student) {
    throw Object.assign(
      new Error("Student not found or does not belong to this organization"),
      { code: "STUDENT_NOT_FOUND", statusCode: 404 }
    );
  }

  const disciplineIds = session.disciplines.map((d) => d.id);

  // Fetch ratings for this student in this session's disciplines.
  const ratings = await prisma.rating.findMany({
    where: {
      student_id: studentId,
      session_discipline_id: { in: disciplineIds },
    },
    select: {
      score: true,
      comment: true,
      session_discipline: {
        select: { name: true },
      },
    },
    orderBy: { session_discipline: { name: "asc" } },
  });

  if (ratings.length === 0) {
    throw Object.assign(
      new Error("Student has no ratings for this session — add ratings before generating a report"),
      { code: "NO_RATINGS", statusCode: 422 }
    );
  }

  // ── 2. Build raw ratings array ─────────────────────────────────────────────
  const rawRatings: RawRating[] = ratings.map((r) => ({
    name: r.session_discipline.name,
    score: r.score,
    comment: r.comment,
  }));

  // Fetch topic ratings for this student in this session (score per topic).
  // These are score-only — no PII. Passed to buildPrompt only if present.
  const topicRatingRows = await prisma.topicRating.findMany({
    where: {
      session_id: sessionId,
      student_id: studentId,
      organization_id: orgId,
    },
    select: { topic_name: true, score: true },
    orderBy: { topic_name: "asc" },
  });

  const topicRatings =
    topicRatingRows.length > 0
      ? topicRatingRows.map((tr) => ({
          topicName: tr.topic_name,
          score: tr.score,
        }))
      : undefined;

  // ── 2c. Fetch test context ──────────────────────────────────────────────────
  // testInstruction is derived from config — fires based on what the teacher
  // configured, not on whether students happen to have results yet (Rule 6).
  // testContext is per-student score data shown in the student block.
  const testFilters = (session.test_filters ?? {}) as Record<string, {
    includeMark?: boolean;
    includePercentage?: boolean;
    includeGrade?: boolean;
    includeLowMention?: boolean;
  }>;

  // Derive included test IDs from test_filters keys (tests may be class-level with no session_id,
  // so we query by ID directly rather than relying on the session→tests Prisma relation).
  const configuredTestIds = Object.keys(testFilters);
  const allIncludedTests = configuredTestIds.length > 0
    ? await prisma.test.findMany({
        where: { id: { in: configuredTestIds }, class_id: session.class_id },
        select: { id: true, name: true, max_mark: true },
      })
    : [];

  // Rule 6 instruction derived from config — fires regardless of whether results exist yet
  const testInstruction = resolveTestInstructionFromConfig(
    testFilters,
    allIncludedTests.map((t) => t.id)
  );

  // Tests that need score data fetched (have at least one score flag set)
  const scoredTestIds = allIncludedTests
    .filter((t) => {
      const f = testFilters[t.id];
      return f && (f.includePercentage || f.includeGrade || f.includeLowMention || f.includeMark);
    })
    .map((t) => t.id);

  let testContext: TestContextItem[] | undefined;

  if (allIncludedTests.length > 0) {
    const testResults = scoredTestIds.length > 0
      ? await prisma.testResult.findMany({
          where: { test_id: { in: scoredTestIds }, student_id: studentId },
          select: { test_id: true, score: true, calculated: true },
        })
      : [];
    const resultByTestId = new Map(testResults.map((r) => [r.test_id, r]));
    const items: TestContextItem[] = [];
    for (const test of allIncludedTests) {
      const filter = testFilters[test.id];
      const isScored = filter.includePercentage || filter.includeGrade || filter.includeLowMention || filter.includeMark;
      if (isScored) {
        const result = resultByTestId.get(test.id);
        if (!result) continue; // no result yet — skip from block (Rule 6 still fires via testInstruction)
        const calc = result.calculated as { percentage: number; grade: string | null };
        const item: TestContextItem = { testName: test.name };
        if (filter.includePercentage || filter.includeLowMention) item.percentage = calc.percentage;
        if (filter.includeGrade) item.grade = calc.grade;
        if (filter.includeLowMention) item.lowMention = true;
        if (filter.includeMark) item.mark = `${result.score}/${test.max_mark}`;
        items.push(item);
      } else {
        // Qualitative only — always include with just test name; no result needed
        items.push({ testName: test.name });
      }
    }
    if (items.length > 0) testContext = items;
  }

  // ── 3. Build prompt — only allowed fields ──────────────────────────────────
  // Privacy rule: first_name + gender + rawRatings + topics + topicRatings ONLY.
  const effectiveTone = tone || session.tone;
  const effectiveLength = length || (session.length as ReportLength);

  // ── 3a. Fetch progression data inline if not passed in options ──────────────
  // Finds the most recently completed session in the same class and computes
  // per-discipline trend scores for this student. No PII in the output.
  let resolvedProgression: ProgressionItem[] | undefined = optionsProgression;

  if (resolvedProgression === undefined) {
    const prevSession = await prisma.reportSession.findFirst({
      where: {
        class_id: session.class_id,
        organization_id: orgId,
        status: "complete",
        id: { not: sessionId },
      },
      select: {
        disciplines: { select: { id: true, name: true } },
      },
      orderBy: { updated_at: "desc" },
    });

    if (prevSession) {
      const prevDisciplineIds = prevSession.disciplines.map((d) => d.id);

      const prevRatings = await prisma.rating.findMany({
        where: {
          student_id: studentId,
          session_discipline_id: { in: prevDisciplineIds },
        },
        select: {
          score: true,
          session_discipline: { select: { name: true } },
        },
      });

      const previousScoreByName = new Map<string, number>();
      for (const r of prevRatings) {
        previousScoreByName.set(r.session_discipline.name, r.score);
      }

      const currentScoreByName = new Map<string, number>();
      for (const r of ratings) {
        currentScoreByName.set(r.session_discipline.name, r.score);
      }

      const matched: ProgressionItem[] = [];
      for (const [name, currentScore] of currentScoreByName) {
        const previousScore = previousScoreByName.get(name);
        if (previousScore === undefined) continue;
        const trend: ProgressionItem["trend"] =
          currentScore > previousScore
            ? "improved"
            : currentScore < previousScore
            ? "declined"
            : "maintained";
        matched.push({ name, trend, previous: previousScore, current: currentScore });
      }

      if (matched.length > 0) {
        resolvedProgression = matched;
      }
    }
  }

  const reportPrompt = {
    firstName: student.first_name,
    gender: student.gender ?? "unspecified",
    ratings: rawRatings,
    topics: session.topics_covered,
    tone: effectiveTone,
    length: effectiveLength,
    topicRatings,
    progression: resolvedProgression,
    testContext,
    testInstruction,
  };

  const promptText = buildPrompt(reportPrompt);

  const modelName =
    provider === "ollama" ? config.ollamaModel  :
    provider === "claude" ? config.claudeModel  :
                            config.openaiModel;

  // ── 4. Call LLM adapter ────────────────────────────────────────────────────
  // Ollama needs no API key — pass a placeholder and skip the missing-key guard.
  const apiKey =
    provider === "ollama" ? "ollama" :
    provider === "claude" ? config.claudeApiKey :
                            config.openaiApiKey;

  if (provider !== "ollama" && !apiKey) {
    throw Object.assign(
      new Error(`No API key configured for provider "${provider}"`),
      { code: "LLM_NO_API_KEY", statusCode: 500 }
    );
  }

  const adapter = createLLMAdapter(provider, apiKey);

  console.log(JSON.stringify({
    event: "report.generate.start",
    studentId,
    anonymousToken: student.anonymous_token,
    sessionId,
    orgId,
    provider,
    model: modelName,
    tone: effectiveTone,
    length: effectiveLength,
  }));

  const startMs = Date.now();
  const rawResponse = await adapter.generateReport(reportPrompt);
  const durationMs = Date.now() - startMs;

  // Sanitise: strip any title/heading line the LLM may have emitted.
  const cleanedResponse = sanitiseLlmResponse(rawResponse);

  // ── 5. Persist Report row ──────────────────────────────────────────────────
  const words = countWords(cleanedResponse);

  const saved = await prisma.report.create({
    data: {
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      // Copy the student's anonymous_token at generation time — immutable snapshot.
      anonymous_token: student.anonymous_token,
      llm_model: modelName,
      llm_prompt: promptText,
      llm_raw_response: rawResponse,       // preserve the original LLM output
      edited_content: cleanedResponse,     // clean version shown to teachers
      status: "draft",
      word_count: words,
    } satisfies Prisma.ReportUncheckedCreateInput,
  });

  console.log(JSON.stringify({
    event: "report.generate.complete",
    reportId: saved.id,
    studentId,
    anonymousToken: student.anonymous_token,
    sessionId,
    orgId,
    durationMs,
    wordCount: words,
  }));

  return saved;
}
