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


**2026-09-22** — CI: one workflow, a change-detection job gating the rest
Workflow-level `paths:` filters are a trap — a skipped *workflow* reports no status, and a required check that never reports blocks the PR forever. A skipped *job* reports as a pass.

```yaml
changes: { outputs: { client: "${{ steps.filter.outputs.client }}" } }
client:  { needs: changes, if: "${{ needs.changes.outputs.client == 'true' }}" }
```

**2026-09-22** — Branch protection + squash-only merges
Required checks: `changes`, `client`, `lint`. `changes` is required too — if it fails, `client` reports "skipped", which counts as a pass and would let a broken PR through. No required approvals: you cannot approve your own PR and would deadlock.

**2026-09-22** — `pr-title.yml`, and ticket ids leave the commit subject
Squash merge makes the PR title the only commit message on `main`, so it is the sole input to release-please. Enforced lowercase-first subjects, which rules out `MP-02 …`; ids now live in the branch name and PR body.

**2026-09-22** — Vercel: production branch pointed at a branch nobody pushes to
Importing the repo makes Vercel deploy every push to `main` straight to production. Set Production Branch to `production` (created with `git push origin main:production`, no local copy) so merges only ever produce previews.

**2026-09-23** — release-please + deploy, first release shipped
`client-v0.2.0` tagged and live. Two human decisions in the chain: merge the feature PR, merge the Release PR.

Token expiries, both 1 year: **VERCEL_TOKEN → 2026-09-23**, **RELEASE_PLEASE_TOKEN → 2026-09-22**. A dead token fails the deploy loudly and leaves production untouched.

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


**2026-09-22** — Nothing a workflow does with `GITHUB_TOKEN` wakes another workflow
GitHub blocks it to prevent recursion. So a release-please tag triggers no deploy, and a release-please PR gets no CI checks — which, with required checks, makes the Release PR unmergeable. Fix: a fine-grained PAT, plus calling the deploy explicitly via `workflow_call`.

**2026-09-22** — `.release-please-manifest.json` is the version, not the tags
An ordinary tracked file that only release-please writes, only inside the Release PR. Every confusing release-please behaviour traces back to this file disagreeing with reality.

**2026-09-22** — `bump-minor-pre-major` keeps a `feat!` from jumping to 1.0.0
Pre-1.0 the default sends a breaking change straight to `1.0.0`, declaring the API stable by accident. With it on: `feat` → 0.2.0, `fix` → 0.1.1, `feat!` → 0.2.0.

**2026-09-23** — Re-running a workflow replays the *old* workflow file
Re-runs are reproducible by design, so a fix on `main` is not picked up. To deploy an old tag with a fixed pipeline, use `workflow_dispatch`: the dropdown picks where the *workflow* comes from (`main`), the `ref` input picks the *code* (the tag).

**2026-09-23** — `git diff main...HEAD` (three dots) is what a PR shows
Three dots compares against the merge base, so `main` moving ahead never pollutes the diff. Two dots compares tips and shows main's new commits inverted, as if deleted.

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


**2026-09-22** — `vercel link` silently broke every future `.env.example`
It appends `.vercel` and `.env*` to `.gitignore`. Last-match-wins means the trailing `.env*` overrode `!.env.example` near the top. `client/.env.example` survived only because it was already tracked.

```bash
git check-ignore -v server/.env.example   # names the exact file:line doing it
```

**2026-09-23** — Vercel token scoped to the *project*, not the account
`whoami` → "User not found", `vercel pull` → "Could not retrieve Project Settings". Yet the project API worked, which is the tell: a project-scoped token has no user identity, and the CLI resolves `/v2/user` before anything else. Recreate with the account as Scope.

Rule: test a credential in isolation (`whoami`) before testing what it accesses.

**2026-09-23** — `Cannot resolve entry module index.html` — root directory applied twice
Vercel's project already has Root Directory = `client`, and `vercel build` applies it relative to the working directory. Running it inside `client/` resolved to `client/client/`. Run every `vercel` command from the repo root; drop `npm ci` too, since `vercel build` installs.

**2026-09-23** — `chore( client): release 0.2.0` — stray space in the release title
release-please's `${component}` token carries a *leading space* by design (its default template is `release${component}`). Dropping it inside `chore(${component})` produced the space. Fixed to `chore: release${component} ${version}`.
