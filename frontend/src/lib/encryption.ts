import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

function deriveKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY
  if (envKey) {
    // Prefer explicit 32-byte hex key from ENCRYPTION_KEY env var
    return Buffer.from(envKey, 'hex')
  }
  // Fallback: derive from JWT_SECRET (for dev environments without ENCRYPTION_KEY)
  return crypto.createHash('sha256').update(process.env.JWT_SECRET!).digest()
}

export function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey()
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptApiKey(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted key format')
  const [ivHex, tagHex, cipherHex] = parts as [string, string, string]
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ciphertext = Buffer.from(cipherHex, 'hex')
  const key = deriveKey()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}

/** Returns a masked version safe to show in the UI: sk-...ab4f */
export function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 7) return '***'
  return plaintext.slice(0, 3) + '...' + plaintext.slice(-4)
}
