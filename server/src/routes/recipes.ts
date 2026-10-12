import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { HttpError, forbidden, unauthorized } from '../lib/httpError.ts'
import { paginate, paginationSchema, toSkipTake } from '../lib/pagination.ts'
import { planEntryTodoInclude, regenerateTodosForEntry } from '../services/todos.ts'
import { PrepTiming, Role, Unit } from '../../generated/prisma/enums.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

export const recipesRouter = Router()

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const recipeBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name must be 120 characters or fewer'),
  photoUrl: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(5000).optional(),

  servings: z.coerce.number().int().min(1, 'Servings must be at least 1').max(50, 'Servings must be 50 or fewer'),
  caloriesPerServing: z.coerce.number().int().min(0, 'Calories cannot be negative').max(10000),
  proteinPerServing: z.coerce.number().min(0, 'Protein cannot be negative').max(1000),
  carbsPerServing: z.coerce.number().min(0).max(1000).optional(),
  fatPerServing: z.coerce.number().min(0).max(1000).optional(),

  isPublic: z.boolean().default(false),

  ingredients: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        quantity: z.coerce.number().positive('Quantity must be greater than zero'),
        unit: z.enum(Unit),
      }),
    )
    .min(1, 'Add at least one ingredient')
    // The composite primary key on RecipeIngredient would reject a duplicate
    // with a raw database error. Catching it here produces the 422 shape the
    // form can actually display.
    .refine(
      (lines) => new Set(lines.map((line) => line.ingredientId)).size === lines.length,
      'Each ingredient can only be listed once',
    ),

  // Optional and allowed to be empty — plenty of recipes need no prep timer.
  prepItems: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Prep step needs a label').max(120),
        leadTimeHours: z.coerce
          .number()
          .int()
          .min(0, 'Lead time cannot be negative')
          // A week. Longer than this is a data-entry mistake, not a recipe.
          .max(168, 'Lead time must be 168 hours (7 days) or fewer'),
        timing: z.enum(PrepTiming).default(PrepTiming.EXACT),
      }),
    )
    .default([]),
})

/**
 * On update, each prep step may carry the `id` it already has.
 *
 * This is what keeps a `PrepItem` row *alive* across an edit instead of
 * deleting it and making a new one. It matters because `TodoItem` points at
 * prep items, and a todo's `status` — including a deliberate CANCELLED — is
 * attached to that row. Recreate the row and the user's decision is gone.
 *
 * Omit the id and you get a new step, which is exactly right for one the user
 * just added in the form.
 */
const recipeUpdateSchema = recipeBodySchema.extend({
  prepItems: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        label: z.string().trim().min(1, 'Prep step needs a label').max(120),
        leadTimeHours: z.coerce
          .number()
          .int()
          .min(0, 'Lead time cannot be negative')
          .max(168, 'Lead time must be 168 hours (7 days) or fewer'),
        timing: z.enum(PrepTiming).default(PrepTiming.EXACT),
      }),
    )
    .default([])
    .refine(
      (items) => {
        const ids = items.map((item) => item.id).filter((id): id is string => Boolean(id))
        return new Set(ids).size === ids.length
      },
      'Each prep step id can only appear once',
    ),
})

/**
 * Express 5 types every `req.params` value as `string | string[] | undefined`,
 * since a route pattern can repeat a name. Parsing through zod narrows it to
 * the string the route actually produces, and rejects anything odd before it
 * reaches a query.
 */
const idParamSchema = z.object({ id: z.string().min(1) })

const listQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).optional(),

  /**
   * `?ingredientIds=a,b,c` — recipes containing **all** of these (AND, not
   * OR). That is what "filter by the ingredients I picked" means in a UI:
   * each one you add should narrow the list.
   *
   * Note this is *not* MP-51's pantry filter, which is the opposite
   * direction: recipes whose ingredients are a subset of what you have,
   * ranked by how many are missing. That needs its own endpoint.
   */
  ingredientIds: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    ),
})

// ---------------------------------------------------------------------------
// Serialisation — the only recipe shapes that leave the server
// ---------------------------------------------------------------------------

const summarySelect = {
  id: true,
  name: true,
  photoUrl: true,
  servings: true,
  caloriesPerServing: true,
  proteinPerServing: true,
  carbsPerServing: true,
  fatPerServing: true,
  isPublic: true,
  createdById: true,
  updatedAt: true,
  _count: { select: { ingredients: true, prepItems: true } },
} satisfies Prisma.RecipeSelect

const detailInclude = {
  ingredients: {
    include: { ingredient: { select: { id: true, name: true, defaultUnit: true, category: true } } },
    orderBy: { ingredient: { name: 'asc' } },
  },
  prepItems: { orderBy: { leadTimeHours: 'desc' } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.RecipeInclude

/**
 * Who may see this recipe: it is public, or the caller owns it — and an admin
 * sees everything.
 *
 * The admin case is not generosity, it is consistency: `assertCanModify` lets
 * an admin delete any recipe, so without this an admin would get a 404 reading
 * the very recipe they are allowed to delete. A role that can moderate content
 * has to be able to look at it.
 *
 * Applied as a `where` clause rather than a post-filter, so a private recipe
 * never leaves the database — and the pagination `total` stays honest instead
 * of counting rows the caller cannot see.
 */
const visibleTo = (user: { id: string; roles: Role[] }): Prisma.RecipeWhereInput =>
  user.roles.includes(Role.ADMIN) ? {} : { OR: [{ isPublic: true }, { createdById: user.id }] }

// ---------------------------------------------------------------------------
// GET /recipes
// ---------------------------------------------------------------------------
recipesRouter.get('/recipes', requireAuth, async (req, res) => {
  const user = req.user

  if (!user) throw unauthorized()

  const { page, pageSize, q, ingredientIds } = listQuerySchema.parse(req.query)

  const where: Prisma.RecipeWhereInput = {
    AND: [
      visibleTo(user),
      ...(q ? [{ name: { contains: q, mode: 'insensitive' } } satisfies Prisma.RecipeWhereInput] : []),
      // One `some` per requested ingredient. Stacking them inside AND is what
      // makes this "contains all of" rather than "contains any of".
      ...ingredientIds.map((id) => ({ ingredients: { some: { ingredientId: id } } }) satisfies Prisma.RecipeWhereInput),
    ],
  }

  // One round trip for the page and its count, rather than two sequential ones.
  const [items, total] = await prisma.$transaction([
    prisma.recipe.findMany({
      where,
      select: summarySelect,
      orderBy: { name: 'asc' },
      ...toSkipTake(page, pageSize),
    }),
    prisma.recipe.count({ where }),
  ])

  res.json(paginate(items, total, page, pageSize))
})

// ---------------------------------------------------------------------------
// GET /recipes/:id
// ---------------------------------------------------------------------------
recipesRouter.get('/recipes/:id', requireAuth, async (req, res) => {
  const user = req.user

  if (!user) throw unauthorized()

  const { id } = idParamSchema.parse(req.params)

  const recipe = await prisma.recipe.findFirst({
    where: { id, ...visibleTo(user) },
    include: detailInclude,
  })

  // 404, not 403, when the recipe exists but is someone else's private one.
  // A 403 would confirm the id is real, which is information the caller has
  // no business having.
  if (!recipe) throw new HttpError(404, 'Recipe not found')

  res.json({ recipe })
})

// ---------------------------------------------------------------------------
// POST /recipes
// ---------------------------------------------------------------------------
recipesRouter.post('/recipes', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const body = recipeBodySchema.parse(req.body)

  await assertIngredientsExist(body.ingredients.map((line) => line.ingredientId))

  const recipe = await prisma.recipe.create({
    data: {
      ...toRecipeFields(body),
      createdById: userId,
      // Nested writes, so the recipe and all its children are one
      // transaction: a bad ingredient row cannot leave a half-made recipe.
      ingredients: { create: body.ingredients },
      prepItems: { create: body.prepItems },
    },
    include: detailInclude,
  })

  res.status(201).json({ recipe })
})

// ---------------------------------------------------------------------------
// PUT /recipes/:id
// ---------------------------------------------------------------------------
recipesRouter.put('/recipes/:id', requireAuth, async (req, res) => {
  const { id } = idParamSchema.parse(req.params)

  await assertCanModify(id, req.user)

  const body = recipeUpdateSchema.parse(req.body)

  await assertIngredientsExist(body.ingredients.map((line) => line.ingredientId))
  await assertPrepItemsBelongToRecipe(id, body.prepItems)

  const recipe = await prisma.$transaction(async (tx) => {
    // Ingredients are still replaced wholesale, and that is fine: a
    // RecipeIngredient's identity *is* (recipeId, ingredientId), there is no
    // surrogate id to preserve, and nothing in the schema points at one. Prep
    // items are the opposite — todos reference them — so they get diffed.
    await tx.recipeIngredient.deleteMany({ where: { recipeId: id } })

    const keptIds = body.prepItems.map((prep) => prep.id).filter((prepId): prepId is string => Boolean(prepId))

    // Steps the user removed in the form. Done first, so a step being deleted
    // cannot collide with one being created.
    await tx.prepItem.deleteMany({ where: { recipeId: id, id: { notIn: keptIds } } })

    for (const prep of body.prepItems) {
      if (prep.id) {
        // The row survives. Its todos keep pointing at it, and they keep
        // their status.
        await tx.prepItem.update({
          where: { id: prep.id },
          data: { label: prep.label, leadTimeHours: prep.leadTimeHours, timing: prep.timing },
        })
      } else {
        await tx.prepItem.create({
          data: { recipeId: id, label: prep.label, leadTimeHours: prep.leadTimeHours, timing: prep.timing },
        })
      }
    }

    const updated = await tx.recipe.update({
      where: { id },
      data: { ...toRecipeFields(body), ingredients: { create: body.ingredients } },
      include: detailInclude,
    })

    // A changed label, lead time or timing mode changes what the todos should
    // say and when they are due — so every plan entry using this recipe gets
    // its todos rebuilt.
    //
    // This reaches other people's plans too, not just the editor's: a public
    // recipe can be planned by anyone, and their prep todos should reflect the
    // recipe as it is now. Because the PrepItem rows survived above,
    // `regenerateTodosForEntry` finds the existing todos by
    // (sourceEntryId, sourcePrepItemId) and updates them in place — so a
    // ticked or cancelled todo keeps its status.
    const entries = await tx.mealPlanEntry.findMany({ where: { recipeId: id }, include: planEntryTodoInclude })

    for (const entry of entries) {
      await regenerateTodosForEntry(tx, entry)
    }

    return updated
  })

  res.json({ recipe })
})

// ---------------------------------------------------------------------------
// DELETE /recipes/:id
// ---------------------------------------------------------------------------
recipesRouter.delete('/recipes/:id', requireAuth, async (req, res) => {
  const { id } = idParamSchema.parse(req.params)

  await assertCanModify(id, req.user)

  // Ingredients, prep items and plan entries go with it — all three FKs are
  // ON DELETE CASCADE.
  await prisma.recipe.delete({ where: { id } })

  res.status(204).end()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps the validated body onto scalar columns, leaving relations out. */
function toRecipeFields(body: z.infer<typeof recipeBodySchema>) {
  const { ingredients: _ingredients, prepItems: _prepItems, ...fields } = body

  return fields
}

/**
 * "Owner or admin" — the rule the ticket names for delete, applied to update
 * too. Letting any signed-in user rewrite someone else's recipe while being
 * unable to delete it would be a strange place to draw the line.
 *
 * 404 before 403: if the recipe does not exist, say so. If it exists and is
 * not yours, say forbidden — by then you already proved the id is real by
 * owning or administering nothing, so there is no extra leak.
 */
async function assertCanModify(id: string, user: { id: string; roles: Role[] } | undefined): Promise<void> {
  if (!user) throw unauthorized()

  const recipe = await prisma.recipe.findUnique({ where: { id }, select: { createdById: true } })

  if (!recipe) throw new HttpError(404, 'Recipe not found')

  if (recipe.createdById !== user.id && !user.roles.includes(Role.ADMIN)) {
    throw forbidden('Only the recipe owner or an admin can change this recipe')
  }
}

/**
 * Every supplied prep-step id must already belong to *this* recipe.
 *
 * Without this check, `PUT /recipes/mine` could pass another recipe's prep
 * item id and the update would silently re-parent that row — stealing a step
 * out of someone else's recipe and dragging its todos along with it. An
 * unknown id is a 422 rather than a 403, because from the caller's side it is
 * indistinguishable from a stale form.
 */
async function assertPrepItemsBelongToRecipe(
  recipeId: string,
  prepItems: { id?: string | undefined }[],
): Promise<void> {
  const suppliedIds = prepItems.map((prep) => prep.id).filter((id): id is string => Boolean(id))

  if (suppliedIds.length === 0) return

  const owned = await prisma.prepItem.findMany({
    where: { id: { in: suppliedIds }, recipeId },
    select: { id: true },
  })

  if (owned.length === suppliedIds.length) return

  const ownedIds = new Set(owned.map((row) => row.id))
  const strangers = suppliedIds.filter((id) => !ownedIds.has(id))

  throw new HttpError(422, 'Validation failed', {
    prepItems: `Unknown prep step ${strangers.length > 1 ? 'ids' : 'id'} for this recipe: ${strangers.join(', ')}`,
  })
}

/**
 * Turns "you sent an ingredient id that does not exist" into a 422 the form
 * can show, rather than letting the foreign key fail as an opaque 500.
 */
async function assertIngredientsExist(ids: string[]): Promise<void> {
  const found = await prisma.ingredient.findMany({ where: { id: { in: ids } }, select: { id: true } })

  if (found.length === ids.length) return

  const known = new Set(found.map((row) => row.id))
  const missing = ids.filter((id) => !known.has(id))

  throw new HttpError(422, 'Validation failed', {
    ingredients: `Unknown ingredient ${missing.length > 1 ? 'ids' : 'id'}: ${missing.join(', ')}`,
  })
}
