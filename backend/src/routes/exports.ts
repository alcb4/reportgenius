/**
 * Export routes
 *
 * GET /api/v1/reports/:reportId/export/pdf
 *   Stream a single report as a PDF attachment.
 *
 * GET /api/v1/sessions/:sessionId/export/pdf
 *   Stream a ZIP of all FINAL reports for the session, one PDF per student.
 *
 * GET /api/v1/sessions/:sessionId/export/csv
 *   Stream an XLSX workbook with all reports (draft + final) for the session.
 *
 * GET /api/v1/classes/:classId/export/pdf   (compat — resolves to most recent session)
 * GET /api/v1/classes/:classId/export/csv   (compat — resolves to most recent session)
 *
 * Multi-tenant isolation: organizationId is extracted from the JWT and passed
 * to every service call. The service layer re-verifies ownership at the DB level.
 */

import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import {
  exportReportPDF,
  exportSessionPDF,
  exportSessionCSV,
  exportClassPDF,
  exportClassCSV,
} from "../services/export.service";

const router = Router();
const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeFilename(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim() || "file";
}

function handleDomainError(
  err: unknown,
  res: Response,
  next: NextFunction
): void {
  if (
    err !== null &&
    typeof err === "object" &&
    "statusCode" in err &&
    "code" in err
  ) {
    const domainErr = err as { statusCode: number; code: string; message: string };
    res.status(domainErr.statusCode).json({
      error: domainErr.message,
      code: domainErr.code,
    });
    return;
  }
  next(err);
}

// ── GET /api/v1/reports/:reportId/export/pdf ──────────────────────────────────

router.get(
  "/reports/:reportId/export/pdf",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const reportId = String(req.params["reportId"]);
      const organizationId = req.user.organizationId;

      const report = await prisma.report.findFirst({
        where: { id: reportId, organization_id: organizationId },
        select: { student: { select: { first_name: true } } },
      });

      if (!report) {
        res.status(404).json({ error: "Report not found", code: "REPORT_NOT_FOUND" });
        return;
      }

      const firstName = safeFilename(report.student.first_name);

      console.log(JSON.stringify({
        event: "export.route.pdf.single",
        reportId,
        organizationId,
      }));

      const pdfBuffer = await exportReportPDF(reportId, organizationId);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${firstName}_report.pdf"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.status(200).end(pdfBuffer);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/export/pdf ───────────────────────────────

router.get(
  "/sessions/:sessionId/export/pdf",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: { name: true },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const sessionName = safeFilename(session.name);

      console.log(JSON.stringify({
        event: "export.route.pdf.session",
        sessionId,
        organizationId,
      }));

      const zipBuffer = await exportSessionPDF(sessionId, organizationId);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${sessionName}_reports.zip"`);
      res.setHeader("Content-Length", zipBuffer.length);
      res.status(200).end(zipBuffer);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

// ── GET /api/v1/sessions/:sessionId/export/csv ───────────────────────────────

router.get(
  "/sessions/:sessionId/export/csv",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = String(req.params["sessionId"]);
      const organizationId = req.user.organizationId;

      const session = await prisma.reportSession.findFirst({
        where: { id: sessionId, organization_id: organizationId },
        select: { name: true },
      });

      if (!session) {
        res.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
        return;
      }

      const sessionName = safeFilename(session.name);

      console.log(JSON.stringify({
        event: "export.route.xlsx.session",
        sessionId,
        organizationId,
      }));

      const xlsxBuffer = await exportSessionCSV(sessionId, organizationId);

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sessionName}_reports.xlsx"`
      );
      res.setHeader("Content-Length", xlsxBuffer.length);
      res.status(200).end(xlsxBuffer);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

// ── GET /api/v1/classes/:classId/export/pdf (compat) ─────────────────────────

router.get(
  "/classes/:classId/export/pdf",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      const cls = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { name: true },
      });

      if (!cls) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const className = safeFilename(cls.name);

      console.log(JSON.stringify({
        event: "export.route.pdf.class",
        classId,
        organizationId,
      }));

      const zipBuffer = await exportClassPDF(classId, organizationId);

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${className}_reports.zip"`);
      res.setHeader("Content-Length", zipBuffer.length);
      res.status(200).end(zipBuffer);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

// ── GET /api/v1/classes/:classId/export/csv (compat) ─────────────────────────

router.get(
  "/classes/:classId/export/csv",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const classId = String(req.params["classId"]);
      const organizationId = req.user.organizationId;

      const cls = await prisma.class.findFirst({
        where: { id: classId, organization_id: organizationId },
        select: { name: true },
      });

      if (!cls) {
        res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" });
        return;
      }

      const className = safeFilename(cls.name);

      console.log(JSON.stringify({
        event: "export.route.xlsx.class",
        classId,
        organizationId,
      }));

      const xlsxBuffer = await exportClassCSV(classId, organizationId);

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${className}_reports.xlsx"`
      );
      res.setHeader("Content-Length", xlsxBuffer.length);
      res.status(200).end(xlsxBuffer);
    } catch (err) {
      handleDomainError(err, res, next);
    }
  }
);

export default router;
