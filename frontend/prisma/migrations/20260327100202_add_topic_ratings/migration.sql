-- CreateTable topic_ratings
-- Multi-tenant: organization_id on every row for isolation.
-- Unique constraint prevents duplicate ratings per student+session+topic.

CREATE TABLE "topic_ratings" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "session_id"      UUID NOT NULL,
    "student_id"      UUID NOT NULL,
    "topic_name"      VARCHAR(255) NOT NULL,
    "score"           INTEGER NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topic_ratings_session_id_student_id_topic_name_key"
    ON "topic_ratings"("session_id", "student_id", "topic_name");

CREATE INDEX "topic_ratings_organization_id_idx"
    ON "topic_ratings"("organization_id");

CREATE INDEX "topic_ratings_session_id_student_id_idx"
    ON "topic_ratings"("session_id", "student_id");

-- AddForeignKey
ALTER TABLE "topic_ratings"
    ADD CONSTRAINT "topic_ratings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "topic_ratings"
    ADD CONSTRAINT "topic_ratings_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "report_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "topic_ratings"
    ADD CONSTRAINT "topic_ratings_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
