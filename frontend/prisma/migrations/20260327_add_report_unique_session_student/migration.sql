-- Add unique constraint on (session_id, student_id) to reports table.
-- This ensures one report per student per session and enables upsert in parse-reports.

ALTER TABLE "reports" ADD CONSTRAINT "reports_session_id_student_id_key" UNIQUE ("session_id", "student_id");
