-- ReportGenius schema refactor: sessions, disciplines, student PII fields
-- Applied via prisma db push --force-reset on 2026-03-26
-- This file documents the migration for audit purposes.

-- DropForeignKey (old disciplines / ratings / reports)
-- DropTable disciplines
-- CreateTable discipline_templates
-- CreateTable report_sessions
-- CreateTable session_disciplines
-- AlterTable classes: drop term, topics_covered; add archived, updated_at
-- AlterTable students: add last_name, student_ref_id, anonymous_token, updated_at
-- AlterTable ratings: drop discipline_id; add session_discipline_id
-- AlterTable reports: drop class_id; add session_id, anonymous_token

-- See prisma/schema.prisma for the full current schema.
