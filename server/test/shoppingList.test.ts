import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { MealType, Unit } from '../generated/prisma/enums.ts'
import { createIngredients, createRecipeRow, resetDb, testDb } from './helpers/db.ts'
import { authAs } from './helpers/auth.ts'

const app = createApp()

let me: Awaited<ReturnType<typeof authAs>>
let someoneElse: Awaited<ReturnType<typeof authAs>>
let chickpeas: string
let onion: string
let yoghurt: string

beforeEach(async () => {
  await resetDb()
  me = await authAs('me@example.com')
  someoneElse = await authAs('them@example.com')
  const rows = await createIngredients(['Chickpeas', 'Onion', 'Yoghurt'])
  chickpeas = rows[0]!.id
  onion = rows[1]!.id
  yoghurt = rows[2]!.id
})

afterAll(() => testDb.$disconnect())

/**
 * The hand-worked example for the shopping list.
 *
 * `RecipeIngredient.quantity` is the amount for the WHOLE recipe, which
 * yields `Recipe.servings`. A plan entry asks for `entry.servings`. So each
 * line contributes `quantity × entry.servings / recipe.servings`.
 *
 *   Chana (yields 4)   300 GRAM chickpeas, 2 PIECE onion
 *     planned 2 servings → scale 2/4 = 0.5  → 150 GRAM chickpeas, 1 PIECE onion
 *
 *   Hummus (yields 2)  100 GRAM chickpeas, 200 GRAM yoghurt
 *     planned 2 servings → scale 2/2 = 1    → 100 GRAM chickpeas, 200 GRAM yoghurt
 *
 *   Raita (yields 2)   2 TABLESPOON yoghurt
 *     planned 1 serving  → scale 1/2 = 0.5  → 1 TABLESPOON yoghurt
 *                                              ─────────────────────────────
 *   Chickpeas  GRAM        150 + 100  =  250
 *   Onion      PIECE                      1
 *   Yoghurt    GRAM                     200
 *   Yoghurt    TABLESPOON                 1
 *
 * Yoghurt appears twice on purpose. 200 grams and 1 tablespoon cannot be
 * added, and a list claiming "201 yoghurt" would be worse than two lines.
 */
const seedThePlan = async () => {
  const chana = await createRecipeRow({
    ownerId: me.user.id,
    name: 'Chana',
    servings: 4,
    caloriesPerServing: 420,
    proteinPerServing: 18,
    ingredients: [
      { ingredientId: chickpeas, quantity: 300, unit: Unit.GRAM },
      { ingredientId: onion, quantity: 2, unit: Unit.PIECE },
    ],
  })
  const hummus = await createRecipeRow({
    ownerId: me.user.id,
    name: 'Hummus',
    servings: 2,
    caloriesPerServing: 250,
    proteinPerServing: 9,
    ingredients: [
      { ingredientId: chickpeas, quantity: 100, unit: Unit.GRAM },
      { ingredientId: yoghurt, quantity: 200, unit: Unit.GRAM },
    ],
  })
  const raita = await createRecipeRow({
    ownerId: me.user.id,
    name: 'Raita',
    servings: 2,
    caloriesPerServing: 90,
    proteinPerServing: 4,
    ingredients: [{ ingredientId: yoghurt, quantity: 2, unit: Unit.TABLESPOON }],
  })

  const add = (date: string, mealType: MealType, recipeId: string, servings: number) =>
    request(app).post('/meal-plan').set('Authorization', me.header).send({ date, mealType, recipeId, servings })

  await add('2026-10-12', MealType.LUNCH, chana.id, 2)
  await add('2026-10-13', MealType.LUNCH, hummus.id, 2)
  await add('2026-10-13', MealType.SNACK, raita.id, 1)
}

const key = (row: { name: string; unit: string }) => `${row.name} ${row.unit}`

describe('GET /shopping-list?from=&to=', () => {
  it('matches the hand-calculated aggregate, deduped by ingredient AND unit', async () => {
    await seedThePlan()

    const res = await request(app)
      .get('/shopping-list?from=2026-10-12&to=2026-10-13')
      .set('Authorization', me.header)

    expect(res.status).toBe(200)

    const got = Object.fromEntries(res.body.items.map((row: { name: string; unit: string }) => [key(row), row]))

    expect(Object.keys(got).sort()).toEqual([
      'Chickpeas GRAM',
      'Onion PIECE',
      'Yoghurt GRAM',
      'Yoghurt TABLESPOON',
    ])
    expect(got['Chickpeas GRAM'].quantity).toBe(250)
    expect(got['Onion PIECE'].quantity).toBe(1)
    expect(got['Yoghurt GRAM'].quantity).toBe(200)
    expect(got['Yoghurt TABLESPOON'].quantity).toBe(1)
  })

  it('counts how many planned recipes each line came from', async () => {
    await seedThePlan()

    const res = await request(app)
      .get('/shopping-list?from=2026-10-12&to=2026-10-13')
      .set('Authorization', me.header)

    const got = Object.fromEntries(res.body.items.map((row: { name: string; unit: string }) => [key(row), row]))

    // Chickpeas come from both Chana and Hummus.
    expect(got['Chickpeas GRAM'].recipeCount).toBe(2)
    expect(got['Onion PIECE'].recipeCount).toBe(1)
  })

  it('scales down when cooking fewer servings than the recipe yields', async () => {
    const solo = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Big Batch',
      servings: 8,
      caloriesPerServing: 100,
      proteinPerServing: 1,
      ingredients: [{ ingredientId: chickpeas, quantity: 800, unit: Unit.GRAM }],
    })

    await request(app)
      .post('/meal-plan')
      .set('Authorization', me.header)
      .send({ date: '2026-10-12', mealType: MealType.LUNCH, recipeId: solo.id, servings: 1 })

    const res = await request(app)
      .get('/shopping-list?from=2026-10-12&to=2026-10-12')
      .set('Authorization', me.header)

    // One of eight servings → an eighth of the chickpeas.
    expect(res.body.items[0].quantity).toBe(100)
  })

  it('respects the date range', async () => {
    await seedThePlan()

    const firstDayOnly = await request(app)
      .get('/shopping-list?from=2026-10-12&to=2026-10-12')
      .set('Authorization', me.header)

    const got = firstDayOnly.body.items.map(key)

    expect(got.sort()).toEqual(['Chickpeas GRAM', 'Onion PIECE'])
  })

  it('is empty for a range with nothing planned', async () => {
    const res = await request(app)
      .get('/shopping-list?from=2026-11-01&to=2026-11-07')
      .set('Authorization', me.header)

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  it("never includes another user's plan", async () => {
    await seedThePlan()

    const res = await request(app)
      .get('/shopping-list?from=2026-10-12&to=2026-10-13')
      .set('Authorization', someoneElse.header)

    expect(res.body.items).toEqual([])
  })

  it('422s a missing or oversized range, and 401s without a token', async () => {
    const missing = await request(app).get('/shopping-list').set('Authorization', me.header)
    const huge = await request(app)
      .get('/shopping-list?from=2020-01-01&to=2026-01-01')
      .set('Authorization', me.header)
    const anon = await request(app).get('/shopping-list?from=2026-10-12&to=2026-10-13')

    expect(missing.status).toBe(422)
    expect(huge.status).toBe(422)
    expect(anon.status).toBe(401)
  })
})
