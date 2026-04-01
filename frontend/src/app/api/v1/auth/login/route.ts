import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'
import { rateLimitOrNull, isLoginLocked, recordLoginFailure, clearLoginFailures } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export async function POST(req: NextRequest) {
  const limited = await rateLimitOrNull(req, 'auth', 'login')
  if (limited) return limited

  try {
    const body = await req.json()
    const parsed = LoginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { email, password } = parsed.data

    if (await isLoginLocked(email)) {
      return NextResponse.json(
        { error: 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.', code: 'ACCOUNT_LOCKED' },
        { status: 429 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, password_hash: true, organization_id: true, created_at: true },
    })

    const dummyHash = '$2b$12$DUMMY_HASH_FOR_TIMING_SAFE_COMPARE_PLACEHOLDER_ONLY'
    const hashToCheck = user ? user.password_hash : dummyHash
    const passwordMatch = await bcrypt.compare(password, hashToCheck)

    if (!user || !passwordMatch) {
      if (user) await recordLoginFailure(email)
      return NextResponse.json(
        { error: 'Invalid email or password', code: 'AUTH_INVALID_CREDENTIALS' },
        { status: 401 }
      )
    }

    await clearLoginFailures(email)
    const token = signToken(user.id, user.organization_id, user.email)

    return NextResponse.json({
      token,
      user: { id: user.id, email: user.email, organizationId: user.organization_id, createdAt: user.created_at },
    })
  } catch (err) {
    console.error('login error', err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
