/**
 * Settings routes — LLM provider configuration per organization.
 * API keys are AES-256 encrypted before storage in the JSONB settings field.
 *
 * Routes:
 *   GET  /api/v1/settings         — fetch current provider settings (key redacted)
 *   PUT  /api/v1/settings         — update provider + encrypted API key + model
 *   GET  /api/v1/settings/test    — validate the stored API key works
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { authenticate } from "../middleware/auth";
import { config } from "../config";

const router = Router();
const prisma = new PrismaClient();

// ── Encryption helpers ─────────────────────────────────────────────────────────
// AES-256-GCM: authenticated encryption, safe for API keys at rest.
// Derives a 32-byte key from JWT_SECRET via SHA-256 so no extra env var needed.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(config.jwtSecret).digest();
}

function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as: iv(hex):tag(hex):ciphertext(hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptApiKey(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted key format");
  const [ivHex, tagHex, cipherHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const ProviderEnum = z.enum(["openai", "claude", "grok", "ollama"]);

const UpdateSettingsSchema = z.object({
  llm_provider: ProviderEnum,
  api_key: z.string().optional(),
  model: z.string().min(1, "Model is required").max(100),
  ollama_url: z.string().optional(),
}).refine(
  (d) => d.llm_provider === "ollama" || (d.api_key && d.api_key.trim().length > 0),
  { message: "API key is required", path: ["api_key"] }
);

// ── Provider default models ────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  claude: "claude-3-5-haiku-latest",
  grok: "grok-beta",
};

// ── GET /api/v1/settings ───────────────────────────────────────────────────────

router.get(
  "/settings",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { settings: true, name: true },
      });

      if (!org) {
        res.status(404).json({ error: "Organization not found", code: "ORG_NOT_FOUND" });
        return;
      }

      const settings = org.settings as Record<string, unknown>;

      const llm_provider = (settings.llm_provider as string) ?? "openai";
      res.status(200).json({
        org_name: org.name,
        llm_provider,
        model: (settings.model as string) ?? DEFAULT_MODELS[llm_provider] ?? "gpt-4o-mini",
        // Never return the raw key — only indicate whether one is configured.
        // For ollama, no key is needed so always report true once provider is set.
        has_api_key: llm_provider === "ollama" ? true : Boolean(settings.encrypted_api_key),
        ...(llm_provider === "ollama" && {
          ollama_url: (settings.ollama_url as string) ?? "http://localhost:11434",
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/v1/settings ───────────────────────────────────────────────────────

router.put(
  "/settings",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = UpdateSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { llm_provider, api_key, model, ollama_url } = parsed.data;

      // For Ollama: no real API key — store a placeholder so has_api_key=true on re-load.
      const encrypted_api_key =
        llm_provider === "ollama" ? encryptApiKey("ollama") : encryptApiKey(api_key!);

      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { settings: true },
      });

      if (!org) {
        res.status(404).json({ error: "Organization not found", code: "ORG_NOT_FOUND" });
        return;
      }

      const existing = org.settings as Record<string, unknown>;

      await prisma.organization.update({
        where: { id: req.user.organizationId },
        data: {
          settings: {
            ...existing,
            llm_provider,
            model,
            encrypted_api_key,
            ...(llm_provider === "ollama" && {
              ollama_url: ollama_url ?? "http://localhost:11434",
            }),
          },
        },
      });

      console.log(JSON.stringify({
        event: "settings.updated",
        organizationId: req.user.organizationId,
        llm_provider,
        model,
      }));

      res.status(200).json({
        llm_provider,
        model,
        has_api_key: true,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/settings/test ──────────────────────────────────────────────────

router.get(
  "/settings/test",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { settings: true },
      });

      if (!org) {
        res.status(404).json({ error: "Organization not found", code: "ORG_NOT_FOUND" });
        return;
      }

      const settings = org.settings as Record<string, unknown>;
      const encryptedKey = settings.encrypted_api_key as string | undefined;
      const provider = (settings.llm_provider as string) ?? "openai";
      const model = (settings.model as string) ?? DEFAULT_MODELS[provider] ?? "gpt-4o-mini";

      // Ollama needs no API key — test reachability directly.
      if (provider === "ollama") {
        const ollamaBase = (settings.ollama_url as string | undefined) ?? "http://localhost:11434";
        try {
          const response = await fetch(`${ollamaBase}/api/tags`, {
            signal: AbortSignal.timeout(5_000),
          });
          const testOk = response.ok;
          res.status(200).json({
            success: testOk,
            provider,
            model,
            ...(!testOk && { error: `Ollama not reachable at ${ollamaBase}` }),
          });
        } catch {
          res.status(200).json({
            success: false,
            provider,
            model,
            error: "Ollama is not running or not reachable",
          });
        }
        return;
      }

      if (!encryptedKey) {
        res.status(400).json({
          success: false,
          error: "No API key configured",
          code: "NO_API_KEY",
        });
        return;
      }

      let apiKey: string;
      try {
        apiKey = decryptApiKey(encryptedKey);
      } catch {
        res.status(500).json({
          success: false,
          error: "Failed to decrypt stored API key",
          code: "DECRYPT_ERROR",
        });
        return;
      }

      // Test connectivity with a minimal request to the provider.
      let testOk = false;
      let testError: string | undefined;

      try {
        if (provider === "openai") {
          const response = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          testOk = response.ok;
          if (!testOk) {
            const body = (await response.json()) as { error?: { message?: string } };
            testError = body?.error?.message ?? `HTTP ${response.status}`;
          }
        } else if (provider === "claude") {
          // Claude: send a tiny message to validate key.
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              max_tokens: 1,
              messages: [{ role: "user", content: "Hi" }],
            }),
            signal: AbortSignal.timeout(10000),
          });
          testOk = response.ok;
          if (!testOk) {
            const body = (await response.json()) as { error?: { message?: string } };
            testError = body?.error?.message ?? `HTTP ${response.status}`;
          }
        } else if (provider === "grok") {
          const response = await fetch("https://api.x.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          testOk = response.ok;
          if (!testOk) {
            const body = (await response.json()) as { error?: { message?: string } };
            testError = body?.error?.message ?? `HTTP ${response.status}`;
          }
        } else {
          testError = `Unknown provider: ${provider}`;
        }
      } catch (err) {
        testError = err instanceof Error ? err.message : "Connection failed";
      }

      console.log(JSON.stringify({
        event: "settings.test",
        organizationId: req.user.organizationId,
        provider,
        success: testOk,
      }));

      res.status(200).json({
        success: testOk,
        provider,
        model,
        ...(testError ? { error: testError } : {}),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
