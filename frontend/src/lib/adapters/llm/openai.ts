/**
 * OpenAI LLM adapter.
 *
 * Model: OPENAI_MODEL env var (default: gpt-4o-mini).
 * Timeout: 30 seconds.
 * Retry: up to 3 attempts with exponential backoff on HTTP 429 (rate limit)
 *        and 503 (service unavailable) only. All other errors surface
 *        immediately.
 */

import OpenAI from "openai";
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
  if (err instanceof OpenAI.APIError) {
    return err.status === 429 || err.status === 503;
  }
  return false;
}

export class OpenAIAdapter implements LLMAdapter {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({
      apiKey,
      timeout: TIMEOUT_MS,
      maxRetries: 0, // We handle retries ourselves for observability.
    });
    this.model = model ?? process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
  }

  async generateReport(prompt: ReportPrompt): Promise<string> {
    const userMessage = buildPrompt(prompt);
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(
          JSON.stringify({
            event: "llm.openai.request",
            model: this.model,
            attempt,
            promptLength: userMessage.length,
          })
        );

        const start = Date.now();
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: "system",
              content:
                "You are an experienced teacher writing professional, encouraging student reports. Write exactly as instructed — no additional commentary.",
            },
            { role: "user", content: userMessage },
          ],
          temperature: 0.7,
        });

        const text = completion.choices[0]?.message?.content ?? "";
        const durationMs = Date.now() - start;

        console.log(
          JSON.stringify({
            event: "llm.openai.response",
            model: this.model,
            durationMs,
            tokensUsed: completion.usage?.total_tokens ?? null,
            responseLength: text.length,
          })
        );

        return text;
      } catch (err) {
        lastError = err;

        if (!isRetryable(err) || attempt === MAX_RETRIES - 1) {
          console.error(
            JSON.stringify({
              event: "llm.openai.error",
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
            event: "llm.openai.retry",
            model: this.model,
            attempt,
            delayMs: delay,
            reason: err instanceof OpenAI.APIError ? err.status : "unknown",
          })
        );
        await sleep(delay);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`OpenAI request failed: ${String(lastError)}`);
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}
