---
name: Schema Refactor — Sessions, Disciplines, Student PII (pre-Task 8)
description: Major structural refactor before Task 8; introduces ReportSession, DisciplineTemplate, SessionDiscipline, anonymous_token
type: project
---

Applied 2026-03-26 via `prisma db push --force-reset` (dev database only, seed data repopulated).

**Key changes:**
- `Class` stripped of `term`, `topics_covered`, `disciplines` relation. Now permanent (year group + students only). Added `archived`, `updated_at`.
- `Student` gains `last_name`, `student_ref_id`, `anonymous_token` (unique UUID, sent to LLM instead of any PII), `updated_at`.
- NEW `DisciplineTemplate` — global org-neutral library, seeded with 54 entries across 7 categories (General, Languages, Maths, Sciences, Arts, Humanities, PE & Sport). `is_default: true` for all 10 General disciplines.
- NEW `ReportSession` — named report event attached to a class. Holds `topics_covered`, `tone`, `length`, `status`. Replaces per-class term/topics pattern.
- NEW `SessionDiscipline` — disciplines chosen for a specific session (from library or custom). Has `is_custom` flag.
- `Rating` — `discipline_id` replaced by `session_discipline_id`.
- `Report` — `class_id` replaced by `session_id`. Added `anonymous_token` (copied from student at generation time).

**Route changes:**
- `GET/POST /api/v1/classes` — updated (no more disciplines in create)
- `PUT /api/v1/classes/:id` and `POST /api/v1/classes/:id/archive` — new endpoints
- NEW `routes/sessions.ts` — full CRUD for ReportSession + duplicate endpoint
- `routes/disciplines.ts` — rewritten: `GET /discipline-templates`, `POST/DELETE /sessions/:sessionId/disciplines`
- `routes/ratings.ts` — scoped to `sessions/:sessionId/ratings` (not classId)
- `routes/bulk.ts` — scoped to `sessions/:sessionId/generate/bulk`
- `routes/reports.ts` — generate now `POST /sessions/:sessionId/students/:studentId/generate`; list `GET /sessions/:sessionId/reports`
- `export.service.ts` — new `exportSessionPDF`/`exportSessionCSV`; class-based routes kept as compat aliases resolving to most recent session

**Privacy rule reinforced:** LLM prompt uses `anonymous_token` for logging (not student name), and only `first_name + gender + ratingSummary + topics_covered` in prompt text. `last_name`, `student_ref_id`, `internal_notes` NEVER reach LLM.

**Why:** Decoupling class from report events allows a class to persist across years while report sessions are ephemeral, named events. This is the correct data model for school reporting workflows.

**How to apply:** All future code must use `sessionId` (not `classId`) as the primary scope for ratings, report generation, bulk jobs, and exports.
