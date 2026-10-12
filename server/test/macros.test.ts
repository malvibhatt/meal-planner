import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { MealType } from '../generated/prisma/enums.ts'
import { createRecipeRow, resetDb, testDb } from './helpers/db.ts'
import { authAs } from './helpers/auth.ts'

const app = createApp()

let me: Awaited<ReturnType<typeof authAs>>
let someoneElse: Awaited<ReturnType<typeof authAs>>

beforeEach(async () => {
  await resetDb()
  me = await authAs('me@example.com')
  someoneElse = await authAs('them@example.com')
})

afterAll(() => testDb.$disconnect())

/**
 * The ticket's AC: "macros endpoint matches a hand-calculated example."
 * Here is the example, worked out by hand.
 *
 * Macros on Recipe are PER SERVING, and a plan entry says how many servings
 * are eaten, so each contribution is perServing × entry.servings.
 *
 *   Breakfast — Overnight Oats, 1 serving
 *     380 cal, 14 p, 54 c, 11 f    ×1  =  380 cal, 14 p, 54 c, 11 f
 *
 *   Lunch — Chana Masala, 2 servings
 *     420 cal, 18 p, 62 c, 10 f    ×2  =  840 cal, 36 p, 124 c, 20 f
 *
 *   Dinner — Salmon & Quinoa, 3 servings   (carbs and fat are NULL)
 *     580 cal, 42 p,  — ,  —       ×3  = 1740 cal, 126 p,   0 c,  0 f
 *                                        ────────────────────────────
 *                                 TOTAL  2960 cal, 176 p, 178 c, 31 f
 *
 * The dinner row is deliberately missing carbs and fat: without COALESCE in
 * the SQL, one NULL would make the whole day's carbs NULL rather than adding
 * zero.
 */
const EXPECTED = { calories: 2960, protein: 176, carbs: 178, fat: 31, entries: 3 }

const seedTheDay = async () => {
  const oats = await createRecipeRow({
    ownerId: me.user.id,
    name: 'Overnight Oats',
    servings: 1,
    caloriesPerServing: 380,
    proteinPerServing: 14,
    carbsPerServing: 54,
    fatPerServing: 11,
  })
  const chana = await createRecipeRow({
    ownerId: me.user.id,
    name: 'Chana Masala',
    servings: 4,
    caloriesPerServing: 420,
    proteinPerServing: 18,
    carbsPerServing: 62,
    fatPerServing: 10,
  })
  const salmon = await createRecipeRow({
    ownerId: me.user.id,
    name: 'Salmon & Quinoa',
    servings: 2,
    caloriesPerServing: 580,
    proteinPerServing: 42,
    carbsPerServing: null,
    fatPerServing: null,
  })

  const add = (mealType: MealType, recipeId: string, servings: number) =>
    request(app)
      .post('/meal-plan')
      .set('Authorization', me.header)
      .send({ date: '2026-10-13', mealType, recipeId, servings })

  await add(MealType.BREAKFAST, oats.id, 1)
  await add(MealType.LUNCH, chana.id, 2)
  await add(MealType.DINNER, salmon.id, 3)
}

describe('GET /meal-plan/macros', () => {
  it('matches the hand-calculated totals', async () => {
    await seedTheDay()

    const res = await request(app).get('/meal-plan/macros?date=2026-10-13').set('Authorization', me.header)

    expect(res.status).toBe(200)
    expect(res.body.date).toBe('2026-10-13')
    expect(res.body.totals).toEqual(EXPECTED)
  })

  it('breaks the day down per meal, each matching its own line of the sum', async () => {
    await seedTheDay()

    const res = await request(app).get('/meal-plan/macros?date=2026-10-13').set('Authorization', me.header)

    const byMeal = Object.fromEntries(
      res.body.byMealType.map((row: { mealType: string }) => [row.mealType, row]),
    )

    expect(byMeal[MealType.BREAKFAST]).toMatchObject({ calories: 380, protein: 14, carbs: 54, fat: 11 })
    expect(byMeal[MealType.LUNCH]).toMatchObject({ calories: 840, protein: 36, carbs: 124, fat: 20 })
    expect(byMeal[MealType.DINNER]).toMatchObject({ calories: 1740, protein: 126, carbs: 0, fat: 0 })
  })

  it('the per-meal rows add up to the total — the ROLLUP is consistent', async () => {
    await seedTheDay()

    const res = await request(app).get('/meal-plan/macros?date=2026-10-13').set('Authorization', me.header)
    const sum = (key: string) =>
      res.body.byMealType.reduce((acc: number, row: Record<string, number>) => acc + (row[key] ?? 0), 0)

    expect(sum('calories')).toBe(res.body.totals.calories)
    expect(sum('protein')).toBe(res.body.totals.protein)
    expect(sum('carbs')).toBe(res.body.totals.carbs)
    expect(sum('fat')).toBe(res.body.totals.fat)
  })

  it('returns zeroes for a day with nothing planned', async () => {
    const res = await request(app).get('/meal-plan/macros?date=2026-10-14').set('Authorization', me.header)

    expect(res.status).toBe(200)
    expect(res.body.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0, entries: 0 })
    expect(res.body.byMealType).toEqual([])
  })

  it('counts only the asked-for day', async () => {
    await seedTheDay()
    const oats = await testDb.recipe.findFirstOrThrow({ where: { name: 'Overnight Oats' } })
    await request(app)
      .post('/meal-plan')
      .set('Authorization', me.header)
      .send({ date: '2026-10-14', mealType: MealType.BREAKFAST, recipeId: oats.id, servings: 1 })

    const res = await request(app).get('/meal-plan/macros?date=2026-10-13').set('Authorization', me.header)

    expect(res.body.totals.calories).toBe(EXPECTED.calories)
  })

  it("counts only the caller's own plan", async () => {
    await seedTheDay()

    const res = await request(app).get('/meal-plan/macros?date=2026-10-13').set('Authorization', someoneElse.header)

    expect(res.body.totals.entries).toBe(0)
  })

  it('422s a malformed date', async () => {
    const res = await request(app).get('/meal-plan/macros?date=13-10-2026').set('Authorization', me.header)

    expect(res.status).toBe(422)
  })

  it('401s without a token', async () => {
    const res = await request(app).get('/meal-plan/macros?date=2026-10-13')

    expect(res.status).toBe(401)
  })
})
