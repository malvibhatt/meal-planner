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

**2026-09-13** — Point `main.tsx` at the alias
`import App from "@/app/App"` — the first real `@/` import, which closes MP-01. Sibling CSS stays relative (`./App.css`).

**2026-09-13** — Remote origin + first push
`origin` → github.com/malvibhatt/meal-planner over HTTPS; `main` now tracks `origin/main`.

```bash
git remote add origin https://github.com/malvibhatt/meal-planner.git
git push -u origin main
```

**2026-09-13** — Repo layout: one repo, prefixed commits
Kept `client/` + `server/` as siblings under `meal-planner` rather than splitting into two repos — a split costs two remotes and loses atomic commits when an API shape and its consuming hook change together. Prefixes give focused history without that.

```bash
git commit -m "client: MP-02 route tree"
git log --oneline --grep '^client:'    # narrow view on demand
```

---

## Concepts

**2026-09-12** — Vite does not read tsconfig `paths`
Angular's CLI configures its bundler from tsconfig, so one entry is enough. Vite deliberately doesn't — hence the duplicate config.

**2026-09-12** — Relative vs alias imports
Relative for siblings that move together (`./App.css`); alias for crossing folders (`@/api/axiosInstance`). Rule of thumb: any `../` should be an alias.

**2026-09-13** — `import.meta.dirname` needs Node 20.11+
In ESM (`"type": "module"`) there is no `__dirname`. On Node 22 use `import.meta.dirname`; older guides show `fileURLToPath(new URL(...))`.

**2026-09-13** — Vite 8 _does_ read tsconfig `paths` (supersedes the 09-12 entry above)
Rolldown resolves them natively — stripping `resolve.alias` entirely still built clean. Vite ≤6 did not; that's where the "configure it twice" advice comes from.

**2026-09-13** — CSS is the reason `resolve.alias` stays
PostCSS never sees tsconfig, so `@import "@/x.css"` dies with `ENOENT: open '@/x.css'` on `paths` alone. The alias covers what TS never touches: CSS, `url()`, `.js`.

---

## Errors

**2026-09-12** — `Module not found: ./assets/vite.svg`
Moving `App.tsx` into `src/api/` left its relative asset imports pointing at `src/api/assets/`. Fixed by using `@/assets/*` — the exact breakage aliases prevent.

**2026-09-12** — Alias config that was never exercised
`tsc` and `vite build` both passed while zero files imported `@/anything`. A green build proves nothing until one real import uses it.

**2026-09-13** — `Rolldown failed to resolve import "src/app/App"`
No `./` prefix makes it a bare specifier, so the resolver looks in `node_modules/` exactly as it would for `react`. `baseUrl: "."` does fix it, but it is deprecated in TS 6 (TS5101) and stops working in TS 7 — use `@/`.

**2026-09-13** — Commit landed under the wrong author email
Committed as `smitbhatt1623@gmail.com` (Claude account) instead of the git global `malvisbhatt@gmail.com`; passed via `git -c`, so nothing persisted to repo config. Unpushed, so amending was safe.

```bash
git commit --amend --reset-author --no-edit   # rewrites author AND committer

Verify:
git log -1 --format="%an <%ae>"

Then Add the remote
```
