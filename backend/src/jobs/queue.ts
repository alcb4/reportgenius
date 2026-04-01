/**
 * BullMQ Queue and QueueEvents instances for report generation.
 *
 * Single shared instances — import these wherever jobs need to be added
 * or monitored. The Worker is created separately in worker.ts so it runs
 * as its own process.
 *
 * Redis connection reads REDIS_URL from the environment (default:
 * redis://localhost:6379). IORedis connection options are passed directly
 * to BullMQ so it manages the connection lifecycle.
 */

import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAME = "report-generation";

/** Parse redis URL or use defaults. */
const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";

/**
 * Shared IORedis connection used by the Queue and QueueEvents.
 * BullMQ requires maxRetriesPerRequest: null for blocking commands.
 */
export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (err: Error) => {
  console.error(
    JSON.stringify({
      event: "redis.connection_error",
      error: err.message,
    })
  );
});

redisConnection.on("connect", () => {
  console.log(JSON.stringify({ event: "redis.connected", url: redisUrl }));
});

/**
 * The BullMQ Queue instance. Use this to add jobs from the API server.
 * Do NOT import the Worker here — it lives in a separate process.
 */
export const reportQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000, // 2s → 4s → 8s
    },
    removeOnComplete: {
      // Keep the last 500 completed jobs for status polling.
      count: 500,
    },
    removeOnFail: {
      // Keep failed jobs for 7 days so retry-failed can re-queue them.
      age: 7 * 24 * 60 * 60,
    },
  },
});

/**
 * QueueEvents allows listening to job lifecycle events (completed, failed,
 * progress) without running a Worker. Used by the status endpoint to
 * aggregate real-time progress.
 */
export const reportQueueEvents = new QueueEvents(QUEUE_NAME, {
  connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }),
});
