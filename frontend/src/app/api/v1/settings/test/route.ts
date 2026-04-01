import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/authenticate'
import { decryptApiKey } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

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
      select: { settings: true },
    })

    if (!org) return NextResponse.json({ error: 'Organization not found', code: 'ORG_NOT_FOUND' }, { status: 404 })

    const settings = org.settings as Record<string, unknown>
    const encryptedKey = settings.encrypted_api_key as string | undefined
    const provider = (settings.llm_provider as string) ?? 'openai'
    const model = (settings.model as string) ?? DEFAULT_MODELS[provider] ?? 'gpt-4o-mini'

    if (provider === 'ollama') {
      const ollamaBase = (settings.ollama_url as string | undefined) ?? 'http://localhost:11434'
      try {
        const response = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5_000) })
        const testOk = response.ok
        return NextResponse.json({
          success: testOk, provider, model,
          ...(!testOk && { error: `Ollama not reachable at ${ollamaBase}` }),
        })
      } catch {
        return NextResponse.json({ success: false, provider, model, error: 'Ollama is not running or not reachable' })
      }
    }

    if (!encryptedKey) {
      return NextResponse.json({ success: false, error: 'No API key configured', code: 'NO_API_KEY' }, { status: 400 })
    }

    let apiKey: string
    try {
      apiKey = decryptApiKey(encryptedKey)
    } catch {
      return NextResponse.json({ success: false, error: 'Failed to decrypt stored API key', code: 'DECRYPT_ERROR' }, { status: 500 })
    }

    let testOk = false
    let testError: string | undefined

    try {
      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        })
        testOk = response.ok
        if (!testOk) {
          const body = (await response.json()) as { error?: { message?: string } }
          testError = body?.error?.message ?? `HTTP ${response.status}`
        }
      } else if (provider === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }),
          signal: AbortSignal.timeout(10000),
        })
        testOk = response.ok
        if (!testOk) {
          const body = (await response.json()) as { error?: { message?: string } }
          testError = body?.error?.message ?? `HTTP ${response.status}`
        }
      } else if (provider === 'grok') {
        const response = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        })
        testOk = response.ok
        if (!testOk) {
          const body = (await response.json()) as { error?: { message?: string } }
          testError = body?.error?.message ?? `HTTP ${response.status}`
        }
      } else {
        testError = `Unknown provider: ${provider}`
      }
    } catch (err) {
      testError = err instanceof Error ? err.message : 'Connection failed'
    }

    return NextResponse.json({ success: testOk, provider, model, ...(testError ? { error: testError } : {}) })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
