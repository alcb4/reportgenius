---
name: ts-node shell quoting issue on Linux
description: Using --compiler-options with JSON in npm scripts breaks on Linux due to shell quote stripping
type: feedback
---

Do NOT use `ts-node --compiler-options '{"module":"CommonJS"}'` in npm scripts on this Linux environment.

**Why:** The shell strips the curly-quote characters, causing a JSON parse error in ts-node: `SyntaxError: Unexpected token ''', "'{"module""... is not valid JSON`.

**How to apply:** Always use a dedicated tsconfig file (e.g. `tsconfig.seed.json`) and pass it via `ts-node --project tsconfig.seed.json` instead of inline compiler options.
