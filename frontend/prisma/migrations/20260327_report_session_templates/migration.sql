-- AlterTable: add template support to report_sessions
ALTER TABLE "report_sessions" ADD COLUMN IF NOT EXISTS "is_template" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "report_sessions" ADD COLUMN IF NOT EXISTS "source_template_id" UUID;
