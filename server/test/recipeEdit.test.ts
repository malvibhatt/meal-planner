import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { MealType, PrepTiming, TodoStatus, Unit } from '../generated/prisma/enums.ts'
import { createIngredients, createRecipeRow, resetDb, testDb } from './helpers/db.ts'
import { authAs } from './helpers/auth.ts'

const app = createApp()

let owner: Awaited<ReturnType<typeof authAs>>
let planner: Awaited<ReturnType<typeof authAs>>
let chickpeas: string

beforeEach(async () => {
  await resetDb()
  owner = await authAs('owner@example.com')
  planner = await authAs('planner@example.com')
  chickpeas = (await createIngredients(['Chickpeas']))[0]!.id
})

afterAll(() => testDb.$disconnect())

/** A recipe with one SLOT soak and one EXACT step, planned by `planner`. */
async function setup() {
  const recipe = await createRecipeRow({
    ownerId: owner.user.id,
    name: 'Chana Masala',
    servings: 4,
    caloriesPerServing: 420,
    proteinPerServing: 18,
    ingredients: [{ ingredientId: chickpeas, quantity: 300, unit: Unit.GRAM }],
    prepItems: [
      { label: 'Soak the chickpeas', leadTimeHours: 8, timing: PrepTiming.SLOT },
      { label: 'Blitz the paste', leadTimeHours: 1, timing: PrepTiming.EXACT },
    ],
  })

  await request(app)
    .post('/meal-plan')
    .set('Authorization', planner.header)
    .send({ date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

  return recipe
}

/** The recipe as the edit form would receive it — prep items with their ids. */
async function readForEditing(recipeId: string, as: typeof owner) {
  const res = await request(app).get(`/recipes/${recipeId}`).set('Authorization', as.header)

  expect(res.status).toBe(200)
  return res.body.recipe as {
    id: string
    prepItems: { id: string; label: string; leadTimeHours: number; timing: PrepTiming }[]
  }
}

const putBody = (prepItems: unknown[]) => ({
  name: 'Chana Masala',
  servings: 4,
  caloriesPerServing: 420,
  proteinPerServing: 18,
  ingredients: [{ ingredientId: chickpeas, quantity: 300, unit: Unit.GRAM }],
  prepItems,
})

describe('GET /recipes/:id gives the form what it needs to round-trip', () => {
  it('returns prep steps with their ids', async () => {
    const recipe = await setup()

    const read = await readForEditing(recipe.id, owner)

    expect(read.prepItems).toHaveLength(2)
    for (const prep of read.prepItems) {
      expect(prep.id).toBeTypeOf('string')
      expect(prep.timing).toBeTypeOf('string')
    }
  })
})

describe('a resolved todo survives a recipe edit', () => {
  it('keeps a ticked todo ticked', async () => {
    const recipe = await setup()
    const soakTodo = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app)
      .patch(`/todos/${soakTodo.id}`)
      .set('Authorization', planner.header)
      .send({ status: TodoStatus.DONE })

    const read = await readForEditing(recipe.id, owner)
    const res = await request(app)
      .put(`/recipes/${recipe.id}`)
      .set('Authorization', owner.header)
      .send(putBody(read.prepItems))

    expect(res.status).toBe(200)

    const after = await testDb.todoItem.findUniqueOrThrow({ where: { id: soakTodo.id } })
    expect(after.status).toBe(TodoStatus.DONE)
    expect(after.completedAt).not.toBeNull()
    expect(await testDb.todoItem.count()).toBe(2)
  })

  it('keeps a cancelled todo cancelled, so a dismissal is not undone by an edit', async () => {
    const recipe = await setup()
    const soakTodo = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app)
      .patch(`/todos/${soakTodo.id}`)
      .set('Authorization', planner.header)
      .send({ status: TodoStatus.CANCELLED })

    const read = await readForEditing(recipe.id, owner)
    await request(app)
      .put(`/recipes/${recipe.id}`)
      .set('Authorization', owner.header)
      .send(putBody(read.prepItems))

    const after = await testDb.todoItem.findUniqueOrThrow({ where: { id: soakTodo.id } })
    expect(after.status).toBe(TodoStatus.CANCELLED)
    expect(after.cancelledAt).not.toBeNull()
  })

  it('keeps the same PrepItem rows rather than recreating them', async () => {
    const recipe = await setup()
    const before = await testDb.prepItem.findMany({ where: { recipeId: recipe.id }, select: { id: true } })

    const read = await readForEditing(recipe.id, owner)
    await request(app)
      .put(`/recipes/${recipe.id}`)
      .set('Authorization', owner.header)
      .send(putBody(read.prepItems))

    const after = await testDb.prepItem.findMany({ where: { recipeId: recipe.id }, select: { id: true } })

    expect(after.map((p) => p.id).sort()).toEqual(before.map((p) => p.id).sort())
  })
})

describe('edits propagate to the todos that derive from them', () => {
  it('moves dueAt when the lead time changes, without losing the status', async () => {
    const recipe = await setup()
    const soakTodo = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app)
      .patch(`/todos/${soakTodo.id}`)
      .set('Authorization', planner.header)
      .send({ status: TodoStatus.DONE })

    // 8h SLOT for Tuesday lunch was Monday 21:30. Raise it to 20h and the
    // only slot early enough is Monday 09:00.
    expect(soakTodo.dueAt.toISOString()).toBe('2026-10-12T21:30:00.000Z')

    const read = await readForEditing(recipe.id, owner)
    const prepItems = read.prepItems.map((prep) =>
      prep.label.startsWith('Soak') ? { ...prep, leadTimeHours: 20 } : prep,
    )

    await request(app).put(`/recipes/${recipe.id}`).set('Authorization', owner.header).send(putBody(prepItems))

    const after = await testDb.todoItem.findUniqueOrThrow({ where: { id: soakTodo.id } })

    expect(after.dueAt.toISOString()).toBe('2026-10-12T09:00:00.000Z')
    expect(after.status).toBe(TodoStatus.DONE)
  })

  it('switches a step from SLOT to EXACT and reschedules accordingly', async () => {
    const recipe = await setup()
    const read = await readForEditing(recipe.id, owner)
    const prepItems = read.prepItems.map((prep) =>
      prep.label.startsWith('Soak') ? { ...prep, timing: PrepTiming.EXACT } : prep,
    )

    await request(app).put(`/recipes/${recipe.id}`).set('Authorization', owner.header).send(putBody(prepItems))

    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })

    // EXACT 8h before Tuesday 13:00 is Tuesday 05:00 — a literal offset again.
    expect(soak.dueAt.toISOString()).toBe('2026-10-13T05:00:00.000Z')
  })

  it('relabels the todo when the step is renamed', async () => {
    const recipe = await setup()
    const read = await readForEditing(recipe.id, owner)
    const prepItems = read.prepItems.map((prep) =>
      prep.label.startsWith('Soak') ? { ...prep, label: 'Soak the chickpeas overnight' } : prep,
    )

    await request(app).put(`/recipes/${recipe.id}`).set('Authorization', owner.header).send(putBody(prepItems))

    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })

    expect(soak.label).toBe('Soak the chickpeas overnight — Chana Masala')
  })

  it("rebuilds another user's todos too, since a public recipe can be in anyone's plan", async () => {
    const recipe = await setup()
    const todosBefore = await testDb.todoItem.findMany({ where: { userId: planner.user.id } })
    expect(todosBefore).toHaveLength(2)

    const read = await readForEditing(recipe.id, owner)
    const prepItems = read.prepItems.map((prep) =>
      prep.label.startsWith('Blitz') ? { ...prep, leadTimeHours: 3 } : prep,
    )

    await request(app).put(`/recipes/${recipe.id}`).set('Authorization', owner.header).send(putBody(prepItems))

    const blitz = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Blitz' } } })

    expect(blitz.userId).toBe(planner.user.id)
    expect(blitz.dueAt.toISOString()).toBe('2026-10-13T10:00:00.000Z')
  })
})

describe('adding and removing steps', () => {
  it('a step sent without an id is created, and gets its own todo', async () => {
    const recipe = await setup()
    const read = await readForEditing(recipe.id, owner)

    await request(app)
      .put(`/recipes/${recipe.id}`)
      .set('Authorization', owner.header)
      .send(putBody([...read.prepItems, { label: 'Toast the spices', leadTimeHours: 1, timing: PrepTiming.EXACT }]))

    expect(await testDb.prepItem.count({ where: { recipeId: recipe.id } })).toBe(3)
    const todos = await testDb.todoItem.findMany({ orderBy: { label: 'asc' } })
    expect(todos.map((t) => t.label)).toContain('Toast the spices — Chana Masala')
    expect(todos).toHaveLength(3)
  })

  it('a step left out is deleted, taking only its PENDING todo with it', async () => {
    const recipe = await setup()
    const soakTodo = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app)
      .patch(`/todos/${soakTodo.id}`)
      .set('Authorization', planner.header)
      .send({ status: TodoStatus.DONE })

    const read = await readForEditing(recipe.id, owner)
    // Drop both steps: the soak's todo is DONE, the blitz's is PENDING.
    await request(app).put(`/recipes/${recipe.id}`).set('Authorization', owner.header).send(putBody([]))

    expect(read.prepItems).toHaveLength(2)
    expect(await testDb.prepItem.count({ where: { recipeId: recipe.id } })).toBe(0)

    const remaining = await testDb.todoItem.findMany()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(soakTodo.id)
    expect(remaining[0]?.status).toBe(TodoStatus.DONE)
    // Its prep item is gone, so the FK nulled the pointer.
    expect(remaining[0]?.sourcePrepItemId).toBeNull()
  })
})

describe('prep-step ids are validated, not trusted', () => {
  it("422s an id belonging to a different recipe, and that recipe is untouched", async () => {
    const mine = await setup()
    const theirs = await createRecipeRow({
      ownerId: owner.user.id,
      name: 'Black Bean Chilli',
      servings: 6,
      caloriesPerServing: 390,
      proteinPerServing: 20,
      ingredients: [{ ingredientId: chickpeas, quantity: 400, unit: Unit.GRAM }],
      prepItems: [{ label: 'Soak the black beans', leadTimeHours: 8, timing: PrepTiming.SLOT }],
    })
    const stranger = await testDb.prepItem.findFirstOrThrow({ where: { recipeId: theirs.id } })

    const res = await request(app)
      .put(`/recipes/${mine.id}`)
      .set('Authorization', owner.header)
      .send(putBody([{ id: stranger.id, label: 'Stolen step', leadTimeHours: 2, timing: PrepTiming.EXACT }]))

    expect(res.status).toBe(422)
    expect(res.body.errors.prepItems).toMatch(/Unknown prep step id/i)

    // The other recipe still owns its step, with its original label.
    const untouched = await testDb.prepItem.findUniqueOrThrow({ where: { id: stranger.id } })
    expect(untouched.recipeId).toBe(theirs.id)
    expect(untouched.label).toBe('Soak the black beans')
  })

  it('422s an id that does not exist at all', async () => {
    const recipe = await setup()

    const res = await request(app)
      .put(`/recipes/${recipe.id}`)
      .set('Authorization', owner.header)
      .send(putBody([{ id: 'nope', label: 'Ghost step', leadTimeHours: 1, timing: PrepTiming.EXACT }]))

    expect(res.status).toBe(422)
  })

  it('422s the same id twice in one payload', async () => {
    const recipe = await setup()
    const read = await readForEditing(recipe.id, owner)
    const first = read.prepItems[0]!

    const res = await request(app)
      .put(`/recipes/${recipe.id}`)
      .set('Authorization', owner.header)
      .send(putBody([first, { ...first, label: 'Duplicate' }]))

    expect(res.status).toBe(422)
    expect(res.body.errors.prepItems).toMatch(/only appear once/i)
  })

  it('leaves everything untouched when validation fails', async () => {
    const recipe = await setup()
    const before = await testDb.prepItem.findMany({ where: { recipeId: recipe.id } })

    await request(app)
      .put(`/recipes/${recipe.id}`)
      .set('Authorization', owner.header)
      .send(putBody([{ id: 'nope', label: 'Ghost', leadTimeHours: 1, timing: PrepTiming.EXACT }]))

    const after = await testDb.prepItem.findMany({ where: { recipeId: recipe.id } })

    expect(after).toHaveLength(before.length)
    expect(await testDb.todoItem.count()).toBe(2)
  })
})

describe('POST /recipes does not accept prep-step ids', () => {
  it('ignores a client-supplied id and assigns its own', async () => {
    const res = await request(app)
      .post('/recipes')
      .set('Authorization', owner.header)
      .send({
        name: 'Injected',
        servings: 1,
        caloriesPerServing: 100,
        proteinPerServing: 1,
        ingredients: [{ ingredientId: chickpeas, quantity: 1, unit: Unit.GRAM }],
        prepItems: [{ id: 'chosen_by_client', label: 'Soak', leadTimeHours: 8, timing: PrepTiming.SLOT }],
      })

    expect(res.status).toBe(201)
    expect(res.body.recipe.prepItems[0].id).not.toBe('chosen_by_client')
    expect(await testDb.prepItem.findUnique({ where: { id: 'chosen_by_client' } })).toBeNull()
  })
})
