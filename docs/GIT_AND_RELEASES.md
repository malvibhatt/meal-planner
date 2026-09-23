# Git, CI & Releases — Meal Planner

The workflow this project uses, and why. Written to be followed step by step.

Repo: `github.com/malvibhatt/meal-planner` (monorepo — `client/` + `server/`)

---

## 1. The model

Trunk-based with **release branches cut from `main`**. No permanent `develop` branch.

```
main  ──●──●──●──●──●──●──●──●──●──►   trunk, everything merges here
            \                 \
             ●──●  release/1.4  ●──●  release/1.5
                │                  │
              v1.4.0             v1.5.0   ← tagged, shipped
                │
                └─ hotfix commits merge back to main
```

**The three rules:**

1. **Everything merges to `main`.** Features, fixes, docs. `main` is always green.
2. **A release branch is cut when the train departs**, not when work starts. Only stabilization commits land on it — no new features.
3. **Fixes made on a release branch merge back to `main`**, or you ship the same bug again next release.

**Why no `develop`:** its only job is holding merged-but-unreleased work. Release branches do that better, because they exist *only* during a stabilization window instead of forever. The author of GitFlow himself added a caveat in 2020 that the model doesn't suit continuous delivery. Feature flags cover the rest — merge code that's switched off.

> **Solo-project reality check:** with one developer and no users, the release branch is *practice*, not necessity. You could tag `main` directly. Do the full flow anyway — the point is the muscle memory. Just don't be confused when it feels like ceremony; it is, until there's a second person.

---

## 2. Branch naming

Git does not know what "client" or "server" means — a branch always spans the whole repo. The prefix is **convention**, and nothing but discipline stops you editing `server/` on a `client/` branch.

| Branch | Use |
|---|---|
| `main` | Trunk. Protected. Never commit directly. |
| `client/mp-02-route-tree` | Frontend ticket |
| `server/mp-12-auth-endpoints` | Backend ticket |
| `mp-31-fetch-hook` | Touches both — no prefix |
| `release/1.4` | Stabilization for the 1.4 train |
| `hotfix/1.4.1-token-refresh` | Urgent fix against a shipped release |
| `docs/journal-mp-02` | Docs only |

**The reliable filter is paths, not names** — git enforces this one:

```bash
git log --oneline -- client/          # every commit touching the client
git diff main --stat -- server/
```

---

## 3. Conventional Commits

This is the **contract that makes automated versioning possible**. The tooling reads your commit messages to decide the next version number. Get this right and everything downstream is free.

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

| Type | Meaning | Version bump |
|---|---|---|
| `feat` | New feature | **minor** — 1.4.0 → 1.5.0 |
| `fix` | Bug fix | **patch** — 1.4.0 → 1.4.1 |
| `perf` | Performance improvement | patch |
| `refactor` | Neither fixes nor adds | none |
| `docs` | Documentation only | none |
| `test` | Tests only | none |
| `chore` | Tooling, deps, config | none |
| `ci` | CI config | none |
| `BREAKING CHANGE:` in footer, or `feat!:` | Incompatible change | **major** — 1.4.0 → 2.0.0 |

**Scope is where `client` / `server` goes:**

```bash
git commit -m "feat(client): add route tree with nested layouts"
git commit -m "fix(server): set sameSite on the refresh cookie"
git commit -m "feat(client)!: return paginated results from the api layer

BREAKING CHANGE: mealsApi.list now returns Paginated<Meal>, not Meal[]"
```

**Rules:** subject in imperative mood ("add", not "added"), **starting with a lowercase letter**, no trailing period, under ~72 chars.

**Ticket ids do not go in the subject.** They live in the branch name
(`client/mp-02-route-tree`) and the PR description. This is enforced:
`.github/workflows/pr-title.yml` rejects a subject starting with a capital,
and `MP-02 …` is a capital. The id is still one `git log --oneline` away via
the branch, and the squash commit carries a `(#12)` PR reference that links
the change back to its discussion.

---

## 4. Daily workflow (per ticket)

```bash
# 1. start from a fresh main
git switch main && git pull

# 2. branch for the ticket
git switch -c client/mp-02-route-tree

# 3. work, committing in conventional format
git commit -m "feat(client): add route tree with nested layouts"

# 4. push and open a PR
git push -u origin client/mp-02-route-tree
#    → open the PR on github.com (or `gh pr create` if you install gh)

# 5. CI goes green, you read your own diff, then Squash and merge

# 6. clean up
git switch main && git pull
git branch -d client/mp-02-route-tree
```

**Squash merge** is the right default here: your branch's messy "wip", "fix typo", "actually fix it" commits collapse into one clean conventional commit on `main`. The PR title becomes that commit message — so **the PR title must be in conventional format**, since that's what the versioning tool reads.

> Why PRs at all when you're solo? For the review surface. Reading your own diff in GitHub's UI before merging catches a surprising amount — leftover `console.log`, a stray `any`, a file you didn't mean to commit. It costs 30 seconds.

---

## 5. CI with GitHub Actions

### The monorepo problem

You don't want a `docs/` typo to run the full client build. But the naive fix — workflow-level `paths:` filters — has a trap: **a skipped workflow never reports a status, and a required check that never reports blocks the PR forever.**

The fix is one workflow that *always* runs, with a first job that detects what changed and gates the rest.

### GIT-01 — Create `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main, 'release/**']

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      client: ${{ steps.filter.outputs.client }}
      server: ${{ steps.filter.outputs.server }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            client:
              - 'client/**'
              - '.github/workflows/ci.yml'
            server:
              - 'server/**'
              - '.github/workflows/ci.yml'

  client:
    needs: changes
    if: ${{ needs.changes.outputs.client == 'true' }}
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: client
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: client/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npx tsc -b
      - run: npm run build

  server:
    needs: changes
    if: ${{ needs.changes.outputs.server == 'true' }}
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: server/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm test
```

The `server` job is inert until MP-10 creates `server/` — it simply never triggers.

**AC:** open a PR touching only `docs/` → both jobs skip. Touch `client/src/**` → only `client` runs. Break a type on purpose → the PR shows a red check.

### GIT-02 — Protect `main`

Settings → Branches → Add rule for `main`:

- [x] Require a pull request before merging
- [x] Require status checks to pass → select `client` (and `server` once it exists)
- [x] Require branches to be up to date before merging
- [ ] Require approvals — **leave off**, you can't approve your own PR and you'd deadlock

---

## 6. Versioning a monorepo

`client` and `server` ship independently and have no reason to share a number. Version them **separately**:

```
client-v0.3.0      ← tag naming when packages are independent
server-v0.1.2
```

The alternative — one version for the whole repo — means a server patch bumps the client's number for no reason. Avoid.

---

## 7. Automated versioning with release-please

**release-please** (Google's) reads conventional commits on `main` and maintains a permanent open PR titled *"chore: release client 0.3.0"*. That PR contains the version bump and the generated `CHANGELOG.md`. **Merging the release PR is what creates the tag and the GitHub Release.** Nothing ships until you click merge — automation proposes, you decide.

### GIT-03 — Add the manifest

`.release-please-manifest.json` at the repo root — the current version of each package:

```json
{
  "client": "0.1.0",
  "server": "0.1.0"
}
```

`release-please-config.json` at the repo root:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "separate-pull-requests": true,
  "packages": {
    "client": {
      "release-type": "node",
      "package-name": "client",
      "changelog-path": "CHANGELOG.md"
    },
    "server": {
      "release-type": "node",
      "package-name": "server",
      "changelog-path": "CHANGELOG.md"
    }
  }
}
```

`separate-pull-requests: true` gives you one release PR per package, so a client release isn't blocked by unreleased server work.

### GIT-04 — Add the workflow

`.github/workflows/release-please.yml`:

```yaml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

**Gotcha that costs everyone an hour:** Settings → Actions → General → Workflow permissions → tick **"Allow GitHub Actions to create and approve pull requests."** Without it the action fails with a permissions error that doesn't say what's wrong.

**AC:** merge a `feat(client):` PR → within a minute a release PR appears proposing `client 0.2.0` with a changelog entry. Merge it → tag `client-v0.2.0` and a GitHub Release both exist.

---

## 8. The release flow

### 8a. Simple path — release straight from `main`

For most of this project this is all you need:

```
feat(client): … ──► main ──► release-please PR ──► merge ──► tag + Release ──► deploy
```

No release branch. Merge the release PR when you want to ship.

### 8b. Full path — with a stabilization window

Use this when you want to freeze a version and keep building the next one. **Do it at least once for the practice.**

```bash
# 1. cut the branch from main at the chosen commit
git switch main && git pull
git switch -c release/1.4
git push -u origin release/1.4

# 2. main is now free — keep merging features for 1.5

# 3. only stabilization commits go on release/1.4
git switch release/1.4
git commit -m "fix(client): keep ingredient row values when a sibling is deleted"
git push

# 4. tag when stable
git tag -a client-v1.4.0 -m "Release 1.4.0"
git push origin client-v1.4.0

# 5. CRITICAL — merge fixes back or you ship the bug again in 1.5
git switch main && git pull
git merge --no-ff release/1.4
git push
```

Step 5 is the one people forget. Put it in the release checklist.

To run release-please against a release branch instead of tagging by hand, add `target-branch: release/1.4` to the action's `with:` block.

### 8c. Hotfix (production is broken)

```bash
git switch -c hotfix/1.4.1-token-refresh client-v1.4.0   # branch FROM THE TAG
git commit -m "fix(client): refresh loop on expired token"
git tag -a client-v1.4.1 -m "Hotfix 1.4.1"
git push origin hotfix/1.4.1-token-refresh client-v1.4.1
# then merge back into main AND any live release branch
```

Branching from the **tag**, not from `main`, is the whole point — it ships the fix without dragging in everything merged since the release.

---

## 9. Deployment (MP-104)

| Piece | Host | Trigger |
|---|---|---|
| `client/` | Vercel | Root Directory = `client`. Preview deploy per PR, production only on release. |
| `server/` | Railway, Fly.io or Render | Root Directory = `server` |
| Postgres | Neon or Supabase (free tier) | — |

Both hosts support a subdirectory as the project root — this is the setting that makes a monorepo a non-issue.

**Deploy on release, not on every push to `main`.** Merging a feature must not ship it. Preview deploys on PRs give you a URL to check before merging.

> ### Correction — a tag trigger does not work
>
> The obvious design is `on: push: tags: ['client-v*']`, and it is what earlier
> drafts of this document and the visual guide both described. **It never fires.**
>
> A tag created by release-please using `GITHUB_TOKEN` does not trigger other
> workflows — GitHub blocks that to stop workflows recursing. The deploy would
> sit there silently, with no error anywhere, because nothing ran.
>
> The same rule applies to the Release PR itself: a PR opened by `GITHUB_TOKEN`
> gets no CI checks, so required checks stay pending and branch protection
> refuses the merge.
>
> **What this project actually does:**
>
> 1. `release-please.yml` authenticates with a **fine-grained PAT**, not
>    `GITHUB_TOKEN`, so its Release PR is an ordinary PR that CI runs on.
> 2. `deploy.yml` has **no tag trigger**. It is a reusable workflow
>    (`on: workflow_call`) that `release-please.yml` calls directly, gated on
>    the action's `client--release_created` output — which is `true` only on
>    the push that merged a Release PR.
> 3. It checks out `inputs.ref` — the released tag — so production gets exactly
>    the blessed commit rather than whatever `main` has drifted to.
> 4. `workflow_dispatch` on the same workflow covers manual re-deploys and
>    rollbacks to any earlier tag.
>
> Explicit chaining beats the implicit tag trigger anyway: it does not depend on
> which token happened to create the tag, so it cannot quietly break if the PAT
> is ever rotated away.

**Vercel specifics that cost real time:**

- Set **Production Branch** to a branch that is never pushed to (`production`).
  Otherwise Vercel promotes every push to `main` to production on its own,
  which defeats the whole model. Previews keep working.
- Run every `vercel` command from the **repo root**, never from `client/`. The
  project's Root Directory is already `client`, and `vercel build` applies it
  relative to the working directory — running inside `client/` resolves to
  `client/client/` and fails with `Cannot resolve entry module index.html`.
- Scope the Vercel token to the **account**, not to a single project. A
  project-scoped token can call project APIs but has no user identity, so the
  CLI dies on `whoami` with a misleading "Could not retrieve Project Settings".

---

## 10. Rollout plan

The original plan was to defer most of this until there was something to
release. It was brought forward instead and built in one pass **before MP-02**,
on the reasoning that plumbing is far easier to debug when the only thing that
can be broken is the plumbing. That turned out to be right — four separate
failures surfaced during setup, none of which would have been obvious if they
had been tangled up with a real feature.

| Ticket | Status | What |
|---|---|---|
| **GIT-01** | ✅ done | `ci.yml`, change-detection job gating client/server builds |
| **GIT-02** | ✅ done | `main` protected; squash-only; required checks `changes`, `client`, `lint` |
| **GIT-02b** | ✅ done | `pr-title.yml` — conventional PR titles, since squash makes the title the commit |
| **GIT-03/04** | ✅ done | release-please config + manifest + workflow, `client` package only |
| **GIT-05** | ✅ done | `client-v0.2.0` released and deployed on 2026-09-23 |
| **GIT-06** | ✅ done | Vercel wired; production reachable only through a release |
| **GIT-07** | ⏳ MP-10 | Add `server` to the manifest; the CI `server` job activates itself |
| **GIT-08** | ⏳ later | Practise §8b (release branch) and §8c (hotfix) once each |

**Deviation from §6, worth knowing:** `.release-please-manifest.json` currently
declares only `client`. A package whose directory does not exist produces
errors, so `server` gets added in the same PR that creates `server/`.

Adopt **§3 Conventional Commits and §4 the daily loop starting with MP-02.** Those two cost nothing and everything else depends on the commit history being in the right format from the start. Retrofitting commit messages later is not possible.

---

## 11. Cheat sheet

```bash
# daily
git switch main && git pull
git switch -c client/mp-02-route-tree
git commit -m "feat(client): add route tree"
git push -u origin client/mp-02-route-tree

# inspect
git log --oneline --graph --decorate      # topology
git log --oneline -- client/              # commits touching client
git describe --tags                       # how far past the last tag
git tag -l 'client-v*'                    # list client releases

# tags
git tag -a client-v1.4.0 -m "Release 1.4.0"
git push origin client-v1.4.0             # tags are NOT pushed by `git push`
git push --tags                           # push all tags
git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0   # delete local + remote

# undo
git switch --detach client-v1.4.0         # inspect exact released code
git revert <sha>                          # safe on shared branches
git reset --hard <sha>                    # ONLY on unpushed local work
```

---

## 12. Rules worth remembering

- **Annotated tags (`-a`) for anything you ship.** Lightweight tags carry no author, date, or message.
- **Tags don't push automatically.** `git push` ignores them. Always push the tag explicitly.
- **Never rewrite pushed history.** `--amend` and `reset --hard` are for local-only commits. Use `revert` on anything shared.
- **A branch pointer moves; a tag never does.** That's why releases are tagged, not branched.
- **Merge release-branch fixes back to `main`.** The single most common release-flow mistake.
- **Conventional commit format is the input to your automation.** A sloppy message means a wrong version number.
