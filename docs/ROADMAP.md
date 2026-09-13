# Meal Planner — React Revision Roadmap

A learning project to re-cover every React concept end-to-end, with a real Node backend.
Built by someone with 10 years of Angular and one small React app (TrackWise) behind them.

---

## 0. How we work

| | |
|---|---|
| **You** | Write all the React code. Read the ticket, do the subtasks, tick the acceptance criteria. |
| **Me** | Write the backend when you ask. Unblock you on React with explanation-first answers. Review your code. Only hand you React code when you explicitly ask. |
| **Rhythm** | One ticket at a time. Say "MP-12 done, review?" or "stuck on MP-41" and we go from there. |

**Rules for yourself while doing this:**
- Do NOT reach for a library when a hook will do. The point is the hook.
- Before adding `useMemo`/`useCallback`/`memo`, open React DevTools Profiler and prove there's a problem. Phase 9 is where you're *allowed* to memoize freely.
- Every list gets a stable `key` that is an id, never an index.
- Every fetch gets loading / error / empty / success rendering. All four. Every time.

---

## 1. Tech stack

### Frontend
| Choice | Why |
|---|---|
| **Vite + React 19 + TypeScript** | Same as TrackWise. No new build tooling to learn. |
| **react-router-dom v7 (data router)** | `createBrowserRouter` — nested layouts, guards as layout routes, lazy routes. Closest thing to Angular's route config tree. |
| **Ant Design v6** | You already used it. Forms, tables, date pickers, modals for free — buys you time to spend on React instead of CSS. |
| **axios** | Interceptors are the whole point (auth token + refresh + error normalisation). `fetch` has no interceptors. |
| **No global state library** | Context + `useReducer` covers everything here. Zustand/Redux would hide the re-render behaviour you're trying to learn. |
| **TanStack Query — deliberately deferred to Phase 10** | You'll hand-roll fetching with `useEffect` + `AbortController` + `useReducer` first, feel the pain, *then* replace it. That contrast is worth more than starting with Query. |

### Backend
| Choice | Why |
|---|---|
| **Node 22 + Express 5 + TypeScript** | Boring and readable. You'll be reading this code more than writing it. |
| **Prisma ORM** | Typed client generated from the schema — and you can share those types with the frontend. Migrations are one command. |
| **PostgreSQL 16** | See below. Already installed on your machine. |
| **zod** | Request validation + it doubles as the source of your error shape (`422` + field errors), which the frontend forms consume. |
| **JWT: short-lived access token + httpOnly refresh cookie** | This is the setup the cheatsheet's interceptor is written for. Refresh-on-401 is only interesting if refresh actually exists. |

---

## 2. Database: use PostgreSQL

**Recommendation: PostgreSQL + Prisma.** Not MongoDB.

Your app's data is relational and the interesting features are *aggregations across relations*:

| Feature | What the query actually is |
|---|---|
| Auto-calculate total macros per day | Sum over recipes joined through meal-plan entries, grouped by date |
| Weekly ingredient list | Aggregate + sum quantities of ingredients across every recipe planned that week, grouped by ingredient and unit |
| "Find recipes I can cook with these ingredients" | Set containment: recipes whose ingredient set ⊆ my pantry, ranked by how many are missing |
| Auto-generated prep todos | Join meal-plan entry → recipe → prep items, derive a due date per row |

All four are ~10 lines of SQL. In MongoDB they're `$lookup` + `$unwind` + `$group` aggregation pipelines that you would spend real time debugging — which is the opposite of "spend more time on React."

The other reasons:

1. **One ingredient, many recipes.** In Mongo you'd either embed ingredients (and duplicate "chickpeas" 40 times, making the pantry filter miserable) or reference them (and then you're doing joins in a database that doesn't want to). Postgres has one `Ingredient` table and a join table. Done.
2. **Prisma gives you types for free.** `import type { Recipe } from '@prisma/client'` on the backend, and you copy the shape into the frontend's `types/`. Fewer hand-written interfaces to drift.
3. **Migrations are a real skill.** `prisma migrate dev --name add_prep_items` versions your schema. Mongo's "just add the field" is faster on day 1 and a mess on day 30.
4. **It's already on your machine.** `psql 16.14` via Homebrew, plus Docker if you'd rather containerise it.

**When Mongo would have won:** if recipes were free-form documents nobody queries into, and there were no cross-recipe rollups. That's not this app.

**Setup:** local Postgres via Docker Compose (I'll write the file), or the Homebrew instance you already have. If you want it hosted later, Neon or Supabase both have a free tier that Prisma connects to with just a URL change.

---

## 3. Concept coverage map

Use this to check nothing got skipped. Ticket IDs link to Section 5.

| Concept | Covered by |
|---|---|
| Components, props, composition | MP-40, MP-41 |
| `useState` — incl. lazy init & updater form | MP-40, MP-42 |
| `useReducer` — complex form + fetch state | MP-32, MP-42 |
| `useEffect` + cleanup + abort | MP-31, MP-32 |
| `useRef` — DOM access & non-rendering values | MP-52, MP-63 |
| `useContext` + provider composition | MP-21, MP-24 |
| `useMemo` / `useCallback` | MP-62, MP-91 |
| `React.memo` | MP-91 |
| `useTransition` / `useDeferredValue` | MP-51 |
| `useId` | MP-43 |
| `useLayoutEffect` | MP-93 (optional) |
| `useSyncExternalStore` | MP-95 (stretch) |
| React 19: `useActionState`, `useOptimistic`, `use` | MP-100 (stretch) |
| Custom hooks | MP-33, MP-50, MP-64 |
| Controlled forms + validation | MP-42, MP-43 |
| Lists, keys, reconciliation | MP-41, MP-91 |
| Conditional rendering — 4 states | MP-33 |
| Routing: nested layouts, params, search params | MP-02, MP-52, MP-61 |
| Lazy loading + Suspense + prefetch | MP-03, MP-92 |
| Error boundaries | MP-94 |
| Auth: context, guards, interceptors, refresh | MP-20 → MP-23 |
| RBAC: permission hook, route guard, UI guard | MP-24, MP-25 |
| API layer, typed client, error normalisation | MP-30, MP-31 |
| Debounce / throttle | MP-50 |
| Virtualization | MP-93 |
| Profiling & measurement | MP-90 |

---

## 4. Data model (sketch — we'll finalise in MP-11)

```
User            id, email, passwordHash, name, roles[]
Ingredient      id, name (unique), defaultUnit, category      # global catalogue
Recipe          id, name, photoUrl?, notes?, servings,
                caloriesPerServing, proteinPerServing, carbs?, fat?,
                createdById, isPublic
RecipeIngredient  recipeId, ingredientId, quantity, unit      # join table
PrepItem        id, recipeId, label, leadTimeHours            # "soak beans", 12
MealPlanEntry   id, userId, date, mealType, recipeId, servings
                UNIQUE(userId, date, mealType, recipeId)
TodoItem        id, userId, label, dueAt, isDone,
                sourceEntryId, sourcePrepItemId               # regenerated, not hand-written
PantryItem      userId, ingredientId                          # "what I have available"
```

**The prep-timer rule, stated precisely** (this is the trickiest bit of the app — MP-70):

Each meal type has a clock time (configurable, default: breakfast 08:00, lunch 13:00, snack 17:00, dinner 20:00).
For a plan entry on date `D` with meal type `M`, and a prep item with `leadTimeHours = H`:

```
mealAt = D at MEAL_TIMES[M]
todo.dueAt = mealAt - H hours
```

*Tuesday lunch (13:00) + "soak beans, 12h" → dueAt = Monday 01:00.* Hmm — that lands at 1am, not "Monday dinner". So the display rule is: **a todo is shown in the bucket of the last meal slot at or before `dueAt`.** Monday 01:00 falls before Monday breakfast, so it surfaces in **Sunday dinner's** bucket. Decide in MP-70 whether you want strict-time bucketing or "round down to the previous meal slot, minimum one slot of warning" — write the rule down before you code it, and unit-test it.

---

## 5. Tickets

Format: **ID — Title** · *concepts* · subtasks · acceptance criteria · hints.
`[ ]` boxes are for you to tick as you go.

---

### PHASE 0 — Foundations

#### MP-01 — Scaffold the frontend and lock the folder structure
*Concepts: project structure, path aliases, TS config*

**Subtasks**
- [ ] `npm create vite@latest client -- --template react-ts` inside `meal-planner/`
- [ ] Install: `react-router-dom axios antd dayjs`
- [ ] Create the feature-first folder tree from cheatsheet §5 — empty folders with a `.gitkeep` are fine
- [ ] Configure the `@/` path alias in both `vite.config.ts` and `tsconfig.app.json`
- [ ] `git init`, first commit, `.gitignore` covers `node_modules`, `dist`, `.env`

**Acceptance criteria**
- [ ] `npm run dev` serves a page at localhost
- [ ] `import x from '@/utils/foo'` resolves — no red squiggle in VS Code, and `npm run build` passes
- [ ] Folder tree matches: `api/ app/ components/ config/ constants/ context/ features/ hooks/ pages/ routes/ services/ types/ utils/`
- [ ] `npm run build` produces zero TS errors

**Hints** — the alias needs `resolve.alias` in Vite *and* `paths` in tsconfig; they're two separate systems and missing either one gives you a confusing half-working state.

---

#### MP-02 — Route tree with nested layouts
*Concepts: `createBrowserRouter`, layout routes, `<Outlet />`, `NavLink`*

**Angular parallel:** the route array is `Routes`, a layout route is a parent component with `<router-outlet>`, `<Outlet />` *is* `<router-outlet>`.

**Subtasks**
- [ ] `src/app/router.tsx` exporting a `createBrowserRouter` tree
- [ ] `AppLayout` — header + sidebar nav + `<Outlet />`
- [ ] Placeholder pages: Dashboard `/`, Recipes `/recipes`, Recipe detail `/recipes/:id`, Planner `/planner`, Todos `/todos`, Shopping `/shopping`, Login `/login`, `/403`, `*` NotFound
- [ ] `src/constants/routes.ts` — every path as a constant, no string literals in components
- [ ] `<RouterProvider router={router} />` in `main.tsx`

**Acceptance criteria**
- [ ] All nine routes render their placeholder
- [ ] The sidebar highlights the active route via `NavLink`'s `isActive`
- [ ] `/recipes/123` renders the detail page and `useParams()` reads `"123"`
- [ ] A junk URL like `/nope` renders NotFound, not a blank screen
- [ ] Nav links do not cause a full page reload (check the Network tab)

---

#### MP-03 — Route-level code splitting
*Concepts: `React.lazy`, `<Suspense>`, bundle analysis*

**Subtasks**
- [ ] Convert every route element except the layout and Login to `lazy(() => import(...))`
- [ ] A real `<PageSkeleton />` fallback — not a spinner, not blank
- [ ] Wrap lazy elements in `<Suspense>` via a small `withSuspense()` helper
- [ ] `npm run build` and read the chunk list

**Acceptance criteria**
- [ ] `dist/assets/` contains a separate JS chunk per lazy route
- [ ] Network tab (throttled to Slow 3G) shows a chunk fetched *on first navigation* to each route, not at boot
- [ ] The skeleton is visible during that fetch — no flash of blank
- [ ] Initial JS transferred is measurably smaller than before this ticket (write both numbers in the PR description)

---

### PHASE 1 — Backend v1

> These are mine to write. Your job is to read the code, ask about anything unclear, and run it. Don't skip the reading — the frontend tickets assume you know the contract.

#### MP-10 — Server scaffold
- [ ] Express 5 + TS + `tsx` watch mode, `server/` folder
- [ ] Config via `.env` (`DATABASE_URL`, `JWT_SECRET`, `PORT`, `CLIENT_ORIGIN`)
- [ ] CORS with `credentials: true`, `cookie-parser`, JSON body limit
- [ ] `GET /health` → `{ ok: true }`
- **AC:** `curl localhost:4000/health` returns 200 JSON; server restarts on save

#### MP-11 — Prisma schema + Postgres
- [ ] `docker-compose.yml` with Postgres 16 (or point at Homebrew Postgres)
- [ ] Full schema per Section 4, reviewed by you before migrating
- [ ] `prisma migrate dev --name init`
- [ ] Seed script: ~40 ingredients, 8 recipes with prep items, 2 users (admin + regular)
- **AC:** `npx prisma studio` shows seeded data; re-running the seed is idempotent

#### MP-12 — Auth endpoints
- [ ] `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- [ ] Access token 15min in the JSON body; refresh token 7d in an httpOnly, sameSite cookie
- [ ] `requireAuth` middleware; `requireRole(...roles)` middleware
- **AC:** login sets the cookie and returns `{ user, accessToken }`; `/auth/me` 401s without a token; `/auth/refresh` issues a new access token from the cookie alone

#### MP-13 — Recipe + ingredient CRUD
- [ ] `GET /ingredients`, `GET /recipes` (paginated, `?q=`, `?ingredientIds=`), `GET /recipes/:id`, `POST/PUT/DELETE /recipes`
- [ ] zod validation → `422 { message, errors: { field: msg } }`
- [ ] Photo upload: `POST /uploads` (multer, local disk) returning a URL
- **AC:** validation failures return the 422 shape the frontend forms expect; delete is owner-or-admin only

#### MP-14 — Plan, todo and aggregation endpoints
- [ ] `GET/POST/DELETE /meal-plan` (`?from=&to=`)
- [ ] `GET /meal-plan/macros?date=` — daily macro totals computed in SQL
- [ ] `GET /shopping-list?from=&to=` — aggregated, deduped by ingredient + unit
- [ ] `GET /todos?from=&to=`, `PATCH /todos/:id` (toggle done)
- [ ] Todo regeneration on plan write, preserving `isDone` for surviving todos
- **AC:** adding a plan entry with prep items creates todos with correct `dueAt`; deleting the entry removes its *undone* todos; macros endpoint matches a hand-calculated example

---

### PHASE 2 — Auth & RBAC (frontend)

#### MP-20 — Axios instance + token store
*Concepts: service module, module-scoped state, why the access token is not in localStorage*

**Subtasks**
- [ ] `src/api/axiosInstance.ts` — baseURL from a typed `config/env.ts`, `withCredentials: true`, timeout
- [ ] `src/services/tokenStore.ts` — access token held in a module variable (memory), not localStorage
- [ ] `src/api/endpoints.ts` — URL constants

**Acceptance criteria**
- [ ] No component imports `axios` directly — only `@/api/axiosInstance`
- [ ] A hard refresh loses the in-memory access token and the app recovers via `/auth/refresh` (proven in MP-23)
- [ ] You can explain in one sentence why the refresh token is an httpOnly cookie and the access token is not

---

#### MP-21 — AuthContext
*Concepts: `createContext`, provider, custom consumer hook, **memoized context value***

**Angular parallel:** this is your `AuthService` — but unlike a service, the context value's *identity* matters. A new object every render re-renders every consumer.

**Subtasks**
- [ ] `AuthContext` with `{ user, status: 'loading' | 'authed' | 'guest', login, logout }`
- [ ] Bootstrap effect: call `/auth/me` on mount, with an `alive` flag in the cleanup
- [ ] `login` / `logout` wrapped in `useCallback`
- [ ] Context value wrapped in `useMemo`
- [ ] `useAuth()` hook that throws a clear error when used outside the provider
- [ ] `src/app/providers.tsx` composing providers so `main.tsx` stays flat

**Acceptance criteria**
- [ ] `status` starts as `'loading'` — never `'guest'` before `/auth/me` resolves (otherwise refresh flashes the login page)
- [ ] Calling `useAuth()` outside the provider throws a readable error, not `Cannot read property of null`
- [ ] Add a `console.log` in a consumer: it does **not** log on unrelated parent re-renders
- [ ] Unmounting mid-request produces no "state update on unmounted component" warning

**Hints** — do the `useMemo` deliberately: build it *without* memoization first, watch a consumer re-render on every keystroke elsewhere, then add it. That's the lesson.

---

#### MP-22 — Login page
*Concepts: controlled inputs, submit lifecycle, `finally`, redirect-back*

**Subtasks**
- [ ] Controlled email + password form, client-side validation before the network call
- [ ] `submitting` state guarding double-submit, reset in `finally`
- [ ] Server field errors (422) mapped onto the inputs
- [ ] On success redirect to `location.state.from` if present, else `/`
- [ ] Logout button in the header

**Acceptance criteria**
- [ ] Double-clicking Submit fires exactly one request (verify in the Network tab)
- [ ] A failed login re-enables the button — the `finally` path is exercised
- [ ] Wrong password shows the server's message, not a blank form
- [ ] Visiting `/planner` while logged out, then logging in, lands you back on `/planner`

---

#### MP-23 — Interceptors: attach token, refresh on 401
*Concepts: cross-cutting concerns, request queueing, error normalisation*

**Angular parallel:** this is your `HttpInterceptor` — same idea, different API.

**Subtasks**
- [ ] Request interceptor attaching `Authorization: Bearer`
- [ ] Response interceptor: on 401, refresh once, retry the original request
- [ ] Queue concurrent 401s so N failed requests trigger **one** refresh
- [ ] Refresh failure → clear tokens → redirect to `/login`
- [ ] Normalise all errors to `{ status, message, fields? }` before rejecting

**Acceptance criteria**
- [ ] Set the access token TTL to 10s on the server, sit on a page, and watch a request 401 → refresh → retry → succeed, invisibly to the user
- [ ] Fire three requests simultaneously against an expired token: exactly one `/auth/refresh` in the Network tab, all three succeed
- [ ] A 401 on `/auth/refresh` itself does not loop infinitely
- [ ] Every `catch` block in the app reads `err.message` — no `err.response?.data?.message` anywhere outside the interceptor

---

#### MP-24 — Route guards
*Concepts: guards as layout routes, `<Navigate>`, redirect state*

**Subtasks**
- [ ] `ProtectedRoute` — `loading` → full-page loader; `guest` → `<Navigate to="/login" state={{ from: location }} />`; else `<Outlet />`
- [ ] Restructure the router so every private route is a child of it
- [ ] `/403` page

**Acceptance criteria**
- [ ] Logged out, every private URL redirects to `/login`; `/login` itself does not
- [ ] Hard-refreshing a private page does **not** flash the login screen before restoring the session
- [ ] The browser Back button after a guard redirect doesn't trap you in a loop (`replace` is set)

---

#### MP-25 — RBAC
*Concepts: derived permissions with `useMemo`, guard component, declarative UI gating*

**Subtasks**
- [ ] `constants/roles.ts` — `ROLES`, `Permission` union, `ROLE_PERMISSIONS` map
- [ ] `usePermission()` returning `can` / `canAny` / `hasRole`, permissions built into a `Set` inside `useMemo`
- [ ] `RoleRoute` layout guard → `/403`
- [ ] `<Can perm="...">` wrapper component with a `fallback` prop
- [ ] An `/admin/ingredients` page behind `ADMIN`

**Acceptance criteria**
- [ ] A `USER` navigating to `/admin/ingredients` lands on `/403`; an `ADMIN` sees the page
- [ ] Delete buttons on recipes you don't own are absent for `USER`, present for `ADMIN`
- [ ] With the button hidden, `curl`ing the DELETE endpoint as that user still returns **403** — client RBAC is UX, the server is the gate. Prove this and note it in the ticket.
- [ ] Permission set is not recomputed on every render (log inside the `useMemo`)

---

### PHASE 3 — API layer & data-fetching hooks

#### MP-30 — Typed API modules
*Concepts: feature-first API layer, generics, DTO types*

**Subtasks**
- [ ] `types/api.types.ts` — `ApiResponse<T>`, `ApiError`, `Paginated<T>`
- [ ] `features/recipes/api/recipesApi.ts`, `features/ingredients/…`, `features/plan/…`
- [ ] Every method accepts an optional `AbortSignal`

**Acceptance criteria**
- [ ] Zero `api.get(...)` calls inside any component or page file (grep to prove it)
- [ ] Every API function has an explicit return type — no inferred `any`
- [ ] Mistyping a response field is a compile error

---

#### MP-31 — `useFetch`-style hook with abort
*Concepts: `useEffect` cleanup, `AbortController`, race conditions*

**Subtasks**
- [ ] A hook that takes a fetcher + deps and returns `{ loading, data, error, refetch }`
- [ ] `AbortController` created per effect run, aborted in cleanup
- [ ] Swallow cancellation errors; surface real ones

**Acceptance criteria**
- [ ] Navigating away mid-request shows a cancelled request in the Network tab and logs no error
- [ ] Rapidly changing the dependency 5 times leaves the **last** response rendered — never an out-of-order earlier one (throttle the network and prove it)
- [ ] `refetch()` re-runs without remounting the component

**Hints** — the stale-response race is the real lesson. Even with abort, reason about what happens if response 3 lands after response 5. An `ignore` boolean in the cleanup closure is the belt to abort's braces.

---

#### MP-32 — `useReducer` for fetch state
*Concepts: `useReducer`, discriminated unions, stable `dispatch`*

**Subtasks**
- [ ] Model fetch state as a reducer with `FETCH_START` / `SUCCESS` / `ERROR`
- [ ] Type `Action` as a discriminated union
- [ ] Refactor MP-31's hook onto it

**Acceptance criteria**
- [ ] Impossible states are unrepresentable — you cannot have `loading: true` and `error` set at once
- [ ] `dispatch` is passed to a child without `useCallback` and you can explain why that's safe
- [ ] Adding a new action without handling it in the switch is a TS error

---

#### MP-33 — Four-state rendering as a shared pattern
*Concepts: conditional rendering, component composition, `children` as a slot*

**Subtasks**
- [ ] `<QueryState loading error empty>` wrapper, or an equivalent convention you apply consistently
- [ ] `<PageSkeleton />`, `<ErrorState onRetry />`, `<EmptyState />` in `components/ui/`

**Acceptance criteria**
- [ ] Every data-driven page renders something meaningful in all four states
- [ ] The error state has a working Retry that re-issues the request
- [ ] Empty ≠ loading — an empty result never shows a skeleton forever

---

### PHASE 4 — Recipes

#### MP-40 — Recipe list page
*Concepts: props, lists & keys, composition*
- [ ] `RecipeCard` (presentational, no data fetching) + `RecipeList` + `RecipesPage`
- [ ] Card shows name, photo or placeholder, calories/protein, ingredient count
- **AC:** page is thin — fetch + layout only, zero business logic; keys are recipe ids; `RecipeCard` receives everything via props and could be rendered from a static array with no changes

#### MP-41 — Recipe detail page
*Concepts: route params, dependent fetching*
- [ ] `/recipes/:id` fetching by param; ingredients, macros, prep items, notes
- [ ] Handle a 404 id gracefully
- **AC:** changing the id in the URL refetches; a bogus id shows a not-found state, not a crash

#### MP-42 — Recipe create/edit form
*Concepts: `useReducer` for a complex form, dynamic field arrays, controlled inputs*

This is the biggest React ticket in the project. The form has: name, photo, notes, servings, macros, **a variable-length ingredient list** (ingredient + quantity + unit rows, addable/removable), and **a variable-length prep-item list** (label + lead-time-hours rows).

**Subtasks**
- [ ] Model the whole form in one `useReducer` — actions like `SET_FIELD`, `ADD_INGREDIENT`, `UPDATE_INGREDIENT`, `REMOVE_INGREDIENT`, `ADD_PREP`, …
- [ ] Ingredient rows use an autocomplete against `GET /ingredients`
- [ ] Every dynamic row gets a stable client-generated id as its key (`crypto.randomUUID()`), **not** the array index
- [ ] Client validation before submit; map 422 field errors onto rows
- [ ] Reuse the same component for create and edit (`/recipes/new` and `/recipes/:id/edit`)

**Acceptance criteria**
- [ ] Add three ingredient rows, fill them, delete the **middle** one — the other two keep their values. (With index keys they won't. Try it wrong first, then fix it — this is the reconciliation lesson.)
- [ ] No state mutation anywhere in the reducer — every case returns a new object/array
- [ ] Submitting twice fast creates one recipe
- [ ] Edit mode pre-populates every field including all dynamic rows
- [ ] A server 422 on `ingredients[1].quantity` highlights that specific row

#### MP-43 — Photo upload + accessible fields
*Concepts: `useRef` on a file input, object URLs, `useId`*
- [ ] Hidden file input triggered by a styled button via `useRef`
- [ ] Local preview with `URL.createObjectURL`, revoked on cleanup
- [ ] `useId` to wire every `<label htmlFor>` to its input
- **AC:** preview appears before upload completes; no object-URL leak (revoke in the effect cleanup); every input is reachable by clicking its label; upload failure leaves the form usable

#### MP-44 — Delete with confirmation + optimistic-free flow
- [ ] Confirm modal; on success remove from list without a full refetch
- **AC:** deleting the last item on a page shows the empty state; a failed delete restores the row and shows an error

---

### PHASE 5 — Find recipes (the perf-flavoured phase)

#### MP-50 — `useDebounce` + text search
*Concepts: custom hook, timers with cleanup*
- [ ] `hooks/useDebounce.ts`
- [ ] Search box on the recipes page hitting `?q=`
- **AC:** typing "chicken" fires **one** request, not eight; clearing the box resets to the unfiltered list; the debounce timer is cleared on unmount

#### MP-51 — Pantry filter with `useTransition` / `useDeferredValue`
*Concepts: concurrent rendering, urgent vs non-urgent updates*
- [ ] Multi-select of available ingredients (this is the "select available ingredients" filter)
- [ ] Results ranked: cookable now → missing 1 → missing 2
- [ ] Wrap the results update in `startTransition`, or derive with `useDeferredValue`
- [ ] Show a subtle pending indicator from `isPending`
- **AC:** with 200+ recipes rendered, toggling checkboxes stays instantly responsive; the checkbox visibly updates *before* the list does; you can articulate the difference between `useTransition` and `useDeferredValue` and why you chose one

#### MP-52 — Filters in the URL
*Concepts: `useSearchParams`, URL as state*
- [ ] Search text and selected ingredients live in the query string
- **AC:** a filtered URL is copy-pasteable into a new tab and reproduces the exact view; Back undoes the last filter change; refresh preserves filters; no duplicate fetch on mount from syncing state to URL and back

#### MP-53 — Pagination or infinite scroll
- [ ] Pick one and implement it against the paginated endpoint
- **AC:** page state is in the URL; changing filters resets to page 1; in-flight page requests are aborted on filter change

---

### PHASE 6 — Meal plan

#### MP-60 — Weekly planner grid
*Concepts: derived data, `key` on a 2-D structure*
- [ ] 7 days × 4 meal types grid; week navigation (prev/this/next)
- [ ] Each cell lists planned recipes with a remove button
- **AC:** one `GET /meal-plan?from=&to=` per week change, not per cell; empty cells show an "Add" affordance; today's column is visually marked

#### MP-61 — Add-to-plan flow
- [ ] Click a cell → modal → pick date/meal type (pre-filled) → search recipe → servings → save
- [ ] Also reachable from a recipe detail page ("Add to plan")
- **AC:** the grid updates without a full page reload; adding the same recipe twice to one slot is prevented with a clear message; the modal closes only on success

#### MP-62 — Daily macro totals
*Concepts: `useMemo` on real derived data, and knowing when it's pointless*
- [ ] Total calories + protein per day, shown under each day column
- [ ] Compute client-side from loaded plan data
- **AC:** totals update immediately on add/remove; the `useMemo` dependency array is exactly the plan slice it reads; **and** you've measured whether the memo actually helps here — if it doesn't, remove it and write down why (this is a legitimate outcome of the ticket)

#### MP-63 — Week navigation with keyboard shortcuts
*Concepts: `useEffect` event listeners, `useRef` for non-render values*
- [ ] Left/right arrows change week; `t` jumps to today
- **AC:** listener is removed on unmount (add/remove logged to prove it); shortcuts don't fire while typing in an input

#### MP-64 — `useLocalStorage` for view preferences
*Concepts: custom hook, lazy `useState` init*
- [ ] Persist last-viewed week and grid/list toggle
- **AC:** preference survives refresh; a corrupt localStorage value doesn't crash the app (the `try/catch` in the lazy initialiser)

---

### PHASE 7 — Auto-generated todos & shopping list

#### MP-70 — Prep-timer todo list
*Concepts: consuming derived server data, date handling, optimistic toggle*
- [ ] **First:** write the bucketing rule from Section 4 down as prose, agree it, then implement
- [ ] `/todos` page grouped by day → meal slot
- [ ] Checkbox toggle with optimistic UI, rolled back on failure
- **AC:** planning Tuesday lunch beans (12h soak) produces a todo in the agreed slot — assert the exact expected timestamp in the ticket; unchecking and rechecking survives a refresh; removing the plan entry removes the undone todo; a failed toggle visibly reverts

#### MP-71 — Todo timer / countdown
*Concepts: `setInterval` in an effect, cleanup, stale closures*
- [ ] Relative "due in 4h 20m" that ticks
- **AC:** one interval per mounted component, cleared on unmount; the displayed value uses fresh state, not a stale closure (the classic `setInterval` + `useState` bug — hit it, then fix it with the updater form or a ref)

#### MP-72 — Weekly shopping list
- [ ] `/shopping?from=&to=` — grouped by ingredient category, quantities summed, unit-aware
- [ ] Check-off state persisted locally
- **AC:** two recipes using 200g + 300g chickpeas show one 500g line; mismatched units (g vs cups) are shown separately rather than wrongly summed; the list recalculates when the plan changes

#### MP-73 — Export / print view
- [ ] A print stylesheet or copy-to-clipboard
- **AC:** printed output has no nav chrome

---

### PHASE 8 — Dashboard

#### MP-80 — Today's panel
- [ ] Today's meals by slot, today's todos, today's macro totals
- **AC:** one round trip for the whole dashboard (or a documented reason why more); each panel has its own loading/empty state so a slow panel doesn't block the others

#### MP-81 — Week-at-a-glance
- [ ] Compact 7-day strip linking into the planner
- **AC:** links carry the week into `/planner` via search params

#### MP-82 — "Suggest more like this"
- [ ] Links from today's ingredients to the pantry-filtered recipe search
- **AC:** the link lands on `/recipes` with the filters pre-applied via URL (reusing MP-52 — no new state mechanism)

---

### PHASE 9 — Performance pass

> Do this phase **after** the app works. That's the point: you profile a real app, not a hypothetical one.

#### MP-90 — Measure first
- [ ] React DevTools Profiler: record interactions on the recipe list, planner grid, and search
- [ ] Enable "Highlight updates when components render"
- [ ] Write a short findings note: which components re-render that shouldn't, with commit durations
- **AC:** you have a written before-list of at least three concrete over-rendering problems, with numbers. No fixes yet.

#### MP-91 — `React.memo` + `useCallback` + stable props
- [ ] Fix the findings from MP-90 — `memo` on `RecipeCard`/`PlannerCell`, `useCallback` on handlers passed to them, `useMemo` on object/array props
- **AC:** re-profile and show each finding measurably improved; every memo you added is justified by a number in the MP-90 note; you removed at least one memo that didn't help (there will be one)

#### MP-92 — Context splitting & state colocation
*Concepts: the re-render cost of context, moving state down*
- [ ] Split any context where consumers only need part of it (e.g. auth user vs auth actions)
- [ ] Find state living too high and colocate it downward
- **AC:** a component consuming only auth *actions* doesn't re-render when `user` changes; at least one piece of state moved down and the parent's render count dropped

#### MP-93 — Virtualization
- [ ] `@tanstack/react-virtual` on the recipe list (seed 500+ recipes to make it real)
- **AC:** DOM node count stays roughly constant while scrolling 500 rows; scroll stays at 60fps; row heights don't jump

#### MP-94 — Error boundaries
- [ ] A boundary around the router's lazy routes; `errorElement` on route branches
- [ ] Chunk-load failure offers a reload
- **AC:** throwing inside a page shows the boundary, not a white screen; the rest of the shell (nav) still works; a simulated failed chunk load offers reload

#### MP-95 — Prefetch on hover
- [ ] `onMouseEnter` triggers the route's dynamic `import()`
- **AC:** hovering a nav link fetches the chunk before the click; navigation after hovering shows no skeleton

---

### PHASE 10 — Stretch

- **MP-100** — React 19 form APIs: rebuild the login or recipe form with `useActionState` + `useFormStatus`; use `useOptimistic` for the todo toggle. Compare with your hand-rolled version.
- **MP-101** — Replace MP-31/32's hooks with TanStack Query. Write up what it gave you (cache, dedupe, refetch, stale-while-revalidate) and what you lost. This retrospective is the actual deliverable.
- **MP-102** — `useSyncExternalStore` for online/offline status and a cross-tab sync of the shopping list.
- **MP-103** — Tests: Vitest + Testing Library on the reducer (MP-42), the prep-timer date math (MP-70), and one integration test of the login flow with MSW.
- **MP-104** — Deploy: client to Vercel/Netlify, server + Postgres to Railway/Fly/Neon.

---

## 6. Definition of done (every ticket)

- [ ] Acceptance criteria all ticked, personally verified in the browser
- [ ] `npm run build` — zero TS errors
- [ ] `npm run lint` — zero warnings (`react-hooks/exhaustive-deps` included; if you disable it, comment *why* on that line)
- [ ] Loading / error / empty / success all render, if the ticket touches data
- [ ] Every effect that subscribes, unsubscribes
- [ ] Every fetch is abortable
- [ ] No index keys on dynamic lists
- [ ] A note in `LEARNING.md` — what the concept was, the Angular equivalent, and the one thing that surprised you

---

## 7. Suggested order

Phases run in order, with one exception: **MP-10 → MP-14 (backend) can be built ahead of time in one sitting** so you're never blocked waiting on an endpoint. Say the word and I'll write Phase 1 in full.

Realistic pacing at a few evenings a week: Phase 0–2 in week 1–2, Phase 3–4 in week 3–4, Phase 5–7 in week 5–7, Phase 8–9 in week 8. Phase 9 is where it stops being a tutorial app.
