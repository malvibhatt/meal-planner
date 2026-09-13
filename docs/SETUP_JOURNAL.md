# Meal Planner — Setup Journal

Terse log. Two lines per entry, code only when it helps.
Update with `/journal` in Claude Code.

---

## Setup steps

**2026-09-08** — Scaffold client
Vite + React 19 + TS, then the four runtime deps. Backend lives in a separate `server/` (not started yet).

```bash
npm create vite@latest client -- --template react-ts
npm i react-router-dom axios antd dayjs
```

**2026-09-12** — Path alias `@/` → `src/`
Must be configured in **two** places: Vite resolves it at build time, TS only type-checks it. Neither implies the other.

```ts
// vite.config.ts
resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } }
```
```json
// tsconfig.app.json → compilerOptions
"paths": { "@/*": ["./src/*"] }
```

**2026-09-13** — Folder tree + first commit
Feature-first layout per cheatsheet §5. `App.tsx` moved `src/api/` → `src/app/`; `api/` is reserved for the axios layer.

---

## Concepts

**2026-09-12** — Vite does not read tsconfig `paths`
Angular's CLI configures its bundler from tsconfig, so one entry is enough. Vite deliberately doesn't — hence the duplicate config.

**2026-09-12** — Relative vs alias imports
Relative for siblings that move together (`./App.css`); alias for crossing folders (`@/api/axiosInstance`). Rule of thumb: any `../` should be an alias.

**2026-09-13** — `import.meta.dirname` needs Node 20.11+
In ESM (`"type": "module"`) there is no `__dirname`. On Node 22 use `import.meta.dirname`; older guides show `fileURLToPath(new URL(...))`.

---

## Errors

**2026-09-12** — `Module not found: ./assets/vite.svg`
Moving `App.tsx` into `src/api/` left its relative asset imports pointing at `src/api/assets/`. Fixed by using `@/assets/*` — the exact breakage aliases prevent.

**2026-09-12** — Alias config that was never exercised
`tsc` and `vite build` both passed while zero files imported `@/anything`. A green build proves nothing until one real import uses it.
