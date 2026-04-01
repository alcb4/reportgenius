/**
 * Anthropic Claude LLM adapter.
 *
 * Model: CLAUDE_MODEL env var (default: claude-3-5-haiku-latest).
 * Timeout: 30 seconds.
 * Retry: up to 3 attempts with exponential backoff on HTTP 429 (rate limit)
 *        and 529 (overloaded) only. All other errors surface immediately.
 */

import Anthropic from "@anthropic-ai/sdk";
import { LLMAdapter, ReportPrompt } from "./types";
import { buildPrompt } from "./prompt-builder";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff: 1s, 2s, 4s. */
function backoffMs(attempt: number): number {
  return 1_000 * Math.pow(2, attempt);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // 429 = rate limit, 529 = Anthropic-specific overloaded response.
    return err.status === 429 || err.status === 529;
  }
  return false;
}

export class ClaudeAdapter implements LLMAdapter {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({
      apiKey,
      timeout: TIMEOUT_MS,
      maxRetries: 0, // We handle retries ourselves for observability.
    });
    this.model = model ?? process.env["CLAUDE_MODEL"] ?? "claude-3-5-haiku-latest";
  }

  async generateReport(prompt: ReportPrompt): Promise<string> {
    const userMessage = buildPrompt(prompt);
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(
          JSON.stringify({
            event: "llm.claude.request",
            model: this.model,
            attempt,
            promptLength: userMessage.length,
          })
        );

        const start = Date.now();
        const message = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          system:
            "You are an experienced teacher writing professional, encouraging student reports. Write exactly as instructed — no additional commentary.",
          messages: [{ role: "user", content: userMessage }],
        });

        const block = message.content[0];
        const text = block?.type === "text" ? block.text : "";
        const durationMs = Date.now() - start;

        console.log(
          JSON.stringify({
            event: "llm.claude.response",
            model: this.model,
            durationMs,
            inputTokens: message.usage?.input_tokens ?? null,
            outputTokens: message.usage?.output_tokens ?? null,
            responseLength: text.length,
          })
        );

        return text;
      } catch (err) {
        lastError = err;

        if (!isRetryable(err) || attempt === MAX_RETRIES - 1) {
          console.error(
            JSON.stringify({
              event: "llm.claude.error",
              model: this.model,
              attempt,
              error: err instanceof Error ? err.message : String(err),
            })
          );
          break;
        }

        const delay = backoffMs(attempt);
        console.log(
          JSON.stringify({
            event: "llm.claude.retry",
            model: this.model,
            attempt,
            delayMs: delay,
            reason: err instanceof Anthropic.APIError ? err.status : "unknown",
          })
        );
        await sleep(delay);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Claude request failed: ${String(lastError)}`);
  }

  async validateConnection(): Promise<boolean> {
    try {
      // Anthropic SDK does not have a models.list() — send a minimal message
      // to verify the API key is accepted. Use the cheapest available model.
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
