TASK: ENCRYPT API KEYS IN SETTINGS — AT REST ENCRYPTION

PROBLEM:
Teacher API keys (OpenAI, Anthropic etc.) stored in the
database must never be plaintext. If the DB is breached,
plaintext keys = immediate financial damage to teachers.

═══════════════════════════════════════════════════════
APPROACH: AES-256-GCM ENCRYPTION AT REST
═══════════════════════════════════════════════════════

Encrypt before writing to DB.
Decrypt only server-side when needed for LLM call.
Key never sent to frontend after initial save.

Add to .env:
  ENCRYPTION_KEY="<32-byte hex string>"

Generate with:
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

═══════════════════════════════════════════════════════
ENCRYPTION UTILITY
═══════════════════════════════════════════════════════

Create: src/lib/encryption.ts

  import crypto from 'crypto'

  const ALGORITHM = 'aes-256-gcm'
  const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')

  export function encrypt(plaintext: string): string {
    const iv  = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ])
    const tag = cipher.getAuthTag()

    // Store as: iv:tag:encrypted (all hex)
    return [
      iv.toString('hex'),
      tag.toString('hex'),
      encrypted.toString('hex')
    ].join(':')
  }

  export function decrypt(stored: string): string {
    const [ivHex, tagHex, encryptedHex] = stored.split(':')

    const iv        = Buffer.from(ivHex, 'hex')
    const tag       = Buffer.from(tagHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)
    decipher.setAuthTag(tag)

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8')
  }

  export function maskKey(plaintext: string): string {
    // Returns: sk-...XXXX (last 4 chars visible only)
    return plaintext.slice(0, 3) + '...' + plaintext.slice(-4)
  }

═══════════════════════════════════════════════════════
SAVING AN API KEY
═══════════════════════════════════════════════════════

  // PATCH /api/v1/settings/api-key
  import { encrypt } from '@/lib/encryption'

  const { apiKey, provider } = body  // e.g. "sk-abc123", "openai"

  // Validate it looks like a real key before storing:
  if (!apiKey.startsWith('sk-')) {
    return NextResponse.json({ error: 'Invalid API key format' }, { status: 400 })
  }

  await prisma.organisationSettings.update({
    where:  { organisation_id: user.organisationId },
    data:   { api_key_encrypted: encrypt(apiKey) }
  })

  // Return masked version only — never return plaintext:
  return NextResponse.json({ maskedKey: maskKey(apiKey) })

═══════════════════════════════════════════════════════
READING AN API KEY (for LLM call only)
═══════════════════════════════════════════════════════

  import { decrypt } from '@/lib/encryption'

  const settings = await prisma.organisationSettings.findUnique({
    where: { organisation_id: user.organisationId }
  })

  const apiKey = decrypt(settings.api_key_encrypted)
  // Use for LLM call — never return to frontend

═══════════════════════════════════════════════════════
WHAT THE FRONTEND SEES
═══════════════════════════════════════════════════════

  GET /api/v1/settings

  Return ONLY the masked key:
    { apiKey: "sk-...ab4f" }   // masked
    // NEVER: { apiKey: "sk-abc123fullkey" }

  Settings UI shows:
    API Key: sk-...ab4f  [Update] [Remove]

  Teacher can see enough to know which key is stored,
  but cannot retrieve the full key via the UI or API.

═══════════════════════════════════════════════════════
REMOVING AN API KEY
═══════════════════════════════════════════════════════

  // DELETE /api/v1/settings/api-key
  await prisma.organisationSettings.update({
    where: { organisation_id: user.organisationId },
    data:  { api_key_encrypted: null }
  })

═══════════════════════════════════════════════════════
ALSO CHECK
═══════════════════════════════════════════════════════

  □ API key never written to any log files
    → Check all logger calls near LLM generation
    → Ensure error messages don't include the key:
       catch(e) { console.error('LLM error', e) }
       // make sure e doesn't contain the key

  □ API key never included in error responses to frontend

  □ ENCRYPTION_KEY added to:
    → .env.local (dev)
    → Vercel environment variables (production)
    → .env.example with placeholder:
       ENCRYPTION_KEY="your-32-byte-hex-key-here"

  □ If rotating ENCRYPTION_KEY in future:
    → Must re-encrypt all stored keys with new key
    → Document this in README under "Key Rotation"

═══════════════════════════════════════════════════════
VERIFY
═══════════════════════════════════════════════════════

  □ Save API key → DB shows encrypted string, not plaintext ✓
  □ Settings page shows masked key (sk-...xxxx) only ✓
  □ LLM generation works with decrypted key ✓
  □ GET /api/v1/settings never returns full key ✓
  □ ENCRYPTION_KEY not in any committed file ✓
  □ Remove key → DB field set to null ✓

End with: "API keys encrypted at rest with AES-256-GCM.
Plaintext key never stored or returned to frontend."