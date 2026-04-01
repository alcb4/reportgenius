/**
 * Worker process entry point.
 *
 * Run this as a separate process:
 *   node --env-file=../.env node_modules/.bin/ts-node --project tsconfig.json src/jobs/worker.ts
 *
 * This process does NOT start the HTTP server — it only processes BullMQ jobs.
 * It reads the same .env as the API server so DATABASE_URL and LLM keys are
 * available to generateSingleReport().
 */

// config import validates required env vars and throws at startup if missing.
import "../config";

import { startWorker } from "./report.worker";

const worker = startWorker();

console.log(
  JSON.stringify({
    event: "worker.process.started",
    pid: process.pid,
  })
);

// Graceful shutdown: let in-flight jobs finish before the process exits.
async function shutdown(signal: string): Promise<void> {
  console.log(
    JSON.stringify({
      event: "worker.process.shutdown",
      signal,
      pid: process.pid,
    })
  );

  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT",  () => { void shutdown("SIGINT"); });

// Keep the process alive.
process.stdin.resume();
