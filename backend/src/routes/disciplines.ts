/**
 * Discipline routes
 *
 * GET    /api/v1/discipline-templates                          — full library grouped by category
 * POST   /api/v1/sessions/:sessionId/disciplines               — add discipline to session
 * DELETE /api/v1/sessions/:sessionId/disciplines/:disciplineId — remove if no ratings
 *
 * Multi-tenant isolation: session ownership is verified on every write operation.
 * The discipline_templates table is global (org-neutral) — reads require only auth.
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

// ── Zod schemas ──────────────────────────────────────────────────────────────

const AddDisciplineSchema = z.object({
  // Provide either templateId (from library) OR name + optional category (custom).
  templateId: z.string().uuid().optional(),
  name: z.string().min(1, "Discipline name is required").max(100).optional(),
  category: z.string().max(100).optional(),
}).refine(
  (data) => data.templateId !== undefined || data.name !== undefined,
  { message: "Provide either templateId (from library) or name (custom discipline)" }
);

// ── Helper ───────────────────────────────────────────────────────────────────

async function resolveSession(
  sessionId: string,
  organizationId: string
): Promise<{ id: string } | null> {
  return prisma.reportSession.findFirst({
    where: { id: sessionId, organization_id: organizationId },
    select: { id: true },
  });
}

// ── GET /api/v1/discipline-templates ─────────────────────────────────────────
// Returns the full library grouped by category.

router.get(
  "/discipline-templates",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const templates = await prisma.disciplineTemplate.findMany({
        select: {
          id: true,
          category: true,
          name: true,
          is_default: true,
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });

      // Group by category for convenient frontend rendering.
      const grouped: Record<string, Array<{ id: string; name: string; is_default: boolean }>> = {};
      for (const t of templates) {
        if (!grouped[t.category]) {
          grouped[t.category] = [];
        }
        grouped[t.category]!.push({ id: t.id, name: t.name, is_default: t.is_default });
      }

      const data = Object.entries(grouped).map(([category, disciplines]) => ({
        category,
        disciplines,
      }));

      res.status(200).json({ data, total: templates.length });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/sessions/:sessionId/disciplines ──────────────────────────────

router.post(
  "/sessions/:sessionId/disciplines",
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

      const parsed = AddDisciplineSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.errors.map((e) => e.message).join(", "),
          code: "VALIDATION_ERROR",
        });
        return;
      }

      let disciplineName: string;
      let disciplineCategory: string | null = null;
      let isCustom = false;

      if (parsed.data.templateId) {
        // Resolve from template library.
        const template = await prisma.disciplineTemplate.findUnique({
          where: { id: parsed.data.templateId },
          select: { name: true, category: true },
        });
        if (!template) {
          res.status(404).json({
            error: "Discipline template not found",
            code: "TEMPLATE_NOT_FOUND",
          });
          return;
        }
        disciplineName = template.name;
        disciplineCategory = template.category;
        isCustom = false;
      } else {
        // Custom discipline — name must be present (guaranteed by schema refine).
        disciplineName = parsed.data.name as string;
        disciplineCategory = parsed.data.category ?? null;
        isCustom = true;
      }

      const discipline = await prisma.sessionDiscipline.create({
        data: {
          session_id: sessionId,
          name: disciplineName,
          category: disciplineCategory,
          is_custom: isCustom,
        },
        select: {
          id: true,
          name: true,
          category: true,
          is_custom: true,
          created_at: true,
        },
      });

      console.log(JSON.stringify({
        event: "session_discipline.created",
        disciplineId: discipline.id,
        sessionId,
        organizationId,
        isCustom,
      }));

      res.status(201).json({ data: discipline });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/v1/sessions/:sessionId/disciplines/:disciplineId ──────────────
// Only allowed if no ratings reference this session discipline.

router.delete(
  "/sessions/:sessionId/disciplines/:disciplineId",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const disciplineId = String(req.params["disciplineId"]);
      const organizationId = req.user.organizationId;

      // Verify session ownership.
      const session = await resolveSession(sessionId, organizationId);
      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      // Verify discipline belongs to this session.
      const discipline = await prisma.sessionDiscipline.findFirst({
        where: { id: disciplineId, session_id: sessionId },
        select: { id: true },
      });
      if (!discipline) {
        res.status(404).json({
          error: "Discipline not found in this session",
          code: "DISCIPLINE_NOT_FOUND",
        });
        return;
      }

      // Block deletion if any ratings reference this session discipline.
      const ratingCount = await prisma.rating.count({
        where: { session_discipline_id: disciplineId },
      });

      if (ratingCount > 0) {
        res.status(409).json({
          error: "Cannot delete discipline with existing ratings. Delete ratings first.",
          code: "DISCIPLINE_HAS_RATINGS",
        });
        return;
      }

      await prisma.sessionDiscipline.delete({ where: { id: disciplineId } });

      console.log(JSON.stringify({
        event: "session_discipline.deleted",
        disciplineId,
        sessionId,
        organizationId,
      }));

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
