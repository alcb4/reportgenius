---
name: Task 4 — LLM Adapter + Single Report Generation complete
description: LLM adapters (OpenAI/Claude), factory with fallback chain, prompt-builder, report service, and reports routes all implemented and tested
type: project
---

Task 4 implemented the full LLM adapter layer and single report generation pipeline.

## What was built

- `backend/src/adapters/llm/types.ts` — LLMAdapter interface, ReportPrompt type, LENGTH_WORD_COUNT map
- `backend/src/adapters/llm/prompt-builder.ts` — buildPrompt() and formatRatingSummary(); exact template enforced; privacy check verified
- `backend/src/adapters/llm/openai.ts` — OpenAIAdapter with 3x exponential backoff on 429/503
- `backend/src/adapters/llm/claude.ts` — ClaudeAdapter with 3x exponential backoff on 429/529
- `backend/src/adapters/llm/factory.ts` — createLLMAdapter() with automatic fallback chain if secondary provider key is in env
- `backend/src/services/report.service.ts` — generateSingleReport() single Prisma query, builds prompt, calls LLM, persists Report row
- `backend/src/routes/reports.ts` — 5 endpoints: generate, list, get, update, redo
- `backend/src/config.ts` — extended with llmProvider, openaiApiKey, openaiModel, claudeApiKey, claudeModel
- `.env` — added LLM_PROVIDER, OPENAI_API_KEY, OPENAI_MODEL, CLAUDE_API_KEY, CLAUDE_MODEL

## Key decisions

- Two new deps approved: `openai` and `@anthropic-ai/sdk`
- Redo creates a NEW Report row — old report is preserved (immutable history)
- PUT /reports/:reportId updates only edited_content + word_count; llm_raw_response is never modified
- LLM prompts verified to contain only: firstName, gender, ratingSummary (aggregated score+comment), topics, tone, length. No PII.
- validateConnection() for Claude uses a 1-token message (no models.list() on Anthropic SDK)
- Internal 500 on bad API key is expected in dev; error surfaces through centralized middleware

**Why:** Privacy-safe prompt template is the core architectural constraint; prompt-builder is the single point of enforcement.
**How to apply:** Never add fields to ReportPrompt or buildPrompt() without a privacy review.
