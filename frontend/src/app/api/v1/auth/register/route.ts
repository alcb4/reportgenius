import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'
import { Prisma } from '@prisma/client'
import { rateLimitOrNull } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  orgName: z.string().min(1, 'Organisation name is required').max(255),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to register' }) }),
  // Honeypot — must be absent or empty; bots fill it
  website: z.string().max(0).optional(),
  // Timing token — form render timestamp (ms); bots submit too fast
  _t: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const limited = await rateLimitOrNull(req, 'auth', 'register')
  if (limited) return limited

  try {
    const body = await req.json()
    const parsed = RegisterSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', '), code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { email, password, orgName, website, _t } = parsed.data

    // Honeypot — silently reject bots that fill the hidden field
    if (website) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Timing check — reject submissions under 3 seconds (bot speed)
    if (_t) {
      const formAge = Date.now() - parseInt(_t, 10)
      if (formAge < 3000) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
      }
    }

    const termsAcceptedAt = new Date()

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already registered', code: 'EMAIL_EXISTS' },
        { status: 409 }
      )
    }

    const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10)
    const passwordHash = await bcrypt.hash(password, bcryptRounds)

    const { user, organization } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const organization = await tx.organization.create({
        data: { name: orgName },
        select: { id: true, name: true },
      })

      const user = await tx.user.create({
        data: { email, password_hash: passwordHash, organization_id: organization.id, terms_accepted_at: termsAcceptedAt },
        select: { id: true, email: true, organization_id: true, created_at: true },
      })

      return { user, organization }
    })

    const token = signToken(user.id, user.organization_id, user.email)

    return NextResponse.json(
      {
        token,
        user: { id: user.id, email: user.email, organizationId: user.organization_id, createdAt: user.created_at },
        organization: { id: organization.id, name: organization.name },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('register error', err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
