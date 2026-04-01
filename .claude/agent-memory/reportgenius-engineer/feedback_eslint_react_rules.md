---
name: Next.js 16 strict React ESLint rules
description: Specific ESLint rule constraints enforced by this project's eslint-config-next
type: feedback
---

This project uses Next.js 16.2.1 with very strict React ESLint rules. Three rules to watch:

**Rule 1: No ref mutation during render**
- `react-hooks/refs`: Cannot write `ref.current = value` during the render body
- **Fix:** Wrap ref mutations in `useEffect(() => { ref.current = value; }, [value])`

**Rule 2: No direct setState in effect body**
- `react-hooks/set-state-in-effect`: Cannot call setState synchronously at the top level of a `useEffect` body
- **Fix:** Call setState inside async functions or event callbacks that run from within the effect, not at the effect's top level. E.g. `useEffect(() => { async function tick() { setX(…); } setTimeout(tick, 0); }, [])`

**Rule 3: No self-referencing useCallback**
- `react-hooks/immutability`: `useCallback` body cannot reference its own result (e.g. `setTimeout(poll, …)` where `poll` is the `useCallback` return)
- **Fix:** Use a `ref` to break the cycle: `const ref = useRef(fn); useEffect(() => { ref.current = fn; }, [fn]);` then `setTimeout(() => ref.current?.(), ms)` — but remember ref mutation must be in an effect (Rule 1 above).

**Why:** This project's `eslint-config-next` version treats these as errors, not warnings. All three must be resolved for `npm run build` and CI to pass.

**How to apply:** Whenever writing React hooks that involve polling, recursive setTimeout, or updating stable callback refs — check these three constraints before running lint.
