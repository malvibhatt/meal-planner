import { Router } from 'express'
import { prisma } from '../db/prisma.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { unauthorized } from '../lib/httpError.ts'
import { parseDateRange } from '../lib/dateRange.ts'
import type { IngredientCategory, Unit } from '../../generated/prisma/enums.ts'

export const shoppingListRouter = Router()

type ShoppingRow = {
  ingredientId: string
  name: string
  category: IngredientCategory
  unit: Unit
  quantity: number
  recipeCount: bigint
}

/**
 * GET /shopping-list?from=&to=
 *
 * Everything you need to buy for the planned meals in a date range,
 * aggregated and deduped by ingredient **and unit** — the grouping the
 * roadmap's §2 named. Unit has to be part of the key: 200 GRAM of yoghurt and
 * 2 TABLESPOON of yoghurt cannot be added together, and silently summing them
 * to "202 of yoghurt" would be worse than listing them twice.
 *
 * The scaling is the subtle part. `RecipeIngredient.quantity` is for the whole
 * recipe, which yields `Recipe.servings`. A plan entry asks for
 * `entry.servings`. So the amount actually needed is
 *
 *     quantity * (entry.servings / recipe.servings)
 *
 * Cooking one portion of a four-portion recipe should put a quarter of the
 * chickpeas on the list, not all of them.
 */
shoppingListRouter.get('/shopping-list', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const { from, to } = parseDateRange(req.query)

  const rows = await prisma.$queryRaw<ShoppingRow[]>`
    SELECT
      i."id"                                                               AS "ingredientId",
      i."name"                                                             AS "name",
      i."category"                                                         AS "category",
      ri."unit"                                                            AS "unit",
      SUM(ri."quantity" * e."servings"::float / r."servings"::float)::float AS "quantity",
      COUNT(DISTINCT r."id")                                               AS "recipeCount"
    FROM "MealPlanEntry" e
    JOIN "Recipe"           r  ON r."id"  = e."recipeId"
    JOIN "RecipeIngredient" ri ON ri."recipeId" = r."id"
    JOIN "Ingredient"       i  ON i."id"  = ri."ingredientId"
    WHERE e."userId" = ${userId}
      AND e."date" BETWEEN ${from}::date AND ${to}::date
    GROUP BY i."id", i."name", i."category", ri."unit"
    ORDER BY i."category" ASC, i."name" ASC
  `

  res.json({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    items: rows.map((row) => ({
      ingredientId: row.ingredientId,
      name: row.name,
      category: row.category,
      unit: row.unit,
      // Two decimals: the scaling divides, so "0.3333333 CUP of rice" is a
      // real possibility and not a useful thing to put on a shopping list.
      quantity: Math.round(row.quantity * 100) / 100,
      recipeCount: Number(row.recipeCount),
    })),
  })
})
