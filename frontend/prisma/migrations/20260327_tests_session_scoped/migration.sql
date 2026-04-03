-- AlterTable: add session_id to tests
ALTER TABLE "tests" ADD COLUMN "session_id" UUID;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "report_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "tests_session_id_idx" ON "tests"("session_id");

-- AlterTable: add enable_progression and allow_negative_progression to report_sessions
ALTER TABLE "report_sessions" ADD COLUMN "enable_progression" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "report_sessions" ADD COLUMN "allow_negative_progression" BOOLEAN NOT NULL DEFAULT true;
