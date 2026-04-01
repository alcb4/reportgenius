import { NextRequest } from 'next/server'
import { verifyToken, JWTPayload } from './jwt'

export async function authenticate(req: NextRequest): Promise<JWTPayload | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  try {
    return verifyToken(token)
  } catch {
    return null
  }
}
