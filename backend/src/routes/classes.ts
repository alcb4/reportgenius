/**
 * Classes routes
 *
 * GET    /api/v1/classes              — list all classes with student + session counts
 * POST   /api/v1/classes              — create a class
 * GET    /api/v1/classes/:id          — full class with students + sessions list
 * PUT    /api/v1/classes/:id          — edit name, year_group, subject
 * POST   /api/v1/classes/:id/archive  — soft-delete (set archived: true)
 *
 * Multi-tenant isolation: every query filters by organization_id.
 * Class no longer carries term/topics_covered/disciplines — those live on ReportSession.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

// ── Zod schemas ────────────────────────────────────────────────────────────────

const CreateClassSchema = z.object({
  name: z.string().min(1, "Class name is required").max(255),
  year_group: z.string().max(100).optional(),
  subject: z.string().max(100).optional(),
});

const UpdateClassSchema = z.object({
  name: z.string().min(1, "Class name is required").max(255).optional(),
  year_group: z.string().max(100).nullable().optional(),
  subject: z.string().max(100).nullable().optional(),
});

// ── GET /api/v1/classes ────────────────────────────────────────────────────────

router.get(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.user.organizationId;

      const classes = await prisma.class.findMany({
        where: { organization_id: organizationId },
        select: {
          id: true,
          name: true,
          year_group: true,
          subject: true,
          archived: true,
          created_at: true,
          updated_at: true,
          _count: {
            select: { students: true, sessions: true },
          },
        },
        orderBy: { created_at: "desc" },
      });

      res.status(200).json({ data: classes });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/classes ───────────────────────────────────────────────────────

router.post(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.user.organizationId;

      const parsed = CreateClassSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { name, year_group, subject } = parsed.data;

      const newClass = await prisma.class.create({
        data: {
          organization_id: organizationId,
          name,
          year_group: year_group ?? null,
          subject: subject ?? null,
          archived: false,
        },
        select: {
          id: true,
          name: true,
          year_group: true,
          subject: true,
          archived: true,
          created_at: true,
          updated_at: true,
        },
      });

      console.log(JSON.stringify({
        event: "class.created",
        classId: newClass.id,
        organizationId,
      }));

      res.status(201).json({ data: newClass });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/classes/:id ────────────────────────────────────────────────────

router.get(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.user.organizationId;
      const classId = req.params["id"] as string;

      const cls = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: {
          id: true,
          name: true,
          year_group: true,
          subject: true,
          archived: true,
          created_at: true,
          updated_at: true,
          students: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              student_ref_id: true,
              gender: true,
              created_at: true,
            },
            orderBy: { first_name: "asc" },
          },
          sessions: {
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
          },
        },
      });

      if (!cls) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      res.status(200).json({ data: cls });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/v1/classes/:id ────────────────────────────────────────────────────

router.put(
  "/:id",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.user.organizationId;
      const classId = req.params["id"] as string;

      // Verify ownership.
      const existing = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { id: true },
      });
      if (!existing) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const parsed = UpdateClassSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const updated = await prisma.class.update({
        where: { id: classId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.year_group !== undefined ? { year_group: parsed.data.year_group } : {}),
          ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
        },
        select: {
          id: true,
          name: true,
          year_group: true,
          subject: true,
          archived: true,
          created_at: true,
          updated_at: true,
        },
      });

      console.log(JSON.stringify({
        event: "class.updated",
        classId,
        organizationId,
      }));

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/classes/:id/archive ──────────────────────────────────────────

router.post(
  "/:id/archive",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = req.user.organizationId;
      const classId = req.params["id"] as string;

      const existing = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { id: true, archived: true },
      });
      if (!existing) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const updated = await prisma.class.update({
        where: { id: classId },
        data: { archived: true },
        select: {
          id: true,
          name: true,
          archived: true,
          updated_at: true,
        },
      });

      console.log(JSON.stringify({
        event: "class.archived",
        classId,
        organizationId,
      }));

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// ── Test CRUD ──────────────────────────────────────────────────────────────────
//
// GET  /api/v1/classes/:classId/tests          — list tests for a class
// POST /api/v1/classes/:classId/tests          — create a test
// PUT  /api/v1/tests/:testId                   — update a test
// DELETE /api/v1/tests/:testId                 — delete a test
// POST /api/v1/classes/:classId/tests/copy     — copy test to another class
// GET  /api/v1/tests/:testId/results           — get all results for a test
// POST /api/v1/tests/:testId/results/bulk      — bulk upsert results

const CreateTestSchema = z.object({
  name: z.string().min(1, "Test name is required").max(255),
  topics: z.array(z.string()).optional().default([]),
  max_mark: z.number().int().min(1),
  grade_boundaries: z.record(z.number()).optional().default({}),
});

const UpdateTestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  topics: z.array(z.string()).optional(),
  max_mark: z.number().int().min(1).optional(),
  grade_boundaries: z.record(z.number()).optional(),
});

const CopyTestSchema = z.object({
  testId: z.string().uuid(),
  targetClassId: z.string().uuid(),
});

const BulkTestResultsSchema = z.object({
  results: z.array(z.object({
    studentId: z.string().uuid(),
    score: z.number().int().min(0),
    comment: z.string().optional().nullable(),
  })),
});

/** Compute grade from boundaries JSON. Boundaries: { "A": 90, "B": 75, ... } */
function computeGrade(
  score: number,
  maxMark: number,
  boundaries: Record<string, number>
): { percentage: number; grade: string | null } {
  const percentage = maxMark > 0 ? Math.round((score / maxMark) * 100) : 0;

  // Sort boundaries descending by threshold
  const sorted = Object.entries(boundaries)
    .map(([grade, threshold]) => ({ grade, threshold }))
    .sort((a, b) => b.threshold - a.threshold);

  const grade = sorted.find((b) => percentage >= b.threshold)?.grade ?? null;

  return { percentage, grade };
}

// GET /api/v1/classes/:classId/tests
router.get(
  "/:classId/tests",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      // Verify class belongs to org
      const classRow = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { id: true },
      });
      if (!classRow) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const tests = await prisma.test.findMany({
        where: { class_id: classId },
        select: {
          id: true,
          name: true,
          topics: true,
          max_mark: true,
          grade_boundaries: true,
          created_at: true,
          _count: { select: { results: true } },
        },
        orderBy: { created_at: "desc" },
      });

      res.status(200).json({ data: tests });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/classes/:classId/tests/:testId
router.get(
  "/:classId/tests/:testId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const testId = String(req.params["testId"]);
      const organizationId = req.user.organizationId;

      // Verify class belongs to org
      const classRow = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { id: true },
      });
      if (!classRow) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const test = await prisma.test.findFirst({
        where: { id: testId, class_id: classId },
        select: {
          id: true,
          name: true,
          topics: true,
          max_mark: true,
          grade_boundaries: true,
          created_at: true,
          _count: { select: { results: true } },
        },
      });
      if (!test) {
        res.status(404).json({ error: "Test not found", code: "TEST_NOT_FOUND" });
        return;
      }

      res.status(200).json({ data: test });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/classes/:classId/tests
router.post(
  "/:classId/tests",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      const classRow = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { id: true },
      });
      if (!classRow) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const parsed = CreateTestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const test = await prisma.test.create({
        data: {
          class_id: classId,
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
          created_at: true,
        },
      });

      console.log(JSON.stringify({
        event: "test.created",
        testId: test.id,
        classId,
        organizationId,
      }));

      res.status(201).json({ data: test });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/classes/:classId/tests/copy
router.post(
  "/:classId/tests/copy",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      // Verify source class belongs to org
      const sourceClass = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { id: true },
      });
      if (!sourceClass) {
        res.status(404).json({ error: "Source class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const parsed = CopyTestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const { testId, targetClassId } = parsed.data;

      // Verify test belongs to source class
      const sourceTest = await prisma.test.findFirst({
        where: { id: testId, class_id: classId },
        select: { id: true, name: true, topics: true, max_mark: true, grade_boundaries: true },
      });
      if (!sourceTest) {
        res.status(404).json({ error: "Test not found", code: "TEST_NOT_FOUND" });
        return;
      }

      // Verify target class belongs to same org
      const targetClass = await prisma.class.findFirst({
        where: { id: targetClassId, organization_id: organizationId },
        select: { id: true },
      });
      if (!targetClass) {
        res.status(404).json({ error: "Target class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const newTest = await prisma.test.create({
        data: {
          class_id: targetClassId,
          name: sourceTest.name,
          topics: sourceTest.topics,
          max_mark: sourceTest.max_mark,
          grade_boundaries: sourceTest.grade_boundaries as Record<string, number>,
        },
        select: { id: true, name: true, class_id: true, created_at: true },
      });

      console.log(JSON.stringify({
        event: "test.copied",
        sourceTestId: testId,
        newTestId: newTest.id,
        targetClassId,
        organizationId,
      }));

      res.status(201).json({ data: newTest });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/tests/:testId/results
router.get(
  "/tests/:testId/results",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const testId = String(req.params["testId"]);
      const organizationId = req.user.organizationId;

      // Verify test belongs to a class in this org
      const test = await prisma.test.findFirst({
        where: {
          id: testId,
          class: { organization_id: organizationId },
        },
        select: { id: true, max_mark: true, grade_boundaries: true },
      });
      if (!test) {
        res.status(404).json({ error: "Test not found", code: "TEST_NOT_FOUND" });
        return;
      }

      const results = await prisma.testResult.findMany({
        where: { test_id: testId },
        select: {
          id: true,
          student_id: true,
          score: true,
          comment: true,
          calculated: true,
          student: { select: { id: true, first_name: true, last_name: true, student_ref_id: true } },
        },
        orderBy: { student: { first_name: "asc" } },
      });

      res.status(200).json({ data: results });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/tests/:testId/results/bulk
router.post(
  "/tests/:testId/results/bulk",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const testId = String(req.params["testId"]);
      const organizationId = req.user.organizationId;

      const test = await prisma.test.findFirst({
        where: {
          id: testId,
          class: { organization_id: organizationId },
        },
        select: { id: true, max_mark: true, grade_boundaries: true },
      });
      if (!test) {
        res.status(404).json({ error: "Test not found", code: "TEST_NOT_FOUND" });
        return;
      }

      const parsed = BulkTestResultsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const boundaries = (test.grade_boundaries ?? {}) as Record<string, number>;

      const upserts = parsed.data.results.map((r) => {
        const calculated = computeGrade(r.score, test.max_mark, boundaries);
        return prisma.testResult.upsert({
          where: { test_id_student_id: { test_id: testId, student_id: r.studentId } },
          create: {
            test_id: testId,
            student_id: r.studentId,
            score: r.score,
            comment: r.comment ?? null,
            calculated,
          },
          update: {
            score: r.score,
            comment: r.comment ?? null,
            calculated,
          },
          select: { id: true, student_id: true, score: true, calculated: true },
        });
      });

      const savedResults = await prisma.$transaction(upserts);

      console.log(JSON.stringify({
        event: "test_results.bulk_saved",
        testId,
        organizationId,
        count: savedResults.length,
      }));

      res.status(200).json({ data: savedResults, count: savedResults.length });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/tests/:testId
router.put(
  "/tests/:testId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const testId = String(req.params["testId"]);
      const organizationId = req.user.organizationId;

      const test = await prisma.test.findFirst({
        where: {
          id: testId,
          class: { organization_id: organizationId },
        },
        select: { id: true },
      });
      if (!test) {
        res.status(404).json({ error: "Test not found", code: "TEST_NOT_FOUND" });
        return;
      }

      const parsed = UpdateTestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      const updated = await prisma.test.update({
        where: { id: testId },
        data: {
          ...(parsed.data.name !== undefined && { name: parsed.data.name }),
          ...(parsed.data.topics !== undefined && { topics: parsed.data.topics }),
          ...(parsed.data.max_mark !== undefined && { max_mark: parsed.data.max_mark }),
          ...(parsed.data.grade_boundaries !== undefined && { grade_boundaries: parsed.data.grade_boundaries }),
        },
        select: {
          id: true,
          name: true,
          topics: true,
          max_mark: true,
          grade_boundaries: true,
          created_at: true,
        },
      });

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/tests/:testId
router.delete(
  "/tests/:testId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const testId = String(req.params["testId"]);
      const organizationId = req.user.organizationId;

      const test = await prisma.test.findFirst({
        where: {
          id: testId,
          class: { organization_id: organizationId },
        },
        select: { id: true },
      });
      if (!test) {
        res.status(404).json({ error: "Test not found", code: "TEST_NOT_FOUND" });
        return;
      }

      await prisma.test.delete({ where: { id: testId } });

      console.log(JSON.stringify({
        event: "test.deleted",
        testId,
        organizationId,
      }));

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
