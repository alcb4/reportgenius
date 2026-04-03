-- CreateTable tests
CREATE TABLE IF NOT EXISTS "tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "class_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "topics" TEXT[] NOT NULL DEFAULT '{}',
    "max_mark" INTEGER NOT NULL,
    "grade_boundaries" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable test_results
CREATE TABLE IF NOT EXISTS "test_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "calculated" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "test_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tests_class_id_idx" ON "tests"("class_id");
CREATE INDEX IF NOT EXISTS "test_results_test_id_idx" ON "test_results"("test_id");
CREATE INDEX IF NOT EXISTS "test_results_student_id_idx" ON "test_results"("student_id");
CREATE UNIQUE INDEX IF NOT EXISTS "test_results_test_id_student_id_key" ON "test_results"("test_id", "student_id");

-- AddForeignKey (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tests_class_id_fkey'
  ) THEN
    ALTER TABLE "tests" ADD CONSTRAINT "tests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_results_test_id_fkey'
  ) THEN
    ALTER TABLE "test_results" ADD CONSTRAINT "test_results_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_results_student_id_fkey'
  ) THEN
    ALTER TABLE "test_results" ADD CONSTRAINT "test_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
