---
name: Task 5 — BullMQ Bulk Generation complete
description: BullMQ queue, worker process, bulk-report service, and bulk API routes implemented and integration-tested
type: project
---

Task 5 implemented BullMQ-based bulk report generation.

**Why:** Needed async bulk processing so teachers can generate reports for whole classes without blocking HTTP responses.

**How to apply:** The bulk pipeline is: POST /bulk → bulkGenerateReports() → reportQueue.addBulk() → Redis hash → Worker processes jobs with concurrency 10 → poll GET /bulk/:batchId/status.

## Files created
- `backend/src/jobs/queue.ts` — single Queue + QueueEvents instances, exports `QUEUE_NAME`, `reportQueue`, `reportQueueEvents`, `redisConnection`
- `backend/src/jobs/report.worker.ts` — Worker with concurrency 10, `processReportJob()`, `startWorker()`, structured failure logging
- `backend/src/jobs/worker.ts` — Standalone process entry point, imports config first for fast startup fail, graceful SIGTERM/SIGINT shutdown
- `backend/src/services/bulk-report.service.ts` — `bulkGenerateReports()`, `getBatchStatus()`, `retryFailedJobs()`
- `backend/src/routes/bulk.ts` — 3 routes mounted at /api/v1 in server.ts

## Dependencies added
- `bullmq@5.71.1` and `ioredis@5.10.1` (approved in task spec)

## Key decisions
- BullMQ custom `jobId` cannot contain `:` — uses `batchId_studentId` (underscore) as the BullMQ-level ID; the logical `jobId` inside `job.data` uses `_` separator too
- Redis hash key `batch:{batchId}` stores: orgId, classId, total, `student:{studentId}` → bullJobId, `report:{studentId}` → reportId (when complete), `error:{studentId}` → error message; TTL 24h
- Status polling queries BullMQ `job.getState()` per student — O(n) but acceptable for class sizes < 100
- Retry-failed calls `job.retry()` and clears error hash fields so next poll shows clean state
- Worker reads REDIS_URL and BULL_CONCURRENCY from env (defaults: redis://localhost:6379, 10)

## Integration test results (2026-03-25)
- POST bulk → { batchId, totalJobs: 5 } confirmed
- GET status → total=5 failed=5 with "Incorrect API key" error (expected with placeholder key)
- POST retry-failed → { requeued: 5 } confirmed
- Cross-org isolation: different org token → 404 on batch status
- Worker logs showed 3 attempts per job with exponential backoff (job.start → job.failed × 3)
- TypeScript tsc --noEmit: clean

## .env additions
REDIS_URL=redis://localhost:6379
BULL_CONCURRENCY=10
