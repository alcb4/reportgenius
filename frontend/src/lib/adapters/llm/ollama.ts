/**
 * Ollama LLM adapter.
 *
 * Uses the OpenAI-compatible API that Ollama exposes, so we can reuse the
 * existing `openai` SDK — just pointed at the local Ollama server.
 *
 * Configuration (env):
 *   OLLAMA_URL   - base URL of the Ollama server (default: http://localhost:11434/v1)
 *   OLLAMA_MODEL - model tag to use           (default: llama3.1:8b)
 *
 * No API key is required; "ollama" is passed as a placeholder to satisfy the
 * SDK's required field.
 *
 * Retries: up to 3 attempts on connection errors (ECONNREFUSED / ETIMEDOUT).
 * Timeout: 120 seconds per request (local CPU inference can take 20–60s).
 */

import OpenAI from "openai";
import { LLMAdapter, ReportPrompt } from "./types";
import { buildPrompt } from "./prompt-builder";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return 1_000 * Math.pow(2, attempt);
}

function isConnectionError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    // SDK wraps ECONNREFUSED / ETIMEDOUT as status 0 or specific codes
    return err.status === 0 || err.message.includes("ECONNREFUSED") || err.message.includes("ETIMEDOUT");
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ECONNREFUSED" || code === "ETIMEDOUT" || err.message.includes("ECONNREFUSED");
  }
  return false;
}

/** Derive the Ollama REST base (strips /v1 suffix if present). */
function ollamaRestBase(): string {
  const url = process.env["OLLAMA_URL"] ?? "http://localhost:11434/v1";
  return url.endsWith("/v1") ? url.slice(0, -3) : url.replace(/\/v1\/?$/, "");
}

export class OllamaAdapter implements LLMAdapter {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const baseURL = process.env["OLLAMA_URL"] ?? "http://localhost:11434/v1";
    this.model = process.env["OLLAMA_MODEL"] ?? "llama3.1:8b";

    this.client = new OpenAI({
      baseURL,
      apiKey: "ollama", // required by the SDK, ignored by Ollama
      timeout: TIMEOUT_MS,
      maxRetries: 0, // we handle retries ourselves
    });
  }

  async generateReport(prompt: ReportPrompt): Promise<string> {
    const userMessage = buildPrompt(prompt);
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(
          JSON.stringify({
            event: "llm.ollama.request",
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
            event: "llm.ollama.response",
            model: this.model,
            durationMs,
            responseLength: text.length,
          })
        );

        return text;
      } catch (err) {
        lastError = err;

        if (!isConnectionError(err) || attempt === MAX_RETRIES - 1) {
          console.error(
            JSON.stringify({
              event: "llm.ollama.error",
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
            event: "llm.ollama.retry",
            model: this.model,
            attempt,
            delayMs: delay,
          })
        );
        await sleep(delay);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Ollama request failed: ${String(lastError)}`);
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${ollamaRestBase()}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
