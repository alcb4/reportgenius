---
name: Task 7 — Next.js Frontend Shell complete
description: Next.js 16.2.1 frontend created with auth, dashboard, class creation, settings pages. Backend settings route added.
type: project
---

Task 7 implemented the full Next.js 16.2.1 App Router frontend shell.

**Frontend stack:** Next.js 16.2.1, React 19, Tailwind CSS v4, TypeScript strict mode.

**Key files created:**
- `frontend/src/lib/api.ts` — `apiFetch<T>()` wrapper, reads JWT from localStorage, throws `APIError` on non-2xx
- `frontend/src/lib/auth.ts` — `getToken/setToken/clearToken/isAuthenticated` helpers, SSR-safe
- `frontend/src/context/AuthContext.tsx` — `AuthProvider` with lazy useState initialiser (reads localStorage once at init, avoids setState-in-effect ESLint error)
- `frontend/src/app/layout.tsx` — Root layout wrapping `<AuthProvider>`, uses Inter font from next/font/google
- `frontend/src/app/(auth)/login/page.tsx` — Login form, client component, redirects to /dashboard on success
- `frontend/src/app/(auth)/register/page.tsx` — Register form with org name field
- `frontend/src/app/(app)/layout.tsx` — Protected shell: unauthenticated → router.replace("/login"), sidebar nav, responsive
- `frontend/src/app/(app)/dashboard/page.tsx` — Class cards grid, skeleton loading, empty state
- `frontend/src/app/(app)/classes/new/page.tsx` — Tag-input for topics, checkbox disciplines, custom discipline additions
- `frontend/src/app/(app)/classes/[id]/page.tsx` — Class detail placeholder page
- `frontend/src/app/(app)/settings/page.tsx` — LLM provider dropdown, encrypted key input, test connection button

**Backend additions:**
- `backend/src/routes/settings.ts` — GET/PUT /api/v1/settings, GET /api/v1/settings/test; AES-256-GCM encryption of API keys, key derived from JWT_SECRET via SHA-256
- Mounted in `backend/src/server.ts` at `/api/v1`
- `backend/src/routes/classes.ts` — Added GET /:id route; fixed response shapes from `{ classes }` to `{ data }` and `{ class }` to `{ data }` for consistency

**ESLint fix:** Next.js 16.2.1 ESLint config flags `setState()` called synchronously inside `useEffect`. Solved by using a lazy useState initialiser (`useState<string | null>(readTokenOnce)`) which reads localStorage exactly once during the first render. The auth redirect in `(app)/layout.tsx` uses `router.replace()` inside an effect — this is a navigation side-effect (acceptable), not a cascading state cascade.

**Why:** The lazy initialiser pattern avoids SSR mismatch: on server, `readTokenOnce` returns null (guarded by `typeof window`). On client, it reads the real token immediately without needing a second render cycle.

**How to apply:** For any future client components that need to hydrate from localStorage, always use the lazy initialiser pattern (`useState(readFn)`) not `useState(null)` + `useEffect(() => setState(readFn()), [])`.
