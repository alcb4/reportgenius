/**
 * Validated environment configuration module.
 * Throws at startup if any required variable is missing.
 * All env access in the application MUST go through this module.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

// Validate all required vars at module load time — fails fast at startup.
export const config = {
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret: requireEnv("JWT_SECRET"),
  port: parseInt(optionalEnv("PORT", "3001"), 10),
  nodeEnv: optionalEnv("NODE_ENV", "development"),
  jwtExpiresIn: optionalEnv("JWT_EXPIRES_IN", "7d"),
  bcryptRounds: parseInt(optionalEnv("BCRYPT_ROUNDS", "12"), 10),

  // LLM configuration — provider + per-provider API keys + models.
  // OPENAI_API_KEY / CLAUDE_API_KEY are optional; used when the matching
  // provider (or fallback chain) is active.
  // Ollama requires no API key — OLLAMA_URL and OLLAMA_MODEL are sufficient.
  llmProvider: optionalEnv("LLM_PROVIDER", "openai"),
  openaiApiKey: process.env["OPENAI_API_KEY"] ?? "",
  openaiModel: optionalEnv("OPENAI_MODEL", "gpt-4o-mini"),
  claudeApiKey: process.env["CLAUDE_API_KEY"] ?? "",
  claudeModel: optionalEnv("CLAUDE_MODEL", "claude-3-5-haiku-latest"),
  ollamaModel: optionalEnv("OLLAMA_MODEL", "llama3.1:8b"),

  // BullMQ / Redis configuration.
  redisUrl: optionalEnv("REDIS_URL", "redis://localhost:6379"),
  bullConcurrency: parseInt(optionalEnv("BULL_CONCURRENCY", "10"), 10),
} as const;
