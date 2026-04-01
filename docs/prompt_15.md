TASK: FULL SECURITY AUDIT BEFORE PUBLIC LAUNCH

Context: Multi-tenant SaaS handling student PII (minors),
teacher data, school data. UK/EU GDPR applies. Open source
on GitHub. Free tier hosting (Vercel + Supabase).

TREAT THIS AS A PRE-LAUNCH SECURITY GATE.
Fix all CRITICAL and HIGH items before deployment.
Document MEDIUM items with a remediation plan.

═══════════════════════════════════════════════════════
SECTION 1 — SECRETS & HARDCODED CREDENTIALS
═══════════════════════════════════════════════════════

Run across ENTIRE codebase including backend/, frontend/,
scripts/, config/, prisma/, any *.json, *.yml, *.yaml:

  □ grep -rn "sk-" .                    // OpenAI keys
  □ grep -rn "sk-ant-" .                // Anthropic keys
  □ grep -rn "password" . --include="*.ts" --include="*.js"
  □ grep -rn "secret" .  --include="*.ts" --include="*.js"
  □ grep -rn "postgres://" .            // hardcoded DB URLs
  □ grep -rn "redis://" .               // hardcoded Redis URLs
  □ grep -rn "Bearer " .                // hardcoded tokens
  □ Check git log for any previously committed secrets:
    git log --all --full-history -- .env*

  ACTION: Any found → rotate immediately, add to .gitignore,
  confirm .env* is in .gitignore before repo goes public.

  Also verify .gitignore contains:
    .env
    .env.local
    .env.production
    .env*.local
    /backend/.env

═══════════════════════════════════════════════════════
SECTION 2 — AUTHENTICATION & AUTHORISATION
═══════════════════════════════════════════════════════

── JWT Security ────────────────────────────────────────

  □ JWT_SECRET is at least 32 random characters
    → Generate: openssl rand -base64 32
  □ JWT expiry set (not infinite):
    expiresIn: '24h' or '7d' — never omit expiry
  □ JWT algorithm is HS256 or RS256 — NOT 'none'
    → Check: jwt.verify(token, secret, { algorithms: ['HS256'] })
  □ Refresh tokens implemented? If yes:
    → Stored in httpOnly cookie, not localStorage
    → Rotation on use (invalidate old on refresh)

── Route Protection ────────────────────────────────────

  □ EVERY API route that returns data has authenticate() guard
  □ No route accidentally left public that shouldn't be
    → Audit all route.ts files for missing authenticate()

  □ Organisation isolation — CRITICAL for multi-tenant:
    Every DB query that returns org data MUST filter by
    the authenticated user's organisationId, not just the
    resource ID in the URL.

    VULNERABLE (IDOR attack):
      prisma.class.findUnique({ where: { id: params.id } })
      // attacker can access any class by guessing UUID

    SECURE:
      prisma.class.findUnique({
        where: {
          id:              params.id,
          organisation_id: user.organisationId  // ← mandatory
        }
      })

    CHECK EVERY query for: classes, students, sessions,
    reports, tests, users — all must include org scoping.

  □ Role checks — if roles exist (admin/teacher):
    → Teachers cannot access other teachers' data
    → Teachers cannot access other organisations
    → No privilege escalation via API param manipulation

── Password Security ────────────────────────────────────

  □ Passwords hashed with bcrypt (cost factor ≥ 12)
    NOT md5, NOT sha1, NOT sha256 without salt
  □ Password minimum length enforced (≥ 8 chars)
  □ No passwords logged anywhere (check logger calls)
  □ Password reset tokens:
    → Cryptographically random (crypto.randomBytes)
    → Single use (invalidated after use)
    → Expire after 1 hour max
    → Stored as hash, not plaintext

═══════════════════════════════════════════════════════
SECTION 3 — INPUT VALIDATION & INJECTION
═══════════════════════════════════════════════════════

── SQL Injection ───────────────────────────────────────

  Prisma parameterises by default — but check for:
  □ Any raw query usage:
    prisma.$queryRaw, prisma.$executeRaw
    → If used, must use Prisma.sql template literal, NOT
      string interpolation:
      UNSAFE:   prisma.$queryRaw(`SELECT * WHERE id = ${id}`)
      SAFE:     prisma.$queryRaw`SELECT * WHERE id = ${id}`

── Input Validation ────────────────────────────────────

  □ Install and use Zod (or equivalent) on ALL API routes:
    → Validate req.body shape and types on every POST/PATCH
    → Validate URL params (UUIDs should match UUID format)
    → Return 400 with safe error message on invalid input
    → Never return raw Prisma/DB errors to client

  Example:
    const schema = z.object({
      name:  z.string().min(1).max(100),
      email: z.string().email(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

  □ No user input passed directly to LLM prompts without sanitisation:
    → Strip or escape any prompt injection attempts
    → Student names, teacher comments going into prompts
      should be trimmed and length-capped
    → Add to prompt builder: inputs truncated to max length

  □ File uploads (if any — PDF/export):
    → Validate file type server-side (not just extension)
    → Max file size enforced

── XSS Prevention ──────────────────────────────────────

  □ Next.js escapes JSX by default — verify no dangerouslySetInnerHTML
    → Search: grep -rn "dangerouslySetInnerHTML" .
    → If found: is the content sanitised with DOMPurify first?
  □ Report text from LLM rendered as text, not HTML

═══════════════════════════════════════════════════════
SECTION 4 — RATE LIMITING & ANTI-ABUSE
═══════════════════════════════════════════════════════

── API Rate Limiting ────────────────────────────────────

  Implement rate limiting on ALL API routes using Upstash
  Redis (already in stack). Use @upstash/ratelimit:

    npm install @upstash/ratelimit

    import { Ratelimit } from '@upstash/ratelimit'
    import { Redis } from '@upstash/redis'

    const ratelimit = new Ratelimit({
      redis:     Redis.fromEnv(),
      limiter:   Ratelimit.slidingWindow(20, '10 s'),
      analytics: true,
    })

    // In route handler:
    const { success } = await ratelimit.limit(ip)
    if (!success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

  Tiered limits (stricter on sensitive routes):

    Auth routes (login, register):   5 req / 15 min per IP
    Password reset:                  3 req / hour per IP
    LLM generation:                  10 req / hour per user
    General API:                     60 req / min per user
    Export routes:                   10 req / hour per user

── Signup Anti-Bot ─────────────────────────────────────

  □ Add honeypot field to registration form:

    // Hidden field — bots fill it, humans don't
    <input
      type="text"
      name="website"           // enticing name for bots
      style={{ display: 'none' }}
      tabIndex={-1}
      autoComplete="off"
    />

    // Server-side: reject if honeypot field is filled
    if (body.website) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
      // Don't tell them why — silent rejection
    }

  □ Add timing check — bots fill forms too fast:
    // Track form render time server-side via hidden timestamp
    // Reject submissions under 3 seconds old
    const formAge = Date.now() - parseInt(body._t)
    if (formAge < 3000) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

  □ Email verification on signup — prevents fake accounts
    → Send verification email before account is active
    → Unverified accounts cannot access any data

  □ Consider: restrict signups to school email domains
    (e.g. *.sch.uk, *.ac.uk) if targeting UK schools only
    → Configurable allowlist of domain patterns

  □ Login attempt lockout:
    → 5 failed attempts → account locked for 15 minutes
    → Notify user by email on lockout
    → Implemented via Redis counter per email

═══════════════════════════════════════════════════════
SECTION 5 — PII & STUDENT DATA (GDPR / UK GDPR)
═══════════════════════════════════════════════════════

This is the highest legal risk area. Students are minors.

── Data Minimisation ───────────────────────────────────

  □ Only collect what is necessary:
    → Student: first name, last name, ref ID, gender (optional)
    → NO date of birth, NO home address, NO parent details
    → NO photos

  □ Audit every field in the student schema — justify each one
    or remove it.

── Data at Rest ────────────────────────────────────────

  □ Supabase encrypts at rest by default ✓
  □ Confirm no student data in logs:
    → Search loggers for any student name/ID being logged
    → LLM prompt logs should be anonymised or not stored
  □ Confirm no student data in error messages returned to client

── Data in Transit ─────────────────────────────────────

  □ HTTPS enforced everywhere (Vercel does this by default) ✓
  □ API calls from frontend use HTTPS only
  □ Supabase connection uses SSL ✓

── Data Isolation (multi-tenant) ───────────────────────

  □ Row Level Security (RLS) enabled on Supabase tables
    → Even if application auth fails, DB-level RLS
      prevents cross-org data access
    → Add RLS policies for each table keyed on org_id

  Example Supabase RLS policy:
    CREATE POLICY "org_isolation" ON students
    FOR ALL USING (
      organisation_id = auth.jwt() ->> 'organisationId'
    );

── Data Retention & Deletion ───────────────────────────

  □ Account deletion removes ALL associated data:
    → Organisation → classes → students → sessions →
      reports → ratings (cascade delete in Prisma schema)
  □ Add a "Delete My Data" option in settings (GDPR right
    to erasure)
  □ Consider auto-deletion of old sessions (e.g. > 2 years)

── Privacy Policy ──────────────────────────────────────

  □ Privacy policy page required before launch:
    → What data is collected
    → How it's stored and where (Supabase/Vercel regions)
    → How long it's retained
    → How to request deletion
  □ Consent checkbox on signup linking to privacy policy

═══════════════════════════════════════════════════════
SECTION 6 — HTTP SECURITY HEADERS
═══════════════════════════════════════════════════════

Add to next.config.js:

  const securityHeaders = [
    { key: 'X-DNS-Prefetch-Control',    value: 'on' },
    { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
    { key: 'X-Content-Type-Options',    value: 'nosniff' },
    { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
    {
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",   // tighten after testing
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self' https://*.supabase.co https://*.upstash.io",
        "frame-ancestors 'none'",
      ].join('; ')
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload'
    },
  ]

  module.exports = {
    async headers() {
      return [{ source: '/(.*)', headers: securityHeaders }]
    }
  }

═══════════════════════════════════════════════════════
SECTION 7 — OPEN SOURCE SPECIFIC RISKS
═══════════════════════════════════════════════════════

Since code is public on GitHub:

  □ .env.example file in repo — with placeholder values only:
    DATABASE_URL="postgres://user:password@host:5432/db"
    JWT_SECRET="your-32-char-secret-here"
    (Never real values)

  □ SECURITY.md file — responsible disclosure policy:
    How to report vulnerabilities privately

  □ Dependency audit before going public:
    npm audit
    → Fix all critical and high vulnerabilities
    → Set up Dependabot alerts on GitHub repo

  □ No admin backdoors, test accounts, or debug routes
    left in production code:
    → Search: grep -rn "admin@" .
    → Search: grep -rn "test@" .
    → Search: grep -rn "/debug" .
    → Search: grep -rn "isDev &&" . (dev-only bypasses)

  □ No commented-out auth bypasses:
    → Search: grep -rn "// authenticate" .
    → Search: grep -rn "TODO.*auth" .

═══════════════════════════════════════════════════════
SECTION 8 — LLM-SPECIFIC SECURITY
═══════════════════════════════════════════════════════

  □ Prompt injection — teacher comment fields go into prompts:
    → Cap input length: comment max 500 chars
    → Strip: "ignore previous instructions", "system:",
      "you are now", "jailbreak" patterns
    → Log any suspicious patterns for review

  □ LLM API key protection:
    → Keys server-side only, never in client bundle
    → Verify: grep -rn "OPENAI" frontend/src --include="*.ts"
      should return nothing (no key refs in frontend)

  □ LLM output validation:
    → Generated report text sanitised before storing
    → Max length enforced on stored report text
    → Never execute or eval LLM output

  □ Cost protection:
    → Rate limit per user per day on generation
    → Alert if spend exceeds threshold (OpenAI/Anthropic dashboards)

═══════════════════════════════════════════════════════
SECTION 9 — VERCEL + SUPABASE SPECIFIC
═══════════════════════════════════════════════════════

  □ Supabase:
    → Disable "Enable public signup" if using Supabase Auth
    → API keys: use anon key only in client, service role
      key ONLY server-side, never in frontend bundle
    → Verify: service role key not in any frontend file
    → Enable RLS on ALL tables (default is disabled)

  □ Vercel:
    → Environment variables set in dashboard, not in repo
    → Preview deployments — do they have access to
      production DB? They shouldn't.
      → Create separate PREVIEW env vars pointing to
        a separate staging Supabase project

═══════════════════════════════════════════════════════
PRIORITY ORDER FOR FIXES
═══════════════════════════════════════════════════════

  CRITICAL (block launch):
    1. IDOR / org isolation on every DB query
    2. JWT security (expiry, algorithm)
    3. No secrets in git history
    4. Input validation (Zod) on all routes
    5. RLS enabled on Supabase tables
    6. Rate limiting on auth routes

  HIGH (fix before launch):
    7. HTTP security headers
    8. Honeypot + timing on signup
    9. Login lockout
    10. GDPR deletion flow
    11. Email verification

  MEDIUM (fix within 30 days of launch):
    12. Full CSP tightening
    13. Prompt injection filtering
    14. Dependency audit (npm audit)
    15. Privacy policy page
    16. Auto data retention policy

═══════════════════════════════════════════════════════

End with: "Security audit complete. All critical and high items
resolved. App is safe to launch with student data."