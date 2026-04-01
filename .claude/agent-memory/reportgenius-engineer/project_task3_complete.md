---
name: Task 3 — Students, Disciplines & Ratings CRUD complete
description: Records what was built in Task 3, key decisions, and patterns established
type: project
---

Task 3 (Students, Disciplines & Ratings CRUD) is complete.

**What was built:**
- `backend/src/routes/students.ts` — POST single/bulk create, GET with ratings include, DELETE with final-report guard
- `backend/src/routes/disciplines.ts` — POST create, GET list with ratings count, DELETE with ratings guard
- `backend/src/routes/ratings.ts` — POST bulk upsert (transaction), GET grid response with disciplines column headers
- `backend/src/server.ts` — mounted all three routers at `/api/v1` (mixed prefixes require root mount, not sub-path mount)

**Key decisions:**
- `req.params` in `@types/express` v5 is typed as `string | string[]`. Fix: use `String(req.params["paramName"])` at every extraction point — avoids adding type overrides and keeps strict mode happy.
- Rating model has no unique constraint on `(student_id, discipline_id)`. Upsert strategy: one `findMany` to fetch existing ratings into a Map, then `Promise.all(updates)` + `createMany(inserts)` — all inside a single `$transaction`. Zero N+1.
- GET /ratings returns a grid: `{ students: [...{ id, first_name, ratings: [...] }], disciplines: [...] }`. Students and disciplines fetched in parallel with `Promise.all`.
- Tenant isolation for ratings: `Rating` has no `organization_id` column — isolation enforced by verifying the class belongs to the org before any rating operation, plus validating all student/discipline IDs against the class in single queries.
- Student DELETE blocks on `status: { not: "draft" }` reports — allows deleting students who only have draft reports.
- Discipline DELETE blocks on any ratings count > 0.
- All routes: mixed prefix mounting. Students/disciplines/ratings mounted at `/api/v1` (not `/api/v1/classes`) because they include both `/classes/:id/...` and `/students/:id`, `/disciplines/:id` top-level paths.

**Verified tests:**
- POST /classes/:id/students/bulk → 5 students created, count: 5
- POST /classes/:id/disciplines × 4 → 4 disciplines created
- POST /classes/:id/ratings (20 ratings) → created: 20, updated: 0
- Re-submit same ratings → created: 0, updated: 20 (upsert works)
- GET /classes/:id/ratings → 5 students × 4 disciplines each, correct scores
- Score 6 → VALIDATION_ERROR
- Bulk > 100 students → VALIDATION_ERROR
- No auth → AUTH_MISSING

**Why:** These routes are the data foundation for LLM report generation — ratings are what gets aggregated into the LLM prompt summary.

**How to apply:** When Task 4 (LLM adapter) reads ratings for a student, use the same `prisma.student.findMany` with `include: { ratings: { include: { discipline: true } } }` pattern established here. Always verify class ownership before any operation.
