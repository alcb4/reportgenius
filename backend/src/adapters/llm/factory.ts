/**
 * LLM adapter factory.
 *
 * createLLMAdapter(provider, apiKey) returns the correct adapter instance.
 *
 * Fallback chain:
 *   If the primary provider fails to respond after all retries, and a
 *   secondary provider key is available in env, the factory returns a
 *   FallbackAdapter that transparently tries the secondary on failure.
 *
 * Supported providers:  "openai"  |  "claude"  |  "ollama"
 * Default:              "openai"
 *
 * Ollama fallback chain: ollama → openai (if OPENAI_API_KEY set) → claude
 */

import { LLMAdapter, ReportPrompt } from "./types";
import { OpenAIAdapter } from "./openai";
import { ClaudeAdapter } from "./claude";
import { OllamaAdapter } from "./ollama";

/**
 * Returns true if the key looks like a placeholder rather than a real
 * API key — catches "your_key_here", empty strings, and suspiciously short
 * values that could never be a valid key.
 */
function isPlaceholderKey(key: string | undefined): boolean {
  if (!key || key.trim().length === 0) return true;
  const lower = key.trim().toLowerCase();
  if (lower.includes("your_key") || lower.includes("your key") || lower.includes("_here")) return true;
  if (lower === "ollama") return true; // internal sentinel used for ollama provider
  if (key.trim().length < 10) return true;
  return false;
}

/**
 * Warn at startup if any configured provider key looks like a placeholder.
 * Called once from the module scope so the warning appears in the boot log.
 */
function warnPlaceholderKeys(): void {
  const checks: Array<{ name: string; envVar: string }> = [
    { name: "OPENAI",  envVar: "OPENAI_API_KEY"  },
    { name: "CLAUDE",  envVar: "CLAUDE_API_KEY"   },
  ];
  for (const { name, envVar } of checks) {
    const val = process.env[envVar];
    if (isPlaceholderKey(val)) {
      console.warn(
        JSON.stringify({
          event: "llm.config.placeholder_key",
          provider: name,
          envVar,
          message: `${envVar} looks like a placeholder — this provider will not be used as a fallback`,
        })
      );
    }
  }
}

warnPlaceholderKeys();

/** Create an adapter for a single provider. */
function createSingleAdapter(provider: string, apiKey: string): LLMAdapter {
  switch (provider.toLowerCase()) {
    case "ollama":
      return new OllamaAdapter();
    case "claude":
      return new ClaudeAdapter(apiKey);
    case "openai":
    default:
      return new OpenAIAdapter(apiKey);
  }
}

/**
 * Wraps a primary adapter with a fallback adapter.
 * If the primary throws, the fallback is tried once (no additional retries —
 * the fallback adapter has its own internal retry logic).
 */
class FallbackAdapter implements LLMAdapter {
  constructor(
    private readonly primary: LLMAdapter,
    private readonly fallback: LLMAdapter,
    private readonly primaryName: string,
    private readonly fallbackName: string
  ) {}

  async generateReport(prompt: ReportPrompt): Promise<string> {
    try {
      return await this.primary.generateReport(prompt);
    } catch (primaryErr) {
      console.error(
        JSON.stringify({
          event: "llm.fallback.triggered",
          primaryProvider: this.primaryName,
          fallbackProvider: this.fallbackName,
          primaryError:
            primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        })
      );
      return this.fallback.generateReport(prompt);
    }
  }

  async validateConnection(): Promise<boolean> {
    const primaryOk = await this.primary.validateConnection();
    if (primaryOk) return true;
    return this.fallback.validateConnection();
  }
}

/**
 * Factory entry point.
 *
 * @param provider  - "openai", "claude", or "ollama" (case-insensitive)
 * @param apiKey    - Decrypted API key for the primary provider (ignored for ollama)
 * @returns         An LLMAdapter (potentially with a fallback chain)
 */
export function createLLMAdapter(provider: string, apiKey: string): LLMAdapter {
  const primary = createSingleAdapter(provider, apiKey);

  // Ollama fallback chain: ollama → openai → claude
  // Only wire up a fallback if a REAL (non-placeholder) key exists.
  if (provider.toLowerCase() === "ollama") {
    const openaiKey = process.env["OPENAI_API_KEY"];
    if (!isPlaceholderKey(openaiKey)) {
      return new FallbackAdapter(primary, new OpenAIAdapter(openaiKey!), "ollama", "openai");
    }
    const claudeKey = process.env["CLAUDE_API_KEY"];
    if (!isPlaceholderKey(claudeKey)) {
      return new FallbackAdapter(primary, new ClaudeAdapter(claudeKey!), "ollama", "claude");
    }
    // No real fallback key — return the Ollama adapter unwrapped so that a
    // timeout surfaces as a clean error rather than silently hitting a
    // placeholder key and returning a confusing auth failure.
    return primary;
  }

  // openai/claude: attempt to wire up the other provider as fallback,
  // but only if the fallback key is real (not a placeholder).
  const fallbackProvider = provider.toLowerCase() === "claude" ? "openai" : "claude";
  const fallbackEnvKey =
    fallbackProvider === "openai"
      ? process.env["OPENAI_API_KEY"]
      : process.env["CLAUDE_API_KEY"];

  if (!isPlaceholderKey(fallbackEnvKey)) {
    const fallback = createSingleAdapter(fallbackProvider, fallbackEnvKey!);
    return new FallbackAdapter(primary, fallback, provider, fallbackProvider);
  }

  return primary;
}
