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
git commit -m "feat(client): MP-02 route tree with nested layouts"
git commit -m "fix(server): MP-12 refresh cookie missing sameSite"
git commit -m "feat(client)!: MP-30 typed api layer

BREAKING CHANGE: mealsApi.list now returns Paginated<Meal>, not Meal[]"
```

**Rules:** subject in imperative mood ("add", not "added"), no trailing period, under ~72 chars. Keep the ticket id in the subject — it links the commit back to `ROADMAP.md`.

---

## 4. Daily workflow (per ticket)

```bash
# 1. start from a fresh main
git switch main && git pull

# 2. branch for the ticket
git switch -c client/mp-02-route-tree

# 3. work, committing in conventional format
git commit -m "feat(client): MP-02 route tree with nested layouts"

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
git commit -m "fix(client): MP-42 ingredient row loses value on delete"
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
| `client/` | Vercel or Netlify | Root Directory = `client`. Preview deploy per PR, production on tag. |
| `server/` | Railway, Fly.io or Render | Root Directory = `server` |
| Postgres | Neon or Supabase (free tier) | — |

Both hosts support a subdirectory as the project root — this is the setting that makes a monorepo a non-issue.

**Deploy on tag, not on every push to `main`.** Point production at `client-v*` tags so that merging a feature doesn't ship it. Preview deploys on PRs give you a URL to check before merging.

---

## 10. Rollout plan

Don't build all of this today — most of it is meaningless until there's something to release.

| Ticket | When | What |
|---|---|---|
| **GIT-01** | Now | `ci.yml` with path filters |
| **GIT-02** | Now | Protect `main`, require the `client` check |
| **GIT-03/04** | After MP-10 (server exists, so both packages are real) | release-please manifest + workflow |
| **GIT-05** | After Phase 4 (recipes work — something worth calling 0.2.0) | First real release PR → `client-v0.2.0` |
| **GIT-06** | MP-104 | Deploy, then practise §8b and §8c once each |

Adopt **§3 Conventional Commits and §4 the daily loop starting with MP-02.** Those two cost nothing and everything else depends on the commit history being in the right format from the start. Retrofitting commit messages later is not possible.

---

## 11. Cheat sheet

```bash
# daily
git switch main && git pull
git switch -c client/mp-02-route-tree
git commit -m "feat(client): MP-02 route tree"
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
