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

/**
 * Plans one Chana Masala for Tuesday lunch, which generates two todos:
 *   soak  (12h before 13:00) → Tue 01:00
 *   paste (1h  before 13:00) → Tue 12:00
 */
const planTuesdayLunch = async () => {
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

  await request(app)
    .post('/meal-plan')
    .set('Authorization', me.header)
    .send({ date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

  return recipe
}

describe('GET /todos', () => {
  it('returns the generated todos in due order', async () => {
    await planTuesdayLunch()

    const res = await request(app).get('/todos').set('Authorization', me.header)

    expect(res.status).toBe(200)
    expect(res.body.items.map((t: { label: string }) => t.label)).toEqual([
      'Soak the chickpeas — Chana Masala',
      'Blitz the paste — Chana Masala',
    ])
  })

  it('filters on dueAt, not on the date of the meal', async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Beans',
      servings: 2,
      caloriesPerServing: 200,
      proteinPerServing: 8,
      // 20 hours before Tuesday lunch (13:00) is Monday 17:00.
      prepItems: [{ label: 'Soak the beans', leadTimeHours: 20 }],
    })

    await request(app)
      .post('/meal-plan')
      .set('Authorization', me.header)
      .send({ date: '2026-10-13', mealType: MealType.LUNCH, recipeId: recipe.id })

    // The meal is Tuesday, but the job is Monday's — so asking for Monday
    // must find it. This is the whole point of the prep-timer feature.
    const monday = await request(app).get('/todos?from=2026-10-12&to=2026-10-12').set('Authorization', me.header)
    const tuesday = await request(app).get('/todos?from=2026-10-13&to=2026-10-13').set('Authorization', me.header)

    expect(monday.body.items).toHaveLength(1)
    expect(monday.body.items[0].dueAt).toBe('2026-10-12T17:00:00.000Z')
    expect(tuesday.body.items).toHaveLength(0)
  })

  it('includes the whole "to" day, not just its midnight', async () => {
    await planTuesdayLunch()

    // Both todos are on the 13th — one at 01:00, one at 12:00. A naive
    // `lte: midnight` would drop the 12:00 one.
    const res = await request(app).get('/todos?from=2026-10-13&to=2026-10-13').set('Authorization', me.header)

    expect(res.body.items).toHaveLength(2)
  })

  it('?status=PENDING asks for just what is outstanding', async () => {
    await planTuesdayLunch()
    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app).patch(`/todos/${soak.id}`).set('Authorization', me.header).send({ status: TodoStatus.DONE })

    const all = await request(app).get('/todos').set('Authorization', me.header)
    const pending = await request(app).get('/todos?status=PENDING').set('Authorization', me.header)
    const done = await request(app).get('/todos?status=DONE').set('Authorization', me.header)

    // No filter means everything, including resolved — a history view.
    expect(all.body.items).toHaveLength(2)
    expect(pending.body.items).toHaveLength(1)
    expect(pending.body.items[0].label).toMatch(/^Blitz/)
    expect(done.body.items).toHaveLength(1)
    expect(done.body.items[0].label).toMatch(/^Soak/)
  })

  it('hides cancelled todos from the pending list without deleting them', async () => {
    await planTuesdayLunch()
    const soak = await testDb.todoItem.findFirstOrThrow({ where: { label: { startsWith: 'Soak' } } })
    await request(app)
      .patch(`/todos/${soak.id}`)
      .set('Authorization', me.header)
      .send({ status: TodoStatus.CANCELLED })

    const pending = await request(app).get('/todos?status=PENDING').set('Authorization', me.header)
    const cancelled = await request(app).get('/todos?status=CANCELLED').set('Authorization', me.header)

    expect(pending.body.items.map((t: { label: string }) => t.label)).toEqual(['Blitz the paste — Chana Masala'])
    expect(cancelled.body.items).toHaveLength(1)
    expect(await testDb.todoItem.count()).toBe(2)
  })

  it('422s an unknown ?status=', async () => {
    const res = await request(app).get('/todos?status=MAYBE').set('Authorization', me.header)

    expect(res.status).toBe(422)
  })

  it('leaves an overdue todo on the list — nothing expires it', async () => {
    const recipe = await createRecipeRow({
      ownerId: me.user.id,
      name: 'Beans',
      servings: 2,
      caloriesPerServing: 200,
      proteinPerServing: 8,
      prepItems: [{ label: 'Soak the beans', leadTimeHours: 8, timing: PrepTiming.SLOT }],
    })

    // A meal in the past: its prep time is long gone.
    await request(app)
      .post('/meal-plan')
      .set('Authorization', me.header)
      .send({ date: '2020-01-02', mealType: MealType.LUNCH, recipeId: recipe.id })

    const res = await request(app).get('/todos?status=PENDING').set('Authorization', me.header)

    expect(res.body.items).toHaveLength(1)
    expect(new Date(res.body.items[0].dueAt).getTime()).toBeLessThan(Date.now())
  })

  it("never shows another user's todos", async () => {
    await planTuesdayLunch()

    const res = await request(app).get('/todos').set('Authorization', someoneElse.header)

    expect(res.body.items).toEqual([])
  })

  it('401s without a token', async () => {
    expect((await request(app).get('/todos')).status).toBe(401)
  })
})

describe('PATCH /todos/:id', () => {
  it('ticks a todo and stamps completedAt', async () => {
    await planTuesdayLunch()
    const todo = await testDb.todoItem.findFirstOrThrow()

    const res = await request(app).patch(`/todos/${todo.id}`).set('Authorization', me.header).send({ status: TodoStatus.DONE })

    expect(res.status).toBe(200)
    expect(res.body.todo.status).toBe(TodoStatus.DONE)
    expect(res.body.todo.completedAt).not.toBeNull()
  })

  it('unticks it again and clears completedAt', async () => {
    await planTuesdayLunch()
    const todo = await testDb.todoItem.findFirstOrThrow()

    await request(app).patch(`/todos/${todo.id}`).set('Authorization', me.header).send({ status: TodoStatus.DONE })
    const res = await request(app).patch(`/todos/${todo.id}`).set('Authorization', me.header).send({ status: TodoStatus.PENDING })

    expect(res.body.todo.status).toBe(TodoStatus.PENDING)
    expect(res.body.todo.completedAt).toBeNull()
  })

  it('422s when status is missing or not one of the three', async () => {
    await planTuesdayLunch()
    const todo = await testDb.todoItem.findFirstOrThrow()

    const missing = await request(app).patch(`/todos/${todo.id}`).set('Authorization', me.header).send({})
    const bogus = await request(app)
      .patch(`/todos/${todo.id}`)
      .set('Authorization', me.header)
      .send({ status: 'MAYBE' })

    expect(missing.status).toBe(422)
    expect(bogus.status).toBe(422)
    expect(bogus.body.errors.status).toMatch(/PENDING, DONE or CANCELLED/i)
  })

  it('cancels a todo and stamps cancelledAt, leaving completedAt null', async () => {
    await planTuesdayLunch()
    const todo = await testDb.todoItem.findFirstOrThrow()

    const res = await request(app)
      .patch(`/todos/${todo.id}`)
      .set('Authorization', me.header)
      .send({ status: TodoStatus.CANCELLED })

    expect(res.status).toBe(200)
    expect(res.body.todo.status).toBe(TodoStatus.CANCELLED)
    expect(res.body.todo.cancelledAt).not.toBeNull()
    expect(res.body.todo.completedAt).toBeNull()
  })

  it('never claims a todo was both completed and cancelled', async () => {
    await planTuesdayLunch()
    const todo = await testDb.todoItem.findFirstOrThrow()
    const patch = (status: TodoStatus) =>
      request(app).patch(`/todos/${todo.id}`).set('Authorization', me.header).send({ status })

    await patch(TodoStatus.DONE)
    const afterCancel = await patch(TodoStatus.CANCELLED)
    const afterReopen = await patch(TodoStatus.PENDING)

    expect(afterCancel.body.todo.completedAt).toBeNull()
    expect(afterCancel.body.todo.cancelledAt).not.toBeNull()
    expect(afterReopen.body.todo.completedAt).toBeNull()
    expect(afterReopen.body.todo.cancelledAt).toBeNull()
  })

  it('ignores attempts to rewrite the label or dueAt', async () => {
    await planTuesdayLunch()
    const todo = await testDb.todoItem.findFirstOrThrow()

    await request(app)
      .patch(`/todos/${todo.id}`)
      .set('Authorization', me.header)
      .send({ status: TodoStatus.DONE, label: 'hacked', dueAt: '2000-01-01T00:00:00Z' })

    const after = await testDb.todoItem.findUniqueOrThrow({ where: { id: todo.id } })

    expect(after.label).toBe(todo.label)
    expect(after.dueAt.toISOString()).toBe(todo.dueAt.toISOString())
  })

  it("404s on another user's todo, and it is untouched", async () => {
    await planTuesdayLunch()
    const todo = await testDb.todoItem.findFirstOrThrow()

    const res = await request(app)
      .patch(`/todos/${todo.id}`)
      .set('Authorization', someoneElse.header)
      .send({ status: TodoStatus.DONE })

    expect(res.status).toBe(404)
    expect((await testDb.todoItem.findUniqueOrThrow({ where: { id: todo.id } })).status).toBe(TodoStatus.PENDING)
  })

  it('404s an unknown id', async () => {
    const res = await request(app).patch('/todos/nope').set('Authorization', me.header).send({ status: TodoStatus.DONE })

    expect(res.status).toBe(404)
  })
})
