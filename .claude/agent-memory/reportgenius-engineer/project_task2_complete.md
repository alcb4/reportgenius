---
name: Task 2 — Express Auth + Core CRUD complete
description: Records what was built in Task 2, key decisions, and quirks discovered
type: project
---

Task 2 (Express Auth + Core CRUD) is complete.

**What was built:**
- `backend/package.json` — deps: express, @prisma/client, bcrypt, cors, helmet, jsonwebtoken, zod. devDeps: typescript, @types/express, @types/bcrypt, @types/cors, @types/jsonwebtoken, ts-node, nodemon.
- `backend/tsconfig.json` — strict mode, target ES2020, CommonJS, outDir ./dist.
- `backend/src/config.ts` — validated env module using `requireEnv()`. Throws at startup if DATABASE_URL or JWT_SECRET missing.
- `backend/src/server.ts` — Express app with helmet, cors, json middleware; Prisma connect on startup; structured JSON logging; centralised error handler; 404 handler.
- `backend/src/middleware/auth.ts` — JWT verify with typed JWTPayload (userId, organizationId, email); extends Express.Request globally; returns structured error codes.
- `backend/src/routes/auth.ts` — POST /api/v1/auth/register (org + user in Prisma transaction, bcrypt hash); POST /api/v1/auth/login (timing-safe dummy hash for non-existent users). Both Zod-validated, returning JWT.
- `backend/src/routes/classes.ts` — GET + POST /api/v1/classes, both gated with authenticate middleware. POST creates class + disciplines in transaction, returns disciplines in response.

**Key decisions:**
- `Prisma.TransactionClient` type annotation needed on `$transaction` callbacks in strict mode — implicit `any` error without it.
- `node --env-file=../.env` used to load root .env (Node 20+ feature). No dotenv package needed.
- backend has its own `node_modules/@prisma/client` — after `prisma generate` at root, must copy generated `.prisma/client` directory into `backend/node_modules/.prisma/client/` for types to resolve correctly: `cp -r node_modules/.prisma/client/. backend/node_modules/.prisma/client/`
- Timing-safe login: always runs bcrypt.compare even when user not found (using a dummy hash) to prevent email enumeration via timing.
- GET /api/v1/classes returns `_count` of students and disciplines for dashboard use.
- Zod `.optional().default([])` pattern used for disciplines/topics arrays — always array, never undefined.

**Verified tests:**
- POST /api/v1/auth/register → 201 with token + user + organization
- POST /api/v1/auth/login → 200 with token + user
- GET /api/v1/classes (no auth) → 401 AUTH_MISSING
- POST /api/v1/classes (with disciplines) → 201 with class + disciplines array
- GET /api/v1/classes (after create) → 200 with correct class, discipline count = 3
- Tenant isolation confirmed: new org sees only its own classes (seed org's class not visible)

**Why:** Auth + classes are the entry point for all subsequent routes — students, ratings, reports all depend on authenticated class context.

**How to apply:** When adding new routes, always import `authenticate` middleware from `../middleware/auth` and use `req.user.organizationId` for every query. The `Prisma.TransactionClient` import pattern from auth.ts/classes.ts should be used for all future transaction callbacks.
