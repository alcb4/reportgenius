---
name: Prisma client generation for backend subdirectory
description: When backend has its own node_modules, prisma generate writes to root; must copy .prisma/client to backend manually
type: feedback
---

When the backend lives in a subdirectory with its own `node_modules/@prisma/client`, running `prisma generate` from the repo root writes generated types into the root `node_modules/.prisma/client/`, NOT the backend's copy.

**Why:** Prisma resolves the output to the nearest `node_modules/@prisma/client` from the schema location — the root wins.

**How to apply:** After any `prisma generate` run (schema changes, migrations), copy the generated client into the backend's node_modules:
```
cp -r node_modules/.prisma/client/. backend/node_modules/.prisma/client/
```
Without this, the backend's TypeScript types will be stale/missing and `tsc` will fail with missing model errors at runtime.

Alternative long-term fix: add a custom `output` to the prisma schema generator pointing to the backend, or consolidate to a monorepo with a single node_modules.
