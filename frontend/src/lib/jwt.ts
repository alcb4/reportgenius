import jwt from 'jsonwebtoken'

export interface JWTPayload {
  userId: string
  organizationId: string
  email: string
}

const JWT_SECRET = process.env.JWT_SECRET!
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d'

export function signToken(userId: string, organizationId: string, email: string): string {
  return jwt.sign({ userId, organizationId, email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions)
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JWTPayload
}
