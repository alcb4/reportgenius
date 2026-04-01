/**
 * BullMQ Worker for the "report-generation" queue.
 *
 * Concurrency: exactly 10 (BULL_CONCURRENCY env or default 10).
 *
 * Job data shape:
 *   {
 *     jobId:          string  — the batchId-scoped identifier logged in all lines
 *     organizationId: string  — org that owns this student
 *     studentId:      string  — the student to generate for
 *     sessionId:      string  — report session the generation belongs to
 *     tone:           string  — e.g. "professional"
 *     length:         "short" | "medium" | "long"
 *   }
 *
 * On success: calls generateSingleReport(), updates job progress to 100.
 * On failure: logs structured JSON { jobId, studentId, error, duration }.
 * Retry policy: 3 attempts, exponential backoff (2s, 4s, 8s) — configured
 *   on the Queue's defaultJobOptions in queue.ts.
 */

import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { generateSingleReport } from "../services/report.service";
import { ReportLength } from "../adapters/llm/types";
import { QUEUE_NAME } from "./queue";

/** Strict type for data stored in each BullMQ job. */
export interface ReportJobData {
  jobId: string;
  organizationId: string;
  studentId: string;
  sessionId: string;
  tone: string;
  length: ReportLength;
}

const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const concurrency = parseInt(
  process.env["BULL_CONCURRENCY"] ?? "10",
  10
);

/**
 * Process a single report-generation job.
 * Exported so unit tests can invoke it directly without spinning up a Worker.
 */
export async function processReportJob(
  job: Job<ReportJobData>
): Promise<{ reportId: string }> {
  const { jobId, organizationId, studentId, sessionId, tone, length } = job.data;
  const startMs = Date.now();

  console.log(JSON.stringify({
    event: "job.start",
    jobId,
    bullJobId: job.id,
    studentId,
    sessionId,
    organizationId,
    tone,
    length,
  }));

  const report = await generateSingleReport(studentId, sessionId, organizationId, {
    tone,
    length,
  });

  const durationMs = Date.now() - startMs;

  // Signal 100% progress so status polling sees completion immediately.
  await job.updateProgress(100);

  console.log(JSON.stringify({
    event: "job.complete",
    jobId,
    bullJobId: job.id,
    studentId,
    reportId: report.id,
    durationMs,
  }));

  return { reportId: report.id };
}

/** Build and start the Worker. Called by the worker.ts entry point. */
export function startWorker(): Worker<ReportJobData> {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  connection.on("error", (err: Error) => {
    console.error(JSON.stringify({
      event: "redis.worker_connection_error",
      error: err.message,
    }));
  });

  const worker = new Worker<ReportJobData>(
    QUEUE_NAME,
    processReportJob,
    {
      connection,
      concurrency,
    }
  );

  worker.on("failed", (job: Job<ReportJobData> | undefined, err: Error) => {
    const durationMs = job
      ? Date.now() - (job.processedOn ?? Date.now())
      : 0;

    console.error(JSON.stringify({
      event: "job.failed",
      jobId: job?.data?.jobId ?? "unknown",
      bullJobId: job?.id ?? "unknown",
      studentId: job?.data?.studentId ?? "unknown",
      sessionId: job?.data?.sessionId ?? "unknown",
      attempts: job?.attemptsMade ?? 0,
      error: err.message,
      durationMs,
    }));
  });

  worker.on("error", (err: Error) => {
    console.error(JSON.stringify({
      event: "worker.error",
      error: err.message,
    }));
  });

  worker.on("ready", () => {
    console.log(JSON.stringify({
      event: "worker.ready",
      queue: QUEUE_NAME,
      concurrency,
    }));
  });

  return worker;
}
