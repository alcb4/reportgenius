-- ReportGenius initial schema
-- Creates all base tables as they existed before tracked migrations began.

-- ── organizations ────────────────────────────────────────────────────────────
CREATE TABLE "organizations" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"       VARCHAR(255) NOT NULL,
    "settings"   JSONB        NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE "users" (
    "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
    "email"             VARCHAR(255) NOT NULL,
    "password_hash"     VARCHAR(255) NOT NULL,
    "organization_id"   UUID         NOT NULL,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terms_accepted_at" TIMESTAMP(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

ALTER TABLE "users"
    ADD CONSTRAINT "users_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── classes ──────────────────────────────────────────────────────────────────
CREATE TABLE "classes" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID         NOT NULL,
    "name"            VARCHAR(255) NOT NULL,
    "year_group"      VARCHAR(100),
    "subject"         VARCHAR(100),
    "archived"        BOOLEAN      NOT NULL DEFAULT false,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "classes_organization_id_idx" ON "classes"("organization_id");

ALTER TABLE "classes"
    ADD CONSTRAINT "classes_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── discipline_templates ─────────────────────────────────────────────────────
CREATE TABLE "discipline_templates" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "category"   VARCHAR(100) NOT NULL,
    "name"       VARCHAR(100) NOT NULL,
    "is_default" BOOLEAN      NOT NULL DEFAULT false,
    CONSTRAINT "discipline_templates_pkey" PRIMARY KEY ("id")
);

-- ── students ─────────────────────────────────────────────────────────────────
CREATE TABLE "students" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID         NOT NULL,
    "class_id"        UUID         NOT NULL,
    "first_name"      VARCHAR(100) NOT NULL,
    "last_name"       VARCHAR(100),
    "student_ref_id"  VARCHAR(100),
    "anonymous_token" UUID         NOT NULL DEFAULT gen_random_uuid(),
    "gender"          VARCHAR(20),
    "internal_notes"  TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "students_anonymous_token_key" ON "students"("anonymous_token");
CREATE INDEX "students_organization_id_idx" ON "students"("organization_id");
CREATE INDEX "students_class_id_idx" ON "students"("class_id");

ALTER TABLE "students"
    ADD CONSTRAINT "students_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "students"
    ADD CONSTRAINT "students_class_id_fkey"
    FOREIGN KEY ("class_id") REFERENCES "classes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── report_sessions ──────────────────────────────────────────────────────────
-- Note: template/filter columns are added by later migrations.
CREATE TABLE "report_sessions" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID         NOT NULL,
    "class_id"        UUID         NOT NULL,
    "name"            VARCHAR(255) NOT NULL,
    "topics_covered"  TEXT[]       NOT NULL DEFAULT '{}',
    "tone"            VARCHAR(50)  NOT NULL DEFAULT 'balanced',
    "length"          VARCHAR(20)  NOT NULL DEFAULT 'medium',
    "status"          VARCHAR(20)  NOT NULL DEFAULT 'draft',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "report_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_sessions_organization_id_idx" ON "report_sessions"("organization_id");
CREATE INDEX "report_sessions_class_id_idx" ON "report_sessions"("class_id");

ALTER TABLE "report_sessions"
    ADD CONSTRAINT "report_sessions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_sessions"
    ADD CONSTRAINT "report_sessions_class_id_fkey"
    FOREIGN KEY ("class_id") REFERENCES "classes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── session_disciplines ──────────────────────────────────────────────────────
CREATE TABLE "session_disciplines" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID         NOT NULL,
    "name"       VARCHAR(100) NOT NULL,
    "category"   VARCHAR(100),
    "is_custom"  BOOLEAN      NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_disciplines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "session_disciplines_session_id_idx" ON "session_disciplines"("session_id");

ALTER TABLE "session_disciplines"
    ADD CONSTRAINT "session_disciplines_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "report_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ratings ──────────────────────────────────────────────────────────────────
CREATE TABLE "ratings" (
    "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    "student_id"            UUID         NOT NULL,
    "session_discipline_id" UUID         NOT NULL,
    "score"                 INTEGER      NOT NULL,
    "comment"               TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ratings_student_id_session_discipline_id_idx"
    ON "ratings"("student_id", "session_discipline_id");

ALTER TABLE "ratings"
    ADD CONSTRAINT "ratings_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ratings"
    ADD CONSTRAINT "ratings_session_discipline_id_fkey"
    FOREIGN KEY ("session_discipline_id") REFERENCES "session_disciplines"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── reports ──────────────────────────────────────────────────────────────────
-- Note: ratings_changed_at and unique constraint added by later migrations.
CREATE TABLE "reports" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "organization_id"  UUID         NOT NULL,
    "student_id"       UUID         NOT NULL,
    "session_id"       UUID         NOT NULL,
    "anonymous_token"  UUID         NOT NULL,
    "llm_model"        VARCHAR(100),
    "llm_prompt"       TEXT,
    "llm_raw_response" TEXT,
    "edited_content"   TEXT         NOT NULL,
    "status"           VARCHAR(20)  NOT NULL DEFAULT 'draft',
    "word_count"       INTEGER,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reports_organization_id_student_id_idx" ON "reports"("organization_id", "student_id");
CREATE INDEX "reports_session_id_idx" ON "reports"("session_id");

ALTER TABLE "reports"
    ADD CONSTRAINT "reports_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reports"
    ADD CONSTRAINT "reports_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reports"
    ADD CONSTRAINT "reports_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "report_sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
