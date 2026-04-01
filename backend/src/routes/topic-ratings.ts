/**
 * Topic Ratings routes
 *
 * POST /api/v1/sessions/:sessionId/topic-ratings/bulk
 *   — Bulk upsert topic ratings for students in a session.
 *
 * GET  /api/v1/sessions/:sessionId/topic-ratings
 *   — Retrieve all topic ratings for a session, grouped by topics.
 *
 * Multi-tenant isolation: every query filters by organization_id from req.user.
 * Privacy: topic ratings are score-only (1–5 per topic) — no PII stored here.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const BulkRatingItemSchema = z.object({
  studentId: z.string().uuid(),
  topicName: z.string().min(1).max(255),
  score: z.number().int().min(1).max(5),
});

const BulkRatingsSchema = z.object({
  ratings: z.array(BulkRatingItemSchema).min(1),
});

// ── POST /api/v1/sessions/:sessionId/topic-ratings/bulk ───────────────────────

router.post(
  "/sessions/:sessionId/topic-ratings/bulk",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      // Validate session belongs to this org.
      const session = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: { id: true, class_id: true, topics_covered: true },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      // Parse and validate request body.
      const parsed = BulkRatingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { ratings } = parsed.data;

      // Validate all topicNames exist in session.topics_covered.
      const topicsSet = new Set(session.topics_covered);
      const invalidTopics = ratings
        .map((r) => r.topicName)
        .filter((t) => !topicsSet.has(t));

      if (invalidTopics.length > 0) {
        const unique = [...new Set(invalidTopics)];
        res.status(422).json({
          error: `Topic(s) not in session: ${unique.join(", ")}`,
          code: "INVALID_TOPIC",
        });
        return;
      }

      // Validate all studentIds belong to this session's class (no N+1).
      const inputStudentIds = [...new Set(ratings.map((r) => r.studentId))];

      const validStudents = await prisma.student.findMany({
        where: {
          id: { in: inputStudentIds },
          class_id: session.class_id,
          organization_id: organizationId,
        },
        select: { id: true },
      });

      const validStudentIdSet = new Set(validStudents.map((s) => s.id));
      const invalidStudentIds = inputStudentIds.filter((id) => !validStudentIdSet.has(id));

      if (invalidStudentIds.length > 0) {
        res.status(422).json({
          error: `Student(s) not in session's class: ${invalidStudentIds.join(", ")}`,
          code: "INVALID_STUDENT",
        });
        return;
      }

      // Fetch existing TopicRatings for the affected students in this session.
      // Keyed by `${student_id}|${topic_name}` for O(1) lookup — no N+1.
      const existing = await prisma.topicRating.findMany({
        where: {
          session_id: sessionId,
          student_id: { in: inputStudentIds },
          organization_id: organizationId,
        },
        select: { id: true, student_id: true, topic_name: true },
      });

      const existingMap = new Map<string, string>(
        existing.map((e) => [`${e.student_id}|${e.topic_name}`, e.id])
      );

      // Split into creates and updates.
      const toCreate: Prisma.TopicRatingUncheckedCreateInput[] = [];
      const toUpdate: Array<{ id: string; score: number }> = [];

      for (const r of ratings) {
        const key = `${r.studentId}|${r.topicName}`;
        const existingId = existingMap.get(key);
        if (existingId !== undefined) {
          toUpdate.push({ id: existingId, score: r.score });
        } else {
          toCreate.push({
            organization_id: organizationId,
            session_id: sessionId,
            student_id: r.studentId,
            topic_name: r.topicName,
            score: r.score,
          });
        }
      }

      // Run all writes in a single transaction.
      await prisma.$transaction([
        ...toCreate.map((data) =>
          prisma.topicRating.create({ data })
        ),
        ...toUpdate.map(({ id, score }) =>
          prisma.topicRating.update({ where: { id }, data: { score } })
        ),
      ]);

      // Mark any existing reports for the affected students as stale.
      await prisma.report.updateMany({
        where: {
          session_id: sessionId,
          student_id: { in: inputStudentIds },
          organization_id: organizationId,
        },
        data: { ratings_changed_at: new Date() },
      });

      console.log(JSON.stringify({
        event: "topic_ratings.bulk_upsert",
        sessionId,
        organizationId,
        created: toCreate.length,
        updated: toUpdate.length,
      }));

      res.status(200).json({
        data: {
          created: toCreate.length,
          updated: toUpdate.length,
          total: toCreate.length + toUpdate.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/topic-ratings ─────────────────────────────

router.get(
  "/sessions/:sessionId/topic-ratings",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      // Validate session belongs to this org.
      const session = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: { id: true, topics_covered: true },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const topicRatings = await prisma.topicRating.findMany({
        where: { session_id: sessionId, organization_id: organizationId },
        select: {
          student_id: true,
          topic_name: true,
          score: true,
        },
        orderBy: [{ student_id: "asc" }, { topic_name: "asc" }],
      });

      res.status(200).json({
        topics: session.topics_covered,
        ratings: topicRatings.map((r) => ({
          studentId: r.student_id,
          topicName: r.topic_name,
          score: r.score,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
