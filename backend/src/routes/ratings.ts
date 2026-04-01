/**
 * Ratings routes — scoped to ReportSession (not Class).
 *
 * POST /api/v1/sessions/:sessionId/ratings
 *   Bulk upsert ratings for students in this session.
 *   Body: { ratings: [{ studentId, sessionDisciplineId, score, comment? }] }
 *   Uses a single Prisma transaction: fetches existing ratings once, then
 *   issues targeted updates for existing rows and a batched createMany for
 *   new rows — zero N+1.
 *
 * GET  /api/v1/sessions/:sessionId/ratings
 *   Returns a grid-shaped response:
 *   { students: [...{ id, first_name, ratings: [...] }], disciplines: [...] }
 *
 * Multi-tenant isolation: every operation first verifies sessionId belongs to
 * req.user.organizationId. Students and disciplines are additionally verified
 * to belong to the session's class.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

// ── Zod schemas ──────────────────────────────────────────────────────────────

const RatingEntrySchema = z.object({
  studentId: z.string().uuid("studentId must be a valid UUID"),
  sessionDisciplineId: z.string().uuid("sessionDisciplineId must be a valid UUID"),
  score: z
    .number()
    .int("score must be an integer")
    .min(1, "score must be at least 1")
    .max(5, "score must be at most 5"),
  comment: z.string().max(2000).nullish(),
});

const BulkRatingsSchema = z.object({
  ratings: z
    .array(RatingEntrySchema)
    .min(1, "ratings array must not be empty")
    .max(10000, "Too many ratings in a single request"),
});

// ── Helper: verify session belongs to org ────────────────────────────────────

async function resolveSession(
  sessionId: string,
  organizationId: string
): Promise<{ id: string; class_id: string } | null> {
  return prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: organizationId },
    select: { id: true, class_id: true },
  });
}

// ── POST /api/v1/sessions/:sessionId/ratings ─────────────────────────────────

router.post(
  "/sessions/:sessionId/ratings",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      // 1. Verify session ownership.
      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      // 2. Validate request body.
      const parsed = BulkRatingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { ratings: incomingRatings } = parsed.data;

      // 3. Collect unique student and discipline IDs from the request.
      const incomingStudentIds = [...new Set(incomingRatings.map((r) => r.studentId))];
      const incomingDisciplineIds = [
        ...new Set(incomingRatings.map((r) => r.sessionDisciplineId)),
      ];

      // 4. Verify all referenced students belong to this session's class and org (one query).
      const validStudents = await prisma.student.findMany({
        where: {
          id: { in: incomingStudentIds },
          class_id: session.class_id,
          organization_id: organizationId,
        },
        select: { id: true },
      });
      const validStudentIdSet = new Set(validStudents.map((s) => s.id));

      const invalidStudentId = incomingStudentIds.find((id) => !validStudentIdSet.has(id));
      if (invalidStudentId !== undefined) {
        res.status(422).json({
          error: `Student ${invalidStudentId} does not belong to this session's class`,
          code: "STUDENT_NOT_IN_CLASS",
        });
        return;
      }

      // 5. Verify all referenced disciplines belong to this session (one query).
      const validDisciplines = await prisma.sessionDiscipline.findMany({
        where: {
          id: { in: incomingDisciplineIds },
          session_id: sessionId,
        },
        select: { id: true },
      });
      const validDisciplineIdSet = new Set(validDisciplines.map((d) => d.id));

      const invalidDisciplineId = incomingDisciplineIds.find(
        (id) => !validDisciplineIdSet.has(id)
      );
      if (invalidDisciplineId !== undefined) {
        res.status(422).json({
          error: `Discipline ${invalidDisciplineId} does not belong to this session`,
          code: "DISCIPLINE_NOT_IN_SESSION",
        });
        return;
      }

      // 6. Bulk upsert inside a single transaction.
      //    Fetch all existing ratings for the affected students + disciplines in one query.
      //    Build a lookup map by "studentId|sessionDisciplineId".
      //    Update existing rows; batch-create new rows.
      //    No N+1: at most two round-trips (one findMany + one createMany) plus parallel updates.
      const upsertResult = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const existingRatings = await tx.rating.findMany({
            where: {
              student_id: { in: incomingStudentIds },
              session_discipline_id: { in: incomingDisciplineIds },
            },
            select: { id: true, student_id: true, session_discipline_id: true },
          });

          // "studentId|sessionDisciplineId" -> ratingId
          const existingMap = new Map<string, string>();
          for (const r of existingRatings) {
            existingMap.set(`${r.student_id}|${r.session_discipline_id}`, r.id);
          }

          const toCreate: Array<{
            student_id: string;
            session_discipline_id: string;
            score: number;
            comment: string | null;
          }> = [];

          const updatePromises: Array<Promise<unknown>> = [];

          for (const rating of incomingRatings) {
            const key = `${rating.studentId}|${rating.sessionDisciplineId}`;
            const existingId = existingMap.get(key);

            if (existingId !== undefined) {
              updatePromises.push(
                tx.rating.update({
                  where: { id: existingId },
                  data: {
                    score: rating.score,
                    comment: rating.comment ?? null,
                  },
                })
              );
            } else {
              toCreate.push({
                student_id: rating.studentId,
                session_discipline_id: rating.sessionDisciplineId,
                score: rating.score,
                comment: rating.comment ?? null,
              });
            }
          }

          await Promise.all(updatePromises);

          if (toCreate.length > 0) {
            await tx.rating.createMany({ data: toCreate });
          }

          return {
            updated: updatePromises.length,
            created: toCreate.length,
          };
        }
      );

      // Mark any existing reports for the affected students as stale.
      // This stamps ratings_changed_at so the frontend can show a warning.
      const affectedStudentIds = incomingStudentIds;
      await prisma.report.updateMany({
        where: {
          session_id: sessionId,
          student_id: { in: affectedStudentIds },
          organization_id: organizationId,
        },
        data: { ratings_changed_at: new Date() },
      });

      console.log(JSON.stringify({
        event: "ratings.bulk_upserted",
        sessionId,
        organizationId,
        created: upsertResult.created,
        updated: upsertResult.updated,
        total: incomingRatings.length,
      }));

      res.status(200).json({
        message: "Ratings saved",
        created: upsertResult.created,
        updated: upsertResult.updated,
        total: incomingRatings.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/ratings ───────────────────────────────────
// Returns a grid-shaped response: students (with their ratings) + discipline column headers.
// Two parallel Prisma queries — no N+1.

router.get(
  "/sessions/:sessionId/ratings",
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

      // Fetch disciplines and students+ratings in parallel — two queries total.
      const [disciplines, students] = await Promise.all([
        prisma.sessionDiscipline.findMany({
          where: { session_id: sessionId },
          select: { id: true, name: true, category: true, is_custom: true },
          orderBy: { created_at: "asc" },
        }),
        prisma.student.findMany({
          where: { class_id: session.class_id, organization_id: organizationId },
          select: {
            id: true,
            first_name: true,
            last_name: true,
            gender: true,
            ratings: {
              where: {
                session_discipline: { session_id: sessionId },
              },
              select: {
                session_discipline_id: true,
                score: true,
                comment: true,
              },
            },
          },
          orderBy: { first_name: "asc" },
        }),
      ]);

      res.status(200).json({ students, disciplines });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
