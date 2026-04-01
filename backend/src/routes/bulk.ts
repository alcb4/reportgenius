/**
 * Bulk report generation routes — scoped to ReportSession.
 *
 * POST   /api/v1/sessions/:sessionId/generate/bulk
 *   Enqueue one LLM report-generation job per student in the session's class.
 *   Body: { llmProvider?: "openai"|"claude" }
 *   Returns: { batchId: string, totalJobs: number }
 *
 * GET    /api/v1/sessions/:sessionId/generate/bulk/:batchId/status
 *   Poll for batch progress.
 *   Returns: BatchStatus — { batchId, total, completed, failed, pending, active, results[] }
 *
 * POST   /api/v1/sessions/:sessionId/generate/bulk/:batchId/retry-failed
 *   Re-queue only the jobs in this batch that are in a "failed" state.
 *   Returns: { requeued: number }
 *
 * Multi-tenant isolation: every operation verifies the session AND batch
 * belong to the authenticated user's organizationId.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import {
  bulkGenerateReports,
  getBatchStatus,
  retryFailedJobs,
} from "../services/bulk-report.service";

const router = Router();

// ── Zod validation schemas ────────────────────────────────────────────────────

const BulkGenerateSchema = z.object({
  llmProvider: z.enum(["openai", "claude"]).optional(),
});

// ── Helper: surface domain errors as HTTP responses ───────────────────────────

function handleDomainError(
  err: unknown,
  res: Response,
  next: NextFunction
): void {
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

// ── POST /api/v1/sessions/:sessionId/generate/bulk ───────────────────────────

router.post(
  "/sessions/:sessionId/generate/bulk",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const parsed = BulkGenerateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { llmProvider } = parsed.data;

      const result = await bulkGenerateReports(sessionId, organizationId, {
        llmProvider,
      });

      console.log(JSON.stringify({
        event: "bulk.route.enqueued",
        sessionId,
        organizationId,
        batchId: result.batchId,
        totalJobs: result.totalJobs,
      }));

      res.status(201).json(result);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/generate/bulk/:batchId/status ────────────

router.get(
  "/sessions/:sessionId/generate/bulk/:batchId/status",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const batchId = String(req.params["batchId"]);
      const organizationId = req.user.organizationId;

      const status = await getBatchStatus(batchId, organizationId);

      res.status(200).json(status);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

// ── POST /api/v1/sessions/:sessionId/generate/bulk/:batchId/retry-failed ──────

router.post(
  "/sessions/:sessionId/generate/bulk/:batchId/retry-failed",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const batchId = String(req.params["batchId"]);
      const organizationId = req.user.organizationId;

      const result = await retryFailedJobs(batchId, organizationId);

      console.log(JSON.stringify({
        event: "bulk.route.retry_failed",
        batchId,
        organizationId,
        requeued: result.requeued,
      }));

      res.status(200).json(result);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

export default router;
