import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

const ProviderEnum = z.enum(['openai', 'claude', 'grok', 'ollama'])

const UpdateSettingsSchema = z.object({
  llm_provider: ProviderEnum,
  api_key: z.string().optional(),
  model: z.string().min(1, 'Model is required').max(100),
  ollama_url: z.string().optional(),
}).refine(
  (d) => d.llm_provider === 'ollama' || (d.api_key && d.api_key.trim().length > 0),
  { message: 'API key is required', path: ['api_key'] }
)

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-latest',
  grok: 'grok-beta',
}

export async function GET(req: NextRequest) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  try {
    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { settings: true, name: true },
    })

    if (!org) return NextResponse.json({ error: 'Organization not found', code: 'ORG_NOT_FOUND' }, { status: 404 })

    const settings = org.settings as Record<string, unknown>
    const llm_provider = (settings.llm_provider as string) ?? 'openai'

    const encryptedKey = settings.encrypted_api_key as string | undefined
    let masked_key: string | undefined
    if (encryptedKey && llm_provider !== 'ollama') {
      try {
        masked_key = maskApiKey(decryptApiKey(encryptedKey))
      } catch {
        // Key stored but unreadable — treat as absent
      }
    }

    return NextResponse.json({
      org_name: org.name,
      llm_provider,
      model: (settings.model as string) ?? DEFAULT_MODELS[llm_provider] ?? 'gpt-4o-mini',
      has_api_key: llm_provider === 'ollama' ? true : Boolean(encryptedKey),
      masked_key,
      ...(llm_provider === 'ollama' && {
        ollama_url: (settings.ollama_url as string) ?? 'http://localhost:11434',
      }),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const user = await authenticate(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_MISSING' }, { status: 401 })

  try {
    const body = await req.json()
    const parsed = UpdateSettingsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      )
    }

    const { llm_provider, api_key, model, ollama_url } = parsed.data

    const encrypted_api_key =
      llm_provider === 'ollama' ? encryptApiKey('ollama') : encryptApiKey(api_key!)

    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { settings: true },
    })

    if (!org) return NextResponse.json({ error: 'Organization not found', code: 'ORG_NOT_FOUND' }, { status: 404 })

    const existing = org.settings as Record<string, unknown>

    await prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        settings: {
          ...existing,
          llm_provider,
          model,
          encrypted_api_key,
          ...(llm_provider === 'ollama' && {
            ollama_url: ollama_url ?? 'http://localhost:11434',
          }),
        },
      },
    })

    return NextResponse.json({ llm_provider, model, has_api_key: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
