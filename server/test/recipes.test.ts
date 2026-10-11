import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { Role, Unit } from '../generated/prisma/enums.ts'
import { createIngredients, resetDb, testDb } from './helpers/db.ts'
import { authAs } from './helpers/auth.ts'

const app = createApp()

let owner: Awaited<ReturnType<typeof authAs>>
let other: Awaited<ReturnType<typeof authAs>>
let admin: Awaited<ReturnType<typeof authAs>>
let ingredientIds: string[]

beforeEach(async () => {
  await resetDb()
  owner = await authAs('owner@example.com')
  other = await authAs('other@example.com')
  admin = await authAs('admin@example.com', [Role.USER, Role.ADMIN])
  ingredientIds = (await createIngredients(['Chickpeas', 'Onion', 'Cumin'])).map((row) => row.id)
})

afterAll(() => testDb.$disconnect())

const validBody = () => ({
  name: 'Chana Masala',
  servings: 4,
  caloriesPerServing: 420,
  proteinPerServing: 18,
  carbsPerServing: 62,
  fatPerServing: 10,
  isPublic: true,
  ingredients: [
    { ingredientId: ingredientIds[0], quantity: 300, unit: Unit.GRAM },
    { ingredientId: ingredientIds[1], quantity: 2, unit: Unit.PIECE },
  ],
  prepItems: [{ label: 'Soak the chickpeas', leadTimeHours: 12 }],
})

const createRecipe = async (as: typeof owner, overrides: Record<string, unknown> = {}) => {
  const res = await request(app).post('/recipes').set('Authorization', as.header).send({ ...validBody(), ...overrides })

  expect(res.status).toBe(201)
  return res.body.recipe as { id: string; name: string }
}

describe('auth is required', () => {
  it.each([
    ['get', '/recipes'],
    ['get', '/ingredients'],
    ['post', '/recipes'],
  ])('%s %s 401s without a token', async (method, path) => {
    const res = await (method === 'get' ? request(app).get(path) : request(app).post(path).send({}))

    expect(res.status).toBe(401)
  })
})

describe('POST /recipes', () => {
  it('creates the recipe with its ingredients and prep items', async () => {
    const res = await request(app).post('/recipes').set('Authorization', owner.header).send(validBody())

    expect(res.status).toBe(201)
    expect(res.body.recipe).toMatchObject({ name: 'Chana Masala', servings: 4 })
    expect(res.body.recipe.ingredients).toHaveLength(2)
    expect(res.body.recipe.prepItems).toEqual([
      expect.objectContaining({ label: 'Soak the chickpeas', leadTimeHours: 12 }),
    ])
    expect(res.body.recipe.createdBy.id).toBe(owner.user.id)
  })

  it('defaults prepItems to empty and isPublic to false', async () => {
    const body = validBody()
    delete (body as Record<string, unknown>).prepItems
    delete (body as Record<string, unknown>).isPublic

    const res = await request(app).post('/recipes').set('Authorization', owner.header).send(body)

    expect(res.status).toBe(201)
    expect(res.body.recipe.prepItems).toEqual([])
    expect(res.body.recipe.isPublic).toBe(false)
  })

  it('returns the 422 field-error shape on a bad payload', async () => {
    const res = await request(app)
      .post('/recipes')
      .set('Authorization', owner.header)
      .send({ name: '', servings: 0, caloriesPerServing: -5, proteinPerServing: 1, ingredients: [] })

    expect(res.status).toBe(422)
    expect(res.body.message).toBe('Validation failed')
    expect(res.body.errors.name).toMatch(/required/i)
    expect(res.body.errors.servings).toMatch(/at least 1/i)
    expect(res.body.errors.caloriesPerServing).toMatch(/negative/i)
    expect(res.body.errors.ingredients).toMatch(/at least one ingredient/i)
  })

  it('rejects the same ingredient listed twice', async () => {
    const body = validBody()
    body.ingredients = [
      { ingredientId: ingredientIds[0], quantity: 1, unit: Unit.GRAM },
      { ingredientId: ingredientIds[0], quantity: 2, unit: Unit.GRAM },
    ]

    const res = await request(app).post('/recipes').set('Authorization', owner.header).send(body)

    expect(res.status).toBe(422)
    expect(res.body.errors.ingredients).toMatch(/only be listed once/i)
  })

  it('rejects an unknown ingredient id as 422, not a 500 from the foreign key', async () => {
    const body = validBody()
    body.ingredients = [{ ingredientId: 'does-not-exist', quantity: 1, unit: Unit.GRAM }]

    const res = await request(app).post('/recipes').set('Authorization', owner.header).send(body)

    expect(res.status).toBe(422)
    expect(res.body.errors.ingredients).toMatch(/Unknown ingredient id/i)
  })

  it('writes nothing when validation fails', async () => {
    await request(app).post('/recipes').set('Authorization', owner.header).send({ name: 'Broken' })

    expect(await testDb.recipe.count()).toBe(0)
  })
})

describe('GET /recipes', () => {
  it('returns the pagination envelope', async () => {
    await createRecipe(owner, { name: 'A' })
    await createRecipe(owner, { name: 'B' })

    const res = await request(app).get('/recipes?page=1&pageSize=1').set('Authorization', owner.header)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2, hasMore: true })
    expect(res.body.items).toHaveLength(1)
  })

  it('caps pageSize so ?pageSize=100000 cannot be used as a hammer', async () => {
    const res = await request(app).get('/recipes?pageSize=100000').set('Authorization', owner.header)

    expect(res.status).toBe(422)
    expect(res.body.errors.pageSize).toBeDefined()
  })

  it('filters by ?q= case-insensitively', async () => {
    await createRecipe(owner, { name: 'Chana Masala' })
    await createRecipe(owner, { name: 'Lentil Dal' })

    const res = await request(app).get('/recipes?q=chana').set('Authorization', owner.header)

    expect(res.body.items.map((r: { name: string }) => r.name)).toEqual(['Chana Masala'])
  })

  it('?ingredientIds= requires ALL of them, not any', async () => {
    await createRecipe(owner, {
      name: 'Has both',
      ingredients: [
        { ingredientId: ingredientIds[0], quantity: 1, unit: Unit.GRAM },
        { ingredientId: ingredientIds[1], quantity: 1, unit: Unit.PIECE },
      ],
    })
    await createRecipe(owner, {
      name: 'Has one',
      ingredients: [{ ingredientId: ingredientIds[0], quantity: 1, unit: Unit.GRAM }],
    })

    const both = await request(app)
      .get(`/recipes?ingredientIds=${ingredientIds[0]},${ingredientIds[1]}`)
      .set('Authorization', owner.header)

    expect(both.body.items.map((r: { name: string }) => r.name)).toEqual(['Has both'])

    const one = await request(app).get(`/recipes?ingredientIds=${ingredientIds[0]}`).set('Authorization', owner.header)

    expect(one.body.total).toBe(2)
  })

  it('hides other people’s private recipes, and keeps `total` honest about it', async () => {
    await createRecipe(owner, { name: 'Private', isPublic: false })
    await createRecipe(owner, { name: 'Public', isPublic: true })

    const mine = await request(app).get('/recipes').set('Authorization', owner.header)
    const theirs = await request(app).get('/recipes').set('Authorization', other.header)

    expect(mine.body.total).toBe(2)
    expect(theirs.body.total).toBe(1)
    expect(theirs.body.items.map((r: { name: string }) => r.name)).toEqual(['Public'])
  })
})

describe('GET /recipes/:id', () => {
  it('returns the full recipe with ingredient details', async () => {
    const created = await createRecipe(owner)

    const res = await request(app).get(`/recipes/${created.id}`).set('Authorization', owner.header)

    expect(res.status).toBe(200)
    expect(res.body.recipe.ingredients[0].ingredient).toMatchObject({ name: expect.any(String) })
  })

  it('404s for an unknown id', async () => {
    const res = await request(app).get('/recipes/nope').set('Authorization', owner.header)

    expect(res.status).toBe(404)
  })

  it("404s — not 403 — for someone else's private recipe, so ids cannot be probed", async () => {
    const created = await createRecipe(owner, { isPublic: false })

    const res = await request(app).get(`/recipes/${created.id}`).set('Authorization', other.header)

    expect(res.status).toBe(404)
  })
})

describe('PUT /recipes/:id', () => {
  it('replaces the recipe, its ingredients and its prep items', async () => {
    const created = await createRecipe(owner)

    const res = await request(app)
      .put(`/recipes/${created.id}`)
      .set('Authorization', owner.header)
      .send({
        ...validBody(),
        name: 'Renamed',
        ingredients: [{ ingredientId: ingredientIds[2], quantity: 5, unit: Unit.GRAM }],
        prepItems: [],
      })

    expect(res.status).toBe(200)
    expect(res.body.recipe.name).toBe('Renamed')
    expect(res.body.recipe.ingredients).toHaveLength(1)
    expect(res.body.recipe.prepItems).toEqual([])
    // Replaced, not accumulated.
    expect(await testDb.recipeIngredient.count({ where: { recipeId: created.id } })).toBe(1)
    expect(await testDb.prepItem.count({ where: { recipeId: created.id } })).toBe(0)
  })

  it("403s when it is not yours", async () => {
    const created = await createRecipe(owner)

    const res = await request(app).put(`/recipes/${created.id}`).set('Authorization', other.header).send(validBody())

    expect(res.status).toBe(403)
  })

  it('lets an admin through', async () => {
    const created = await createRecipe(owner)

    const res = await request(app)
      .put(`/recipes/${created.id}`)
      .set('Authorization', admin.header)
      .send({ ...validBody(), name: 'Admin edited' })

    expect(res.status).toBe(200)
    expect(res.body.recipe.name).toBe('Admin edited')
  })

  it('leaves the recipe untouched when the new payload is invalid', async () => {
    const created = await createRecipe(owner)

    await request(app).put(`/recipes/${created.id}`).set('Authorization', owner.header).send({ name: '' })

    const unchanged = await testDb.recipe.findUnique({ where: { id: created.id } })
    expect(unchanged?.name).toBe('Chana Masala')
    expect(await testDb.recipeIngredient.count({ where: { recipeId: created.id } })).toBe(2)
  })
})

describe('DELETE /recipes/:id — owner or admin only', () => {
  it('lets the owner delete, cascading to ingredients and prep items', async () => {
    const created = await createRecipe(owner)

    const res = await request(app).delete(`/recipes/${created.id}`).set('Authorization', owner.header)

    expect(res.status).toBe(204)
    expect(await testDb.recipe.count()).toBe(0)
    expect(await testDb.recipeIngredient.count()).toBe(0)
    expect(await testDb.prepItem.count()).toBe(0)
  })

  it('403s another signed-in user, and the recipe survives', async () => {
    const created = await createRecipe(owner)

    const res = await request(app).delete(`/recipes/${created.id}`).set('Authorization', other.header)

    expect(res.status).toBe(403)
    expect(await testDb.recipe.count()).toBe(1)
  })

  it('lets an admin delete it', async () => {
    const created = await createRecipe(owner)

    const res = await request(app).delete(`/recipes/${created.id}`).set('Authorization', admin.header)

    expect(res.status).toBe(204)
  })

  it('404s an unknown id', async () => {
    const res = await request(app).delete('/recipes/nope').set('Authorization', owner.header)

    expect(res.status).toBe(404)
  })

  it('does not delete the catalogue ingredients themselves', async () => {
    const created = await createRecipe(owner)

    await request(app).delete(`/recipes/${created.id}`).set('Authorization', owner.header)

    expect(await testDb.ingredient.count()).toBe(3)
  })
})

describe('GET /ingredients', () => {
  it('returns the catalogue ordered by category then name', async () => {
    const res = await request(app).get('/ingredients').set('Authorization', owner.header)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(3)
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Chickpeas', 'Cumin', 'Onion'])
  })

  it('filters by ?q=', async () => {
    const res = await request(app).get('/ingredients?q=onio').set('Authorization', owner.header)

    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Onion'])
  })
})

describe('admin visibility', () => {
  // Without this, an admin gets 404 reading a private recipe they are
  // nonetheless allowed to DELETE — a contradiction a moderator would hit on
  // their first day.
  it("can read another user's private recipe, matching its power to delete it", async () => {
    const created = await createRecipe(owner, { isPublic: false })

    const read = await request(app).get(`/recipes/${created.id}`).set('Authorization', admin.header)
    const del = await request(app).delete(`/recipes/${created.id}`).set('Authorization', admin.header)

    expect(read.status).toBe(200)
    expect(del.status).toBe(204)
  })

  it('sees private recipes in the list too', async () => {
    await createRecipe(owner, { name: 'Secret', isPublic: false })

    const asAdmin = await request(app).get('/recipes').set('Authorization', admin.header)
    const asOther = await request(app).get('/recipes').set('Authorization', other.header)

    expect(asAdmin.body.items.map((r: { name: string }) => r.name)).toContain('Secret')
    expect(asOther.body.total).toBe(0)
  })
})
