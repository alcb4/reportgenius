/**
 * Report Session routes
 *
 * POST /api/v1/classes/:classId/sessions             — create session
 * GET  /api/v1/classes/:classId/sessions             — list sessions for a class
 * GET  /api/v1/sessions/:sessionId                   — session detail + disciplines + ratings grid
 * PUT  /api/v1/sessions/:sessionId                   — edit name, topics, tone, length, status
 * POST /api/v1/sessions/:sessionId/duplicate         — copy session setup (no ratings/reports)
 *
 * Multi-tenant isolation: every operation verifies class/session belongs to
 * req.user.organizationId before touching any data.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { randomUUID } from "crypto";

const router = Router();
const prisma = new PrismaClient();

// ── Zod schemas ──────────────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  name: z.string().min(1, "Session name is required").max(255),
  topics_covered: z.array(z.string()).optional().default([]),
  tone: z.string().max(50).optional().default("balanced"),
  length: z.enum(["short", "medium", "long"]).optional().default("medium"),
  // Template discipline IDs to add from the library.
  templateDisciplineIds: z.array(z.string().uuid()).optional().default([]),
  // Custom discipline names to add (not from library).
  customDisciplines: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        category: z.string().max(100).optional(),
      })
    )
    .optional()
    .default([]),
});

const UpdateSessionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  topics_covered: z.array(z.string()).optional(),
  // Tone values: gentle | balanced | direct
  tone: z.enum(["gentle", "balanced", "direct"]).optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
  status: z.enum(["draft", "in_progress", "complete"]).optional(),
  // Filter persistence fields
  test_filters: z.record(z.object({
    includeMark: z.boolean().optional(),
    includePercentage: z.boolean().optional(),
    includeGrade: z.boolean().optional(),
    includeLowMention: z.boolean().optional(),
  })).nullable().optional(),
  progression_filters: z.array(z.string()).optional(),
  enable_progression: z.boolean().optional(),
  allow_negative_progression: z.boolean().optional(),
  class_overview: z.string().max(2000).nullable().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveClass(
  classId: string,
  organizationId: string
): Promise<{ id: string } | null> {
  return prisma.class.findFirst({
    where: { id: classId, organization_id: organizationId },
    select: { id: true },
  });
}

async function resolveSession(
  sessionId: string,
  organizationId: string
): Promise<{ id: string; class_id: string; topics_covered: string[] } | null> {
  return prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: organizationId },
    select: { id: true, class_id: true, topics_covered: true },
  }) as Promise<{ id: string; class_id: string; topics_covered: string[] } | null>;
}

// ── POST /api/v1/classes/:classId/sessions ───────────────────────────────────

router.post(
  "/classes/:classId/sessions",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      const cls = await resolveClass(classId, organizationId);
      if (!cls) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const parsed = CreateSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { name, topics_covered, tone, length, templateDisciplineIds, customDisciplines } =
        parsed.data;

      // Resolve template disciplines from the library.
      let templateDisciplines: Array<{ name: string; category: string | null }> = [];
      if (templateDisciplineIds.length > 0) {
        const templates = await prisma.disciplineTemplate.findMany({
          where: { id: { in: templateDisciplineIds } },
          select: { name: true, category: true },
        });
        templateDisciplines = templates;
      }

      // Build full discipline list for the session.
      const disciplineData: Array<{
        name: string;
        category: string | null;
        is_custom: boolean;
      }> = [
        ...templateDisciplines.map((t) => ({
          name: t.name,
          category: t.category,
          is_custom: false,
        })),
        ...customDisciplines.map((c) => ({
          name: c.name,
          category: c.category ?? null,
          is_custom: true,
        })),
      ];

      const session = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.reportSession.create({
          data: {
            organization_id: organizationId,
            class_id: classId,
            name,
            topics_covered,
            tone,
            length,
            status: "draft",
            progression_filters: [],
          },
          select: {
            id: true,
            organization_id: true,
            class_id: true,
            name: true,
            topics_covered: true,
            tone: true,
            length: true,
            status: true,
            created_at: true,
            updated_at: true,
          },
        });

        if (disciplineData.length > 0) {
          await tx.sessionDiscipline.createMany({
            data: disciplineData.map((d) => ({
              session_id: created.id,
              name: d.name,
              category: d.category,
              is_custom: d.is_custom,
            })),
          });
        }

        const disciplines = await tx.sessionDiscipline.findMany({
          where: { session_id: created.id },
          select: { id: true, name: true, category: true, is_custom: true, created_at: true },
          orderBy: { created_at: "asc" },
        });

        return { ...created, disciplines };
      });

      console.log(JSON.stringify({
        event: "session.created",
        sessionId: session.id,
        classId,
        organizationId,
        disciplineCount: session.disciplines.length,
      }));

      res.status(201).json({ data: session });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/classes/:classId/sessions ────────────────────────────────────

router.get(
  "/classes/:classId/sessions",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      const cls = await resolveClass(classId, organizationId);
      if (!cls) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const sessions = await prisma.reportSession.findMany({
        where: { class_id: classId, organization_id: organizationId },
        select: {
          id: true,
          name: true,
          topics_covered: true,
          tone: true,
          length: true,
          status: true,
          is_template: true,
          source_template_id: true,
          created_at: true,
          updated_at: true,
          _count: { select: { disciplines: true, reports: true } },
        },
        orderBy: { created_at: "desc" },
      });

      res.status(200).json({ data: sessions });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId ──────────────────────────────────────────
// Returns session + disciplines + student ratings grid.

router.get(
  "/sessions/:sessionId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: {
          id: true,
          organization_id: true,
          class_id: true,
          name: true,
          topics_covered: true,
          tone: true,
          length: true,
          status: true,
          is_template: true,
          source_template_id: true,
          test_filters: true,
          progression_filters: true,
          enable_progression: true,
          allow_negative_progression: true,
          class_overview: true,
          created_at: true,
          updated_at: true,
          disciplines: {
            select: {
              id: true,
              name: true,
              category: true,
              is_custom: true,
              created_at: true,
            },
            orderBy: { created_at: "asc" },
          },
        },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      // Fetch all students for this class with their ratings for this session's disciplines.
      const disciplineIds = session.disciplines.map((d) => d.id);

      const students = await prisma.student.findMany({
        where: { class_id: session.class_id, organization_id: organizationId },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          gender: true,
          ratings: {
            where: { session_discipline_id: { in: disciplineIds } },
            select: {
              session_discipline_id: true,
              score: true,
              comment: true,
            },
          },
        },
        orderBy: { first_name: "asc" },
      });

      res.status(200).json({
        data: {
          session,
          students,
          disciplines: session.disciplines,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/v1/sessions/:sessionId ──────────────────────────────────────────

router.put(
  "/sessions/:sessionId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const existing = await resolveSession(sessionId, organizationId);
      if (!existing) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = UpdateSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const updateData: Prisma.ReportSessionUpdateInput = {};
      if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
      if (parsed.data.topics_covered !== undefined) updateData.topics_covered = parsed.data.topics_covered;
      if (parsed.data.tone !== undefined) updateData.tone = parsed.data.tone;
      if (parsed.data.length !== undefined) updateData.length = parsed.data.length;
      if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
      if (parsed.data.test_filters !== undefined) updateData.test_filters = parsed.data.test_filters as Prisma.InputJsonValue ?? Prisma.JsonNull;
      if (parsed.data.progression_filters !== undefined) updateData.progression_filters = parsed.data.progression_filters;
      if (parsed.data.enable_progression !== undefined) updateData.enable_progression = parsed.data.enable_progression;
      if (parsed.data.allow_negative_progression !== undefined) updateData.allow_negative_progression = parsed.data.allow_negative_progression;
      if (parsed.data.class_overview !== undefined) updateData.class_overview = parsed.data.class_overview ?? null;

      // Topic mutation safety: if topics_covered is changing, find removed topics
      // and delete any TopicRating rows for those topics within the same transaction.
      const newTopics = parsed.data.topics_covered;
      const removedTopics =
        newTopics !== undefined
          ? existing.topics_covered.filter((t) => !newTopics.includes(t))
          : [];

      const sessionSelectFields = {
        id: true,
        name: true,
        topics_covered: true,
        tone: true,
        length: true,
        status: true,
        test_filters: true,
        progression_filters: true,
        enable_progression: true,
        allow_negative_progression: true,
        class_overview: true,
        created_at: true,
        updated_at: true,
      } as const;

      type UpdatedSession = {
        id: string;
        name: string;
        topics_covered: string[];
        tone: string;
        length: string;
        status: string;
        test_filters: Prisma.JsonValue | null;
        progression_filters: string[];
        enable_progression: boolean;
        allow_negative_progression: boolean;
        class_overview: string | null;
        created_at: Date;
        updated_at: Date;
      };

      let updated: UpdatedSession;

      if (removedTopics.length > 0) {
        // Transactionally delete orphaned topic ratings then update the session.
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.topicRating.deleteMany({
            where: {
              session_id: sessionId,
              topic_name: { in: removedTopics },
            },
          });

          return tx.reportSession.update({
            where: { id: sessionId },
            data: updateData,
            select: sessionSelectFields,
          });
        });

        updated = result as UpdatedSession;

        console.log(JSON.stringify({
          event: "session.topics.removed",
          sessionId,
          organizationId,
          removedTopics,
        }));
      } else {
        updated = (await prisma.reportSession.update({
          where: { id: sessionId },
          data: updateData,
          select: sessionSelectFields,
        })) as UpdatedSession;
      }

      console.log(JSON.stringify({
        event: "session.updated",
        sessionId,
        organizationId,
      }));

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/sessions/:sessionId/duplicate ───────────────────────────────
// Copy session setup (disciplines + settings) as a new draft session.
// Ratings and reports are NOT copied.

router.post(
  "/sessions/:sessionId/duplicate",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const source = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: {
          class_id: true,
          name: true,
          topics_covered: true,
          tone: true,
          length: true,
          disciplines: {
            select: { name: true, category: true, is_custom: true },
          },
        },
      });

      if (!source) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const newSession = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.reportSession.create({
          data: {
            id: randomUUID(),
            organization_id: organizationId,
            class_id: source.class_id,
            name: `${source.name} (Copy)`,
            topics_covered: source.topics_covered,
            tone: source.tone,
            length: source.length,
            status: "draft",
            progression_filters: [],
          },
          select: {
            id: true,
            name: true,
            topics_covered: true,
            tone: true,
            length: true,
            status: true,
            created_at: true,
            updated_at: true,
          },
        });

        if (source.disciplines.length > 0) {
          await tx.sessionDiscipline.createMany({
            data: source.disciplines.map((d) => ({
              session_id: created.id,
              name: d.name,
              category: d.category,
              is_custom: d.is_custom,
            })),
          });
        }

        const disciplines = await tx.sessionDiscipline.findMany({
          where: { session_id: created.id },
          select: { id: true, name: true, category: true, is_custom: true },
          orderBy: { created_at: "asc" },
        });

        return { ...created, disciplines };
      });

      console.log(JSON.stringify({
        event: "session.duplicated",
        sourceSessionId: sessionId,
        newSessionId: newSession.id,
        organizationId,
      }));

      res.status(201).json({ data: newSession });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/v1/sessions/:sessionId/topics/rename ──────────────────────────
// Atomically rename a topic in topics_covered and update all matching
// TopicRating rows in the same transaction. Prevents dangling ratings.

const RenameTopicSchema = z.object({
  oldName: z.string().min(1).max(255),
  newName: z.string().min(1).max(255),
});

router.patch(
  "/sessions/:sessionId/topics/rename",
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

      const parsed = RenameTopicSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { oldName, newName } = parsed.data;

      if (!session.topics_covered.includes(oldName)) {
        res.status(422).json({
          error: `Topic "${oldName}" does not exist in this session`,
          code: "TOPIC_NOT_FOUND",
        });
        return;
      }

      if (session.topics_covered.includes(newName)) {
        res.status(422).json({
          error: `Topic "${newName}" already exists in this session`,
          code: "TOPIC_ALREADY_EXISTS",
        });
        return;
      }

      const updatedTopics = session.topics_covered.map((t) =>
        t === oldName ? newName : t
      );

      const { renamedRatingsCount } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.reportSession.update({
          where: { id: sessionId },
          data: { topics_covered: updatedTopics },
        });

        const { count } = await tx.topicRating.updateMany({
          where: {
            session_id: sessionId,
            topic_name: oldName,
          },
          data: { topic_name: newName },
        });

        return { renamedRatingsCount: count };
      });

      console.log(JSON.stringify({
        event: "session.topic.renamed",
        sessionId,
        organizationId,
        oldName,
        newName,
        renamedRatingsCount,
      }));

      res.status(200).json({ data: { renamedRatingsCount } });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/classes/:classId/sessions/copy ───────────────────────────────
// Copy a session's config (disciplines, topics, tone, length) to one or more
// target classes as new draft sessions. No ratings or reports are copied.
// Body: { sourceSessionId: string, targetClassIds: string[] }

const CopySessionSchema = z.object({
  sourceSessionId: z.string().uuid("sourceSessionId must be a UUID"),
  targetClassIds: z.array(z.string().uuid()).min(1, "At least one target class is required"),
});

router.post(
  "/classes/:classId/sessions/copy",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      // Verify source class belongs to org
      const cls = await resolveClass(classId, organizationId);
      if (!cls) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const parsed = CopySessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { sourceSessionId, targetClassIds } = parsed.data;

      // Fetch source session — must belong to this org and this class
      const sourceSession = await prisma.reportSession.findFirst({
        where: { id: sourceSessionId, organization_id: organizationId },
        select: {
          id: true,
          name: true,
          topics_covered: true,
          tone: true,
          length: true,
          disciplines: {
            select: { name: true, category: true, is_custom: true },
          },
        },
      });

      if (!sourceSession) {
        res.status(404).json({ error: "Source session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      // Verify each target class belongs to the same org
      const targetClasses = await prisma.class.findMany({
        where: {
          id: { in: targetClassIds },
          organization_id: organizationId,
        },
        select: { id: true, name: true },
      });

      if (targetClasses.length !== targetClassIds.length) {
        res.status(404).json({
          error: "One or more target classes not found",
          code: "CLASS_NOT_FOUND",
        });
        return;
      }

      // Create sessions for each target class in a single transaction
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const results: Array<{ classId: string; sessionId: string; className: string }> = [];

        for (const targetClass of targetClasses) {
          const newSessionId = randomUUID();
          await tx.reportSession.create({
            data: {
              id: newSessionId,
              organization_id: organizationId,
              class_id: targetClass.id,
              name: sourceSession.name,
              topics_covered: sourceSession.topics_covered,
              tone: sourceSession.tone,
              length: sourceSession.length,
              status: "draft",
              source_template_id: sourceSessionId,
              progression_filters: [],
            },
          });

          if (sourceSession.disciplines.length > 0) {
            await tx.sessionDiscipline.createMany({
              data: sourceSession.disciplines.map((d) => ({
                session_id: newSessionId,
                name: d.name,
                category: d.category,
                is_custom: d.is_custom,
              })),
            });
          }

          results.push({
            classId: targetClass.id,
            sessionId: newSessionId,
            className: targetClass.name,
          });
        }

        return results;
      });

      console.log(JSON.stringify({
        event: "session.copied",
        sourceSessionId,
        organizationId,
        targetCount: created.length,
      }));

      res.status(201).json({ created, total: created.length });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/v1/sessions/:sessionId/mark-template ─────────────────────────────
// Toggle is_template flag on a session.
// Body: { is_template: boolean }

const MarkTemplateSchema = z.object({
  is_template: z.boolean(),
});

router.put(
  "/sessions/:sessionId/mark-template",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const existing = await resolveSession(sessionId, organizationId);
      if (!existing) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const parsed = MarkTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const updated = await prisma.reportSession.update({
        where: { id: sessionId },
        data: { is_template: parsed.data.is_template },
        select: {
          id: true,
          name: true,
          is_template: true,
          source_template_id: true,
        },
      });

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/progression-data ──────────────────────────
// Returns historical discipline-score progression comparing this session to the
// most recently completed session in the same class.
//
// Query param: studentId (optional) — if omitted, picks any student who has
// ratings in the current session.
//
// Response: { previousSession: { id, name, completed_at } | null, matchedDisciplines: [...] }

router.get(
  "/sessions/:sessionId/progression-data",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;
      const studentIdParam = req.query["studentId"];
      const requestedStudentId =
        typeof studentIdParam === "string" && studentIdParam.length > 0
          ? studentIdParam
          : null;

      // 1. Resolve current session — must belong to this org.
      const currentSession = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: {
          id: true,
          class_id: true,
          disciplines: {
            select: { id: true, name: true },
            orderBy: { created_at: "asc" },
          },
        },
      });

      if (!currentSession) {
        res
          .status(404)
          .json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      // 2. Find the most recently completed session in the same class (excluding this one).
      const previousSession = await prisma.reportSession.findFirst({
        where: {
          class_id: currentSession.class_id,
          organization_id: organizationId,
          status: "complete",
          id: { not: sessionId },
        },
        select: {
          id: true,
          name: true,
          updated_at: true,
          disciplines: {
            select: { id: true, name: true },
            orderBy: { created_at: "asc" },
          },
        },
        orderBy: { updated_at: "desc" },
      });

      if (!previousSession) {
        res.status(200).json({
          previousSession: null,
          matchedDisciplines: [],
        });
        return;
      }

      // 3. Pick a student — use provided studentId or find the first student with
      //    ratings in the current session.
      let resolvedStudentId: string | null = requestedStudentId;

      if (!resolvedStudentId) {
        const currentDisciplineIds = currentSession.disciplines.map((d) => d.id);
        const firstRating = await prisma.rating.findFirst({
          where: {
            session_discipline_id: { in: currentDisciplineIds },
          },
          select: { student_id: true },
        });
        resolvedStudentId = firstRating?.student_id ?? null;
      }

      if (!resolvedStudentId) {
        // No ratings yet — nothing to compare.
        res.status(200).json({
          previousSession: {
            id: previousSession.id,
            name: previousSession.name,
            completed_at: previousSession.updated_at,
          },
          matchedDisciplines: [],
        });
        return;
      }

      // Verify the student belongs to this org.
      const studentCheck = await prisma.student.findFirst({
        where: { id: resolvedStudentId, organization_id: organizationId },
        select: { id: true },
      });
      if (!studentCheck) {
        res
          .status(404)
          .json({ error: "Student not found", code: "STUDENT_NOT_FOUND" });
        return;
      }

      // 4. Fetch ratings for this student in the current session.
      const currentDisciplineIds = currentSession.disciplines.map((d) => d.id);
      const currentRatings = await prisma.rating.findMany({
        where: {
          student_id: resolvedStudentId,
          session_discipline_id: { in: currentDisciplineIds },
        },
        select: {
          score: true,
          session_discipline: { select: { name: true } },
        },
      });

      // Build a name → score map for the current session.
      const currentScoreByName = new Map<string, number>();
      for (const r of currentRatings) {
        currentScoreByName.set(r.session_discipline.name, r.score);
      }

      // 5. Fetch ratings for this student in the previous session.
      const previousDisciplineIds = previousSession.disciplines.map((d) => d.id);
      const previousRatings = await prisma.rating.findMany({
        where: {
          student_id: resolvedStudentId,
          session_discipline_id: { in: previousDisciplineIds },
        },
        select: {
          score: true,
          session_discipline: { select: { name: true } },
        },
      });

      const previousScoreByName = new Map<string, number>();
      for (const r of previousRatings) {
        previousScoreByName.set(r.session_discipline.name, r.score);
      }

      // 6. Match disciplines by name and compute trend.
      type Trend = "improved" | "declined" | "maintained";
      interface MatchedDiscipline {
        name: string;
        currentScore: number;
        previousScore: number;
        trend: Trend;
      }

      const matchedDisciplines: MatchedDiscipline[] = [];

      for (const [name, currentScore] of currentScoreByName) {
        const previousScore = previousScoreByName.get(name);
        if (previousScore === undefined) continue;

        const trend: Trend =
          currentScore > previousScore
            ? "improved"
            : currentScore < previousScore
            ? "declined"
            : "maintained";

        matchedDisciplines.push({ name, currentScore, previousScore, trend });
      }

      console.log(
        JSON.stringify({
          event: "session.progression_data.fetched",
          sessionId,
          previousSessionId: previousSession.id,
          organizationId,
          studentId: resolvedStudentId,
          matchedCount: matchedDisciplines.length,
        })
      );

      res.status(200).json({
        previousSession: {
          id: previousSession.id,
          name: previousSession.name,
          completed_at: previousSession.updated_at,
        },
        matchedDisciplines,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/tests ──────────────────────────────────────
// Returns tests scoped to this session (session_id = sessionId).

router.get(
  "/sessions/:sessionId/tests",
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

      const tests = await prisma.test.findMany({
        where: { session_id: sessionId, class_id: session.class_id },
        select: {
          id: true,
          name: true,
          topics: true,
          max_mark: true,
          grade_boundaries: true,
          created_at: true,
          _count: { select: { results: true } },
        },
        orderBy: { created_at: "asc" },
      });

      res.status(200).json({ data: tests });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/sessions/:sessionId/tests ─────────────────────────────────────
// Creates a test scoped to this session. Sets both session_id and class_id
// derived from the session so the test appears in class-level listings too.

const CreateSessionTestSchema = z.object({
  name: z.string().min(1, "Test name is required").max(255),
  topics: z.array(z.string()).optional().default([]),
  max_mark: z.number().int().min(1),
  grade_boundaries: z.record(z.number()).optional().default({}),
});

router.post(
  "/sessions/:sessionId/tests",
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

      const parsed = CreateSessionTestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const test = await prisma.test.create({
        data: {
          class_id: session.class_id,
          session_id: sessionId,
          name: parsed.data.name,
          topics: parsed.data.topics,
          max_mark: parsed.data.max_mark,
          grade_boundaries: parsed.data.grade_boundaries,
        },
        select: {
          id: true,
          name: true,
          topics: true,
          max_mark: true,
          grade_boundaries: true,
          session_id: true,
          class_id: true,
          created_at: true,
        },
      });

      console.log(JSON.stringify({
        event: "test.created_for_session",
        testId: test.id,
        sessionId,
        classId: session.class_id,
        organizationId,
      }));

      res.status(201).json({ data: test });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
