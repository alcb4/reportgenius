
TASK: FULL VERCEL DEPLOYMENT REFACTOR

TARGET ARCHITECTURE:
  Frontend:  Next.js → Vercel (unchanged)
  Backend:   Express API → Next.js API Route Handlers → Vercel
  Database:  Local PostgreSQL → Supabase (PostgreSQL)
  Cache:     Local Redis → Upstash Redis (serverless)
  Repo:      Monorepo (frontend + backend merged)

THIS IS A MULTI-PHASE REFACTOR. DO ONE PHASE AT A TIME.
DO NOT START PHASE 2 UNTIL PHASE 1 IS VERIFIED WORKING.

═══════════════════════════════════════════════════════
PHASE 1 — DATABASE MIGRATION (Supabase)
═══════════════════════════════════════════════════════

1. Create Supabase project at supabase.com
   Note two connection strings:
     - Direct:  postgres://...@db.xxx.supabase.co:5432/postgres
     - Pooler:  postgres://...@aws-0-xxx.pooler.supabase.com:6543/postgres

2. Update .env:
   DATABASE_URL="<pooler connection string>?pgbouncer=true"
   DIRECT_URL="<direct connection string>"

3. Update prisma/schema.prisma:
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")
     directUrl = env("DIRECT_URL")   // ← required for Supabase + Prisma
   }

   directUrl is needed because PgBouncer (Supabase pooler) doesn't
   support all Prisma operations (migrations need direct connection).

4. Run migrations against Supabase:
   npx prisma migrate deploy

5. Seed any required data if applicable.

VERIFY PHASE 1:
  □ npx prisma studio connects to Supabase DB ✓
  □ Existing local dev still works with new DATABASE_URL ✓

═══════════════════════════════════════════════════════
PHASE 2 — REDIS MIGRATION (Upstash)
═══════════════════════════════════════════════════════

1. Create Upstash account at upstash.com
   Create a Redis database (free tier)
   Copy: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN

2. Install Upstash Redis client:
   npm install @upstash/redis
   (replaces ioredis — Upstash uses HTTP not TCP, works in serverless)

3. Replace all Redis usage:

   BEFORE:
     import Redis from 'ioredis'
     const redis = new Redis(process.env.REDIS_URL)
     await redis.set(key, value, 'EX', 3600)
     const val = await redis.get(key)

   AFTER:
     import { Redis } from '@upstash/redis'
     const redis = new Redis({
       url:   process.env.UPSTASH_REDIS_REST_URL!,
       token: process.env.UPSTASH_REDIS_REST_TOKEN!,
     })
     await redis.set(key, value, { ex: 3600 })
     const val = await redis.get(key)

4. Search codebase for all redis usage:
   □ Session storage
   □ Rate limiting
   □ LLM response caching
   □ Any pub/sub (note: Upstash does NOT support pub/sub on free tier)

VERIFY PHASE 2:
  □ App starts with no Redis connection errors ✓
  □ Caching still works (check Upstash dashboard for activity) ✓

═══════════════════════════════════════════════════════
PHASE 3 — MERGE BACKEND INTO NEXT.JS
═══════════════════════════════════════════════════════

This is the largest phase. Convert each Express route to a
Next.js App Router Route Handler.

── FOLDER STRUCTURE ────────────────────────────────────

  Express:          GET  /api/v1/classes
  Next.js Route:    src/app/api/v1/classes/route.ts

  Express:          GET  /api/v1/classes/:id
  Next.js Route:    src/app/api/v1/classes/[id]/route.ts

  Express:          POST /api/v1/classes/:id/sessions
  Next.js Route:    src/app/api/v1/classes/[id]/sessions/route.ts

── ROUTE HANDLER TEMPLATE ──────────────────────────────

  BEFORE (Express):
    router.get('/classes/:id', authenticate, async (req, res) => {
      const { id } = req.params
      const orgId  = req.user.organizationId
      const data   = await prisma.class.findUnique({ where: { id } })
      if (!data) return res.status(404).json({ error: 'Not found' })
      res.json({ data })
    })

  AFTER (Next.js Route Handler):
    // src/app/api/v1/classes/[id]/route.ts
    import { NextRequest, NextResponse } from 'next/server'
    import { authenticate } from '@/lib/auth'   // adapt your auth middleware
    import { prisma } from '@/lib/prisma'

    export async function GET(
      req: NextRequest,
      { params }: { params: { id: string } }
    ) {
      const user = await authenticate(req)
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

      const data = await prisma.class.findUnique({ where: { id: params.id } })
      if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      return NextResponse.json({ data })
    }

── AUTHENTICATION MIDDLEWARE ────────────────────────────

  Express middleware (req, res, next) won't work in Next.js.
  Convert to a helper function:

    // src/lib/auth.ts
    export async function authenticate(req: NextRequest) {
      const token = req.headers.get('authorization')?.replace('Bearer ', '')
      if (!token) return null
      // verify JWT, return user or null
    }

  Call at the top of every route handler that needs auth.

── ROUTE MIGRATION ORDER ───────────────────────────────

  Migrate in this order (least → most complex):

  1. Auth routes          (/api/v1/auth/*)
  2. Organisation routes  (/api/v1/org/*)
  3. Classes routes       (/api/v1/classes/*)
  4. Students routes      (/api/v1/classes/:id/students/*)
  5. Sessions routes      (/api/v1/classes/:id/sessions/*)
  6. Reports routes       (/api/v1/sessions/:id/reports/*)
  7. Export routes        (/api/v1/sessions/:id/export/*)
  8. LLM/AI routes        (/api/v1/generate/*)

  After each group: test in dev before moving to next.

── LONG-RUNNING ROUTES (LLM generation) ────────────────

  Vercel hobby tier has a 10s function timeout.
  Vercel Pro has 60s.

  LLM generation likely exceeds 10s for batch reports.
  Options:
    A) Upgrade to Vercel Pro (recommended for production)
    B) Use Vercel Edge Functions with streaming responses
    C) Move generation to a background job queue

  For now: add this to any LLM route handlers:
    export const maxDuration = 60  // requires Vercel Pro

  Add to route file:
    export const dynamic = 'force-dynamic'

── PRISMA IN SERVERLESS ────────────────────────────────

  Prisma needs connection pooling in serverless to avoid
  exhausting DB connections. Already handled by Supabase
  pooler URL in Phase 1. Also add:

    // src/lib/prisma.ts
    import { PrismaClient } from '@prisma/client'

    const globalForPrisma = globalThis as unknown as {
      prisma: PrismaClient | undefined
    }

    export const prisma =
      globalForPrisma.prisma ?? new PrismaClient()

    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = prisma
    }

  This prevents new PrismaClient() on every function invocation.

═══════════════════════════════════════════════════════
PHASE 4 — ENVIRONMENT VARIABLES
═══════════════════════════════════════════════════════

Create .env.local for Next.js (frontend + API routes share it):

  # Database
  DATABASE_URL="postgres://...pooler...?pgbouncer=true"
  DIRECT_URL="postgres://...direct..."

  # Redis
  UPSTASH_REDIS_REST_URL="https://..."
  UPSTASH_REDIS_REST_TOKEN="..."

  # Auth
  JWT_SECRET="..."
  NEXTAUTH_SECRET="..."    // if using NextAuth

  # LLM
  OPENAI_API_KEY="..."
  CLAUDE_API_KEY="..."

  # App
  NEXT_PUBLIC_APP_URL="https://your-app.vercel.app"

Remove all references to:
  PORT=3001
  BACKEND_URL / API_URL (no longer a separate server)

Frontend api.ts — update base URL:
  BEFORE: const BASE = process.env.NEXT_PUBLIC_API_URL  // http://localhost:3001
  AFTER:  const BASE = '/api/v1'  // relative, same origin

═══════════════════════════════════════════════════════
PHASE 5 — VERCEL DEPLOYMENT
═══════════════════════════════════════════════════════

1. Push merged repo to GitHub

2. Import project in Vercel dashboard
   → Framework: Next.js (auto-detected)
   → Root directory: frontend/ (or / if monorepo merged)
   → Build command: next build (default)

3. Add all environment variables in Vercel dashboard
   (Settings → Environment Variables)

4. Deploy

5. Add custom domain if applicable

═══════════════════════════════════════════════════════
WHAT TO DO WITH THE BACKEND FOLDER
═══════════════════════════════════════════════════════

Once all routes are migrated and verified:
  - Keep backend/ folder as reference until fully stable
  - Do NOT delete until production is confirmed working
  - After stable: archive or remove backend/

═══════════════════════════════════════════════════════
VERIFY FULL DEPLOYMENT
═══════════════════════════════════════════════════════

  □ Auth (login/logout) works on Vercel ✓
  □ Classes load from Supabase ✓
  □ Session creation works ✓
  □ Ratings save correctly ✓
  □ Individual report generation works ✓
  □ Batch report generation works ✓
  □ XLSX export works ✓
  □ PDF export works ✓
  □ Redis caching active (check Upstash dashboard) ✓
  □ No CORS errors (same origin now) ✓
  □ No 3001 port references anywhere in codebase ✓

End with: "App fully deployed on Vercel with Supabase and Upstash. Backend folder archived."