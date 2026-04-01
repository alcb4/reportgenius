/**
 * ReportGenius Express server entry point.
 * Connects to Prisma, applies middleware, mounts routes, handles errors.
 */

// Config is imported first — throws immediately if required env vars are missing.
import { config } from "./config";

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";

import authRouter from "./routes/auth";
import classesRouter from "./routes/classes";
import sessionsRouter from "./routes/sessions";
import studentsRouter from "./routes/students";
import disciplinesRouter from "./routes/disciplines";
import ratingsRouter from "./routes/ratings";
import reportsRouter from "./routes/reports";
import bulkRouter from "./routes/bulk";
import exportsRouter from "./routes/exports";
import settingsRouter from "./routes/settings";
import topicRatingsRouter from "./routes/topic-ratings";

const app = express();
const prisma = new PrismaClient();

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json());

// ── Health check ───────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── API Routes ─────────────────────────────────────────────────────────────────

app.use("/api/v1/auth", authRouter);

// Classes — mounted at /api/v1/classes, router controls sub-paths.
app.use("/api/v1/classes", classesRouter);

// Sessions — mixed prefixes:
//   /classes/:classId/sessions
//   /sessions/:sessionId
//   /sessions/:sessionId/duplicate
app.use("/api/v1", sessionsRouter);

// Students — mixed prefixes:
//   /classes/:classId/students
//   /students/:studentId
app.use("/api/v1", studentsRouter);

// Disciplines — mixed prefixes:
//   /discipline-templates
//   /sessions/:sessionId/disciplines
//   /sessions/:sessionId/disciplines/:disciplineId
app.use("/api/v1", disciplinesRouter);

// Ratings — scoped to sessions:
//   /sessions/:sessionId/ratings
app.use("/api/v1", ratingsRouter);

// Reports — mixed prefixes:
//   /sessions/:sessionId/students/:studentId/generate
//   /sessions/:sessionId/reports
//   /reports/:reportId  (GET, PUT, POST /redo)
app.use("/api/v1", reportsRouter);

// Bulk generation routes — scoped to sessions:
//   /sessions/:sessionId/generate/bulk
//   /sessions/:sessionId/generate/bulk/:batchId/status
//   /sessions/:sessionId/generate/bulk/:batchId/retry-failed
app.use("/api/v1", bulkRouter);

// Export routes:
//   /reports/:reportId/export/pdf
//   /sessions/:sessionId/export/pdf
//   /sessions/:sessionId/export/csv
app.use("/api/v1", exportsRouter);

// Settings routes:
//   GET /api/v1/settings
//   PUT /api/v1/settings
//   GET /api/v1/settings/test
app.use("/api/v1", settingsRouter);

// Topic Ratings routes:
//   POST /api/v1/sessions/:sessionId/topic-ratings/bulk
//   GET  /api/v1/sessions/:sessionId/topic-ratings
app.use("/api/v1", topicRatingsRouter);

// Tests (test-level routes, not class-scoped):
//   GET    /api/v1/tests/:testId/results
//   POST   /api/v1/tests/:testId/results/bulk
//   PUT    /api/v1/tests/:testId
//   DELETE /api/v1/tests/:testId
app.use("/api/v1", classesRouter);

// ── 404 handler ────────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found", code: "NOT_FOUND" });
});

// ── Centralised error handler ──────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";

  console.error(JSON.stringify({
    event: "server.error",
    error: message,
    stack: err instanceof Error ? err.stack : undefined,
  }));

  res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
});

// ── Startup ────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    await prisma.$connect();
    console.log(JSON.stringify({ event: "db.connected" }));

    app.listen(config.port, () => {
      console.log(JSON.stringify({
        event: "server.started",
        port: config.port,
        env: config.nodeEnv,
        message: `Server running on port ${config.port}`,
      }));
    });
  } catch (err) {
    console.error(JSON.stringify({
      event: "server.startup_failed",
      error: err instanceof Error ? err.message : String(err),
    }));
    process.exit(1);
  }
}

start();
