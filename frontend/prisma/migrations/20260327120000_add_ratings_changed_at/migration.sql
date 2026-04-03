-- AlterTable: add ratings_changed_at to reports
-- Null means ratings are in sync with the report. Set to now() when a rating is saved after report generation.
ALTER TABLE "reports" ADD COLUMN "ratings_changed_at" TIMESTAMP(3);
