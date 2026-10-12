import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { HttpError, unauthorized } from '../lib/httpError.ts'
import { parseDateRange, toUtcDay } from '../lib/dateRange.ts'
import { discardPendingTodosForEntry, planEntryTodoInclude, regenerateTodosForEntry } from '../services/todos.ts'
import { MealType } from '../../generated/prisma/enums.ts'

export const mealPlanRouter = Router()

const idParamSchema = z.object({ id: z.string().min(1) })

const createEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD'),
  mealType: z.enum(MealType),
  recipeId: z.string().min(1, 'Pick a recipe'),
  servings: z.coerce.number().int().min(1, 'Servings must be at least 1').max(50).default(1),
})

const entrySelect = {
  id: true,
  date: true,
  mealType: true,
  servings: true,
  recipeId: true,
  recipe: {
    select: {
      id: true,
      name: true,
      photoUrl: true,
      servings: true,
      caloriesPerServing: true,
      proteinPerServing: true,
      carbsPerServing: true,
      fatPerServing: true,
    },
  },
}

// ---------------------------------------------------------------------------
// GET /meal-plan?from=&to=
// ---------------------------------------------------------------------------
mealPlanRouter.get('/meal-plan', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const { from, to } = parseDateRange(req.query)

  const items = await prisma.mealPlanEntry.findMany({
    where: { userId, date: { gte: from, lte: to } },
    select: entrySelect,
    // Flat and sorted, not grouped by day. The planner grid in MP-60 needs to
    // render empty slots too, so it has to build the week's skeleton itself —
    // a grouped response would not save it any work.
    orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
  })

  res.json({ items })
})

// ---------------------------------------------------------------------------
// POST /meal-plan
// ---------------------------------------------------------------------------
mealPlanRouter.post('/meal-plan', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const body = createEntrySchema.parse(req.body)
  const date = toUtcDay(body.date)

  // The recipe must exist and be one this user can see — otherwise a private
  // recipe id could be planted into someone else's plan.
  const recipe = await prisma.recipe.findFirst({
    where: { id: body.recipeId, OR: [{ isPublic: true }, { createdById: userId }] },
    select: { id: true },
  })

  if (!recipe) {
    throw new HttpError(422, 'Validation failed', { recipeId: 'Unknown recipe' })
  }

  const existing = await prisma.mealPlanEntry.findUnique({
    where: {
      userId_date_mealType_recipeId: { userId, date, mealType: body.mealType, recipeId: body.recipeId },
    },
    select: { id: true },
  })

  if (existing) {
    throw new HttpError(409, 'That recipe is already in this meal slot')
  }

  // Entry and todos in one transaction: a plan entry without its prep todos
  // is worse than no plan entry at all, because nothing later would notice.
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.mealPlanEntry.create({
      data: { userId, date, mealType: body.mealType, recipeId: body.recipeId, servings: body.servings },
      include: planEntryTodoInclude,
    })

    await regenerateTodosForEntry(tx, created)

    return tx.mealPlanEntry.findUniqueOrThrow({ where: { id: created.id }, select: entrySelect })
  })

  res.status(201).json({ entry })
})

// ---------------------------------------------------------------------------
// DELETE /meal-plan/:id
// ---------------------------------------------------------------------------
mealPlanRouter.delete('/meal-plan/:id', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const { id } = idParamSchema.parse(req.params)

  // Scoped by userId, so another user's entry is a 404 rather than a 403 —
  // there is no reason to confirm the id exists.
  const entry = await prisma.mealPlanEntry.findFirst({ where: { id, userId }, select: { id: true } })

  if (!entry) throw new HttpError(404, 'Meal plan entry not found')

  await prisma.$transaction(async (tx) => {
    await discardPendingTodosForEntry(tx, entry.id)
    await tx.mealPlanEntry.delete({ where: { id: entry.id } })
  })

  res.status(204).end()
})

// ---------------------------------------------------------------------------
// GET /meal-plan/macros?date=
//
// Computed in SQL, not by summing in JavaScript. This is the query the
// roadmap's §2 used to justify choosing Postgres, so it is worth writing as
// SQL rather than pulling rows into Node and adding them up: one round trip,
// and the database does what it is good at.
// ---------------------------------------------------------------------------

const macrosQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD'),
})

type MacroRow = {
  mealType: MealType | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  entries: bigint
}

mealPlanRouter.get('/meal-plan/macros', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const { date } = macrosQuerySchema.parse(req.query)

  /**
   * Macros are stored *per serving*, and a plan entry says how many servings
   * are being eaten — so every total is `perServing * entry.servings`.
   *
   * GROUP BY ROLLUP gives the per-meal breakdown and the day's total from one
   * query: ROLLUP emits the normal grouped rows plus one extra row with
   * `mealType` NULL holding the grand total. Two queries would have been
   * clearer to read and twice the round trips.
   *
   * COALESCE on carbs and fat because both are nullable on Recipe — without
   * it, one recipe missing its fat figure would make the whole day's fat NULL.
   */
  const rows = await prisma.$queryRaw<MacroRow[]>`
    SELECT
      e."mealType"                                                AS "mealType",
      SUM(r."caloriesPerServing"      * e."servings")::float      AS "calories",
      SUM(r."proteinPerServing"       * e."servings")::float      AS "protein",
      SUM(COALESCE(r."carbsPerServing", 0) * e."servings")::float AS "carbs",
      SUM(COALESCE(r."fatPerServing",   0) * e."servings")::float AS "fat",
      COUNT(*)                                                    AS "entries"
    FROM "MealPlanEntry" e
    JOIN "Recipe" r ON r."id" = e."recipeId"
    WHERE e."userId" = ${userId}
      AND e."date"   = ${toUtcDay(date)}::date
    GROUP BY ROLLUP (e."mealType")
  `

  const round = (value: number | null) => Math.round((value ?? 0) * 10) / 10

  // The ROLLUP total row is the one with a NULL mealType.
  const totalRow = rows.find((row) => row.mealType === null)

  res.json({
    date,
    totals: {
      calories: Math.round(totalRow?.calories ?? 0),
      protein: round(totalRow?.protein ?? null),
      carbs: round(totalRow?.carbs ?? null),
      fat: round(totalRow?.fat ?? null),
      entries: Number(totalRow?.entries ?? 0),
    },
    byMealType: rows
      .filter((row): row is MacroRow & { mealType: MealType } => row.mealType !== null)
      .map((row) => ({
        mealType: row.mealType,
        calories: Math.round(row.calories ?? 0),
        protein: round(row.protein),
        carbs: round(row.carbs),
        fat: round(row.fat),
        entries: Number(row.entries),
      })),
  })
})
