---
name: Task 1 — Database Foundation complete
description: Records what was built in Task 1, key decisions, and quirks discovered
type: project
---

Task 1 (Database Foundation) is complete.

**What was built:**
- `prisma/schema.prisma` — 6 models (Organization, User, Class, Student, Discipline, Rating, Report) with all organization_id foreign keys, JSONB settings, composite indexes matching the tech spec SQL.
- `docker-compose.yml` — postgres:16 on port 5433:5432 and redis:alpine on 6379:6379. `version:` key omitted (obsolete in modern Compose, causes a warning).
- `package.json` (root) — dependencies: @prisma/client, prisma, bcrypt, @types/bcrypt, @types/node, ts-node, typescript.
- `tsconfig.json` (root) — strict mode, CommonJS, targets prisma/*.ts files.
- `tsconfig.seed.json` — extends root tsconfig; used by ts-node for the seed command to avoid shell quoting issues with --compiler-options.
- `prisma/seed.ts` — seeds 1 org, 1 user (bcrypt cost 12), 1 class, 4 disciplines, 5 students, 20 ratings with deterministic UUIDs for idempotent upserts.
- `.env` — DATABASE_URL pointing to localhost:5433.

**Key decisions:**
- Deterministic UUIDs in seed (e.g. 00000000-0000-0000-0000-000000000001) so seed is fully idempotent via upsert.
- `ts-node --project tsconfig.seed.json` instead of `--compiler-options` to avoid shell quoting issues on Linux.
- bcrypt cost factor 12 chosen as sensible security/performance balance.
- `topics_covered` is String[] (Postgres text[]) on Class model — matches tech spec array type.
- Discipline model does NOT have organization_id (it links via class_id → class → organization_id); all direct domain queries must join through class for org isolation.
- Report model has organization_id directly for fast query isolation without join.

**Verified record counts:** 1 org, 1 user, 1 class, 4 disciplines, 5 students, 20 ratings, 15 indexes.

**Why:** Foundation for all subsequent tasks — auth, API routes, BullMQ jobs, and frontend all depend on this schema.

**How to apply:** When writing any query touching disciplines, remember there is no direct organization_id — filter via class_id join. All other tables have organization_id directly.
