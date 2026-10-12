import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { MealType, PrepTiming, TodoStatus } from '../generated/prisma/enums.ts'
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

const addEntry = (as: typeof me, body: Record<string, unknown>) =>
  request(app).post('/meal-plan').set('Authorization', as.header).send(body)

describe('POST /meal-plan', () => {
  it('creates the entry', async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Dal',
      servings: 4,
      caloriesPerServing: 320,
      proteinPerServing: 18,
    })

    const res = await addEntry(me, {
      date: '2026-10-13',
      mealType: MealType.LUNCH,
      recipeId: recipe.id,
      servings: 2,
    })

    expect(res.status).toBe(201)
    expect(res.body.entry).toMatchObject({ mealType: MealType.LUNCH, servings: 2 })
    expect(res.body.entry.recipe.name).toBe('Dal')
  })

  it('409s on the same recipe in the same slot twice', async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Dal',
      servings: 4,
      caloriesPerServing: 320,
      proteinPerServing: 18,
    })
    const body = { date: '2026-10-13', mealType: MealType.DINNER, recipeId: recipe.id }

    expect((await addEntry(me, body)).status).toBe(201)
    expect((await addEntry(me, body)).status).toBe(409)
  })

  it('allows two different recipes in one slot', async () => {
    const base = { ownerId: me.user.id, servings: 2, caloriesPerServing: 300, proteinPerServing: 10 }
    const a = await createRecipeRow({ ...base, name: 'A' })
    const b = await createRecipeRow({ ...base, name: 'B' })

    expect((await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: a.id })).status).toBe(201)
    expect((await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: b.id })).status).toBe(201)
  })

  it("422s on another user's private recipe, so ids cannot be planted", async () => {
    const theirs = await testDb.recipe.create({
      data: {
        name: 'Secret',
        servings: 1,
        caloriesPerServing: 100,
        proteinPerServing: 1,
        isPublic: false,
        createdById: someoneElse.user.id,
      },
    })

    const res = await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: theirs.id })

    expect(res.status).toBe(422)
    expect(res.body.errors.recipeId).toMatch(/Unknown recipe/i)
  })

  it('422s a malformed date and an unknown meal type', async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Dal',
      servings: 1,
      caloriesPerServing: 1,
      proteinPerServing: 1,
    })

    const badDate = await addEntry(me, { date: '13-10-2026', mealType: MealType.LUNCH, recipeId: recipe.id })
    const badMeal = await addEntry(me, { date: '2026-10-13', mealType: 'ELEVENSES', recipeId: recipe.id })

    expect(badDate.status).toBe(422)
    expect(badDate.body.errors.date).toMatch(/YYYY-MM-DD/)
    expect(badMeal.status).toBe(422)
    expect(badMeal.body.errors.mealType).toBeDefined()
  })
})

describe('todo generation — the AC', () => {
  const recipeWithPrep = () =>
    createRecipeRow({
      ownerId: me.user.id,
      name: 'Chana Masala',
      servings: 4,
      caloriesPerServing: 420,
      proteinPerServing: 18,
      prepItems: [
        { label: 'Soak the chickpeas', leadTimeHours: 12 },
        { label: 'Blitz the paste', leadTimeHours: 1 },
      ],
    })

  it('creates one todo per prep item with the correct dueAt', async () => {
    const recipe = await recipeWithPrep()

    await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

    const todos = await testDb.todoItem.findMany({ orderBy: { dueAt: 'asc' } })

    expect(todos).toHaveLength(2)
    // Lunch is 13:00. 12h before → 01:00 the same day; 1h before → 12:00.
    expect(todos[0]?.dueAt.toISOString()).toBe('2026-10-13T01:00:00.000Z')
    expect(todos[1]?.dueAt.toISOString()).toBe('2026-10-13T12:00:00.000Z')
    expect(todos[0]?.label).toBe('Soak the chickpeas — Chana Masala')
    expect(todos.every((todo) => todo.userId === me.user.id)).toBe(true)
  })

  it('creates no todos for a recipe with no prep items', async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Toast',
      servings: 1,
      caloriesPerServing: 200,
      proteinPerServing: 5,
    })

    const res = await addEntry(me, { date: '2026-10-13', mealType: MealType.BREAKFAST, recipeId: recipe.id })

    expect(res.status).toBe(201)
    expect(await testDb.todoItem.count()).toBe(0)
  })

  it('preserves isDone when todos are regenerated', async () => {
    const recipe = await recipeWithPrep()
    const created = await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })
    const entryId = created.body.entry.id as string

    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app).patch(`/todos/${soak.id}`).set('Authorization', me.header).send({ status: TodoStatus.DONE })

    // Regenerate by re-running the service the way a plan write does.
    const entry = await testDb.mealPlanEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { recipe: { select: { name: true, prepItems: true } } },
    })
    const { regenerateTodosForEntry } = await import('../src/services/todos.ts')
    await testDb.$transaction((tx) => regenerateTodosForEntry(tx, entry))

    const after = await testDb.todoItem.findUniqueOrThrow({ where: { id: soak.id } })

    expect(after.status).toBe(TodoStatus.DONE)
    expect(after.completedAt).not.toBeNull()
    // Same row, not a replacement.
    expect(await testDb.todoItem.count()).toBe(2)
  })

  it('removes undone todos for prep items dropped from the recipe, but keeps done ones', async () => {
    const recipe = await recipeWithPrep()
    const created = await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

    const paste = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Blitz' } } })
    await request(app).patch(`/todos/${paste.id}`).set('Authorization', me.header).send({ status: TodoStatus.DONE })

    // Drop both prep items from the recipe, then regenerate.
    await testDb.prepItem.deleteMany({ where: { recipeId: recipe.id } })
    const entry = await testDb.mealPlanEntry.findUniqueOrThrow({
      where: { id: created.body.entry.id },
      include: { recipe: { select: { name: true, prepItems: true } } },
    })
    const { regenerateTodosForEntry } = await import('../src/services/todos.ts')
    await testDb.$transaction((tx) => regenerateTodosForEntry(tx, entry))

    const remaining = await testDb.todoItem.findMany()

    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.status).toBe(TodoStatus.DONE)
    expect(remaining[0]?.label).toMatch(/^Blitz/)
  })
})

describe('DELETE /meal-plan/:id — the AC', () => {
  it("removes the entry's undone todos and keeps the done ones as history", async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Chana Masala',
      servings: 4,
      caloriesPerServing: 420,
      proteinPerServing: 18,
      prepItems: [
        { label: 'Soak the chickpeas', leadTimeHours: 12 },
        { label: 'Blitz the paste', leadTimeHours: 1 },
      ],
    })
    const created = await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })
    const entryId = created.body.entry.id as string

    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app).patch(`/todos/${soak.id}`).set('Authorization', me.header).send({ status: TodoStatus.DONE })

    const res = await request(app).delete(`/meal-plan/${entryId}`).set('Authorization', me.header)

    expect(res.status).toBe(204)

    const remaining = await testDb.todoItem.findMany()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(soak.id)
    expect(remaining[0]?.status).toBe(TodoStatus.DONE)
    // The FK's ON DELETE SET NULL is what lets it outlive its source.
    expect(remaining[0]?.sourceEntryId).toBeNull()
  })

  it("404s on another user's entry, and it survives", async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Dal',
      servings: 1,
      caloriesPerServing: 1,
      proteinPerServing: 1,
    })
    const created = await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

    const res = await request(app)
      .delete(`/meal-plan/${created.body.entry.id}`)
      .set('Authorization', someoneElse.header)

    expect(res.status).toBe(404)
    expect(await testDb.mealPlanEntry.count()).toBe(1)
  })
})

describe('GET /meal-plan?from=&to=', () => {
  beforeEach(async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Dal',
      servings: 2,
      caloriesPerServing: 300,
      proteinPerServing: 10,
    })

    for (const date of ['2026-10-12', '2026-10-13', '2026-10-20']) {
      await addEntry(me, { date, mealType: MealType.LUNCH, recipeId: recipe.id })
    }
  })

  it('returns only entries inside the range, inclusive of both ends', async () => {
    const res = await request(app).get('/meal-plan?from=2026-10-12&to=2026-10-13').set('Authorization', me.header)

    expect(res.status).toBe(200)
    expect(res.body.items.map((i: { date: string }) => i.date.slice(0, 10))).toEqual(['2026-10-12', '2026-10-13'])
  })

  it("never shows another user's plan", async () => {
    const res = await request(app).get('/meal-plan?from=2026-10-01&to=2026-10-31').set('Authorization', someoneElse.header)

    expect(res.body.items).toEqual([])
  })

  it('422s a backwards range and an oversized one', async () => {
    const backwards = await request(app).get('/meal-plan?from=2026-10-13&to=2026-10-12').set('Authorization', me.header)
    const huge = await request(app).get('/meal-plan?from=2020-01-01&to=2026-01-01').set('Authorization', me.header)

    expect(backwards.status).toBe(422)
    expect(backwards.body.errors.to).toMatch(/not be earlier/i)
    expect(huge.status).toBe(422)
    expect(huge.body.errors.to).toMatch(/92 days or fewer/i)
  })

  it('422s when from or to is missing', async () => {
    const res = await request(app).get('/meal-plan').set('Authorization', me.header)

    expect(res.status).toBe(422)
  })
})

describe('CANCELLED todos are decisions, not noise', () => {
  const recipeWithTwoSteps = () =>
    createRecipeRow({
      ownerId: me.user.id,
      name: 'Chana Masala',
      servings: 4,
      caloriesPerServing: 420,
      proteinPerServing: 18,
      prepItems: [
        { label: 'Soak the chickpeas', leadTimeHours: 8, timing: PrepTiming.SLOT },
        { label: 'Blitz the paste', leadTimeHours: 1, timing: PrepTiming.EXACT },
      ],
    })

  it('survives regeneration, so a dismissed step does not come back from the dead', async () => {
    const recipe = await recipeWithTwoSteps()
    const created = await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app)
      .patch(`/todos/${soak.id}`)
      .set('Authorization', me.header)
      .send({ status: TodoStatus.CANCELLED })

    const entry = await testDb.mealPlanEntry.findUniqueOrThrow({
      where: { id: created.body.entry.id },
      include: { recipe: { select: { name: true, prepItems: true } } },
    })
    const { regenerateTodosForEntry } = await import('../src/services/todos.ts')
    await testDb.$transaction((tx) => regenerateTodosForEntry(tx, entry))

    const after = await testDb.todoItem.findUniqueOrThrow({ where: { id: soak.id } })

    expect(after.status).toBe(TodoStatus.CANCELLED)
    expect(await testDb.todoItem.count()).toBe(2)
  })

  it('survives the plan entry being deleted, as history alongside done ones', async () => {
    const recipe = await recipeWithTwoSteps()
    const created = await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app)
      .patch(`/todos/${soak.id}`)
      .set('Authorization', me.header)
      .send({ status: TodoStatus.CANCELLED })

    await request(app).delete(`/meal-plan/${created.body.entry.id}`).set('Authorization', me.header)

    const remaining = await testDb.todoItem.findMany()

    // The pending "blitz" todo is gone; the cancelled soak is kept.
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.status).toBe(TodoStatus.CANCELLED)
    expect(remaining[0]?.sourceEntryId).toBeNull()
  })

  it('a SLOT soak lands before bed the night before for a lunch', async () => {
    const recipe = await recipeWithTwoSteps()

    await addEntry(me, { date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

    const todos = await testDb.todoItem.findMany({ orderBy: { dueAt: 'asc' } })

    // Soak: SLOT, 8h minimum → Monday 21:30, not Tuesday 05:00.
    expect(todos[0]?.label).toMatch(/^Soak/)
    expect(todos[0]?.dueAt.toISOString()).toBe('2026-10-12T21:30:00.000Z')
    // Blitz: EXACT, 1h → Tuesday 12:00, an hour before the meal.
    expect(todos[1]?.label).toMatch(/^Blitz/)
    expect(todos[1]?.dueAt.toISOString()).toBe('2026-10-13T12:00:00.000Z')
  })

  it('the same soak lands that morning for a dinner', async () => {
    const recipe = await recipeWithTwoSteps()

    await addEntry(me, { date: '2026-10-13', mealType: MealType.DINNER, recipeId: recipe.id })

    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })

    expect(soak.dueAt.toISOString()).toBe('2026-10-13T09:00:00.000Z')
  })
})
