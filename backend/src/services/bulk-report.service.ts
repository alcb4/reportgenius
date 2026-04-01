/**
 * Bulk report generation service — scoped to ReportSession.
 *
 * bulkGenerateReports():
 *   1. Verify the session belongs to the organisation.
 *   2. Fetch all students in the session's class (org-scoped).
 *   3. Enqueue one BullMQ job per student, all sharing the same batchId.
 *   4. Store metadata in a Redis hash  key: batch:{batchId}  TTL: 24 h.
 *   5. Return { batchId, totalJobs }.
 *
 * getBatchStatus():
 *   - Read the Redis hash to discover which BullMQ job IDs belong to the batch.
 *   - Query each job's state via the Queue API.
 *   - For completed jobs, look up the reportId in the Redis hash.
 *   - Return aggregated counts + per-student results.
 *
 * retryFailedJobs():
 *   - Read the Redis hash to find the bull job IDs for this batch.
 *   - For each job currently in a failed state, call job.retry().
 *   - Return the count of jobs re-queued.
 *
 * Multi-tenant isolation: EVERY query filters by organizationId.
 * Privacy: no PII beyond first_name/gender/ratings reaches the LLM — that
 *   constraint is enforced by generateSingleReport() in report.service.ts.
 */

import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import { reportQueue } from "../jobs/queue";
import { ReportJobData } from "../jobs/report.worker";
import { ReportLength } from "../adapters/llm/types";

const prisma = new PrismaClient();

const BATCH_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** Lazy singleton Redis client for batch metadata. */
let _redis: IORedis | null = null;
function getRedis(): IORedis {
  if (!_redis) {
    const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
    _redis = new IORedis(url, { maxRetriesPerRequest: null });
    _redis.on("error", (err: Error) => {
      console.error(
        JSON.stringify({ event: "redis.batch_client_error", error: err.message })
      );
    });
  }
  return _redis;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BulkGenerateOptions {
  llmProvider?: string;
}

export interface BatchJobResult {
  studentId: string;
  reportId?: string;
  status: "completed" | "failed" | "pending" | "active";
  error?: string;
}

export interface BatchStatus {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  active: number;
  results: BatchJobResult[];
}

// ── Redis key helpers ─────────────────────────────────────────────────────────

/** Hash key for a batch. */
function batchKey(batchId: string): string {
  return `batch:${batchId}`;
}

/**
 * Hash fields layout inside  batch:{batchId} :
 *
 *   orgId                → organizationId (for ownership verification)
 *   sessionId            → the report session
 *   total                → total number of jobs
 *   student:{studentId}  → bullJobId for that student
 *   report:{studentId}   → reportId once completed
 *   error:{studentId}    → error message if the job failed
 */

// ── bulkGenerateReports ───────────────────────────────────────────────────────

export async function bulkGenerateReports(
  sessionId: string,
  orgId: string,
  options: BulkGenerateOptions
): Promise<{ batchId: string; totalJobs: number }> {
  // 1. Verify session ownership and get class_id.
  const session = await prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: orgId },
    select: {
      id: true,
      class_id: true,
      tone: true,
      length: true,
    },
  });

  if (!session) {
    throw Object.assign(
      new Error("Session not found or does not belong to this organization"),
      { code: "SESSION_NOT_FOUND", statusCode: 404 }
    );
  }

  // 2. Fetch all students in the session's class (org-scoped, no N+1).
  const students = await prisma.student.findMany({
    where: { class_id: session.class_id, organization_id: orgId },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  if (students.length === 0) {
    throw Object.assign(
      new Error("No students found in this session's class"),
      { code: "NO_STUDENTS", statusCode: 422 }
    );
  }

  // 2a. Filter out students with no ratings for this session's disciplines.
  const sessionDisciplineIds = (
    await prisma.sessionDiscipline.findMany({
      where: { session_id: sessionId },
      select: { id: true },
    })
  ).map((d) => d.id);

  const ratedStudentIdSet = new Set(
    (
      await prisma.rating.findMany({
        where: {
          student_id: { in: students.map((s) => s.id) },
          session_discipline_id: { in: sessionDisciplineIds },
        },
        select: { student_id: true },
        distinct: ["student_id"],
      })
    ).map((r) => r.student_id)
  );

  const ratedStudents = students.filter((s) => ratedStudentIdSet.has(s.id));
  const skippedCount = students.length - ratedStudents.length;

  if (ratedStudents.length === 0) {
    throw Object.assign(
      new Error("No students have ratings for this session yet — add ratings before generating reports"),
      { code: "NO_RATINGS", statusCode: 422 }
    );
  }

  const batchId = randomUUID();

  // 3. Enqueue one job per rated student (zero-rated students are skipped).
  const jobPayloads = ratedStudents.map((s) => ({
    name: "generate-report",
    data: {
      jobId: `${batchId}_${s.id}`,
      organizationId: orgId,
      studentId: s.id,
      sessionId,
      tone: session.tone,
      length: session.length as ReportLength,
    } satisfies ReportJobData,
    opts: {
      jobId: `${batchId}_${s.id}`,
    },
  }));

  const addedJobs = await reportQueue.addBulk(jobPayloads);

  // 4. Store batch metadata in Redis hash with 24-hour TTL.
  const redis = getRedis();
  const key = batchKey(batchId);

  const hashFields: string[] = [
    "orgId", orgId,
    "sessionId", sessionId,
    "total", String(ratedStudents.length),
  ];

  for (let i = 0; i < ratedStudents.length; i++) {
    const student = ratedStudents[i];
    const job = addedJobs[i];
    if (student && job) {
      hashFields.push(`student:${student.id}`, job.id ?? `${batchId}_${student.id}`);
    }
  }

  await redis.hset(key, ...hashFields);
  await redis.expire(key, BATCH_TTL_SECONDS);

  console.log(JSON.stringify({
    event: "bulk.enqueued",
    batchId,
    sessionId,
    orgId,
    totalJobs: ratedStudents.length,
    skippedCount,
  }));

  return { batchId, totalJobs: ratedStudents.length };
}

// ── getBatchStatus ────────────────────────────────────────────────────────────

export async function getBatchStatus(
  batchId: string,
  orgId: string
): Promise<BatchStatus> {
  const redis = getRedis();
  const key = batchKey(batchId);

  const hash = await redis.hgetall(key);

  if (!hash || Object.keys(hash).length === 0) {
    throw Object.assign(
      new Error("Batch not found or expired"),
      { code: "BATCH_NOT_FOUND", statusCode: 404 }
    );
  }

  if (hash["orgId"] !== orgId) {
    throw Object.assign(
      new Error("Batch not found or does not belong to this organization"),
      { code: "BATCH_NOT_FOUND", statusCode: 404 }
    );
  }

  const total = parseInt(hash["total"] ?? "0", 10);

  const studentEntries: Array<{ studentId: string; bullJobId: string }> = [];
  for (const [field, value] of Object.entries(hash)) {
    if (field.startsWith("student:")) {
      const studentId = field.slice("student:".length);
      studentEntries.push({ studentId, bullJobId: value });
    }
  }

  const results: BatchJobResult[] = await Promise.all(
    studentEntries.map(async ({ studentId, bullJobId }) => {
      const job = await reportQueue.getJob(bullJobId);

      if (!job) {
        return { studentId, status: "pending" as const };
      }

      const state = await job.getState();

      if (state === "completed") {
        const returnValue = job.returnvalue as { reportId?: string } | null;
        const reportId =
          hash[`report:${studentId}`] ?? returnValue?.reportId;
        return { studentId, reportId, status: "completed" as const };
      }

      if (state === "failed") {
        const errMsg =
          hash[`error:${studentId}`] ?? job.failedReason ?? "Unknown error";
        return { studentId, status: "failed" as const, error: errMsg };
      }

      if (state === "active") {
        return { studentId, status: "active" as const };
      }

      return { studentId, status: "pending" as const };
    })
  );

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const active = results.filter((r) => r.status === "active").length;
  const pending = total - completed - failed - active;

  return {
    batchId,
    total,
    completed,
    failed,
    pending: Math.max(0, pending),
    active,
    results,
  };
}

// ── retryFailedJobs ───────────────────────────────────────────────────────────

export async function retryFailedJobs(
  batchId: string,
  orgId: string
): Promise<{ requeued: number }> {
  const redis = getRedis();
  const key = batchKey(batchId);

  const hash = await redis.hgetall(key);

  if (!hash || Object.keys(hash).length === 0) {
    throw Object.assign(
      new Error("Batch not found or expired"),
      { code: "BATCH_NOT_FOUND", statusCode: 404 }
    );
  }

  if (hash["orgId"] !== orgId) {
    throw Object.assign(
      new Error("Batch not found or does not belong to this organization"),
      { code: "BATCH_NOT_FOUND", statusCode: 404 }
    );
  }

  const studentEntries: Array<{ studentId: string; bullJobId: string }> = [];
  for (const [field, value] of Object.entries(hash)) {
    if (field.startsWith("student:")) {
      const studentId = field.slice("student:".length);
      studentEntries.push({ studentId, bullJobId: value });
    }
  }

  let requeued = 0;

  await Promise.all(
    studentEntries.map(async ({ studentId, bullJobId }) => {
      const job = await reportQueue.getJob(bullJobId);
      if (!job) return;

      const state = await job.getState();
      if (state === "failed") {
        await job.retry();
        requeued += 1;

        await redis.hdel(key, `error:${studentId}`);

        console.log(JSON.stringify({
          event: "job.retried",
          batchId,
          bullJobId,
          studentId,
          orgId,
        }));
      }
    })
  );

  console.log(JSON.stringify({
    event: "bulk.retry_failed.complete",
    batchId,
    orgId,
    requeued,
  }));

  return { requeued };
}
