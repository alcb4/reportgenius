-- Add filter persistence fields to report_sessions
ALTER TABLE "report_sessions"
  ADD COLUMN IF NOT EXISTS "test_filters" JSONB,
  ADD COLUMN IF NOT EXISTS "progression_filters" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "class_overview" TEXT;

-- Change default tone from professional to balanced
ALTER TABLE "report_sessions"
  ALTER COLUMN "tone" SET DEFAULT 'balanced';
