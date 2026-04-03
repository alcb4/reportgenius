/**
 * Reports routes
 *
 * POST /api/v1/sessions/:sessionId/students/:studentId/generate
 *   Generate a new report from the student's current session ratings via LLM.
 *   Body: { llmProvider?: string }
 *   (tone + length are pulled from session settings)
 *
 * GET  /api/v1/sessions/:sessionId/reports
 *   List all reports for a session, ordered by created_at desc.
 *
 * GET  /api/v1/reports/:reportId
 *   Fetch a single report (org-scoped).
 *
 * PUT  /api/v1/reports/:reportId
 *   Update edited_content and/or status (teacher edits). llm_raw_response is never modified.
 *   - Only edited_content → updates content + word_count + sets status="edited"
 *   - Only status → updates status only
 *   - Both → updates content + word_count + uses explicit status
 *
 * POST /api/v1/reports/:reportId/redo
 *   Re-generate from the student's current session ratings. Saves a NEW Report row;
 *   the old report is preserved untouched.
 *
 * GET  /api/v1/students/:studentId/reports
 *   List all reports for a student across all sessions, ordered by created_at DESC.
 *   Includes session + class nesting.
 *
 * PATCH /api/v1/sessions/:sessionId/reports/status
 *   Bulk update status for a list of report IDs within the session.
 *
 * GET  /api/v1/sessions/:sessionId/batch-prompt
 *   Build a preview prompt string for up to 5 students using the shared
 *   buildPrompt() per student (includes test scores, progression, banned phrases).
 *   Intended for the manual copy-paste workflow.
 *
 * POST /api/v1/sessions/:sessionId/batch-generate
 *   Generate and save reports for up to 20 students in parallel. Each student
 *   uses generateSingleReport() — output is identical to individual generation.
 *   Body: { studentIds: string[], llmProvider?: string }
 *
 * Multi-tenant isolation: every operation verifies org ownership before
 * touching any resource.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { generateSingleReport } from "../services/report.service";
import { ReportLength, ProgressionItem, TestContextItem, BatchStudentPayload, BatchSessionConfig } from "../adapters/llm/types";
import { buildPrompt, buildBatchPrompt, resolveTestInstructionFromConfig } from "../adapters/llm/prompt-builder";
import { createLLMAdapter } from "../adapters/llm/factory";
import { config } from "../config";

const router = Router();
const prisma = new PrismaClient();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const GenerateSchema = z.object({
  llmProvider: z.enum(["openai", "claude"]).optional(),
});

const UpdateReportSchema = z
  .object({
    edited_content: z.string().min(1).optional(),
    status: z.enum(["draft", "edited", "final"]).optional(),
  })
  .refine(
    (d) => d.edited_content !== undefined || d.status !== undefined,
    { message: "At least one of edited_content or status is required" }
  );

const RedoSchema = z.object({
  llmProvider: z.enum(["openai", "claude"]).optional(),
});

const BulkStatusSchema = z.object({
  reportIds: z.array(z.string().min(1)).min(1),
  status: z.enum(["draft", "edited", "final"]),
});

const BatchPromptQuerySchema = z.object({
  studentIds: z.union([z.string(), z.array(z.string())]).transform((v) =>
    Array.isArray(v) ? v : [v]
  ),
});

const ParseReportsSchema = z.object({
  raw: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1),
});

const BatchGenerateSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(20),
  llmProvider: z.enum(["openai", "claude"]).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Verify a session belongs to the org; return it or null. */
async function resolveSession(
  sessionId: string,
  organizationId: string
): Promise<{ id: string; tone: string; length: string } | null> {
  return prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: organizationId },
    select: { id: true, tone: true, length: true },
  });
}

/** Verify a report belongs to the org; return it or null. */
async function resolveReport(
  reportId: string,
  organizationId: string
): Promise<{
  id: string;
  student_id: string;
  session_id: string;
  organization_id: string;
} | null> {
  return prisma.report.findFirst({
    where: { id: reportId, organization_id: organizationId },
    select: { id: true, student_id: true, session_id: true, organization_id: true },
  });
}

/** Count words in a string. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── POST /api/v1/sessions/:sessionId/students/:studentId/generate ─────────────

router.post(
  "/sessions/:sessionId/students/:studentId/generate",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const studentId = String(req.params["studentId"]);
      const organizationId = req.user.organizationId;

      // Verify session belongs to org.
      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = GenerateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { llmProvider } = parsed.data;

      const report = await generateSingleReport(studentId, sessionId, organizationId, {
        tone: session.tone,
        length: session.length as ReportLength,
        llmProvider,
      });

      res.status(201).json({ report });
    } catch (err) {
      if (
        err !== null &&
        typeof err === "object" &&
        "statusCode" in err &&
        "code" in err
      ) {
        const domainErr = err as { statusCode: number; code: string; message: string };
        res.status(domainErr.statusCode).json({
          error: domainErr.message,
          code: domainErr.code,
        });
        return;
      }
      next(err);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/reports ───────────────────────────────────

router.get(
  "/sessions/:sessionId/reports",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const reports = await prisma.report.findMany({
        where: { session_id: sessionId, organization_id: organizationId },
        select: {
          id: true,
          student_id: true,
          session_id: true,
          llm_model: true,
          edited_content: true,
          status: true,
          word_count: true,
          ratings_changed_at: true,
          created_at: true,
          updated_at: true,
          // llm_prompt and llm_raw_response omitted from list endpoint for performance.
          student: {
            select: { id: true, first_name: true, gender: true },
          },
        },
        orderBy: { created_at: "desc" },
      });

      res.status(200).json({ reports });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/reports/:reportId ─────────────────────────────────────────────

router.get(
  "/reports/:reportId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reportId = String(req.params["reportId"]);
      const organizationId = req.user.organizationId;

      const report = await prisma.report.findFirst({
        where: { id: reportId, organization_id: organizationId },
        select: {
          id: true,
          organization_id: true,
          student_id: true,
          session_id: true,
          llm_model: true,
          llm_prompt: true,
          llm_raw_response: true,
          edited_content: true,
          status: true,
          word_count: true,
          created_at: true,
          updated_at: true,
          student: {
            select: { id: true, first_name: true, gender: true },
          },
        },
      });

      if (!report) {
        res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
        return;
      }

      res.status(200).json({ report });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/v1/reports/:reportId ─────────────────────────────────────────────
// Updates edited_content and/or status. llm_raw_response is immutable after creation.

router.put(
  "/reports/:reportId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reportId = String(req.params["reportId"]);
      const organizationId = req.user.organizationId;

      const existing = await resolveReport(reportId, organizationId);
      if (!existing) {
        res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
        return;
      }

      const parsed = UpdateReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { edited_content, status } = parsed.data;

      // Build update payload based on what was provided
      const updateData: {
        edited_content?: string;
        word_count?: number;
        status: string;
      } = { status: "edited" }; // default

      if (edited_content !== undefined) {
        updateData.edited_content = edited_content;
        updateData.word_count = countWords(edited_content);
        // If an explicit status was also provided, use it; otherwise default to "edited"
        updateData.status = status ?? "edited";
      } else if (status !== undefined) {
        // Only status provided — update status only, no content change
        updateData.status = status;
      }

      const updated = await prisma.report.update({
        where: { id: reportId },
        data: updateData,
        select: {
          id: true,
          organization_id: true,
          student_id: true,
          session_id: true,
          llm_model: true,
          llm_prompt: true,
          llm_raw_response: true,
          edited_content: true,
          status: true,
          word_count: true,
          created_at: true,
          updated_at: true,
        },
      });

      console.log(JSON.stringify({
        event: "report.updated",
        reportId,
        organizationId,
        status: updated.status,
        wordCount: updated.word_count,
      }));

      res.status(200).json({ report: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/reports/:reportId/redo ───────────────────────────────────────
// Re-generate from current session ratings. Creates a NEW report; old one preserved.

router.post(
  "/reports/:reportId/redo",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reportId = String(req.params["reportId"]);
      const organizationId = req.user.organizationId;

      const existing = await resolveReport(reportId, organizationId);
      if (!existing) {
        res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
        return;
      }

      const parsed = RedoSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { llmProvider } = parsed.data;

      // Re-fetch session for tone/length settings.
      const session = await resolveSession(existing.session_id, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const newReport = await generateSingleReport(
        existing.student_id,
        existing.session_id,
        organizationId,
        {
          tone: session.tone,
          length: session.length as ReportLength,
          llmProvider,
        }
      );

      console.log(JSON.stringify({
        event: "report.redo",
        oldReportId: reportId,
        newReportId: newReport.id,
        studentId: existing.student_id,
        sessionId: existing.session_id,
        organizationId,
      }));

      res.status(201).json({ report: newReport });
    } catch (err) {
      if (
        err !== null &&
        typeof err === "object" &&
        "statusCode" in err &&
        "code" in err
      ) {
        const domainErr = err as { statusCode: number; code: string; message: string };
        res.status(domainErr.statusCode).json({
          error: domainErr.message,
          code: domainErr.code,
        });
        return;
      }
      next(err);
    }
  }
);

// ── GET /api/v1/students/:studentId/reports ───────────────────────────────────
// List all reports for a student across all sessions, most recent first.
// Includes session + class nesting for the history panel.

router.get(
  "/students/:studentId/reports",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const studentId = String(req.params["studentId"]);
      const organizationId = req.user.organizationId;

      // Verify student belongs to this org.
      const student = await prisma.student.findFirst({
        where: { id: studentId, organization_id: organizationId },
        select: { id: true },
      });
      if (!student) {
        res.status(404).json({ error: "Student not found", code: "STUDENT_NOT_FOUND" });
        return;
      }

      const excludeReportId = req.query["excludeReportId"] as string | undefined;

      const reports = await prisma.report.findMany({
        where: {
          student_id: studentId,
          organization_id: organizationId,
          ...(excludeReportId ? { id: { not: excludeReportId } } : {}),
        },
        select: {
          id: true,
          status: true,
          word_count: true,
          llm_raw_response: true,
          created_at: true,
          session: {
            select: {
              id: true,
              name: true,
              class: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { created_at: "desc" },
      });

      res.status(200).json({ reports });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/v1/sessions/:sessionId/reports/status ─────────────────────────
// Bulk-update status for a list of report IDs within a session.

router.patch(
  "/sessions/:sessionId/reports/status",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = BulkStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { reportIds, status } = parsed.data;

      const result = await prisma.report.updateMany({
        where: {
          id: { in: reportIds },
          session_id: sessionId,
          organization_id: organizationId,
        },
        data: { status },
      });

      console.log(JSON.stringify({
        event: "reports.bulk_status_updated",
        sessionId,
        organizationId,
        status,
        updated: result.count,
      }));

      res.status(200).json({ updated: result.count });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/batch-prompt ──────────────────────────────
// Builds a batch prompt string for the given studentIds (max 5).
// Returns: { prompt: string }

router.get(
  "/sessions/:sessionId/batch-prompt",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const queryParsed = BatchPromptQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        res.status(400).json({
          error: "studentIds query param required",
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { studentIds } = queryParsed.data;

      if (studentIds.length > 5) {
        res.status(422).json({
          error: "Maximum 5 students per batch prompt",
          code: "BATCH_TOO_LARGE",
        });
        return;
      }

      // Fetch session details including disciplines, topics, test config, and class
      const sessionFull = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: {
          tone: true,
          length: true,
          topics_covered: true,
          class_id: true,
          test_filters: true,
          disciplines: {
            select: { id: true, name: true },
            orderBy: { created_at: "asc" },
          },
        },
      });

      if (!sessionFull) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      // Verify all students belong to this org and fetch their data
      const students = await prisma.student.findMany({
        where: {
          id: { in: studentIds },
          organization_id: organizationId,
        },
        select: {
          id: true,
          first_name: true,
          gender: true,
        },
      });

      if (students.length !== studentIds.length) {
        res.status(404).json({
          error: "One or more students not found",
          code: "STUDENT_NOT_FOUND",
        });
        return;
      }

      const disciplineIds = sessionFull.disciplines.map((d) => d.id);

      // Fetch all ratings for these students in this session
      const allRatings = await prisma.rating.findMany({
        where: {
          student_id: { in: studentIds },
          session_discipline_id: { in: disciplineIds },
        },
        select: {
          student_id: true,
          score: true,
          comment: true,
          session_discipline: { select: { name: true } },
        },
      });

      // Fetch all topic ratings for these students in this session
      const allTopicRatings = await prisma.topicRating.findMany({
        where: {
          session_id: sessionId,
          student_id: { in: studentIds },
          organization_id: organizationId,
        },
        select: { student_id: true, topic_name: true, score: true },
        orderBy: { topic_name: "asc" },
      });

      // Build per-student rating maps
      const ratingsByStudent = new Map<string, typeof allRatings>();
      for (const r of allRatings) {
        const arr = ratingsByStudent.get(r.student_id) ?? [];
        arr.push(r);
        ratingsByStudent.set(r.student_id, arr);
      }

      const topicsByStudent = new Map<string, typeof allTopicRatings>();
      for (const tr of allTopicRatings) {
        const arr = topicsByStudent.get(tr.student_id) ?? [];
        arr.push(tr);
        topicsByStudent.set(tr.student_id, arr);
      }

      // ── Fetch progression data (previous session, same class) ─────────────────
      const prevSession = await prisma.reportSession.findFirst({
        where: {
          class_id: sessionFull.class_id,
          organization_id: organizationId,
          status: "complete",
          id: { not: sessionId },
        },
        select: {
          disciplines: { select: { id: true, name: true } },
        },
        orderBy: { updated_at: "desc" },
      });

      const prevRatingsByStudent = new Map<string, Array<{ score: number; session_discipline: { name: string } }>>();
      if (prevSession) {
        const prevDisciplineIds = prevSession.disciplines.map((d) => d.id);
        const allPrevRatings = await prisma.rating.findMany({
          where: {
            student_id: { in: studentIds },
            session_discipline_id: { in: prevDisciplineIds },
          },
          select: {
            student_id: true,
            score: true,
            session_discipline: { select: { name: true } },
          },
        });
        for (const r of allPrevRatings) {
          const arr = prevRatingsByStudent.get(r.student_id) ?? [];
          arr.push(r);
          prevRatingsByStudent.set(r.student_id, arr);
        }
      }

      // ── Fetch test results for all students ───────────────────────────────────
      const testFilters = (sessionFull.test_filters ?? {}) as Record<string, {
        includeMark?: boolean;
        includePercentage?: boolean;
        includeGrade?: boolean;
        includeLowMention?: boolean;
      }>;

      // Derive included test IDs from test_filters keys (tests may be class-level with no
      // session_id, so we query by ID directly rather than relying on the session→tests relation).
      const batchConfiguredTestIds = Object.keys(testFilters);
      const allIncludedTests = batchConfiguredTestIds.length > 0
        ? await prisma.test.findMany({
            where: { id: { in: batchConfiguredTestIds }, class_id: sessionFull.class_id },
            select: { id: true, name: true, max_mark: true },
          })
        : [];

      // Rule 6 instruction derived from config — fires regardless of whether results exist yet
      const batchTestInstruction = resolveTestInstructionFromConfig(
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

      const testResultsByStudent = new Map<string, Array<{ test_id: string; score: number; calculated: unknown }>>();
      if (scoredTestIds.length > 0) {
        const allTestResults = await prisma.testResult.findMany({
          where: {
            test_id: { in: scoredTestIds },
            student_id: { in: studentIds },
          },
          select: { test_id: true, student_id: true, score: true, calculated: true },
        });
        for (const r of allTestResults) {
          const arr = testResultsByStudent.get(r.student_id) ?? [];
          arr.push(r);
          testResultsByStudent.set(r.student_id, arr);
        }
      }

      // ── Build per-student payloads using shared buildBatchPrompt() ────────────
      const batchStudents: BatchStudentPayload[] = students.map((student) => {
        const ratings = ratingsByStudent.get(student.id) ?? [];
        const topicRatingRows = topicsByStudent.get(student.id) ?? [];

        const rawRatings = ratings.map((r) => ({
          name: r.session_discipline.name,
          score: r.score,
          comment: r.comment,
        }));

        const topicRatings =
          topicRatingRows.length > 0
            ? topicRatingRows.map((tr) => ({ topicName: tr.topic_name, score: tr.score }))
            : undefined;

        // Compute progression for this student
        let progression: ProgressionItem[] | undefined;
        if (prevSession) {
          const prevRatings = prevRatingsByStudent.get(student.id) ?? [];
          const prevScoreByName = new Map(prevRatings.map((r) => [r.session_discipline.name, r.score]));
          const currScoreByName = new Map(ratings.map((r) => [r.session_discipline.name, r.score]));
          const matched: ProgressionItem[] = [];
          for (const [name, current] of currScoreByName) {
            const previous = prevScoreByName.get(name);
            if (previous === undefined) continue;
            const trend: ProgressionItem["trend"] =
              current > previous ? "improved" : current < previous ? "declined" : "maintained";
            matched.push({ name, trend, previous, current });
          }
          if (matched.length > 0) progression = matched;
        }

        // Compute test context for this student
        let testContext: TestContextItem[] | undefined;
        if (allIncludedTests.length > 0) {
          const studentResults = testResultsByStudent.get(student.id) ?? [];
          const resultByTestId = new Map(studentResults.map((r) => [r.test_id, r]));
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
              if (filter.includeMark) item.mark = `${result.score}/${(test as { max_mark?: number }).max_mark ?? "?"}`;
              items.push(item);
            } else {
              // Qualitative only — always include with just test name; no result needed
              items.push({ testName: test.name });
            }
          }
          if (items.length > 0) testContext = items;
        }

        return {
          id: student.id,
          firstName: student.first_name,
          gender: student.gender ?? "unspecified",
          ratings: rawRatings,
          topics: sessionFull.topics_covered,
          topicRatings,
          progression,
          testContext,
        } satisfies BatchStudentPayload;
      });

      const batchConfig: BatchSessionConfig = {
        tone: sessionFull.tone,
        length: sessionFull.length as ReportLength,
        testInstruction: batchTestInstruction,
      };

      const prompt = buildBatchPrompt(batchStudents, batchConfig);

      res.status(200).json({ prompt });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/sessions/:sessionId/batch-generate ──────────────────────────
// Generate reports for multiple students in parallel using individual API calls.
// Each student uses the shared buildPrompt() — output is identical to individual
// generation. Saves each report to the database; partial failures are reported.
// Body: { studentIds: string[], llmProvider?: string }
// Returns: { reports: GeneratedReport[], failed: Array<{ studentId, error }> }

router.post(
  "/sessions/:sessionId/batch-generate",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = BatchGenerateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { studentIds, llmProvider } = parsed.data;

      // Generate each student's report in parallel — each uses the shared
      // buildPrompt() via generateSingleReport(), guaranteeing output identical
      // to individual generation (test scores, progression, banned phrases, etc.)
      const outcomes = await Promise.allSettled(
        studentIds.map((studentId) =>
          generateSingleReport(studentId, sessionId, organizationId, {
            tone: session.tone,
            length: session.length as ReportLength,
            llmProvider,
          })
        )
      );

      const reports = [];
      const failed = [];

      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i];
        if (outcome.status === "fulfilled") {
          reports.push(outcome.value);
        } else {
          const err = outcome.reason as { code?: string; message?: string };
          failed.push({
            studentId: studentIds[i],
            error: err.message ?? "Unknown error",
            code: err.code ?? "GENERATION_FAILED",
          });
        }
      }

      res.status(200).json({ reports, failed });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/sessions/:sessionId/parse-reports ────────────────────────────
// Parse a raw LLM JSON response and upsert reports for the matched students.
// Body: { raw: string, studentIds: string[] }
// Returns: { results: ParseResult[], saved: number, failed: number }

router.post(
  "/sessions/:sessionId/parse-reports",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = ParseReportsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { raw, studentIds } = parsed.data;

      // Fetch student details (verify org ownership + get names)
      const students = await prisma.student.findMany({
        where: {
          id: { in: studentIds },
          organization_id: organizationId,
        },
        select: { id: true, first_name: true, last_name: true, anonymous_token: true },
      });

      const studentMap = new Map(students.map((s) => [s.id, s]));

      // ── Parse the raw LLM response ──────────────────────────────────────────
      // Step 1: Strip markdown fences
      let cleaned = raw
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      // Step 2: Extract the JSON array substring
      const firstBracket = cleaned.indexOf("[");
      const lastBracket = cleaned.lastIndexOf("]");

      if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
        res.status(422).json({
          error: "Could not parse response as JSON",
          hint: "The response must contain a JSON array [ ... ]. Make sure you copied the full response from the AI tool.",
          code: "PARSE_ERROR",
        });
        return;
      }

      cleaned = cleaned.slice(firstBracket, lastBracket + 1);

      // Step 3: Parse JSON
      let items: unknown;
      try {
        items = JSON.parse(cleaned);
      } catch {
        res.status(422).json({
          error: "Could not parse response as JSON",
          hint: "The JSON was malformed. Try copying the response again — make sure no text is cut off.",
          code: "PARSE_ERROR",
        });
        return;
      }

      // Step 4: Validate structure
      if (!Array.isArray(items)) {
        res.status(422).json({
          error: "Response is not a JSON array",
          hint: "Expected a JSON array like: [{ \"studentId\": \"...\", \"report\": \"...\" }]",
          code: "PARSE_ERROR",
        });
        return;
      }

      // Step 5: Process each item — upsert reports
      interface ParseItemResult {
        studentId: string;
        name: string;
        success: boolean;
        error?: string;
      }

      const results: ParseItemResult[] = [];
      let savedCount = 0;
      let failedCount = 0;

      for (const item of items) {
        if (
          item === null ||
          typeof item !== "object" ||
          !("studentId" in item) ||
          !("report" in item) ||
          typeof (item as Record<string, unknown>)["studentId"] !== "string" ||
          typeof (item as Record<string, unknown>)["report"] !== "string"
        ) {
          failedCount++;
          results.push({
            studentId: "unknown",
            name: "Unknown",
            success: false,
            error: "Invalid item structure — missing studentId or report",
          });
          continue;
        }

        const typedItem = item as { studentId: string; report: string };
        const student = studentMap.get(typedItem.studentId);

        if (!student) {
          failedCount++;
          results.push({
            studentId: typedItem.studentId,
            name: typedItem.studentId,
            success: false,
            error: "Student ID not found in this session",
          });
          continue;
        }

        if (!studentIds.includes(typedItem.studentId)) {
          failedCount++;
          results.push({
            studentId: typedItem.studentId,
            name: student.first_name,
            success: false,
            error: "Student ID not in the requested batch",
          });
          continue;
        }

        const reportText = typedItem.report.trim();
        if (!reportText) {
          failedCount++;
          results.push({
            studentId: typedItem.studentId,
            name: student.first_name,
            success: false,
            error: "Empty report text",
          });
          continue;
        }

        const wordCount = reportText.trim().split(/\s+/).filter(Boolean).length;

        console.log(JSON.stringify({
          event: "parse_reports.upsert_attempt",
          sessionId,
          studentId: typedItem.studentId,
          organizationId,
          wordCount,
        }));

        try {
          const upserted = await prisma.report.upsert({
            where: {
              session_id_student_id: {
                session_id: sessionId,
                student_id: typedItem.studentId,
              },
            },
            create: {
              organization_id: organizationId,
              student_id: typedItem.studentId,
              session_id: sessionId,
              anonymous_token: student.anonymous_token,
              llm_model: "free_model",
              llm_prompt: null,
              llm_raw_response: raw,
              edited_content: reportText,
              status: "draft",
              word_count: wordCount,
            },
            update: {
              llm_model: "free_model",
              llm_raw_response: raw,
              edited_content: reportText,
              status: "draft",
              word_count: wordCount,
            },
            select: { id: true },
          });

          console.log(JSON.stringify({
            event: "parse_reports.upsert_success",
            sessionId,
            studentId: typedItem.studentId,
            reportId: upserted.id,
            organizationId,
          }));

          savedCount++;
          results.push({
            studentId: typedItem.studentId,
            name: student.first_name,
            success: true,
          });
        } catch (dbErr) {
          console.error(JSON.stringify({
            event: "parse_reports.upsert_error",
            sessionId,
            studentId: typedItem.studentId,
            organizationId,
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          }));
          failedCount++;
          results.push({
            studentId: typedItem.studentId,
            name: student.first_name,
            success: false,
            error: "Database error saving report",
          });
        }
      }

      console.log(JSON.stringify({
        event: "reports.parse_and_save",
        sessionId,
        organizationId,
        saved: savedCount,
        failed: failedCount,
      }));

      res.status(200).json({ results, saved: savedCount, failed: failedCount });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/sessions/:sessionId/reports/:studentId/regenerate ────────────
// Re-generate a single report with optional filter overrides.
// Upserts the existing Report row (same session + student).
// Body: { filters?: { disciplineIds?: string[], tone?: string, overviewSummary?: string } }
// Returns: { report: string, reportId: string }

const RegenerateFiltersSchema = z.object({
  disciplineIds: z.array(z.string()).optional(),
  tone: z.enum(["gentle", "balanced", "direct"]).optional(),
  overviewSummary: z.string().max(2000).optional(),
});

const RegenerateSchema = z.object({
  filters: RegenerateFiltersSchema.optional(),
  // Per-student context appended to the prompt (teacher's custom note for this student)
  customNote: z.string().max(1000).optional(),
});

router.post(
  "/sessions/:sessionId/reports/:studentId/regenerate",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const studentId = String(req.params["studentId"]);
      const organizationId = req.user.organizationId;

      // Verify session belongs to org — include saved filter defaults.
      const session = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: {
          id: true,
          tone: true,
          length: true,
          topics_covered: true,
          class_id: true,
          class_overview: true,
          progression_filters: true,
          test_filters: true,
          disciplines: {
            select: { id: true, name: true },
            orderBy: { created_at: "asc" },
          },
        },
      });

      if (!session) {
        res
          .status(404)
          .json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = RegenerateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { filters, customNote } = parsed.data;

      // Verify student belongs to org.
      const student = await prisma.student.findFirst({
        where: { id: studentId, organization_id: organizationId },
        select: {
          id: true,
          first_name: true,
          gender: true,
          anonymous_token: true,
        },
      });

      if (!student) {
        res
          .status(404)
          .json({ error: "Student not found", code: "STUDENT_NOT_FOUND" });
        return;
      }

      // Determine which disciplines to use — apply filter if provided.
      const allDisciplineIds = session.disciplines.map((d) => d.id);
      let activeDisciplineIds = allDisciplineIds;

      if (filters?.disciplineIds && filters.disciplineIds.length > 0) {
        // Keep only the disciplines whose IDs are in the filter list.
        const filterSet = new Set(filters.disciplineIds);
        activeDisciplineIds = session.disciplines
          .filter((d) => filterSet.has(d.id))
          .map((d) => d.id);
      }

      // Fetch ratings for active disciplines only.
      const ratings = await prisma.rating.findMany({
        where: {
          student_id: studentId,
          session_discipline_id: { in: activeDisciplineIds },
        },
        select: {
          score: true,
          comment: true,
          session_discipline: { select: { name: true } },
        },
        orderBy: { session_discipline: { name: "asc" } },
      });

      if (ratings.length === 0) {
        res.status(422).json({
          error:
            "Student has no ratings for the selected disciplines — add ratings before generating",
          code: "NO_RATINGS",
        });
        return;
      }

      // Build raw ratings array (new API — no pre-formatted summary).
      const rawRatingsRegen = ratings.map((r) => ({
        name: r.session_discipline.name,
        score: r.score,
        comment: r.comment,
      }));

      // Fetch topic ratings.
      const topicRatingRows = await prisma.topicRating.findMany({
        where: {
          session_id: sessionId,
          student_id: studentId,
          organization_id: organizationId,
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

      // ── Fetch test context ──────────────────────────────────────────────────
      const regenTestFilters = (session.test_filters ?? {}) as Record<string, {
        includeMark?: boolean;
        includePercentage?: boolean;
        includeGrade?: boolean;
        includeLowMention?: boolean;
      }>;

      // Derive included test IDs from test_filters keys (tests may be class-level with no
      // session_id, so we query by ID directly rather than relying on the session→tests relation).
      const regenConfiguredTestIds = Object.keys(regenTestFilters);
      const regenAllIncludedTests = regenConfiguredTestIds.length > 0
        ? await prisma.test.findMany({
            where: { id: { in: regenConfiguredTestIds }, class_id: session.class_id },
            select: { id: true, name: true, max_mark: true },
          })
        : [];

      // Rule 6 instruction derived from config — fires regardless of whether results exist yet
      const regenTestInstruction = resolveTestInstructionFromConfig(
        regenTestFilters,
        regenAllIncludedTests.map((t) => t.id)
      );

      // Tests that need score data fetched (have at least one score flag set)
      const regenScoredTestIds = regenAllIncludedTests
        .filter((t) => {
          const f = regenTestFilters[t.id];
          return f && (f.includePercentage || f.includeGrade || f.includeLowMention || f.includeMark);
        })
        .map((t) => t.id);

      let testContext: TestContextItem[] | undefined;
      if (regenAllIncludedTests.length > 0) {
        const testResults = regenScoredTestIds.length > 0
          ? await prisma.testResult.findMany({
              where: { test_id: { in: regenScoredTestIds }, student_id: studentId },
              select: { test_id: true, score: true, calculated: true },
            })
          : [];
        const resultByTestId = new Map(testResults.map((r) => [r.test_id, r]));
        const items: TestContextItem[] = [];
        for (const test of regenAllIncludedTests) {
          const filter = regenTestFilters[test.id];
          const isScored = filter.includePercentage || filter.includeGrade || filter.includeLowMention || filter.includeMark;
          if (isScored) {
            const result = resultByTestId.get(test.id);
            if (!result) continue; // no result yet — skip from block (Rule 6 still fires via testInstruction)
            const calc = result.calculated as { percentage: number; grade: string | null };
            const item: TestContextItem = { testName: test.name };
            if (filter.includePercentage || filter.includeLowMention) item.percentage = calc.percentage;
            if (filter.includeGrade) item.grade = calc.grade;
            if (filter.includeLowMention) item.lowMention = true;
            if (filter.includeMark) item.mark = `${result.score}/${test.max_mark ?? "?"}`;
            items.push(item);
          } else {
            // Qualitative only — always include with just test name; no result needed
            items.push({ testName: test.name });
          }
        }
        if (items.length > 0) testContext = items;
      }

      // ── Fetch progression data inline (server-side) ─────────────────────────
      // Mirrors the logic in GET /sessions/:sessionId/progression-data.
      let progression: ProgressionItem[] | undefined;

      const previousSession = await prisma.reportSession.findFirst({
        where: {
          class_id: session.class_id,
          organization_id: organizationId,
          status: "complete",
          id: { not: sessionId },
        },
        select: {
          id: true,
          disciplines: {
            select: { id: true, name: true },
          },
        },
        orderBy: { updated_at: "desc" },
      });

      if (previousSession) {
        const prevDisciplineIds = previousSession.disciplines.map((d) => d.id);

        const [currentRatingsForProg, previousRatings] = await Promise.all([
          prisma.rating.findMany({
            where: {
              student_id: studentId,
              session_discipline_id: { in: activeDisciplineIds },
            },
            select: {
              score: true,
              session_discipline: { select: { name: true } },
            },
          }),
          prisma.rating.findMany({
            where: {
              student_id: studentId,
              session_discipline_id: { in: prevDisciplineIds },
            },
            select: {
              score: true,
              session_discipline: { select: { name: true } },
            },
          }),
        ]);

        const currentScoreByName = new Map<string, number>();
        for (const r of currentRatingsForProg) {
          currentScoreByName.set(r.session_discipline.name, r.score);
        }

        const previousScoreByName = new Map<string, number>();
        for (const r of previousRatings) {
          previousScoreByName.set(r.session_discipline.name, r.score);
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
          progression = matched;
        }
      }

      // ── Determine effective tone and length ────────────────────────────────
      // Use filter override if provided, otherwise fall back to session default.
      const effectiveTone = filters?.tone ?? session.tone;
      const effectiveLength = session.length as ReportLength;

      // Build context note from optional overview + custom note.
      const overviewNote =
        filters?.overviewSummary?.trim() ??
        (session.class_overview?.trim() || undefined);
      const customNoteText = customNote?.trim();
      const contextParts: string[] = [];
      if (overviewNote) contextParts.push(`Class context: ${overviewNote}`);
      if (customNoteText) contextParts.push(`Additional context: ${customNoteText}`);
      const contextNote = contextParts.length > 0 ? contextParts.join(" — ") : undefined;

      const reportPromptObj = {
        firstName: student.first_name,
        gender: student.gender ?? "unspecified",
        ratings: rawRatingsRegen,
        topics: session.topics_covered,
        tone: effectiveTone,
        length: effectiveLength,
        topicRatings,
        progression,
        testContext,
        testInstruction: regenTestInstruction,
        contextNote,
      };

      const promptText = buildPrompt(reportPromptObj);

      // ── Call LLM ────────────────────────────────────────────────────────────
      const provider = config.llmProvider;
      const apiKey =
        provider === "ollama"
          ? "ollama"
          : provider === "claude"
          ? config.claudeApiKey
          : config.openaiApiKey;

      if (provider !== "ollama" && !apiKey) {
        res.status(500).json({
          error: `No API key configured for provider "${provider}"`,
          code: "LLM_NO_API_KEY",
        });
        return;
      }

      const adapter = createLLMAdapter(provider, apiKey);

      console.log(
        JSON.stringify({
          event: "report.regenerate.start",
          sessionId,
          studentId,
          organizationId,
          provider,
          tone: effectiveTone,
        })
      );

      const startMs = Date.now();
      const rawResponse = await adapter.generateReport(reportPromptObj);
      const durationMs = Date.now() - startMs;

      // Strip any leading title line the LLM may have emitted.
      const lines = rawResponse.split("\n");
      const firstLine = lines[0].trim();
      const isTitleLine =
        /^(\*{1,2})?student report[:\s]/i.test(firstLine) ||
        /^#{1,3}\s/.test(firstLine);
      const cleanedResponse = isTitleLine
        ? lines
            .slice(1)
            .filter((l, i, arr) => !(l.trim() === "" && i === 0 && arr[0].trim() === ""))
            .join("\n")
            .trim()
        : rawResponse.trim();

      const wordCount = cleanedResponse
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;

      // Upsert the report row.
      const existingReport = await prisma.report.findUnique({
        where: {
          session_id_student_id: {
            session_id: sessionId,
            student_id: studentId,
          },
        },
        select: { id: true, status: true },
      });

      let reportId: string;

      if (existingReport) {
        await prisma.report.update({
          where: { id: existingReport.id },
          data: {
            edited_content: cleanedResponse,
            llm_raw_response: rawResponse,
            llm_prompt: promptText,
            word_count: wordCount,
            ratings_changed_at: null,
          },
        });
        reportId = existingReport.id;
      } else {
        const created = await prisma.report.create({
          data: {
            organization_id: organizationId,
            student_id: studentId,
            session_id: sessionId,
            anonymous_token: student.anonymous_token,
            llm_model: config.openaiModel,
            llm_prompt: promptText,
            llm_raw_response: rawResponse,
            edited_content: cleanedResponse,
            status: "draft",
            word_count: wordCount,
          },
          select: { id: true },
        });
        reportId = created.id;
      }

      console.log(
        JSON.stringify({
          event: "report.regenerate.complete",
          sessionId,
          studentId,
          reportId,
          organizationId,
          durationMs,
          wordCount,
        })
      );

      res.status(200).json({ report: cleanedResponse, reportId });
    } catch (err) {
      if (
        err !== null &&
        typeof err === "object" &&
        "statusCode" in err &&
        "code" in err
      ) {
        const domainErr = err as {
          statusCode: number;
          code: string;
          message: string;
        };
        res.status(domainErr.statusCode).json({
          error: domainErr.message,
          code: domainErr.code,
        });
        return;
      }
      next(err);
    }
  }
);

export default router;
