import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.ts'
import { Role } from '../../generated/prisma/enums.ts'
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
