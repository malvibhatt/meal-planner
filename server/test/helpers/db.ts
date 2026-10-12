import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.ts'
import { IngredientCategory, PrepTiming, Role, Unit } from '../../generated/prisma/enums.ts'
import { hashPassword } from '../../src/auth/password.ts'

/** Its own client, pointed at the test database by vitest.config.ts. */
export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }),
  log: ['warn', 'error'],
})

/**
 * Empties every table. One statement, so the foreign keys never see a
 * half-deleted graph, and RESTART IDENTITY keeps sequences from drifting.
 */
export async function resetDb(): Promise<void> {
  await testDb.$executeRawUnsafe(`
    TRUNCATE TABLE
      "TodoItem", "PantryItem", "MealPlanEntry",
      "RecipeIngredient", "PrepItem", "Recipe",
      "Ingredient", "User"
    RESTART IDENTITY CASCADE
  `)
}

/** A real user row, hashed the same way register does it. */
export async function createUser(overrides: {
  email: string
  password: string
  name?: string
  roles?: Role[]
}) {
  return testDb.user.create({
    data: {
      email: overrides.email,
      name: overrides.name ?? 'Test User',
      passwordHash: await hashPassword(overrides.password),
      roles: overrides.roles ?? [Role.USER],
    },
  })
}

/** A minimal ingredient catalogue for tests that need real ingredient ids. */
export async function createIngredients(names: string[]) {
  return Promise.all(
    names.map((name, index) =>
      testDb.ingredient.create({
        data: {
          name,
          defaultUnit: index % 2 === 0 ? Unit.GRAM : Unit.PIECE,
          category: IngredientCategory.OTHER,
        },
      }),
    ),
  )
}

/** A recipe with ingredients and prep items, built directly for speed. */
export async function createRecipeRow(input: {
  ownerId: string
  name: string
  servings: number
  caloriesPerServing: number
  proteinPerServing: number
  carbsPerServing?: number | null
  fatPerServing?: number | null
  ingredients?: { ingredientId: string; quantity: number; unit: Unit }[]
  prepItems?: { label: string; leadTimeHours: number; timing?: PrepTiming }[]
}) {
  return testDb.recipe.create({
    data: {
      name: input.name,
      servings: input.servings,
      caloriesPerServing: input.caloriesPerServing,
      proteinPerServing: input.proteinPerServing,
      carbsPerServing: input.carbsPerServing ?? null,
      fatPerServing: input.fatPerServing ?? null,
      isPublic: true,
      createdById: input.ownerId,
      ingredients: { create: input.ingredients ?? [] },
      prepItems: {
        create: (input.prepItems ?? []).map((prep) => ({ ...prep, timing: prep.timing ?? PrepTiming.EXACT })),
      },
    },
    include: { prepItems: true, ingredients: true },
  })
}
