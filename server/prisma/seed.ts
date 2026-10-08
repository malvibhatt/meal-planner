import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'
import { IngredientCategory, Role, Unit } from '../generated/prisma/enums.ts'

/**
 * Seed data for local development.
 *
 * Idempotent by construction: every row is addressed by a stable key — a
 * unique column (ingredient name, user email) or an explicit `seed_*` id —
 * and written with `upsert`. Run it ten times and you get the same database,
 * not ten copies. Rows a previous seed created but this one no longer lists
 * are deleted, so editing the data below converges rather than accumulating.
 *
 *   npm run db:seed
 */

const prisma = new PrismaClient({
  // Deliberately not the singleton from src/db/prisma.ts: that one logs every
  // query in development, which would bury the seed's own output.
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ['warn', 'error'],
})

// Both seeded accounts share this. Printed at the end so you do not have to
// come back and read the source to log in.
const SEED_PASSWORD = 'password123'

// ---------------------------------------------------------------------------
// The global ingredient catalogue
// ---------------------------------------------------------------------------

type SeedIngredient = {
  name: string
  defaultUnit: Unit
  category: IngredientCategory
}

const INGREDIENTS: SeedIngredient[] = [
  // Produce
  { name: 'Onion', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Garlic clove', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Ginger', defaultUnit: Unit.GRAM, category: IngredientCategory.PRODUCE },
  { name: 'Tomato', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Potato', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Carrot', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Celery stick', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Red bell pepper', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Green chilli', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Spinach', defaultUnit: Unit.GRAM, category: IngredientCategory.PRODUCE },
  { name: 'Tenderstem broccoli', defaultUnit: Unit.GRAM, category: IngredientCategory.PRODUCE },
  { name: 'Mushroom', defaultUnit: Unit.GRAM, category: IngredientCategory.PRODUCE },
  { name: 'Lemon', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Lime', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },
  { name: 'Coriander', defaultUnit: Unit.GRAM, category: IngredientCategory.PRODUCE },
  { name: 'Banana', defaultUnit: Unit.PIECE, category: IngredientCategory.PRODUCE },

  // Protein
  { name: 'Chicken breast', defaultUnit: Unit.GRAM, category: IngredientCategory.PROTEIN },
  { name: 'Chicken thigh', defaultUnit: Unit.GRAM, category: IngredientCategory.PROTEIN },
  { name: 'Lamb mince', defaultUnit: Unit.GRAM, category: IngredientCategory.PROTEIN },
  { name: 'Salmon fillet', defaultUnit: Unit.GRAM, category: IngredientCategory.PROTEIN },
  { name: 'Egg', defaultUnit: Unit.PIECE, category: IngredientCategory.PROTEIN },
  { name: 'Paneer', defaultUnit: Unit.GRAM, category: IngredientCategory.PROTEIN },
  { name: 'Firm tofu', defaultUnit: Unit.GRAM, category: IngredientCategory.PROTEIN },

  // Dairy
  { name: 'Whole milk', defaultUnit: Unit.MILLILITRE, category: IngredientCategory.DAIRY },
  { name: 'Greek yoghurt', defaultUnit: Unit.GRAM, category: IngredientCategory.DAIRY },
  { name: 'Butter', defaultUnit: Unit.GRAM, category: IngredientCategory.DAIRY },
  { name: 'Cheddar', defaultUnit: Unit.GRAM, category: IngredientCategory.DAIRY },
  { name: 'Parmesan', defaultUnit: Unit.GRAM, category: IngredientCategory.DAIRY },

  // Grains
  { name: 'Basmati rice', defaultUnit: Unit.GRAM, category: IngredientCategory.GRAIN },
  { name: 'Rolled oats', defaultUnit: Unit.GRAM, category: IngredientCategory.GRAIN },
  { name: 'Quinoa', defaultUnit: Unit.GRAM, category: IngredientCategory.GRAIN },
  { name: 'Spaghetti', defaultUnit: Unit.GRAM, category: IngredientCategory.GRAIN },
  { name: 'Plain flour', defaultUnit: Unit.GRAM, category: IngredientCategory.GRAIN },
  { name: 'Tortilla wrap', defaultUnit: Unit.PIECE, category: IngredientCategory.GRAIN },

  // Legumes — the ones that need soaking, which is what makes prep timers real
  { name: 'Dried chickpeas', defaultUnit: Unit.GRAM, category: IngredientCategory.LEGUME },
  { name: 'Dried black beans', defaultUnit: Unit.GRAM, category: IngredientCategory.LEGUME },
  { name: 'Red lentils', defaultUnit: Unit.GRAM, category: IngredientCategory.LEGUME },

  // Spices
  { name: 'Cumin seeds', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },
  { name: 'Ground turmeric', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },
  { name: 'Garam masala', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },
  { name: 'Smoked paprika', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },
  { name: 'Ground coriander', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },
  { name: 'Chilli powder', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },
  { name: 'Black pepper', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },
  { name: 'Salt', defaultUnit: Unit.TEASPOON, category: IngredientCategory.SPICE },

  // Condiments & oils
  { name: 'Olive oil', defaultUnit: Unit.TABLESPOON, category: IngredientCategory.CONDIMENT },
  { name: 'Soy sauce', defaultUnit: Unit.TABLESPOON, category: IngredientCategory.CONDIMENT },
  { name: 'Tomato passata', defaultUnit: Unit.MILLILITRE, category: IngredientCategory.CONDIMENT },
  { name: 'Coconut milk', defaultUnit: Unit.MILLILITRE, category: IngredientCategory.CONDIMENT },
  { name: 'Honey', defaultUnit: Unit.TABLESPOON, category: IngredientCategory.CONDIMENT },
  { name: 'Tahini', defaultUnit: Unit.TABLESPOON, category: IngredientCategory.CONDIMENT },

  // Baking
  { name: 'Caster sugar', defaultUnit: Unit.GRAM, category: IngredientCategory.BAKING },
  { name: 'Dark chocolate', defaultUnit: Unit.GRAM, category: IngredientCategory.BAKING },

  // Frozen
  { name: 'Frozen peas', defaultUnit: Unit.GRAM, category: IngredientCategory.FROZEN },
  { name: 'Frozen mixed berries', defaultUnit: Unit.GRAM, category: IngredientCategory.FROZEN },
]

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

type SeedRecipe = {
  /** Explicit, stable id — this is what makes re-seeding idempotent. */
  id: string
  name: string
  notes: string
  servings: number
  caloriesPerServing: number
  proteinPerServing: number
  carbsPerServing: number
  fatPerServing: number
  owner: 'admin' | 'cook'
  isPublic: boolean
  ingredients: { name: string; quantity: number; unit: Unit }[]
  prepItems: { id: string; label: string; leadTimeHours: number }[]
}

const RECIPES: SeedRecipe[] = [
  {
    id: 'seed_recipe_chana_masala',
    name: 'Chana Masala',
    notes: 'The soak is the whole trick. Dried chickpeas beat tinned, but only if you start the night before.',
    servings: 4,
    caloriesPerServing: 420,
    proteinPerServing: 18,
    carbsPerServing: 62,
    fatPerServing: 10,
    owner: 'admin',
    isPublic: true,
    ingredients: [
      { name: 'Dried chickpeas', quantity: 300, unit: Unit.GRAM },
      { name: 'Onion', quantity: 2, unit: Unit.PIECE },
      { name: 'Tomato', quantity: 3, unit: Unit.PIECE },
      { name: 'Garlic clove', quantity: 4, unit: Unit.PIECE },
      { name: 'Ginger', quantity: 20, unit: Unit.GRAM },
      { name: 'Cumin seeds', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Ground turmeric', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Garam masala', quantity: 2, unit: Unit.TEASPOON },
      { name: 'Olive oil', quantity: 2, unit: Unit.TABLESPOON },
      { name: 'Salt', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Coriander', quantity: 15, unit: Unit.GRAM },
    ],
    // Two prep items on purpose: MP-14 must generate two todos with
    // *different* dueAt values from a single plan entry.
    prepItems: [
      { id: 'seed_prep_chana_soak', label: 'Soak the dried chickpeas', leadTimeHours: 12 },
      { id: 'seed_prep_chana_paste', label: 'Blitz the ginger-garlic paste', leadTimeHours: 1 },
    ],
  },
  {
    id: 'seed_recipe_overnight_oats',
    name: 'Overnight Oats with Berries',
    notes: 'Assembled the night before. Zero effort in the morning, which is the point.',
    servings: 1,
    caloriesPerServing: 380,
    proteinPerServing: 14,
    carbsPerServing: 54,
    fatPerServing: 11,
    owner: 'admin',
    isPublic: true,
    ingredients: [
      { name: 'Rolled oats', quantity: 60, unit: Unit.GRAM },
      { name: 'Whole milk', quantity: 150, unit: Unit.MILLILITRE },
      { name: 'Greek yoghurt', quantity: 80, unit: Unit.GRAM },
      { name: 'Frozen mixed berries', quantity: 70, unit: Unit.GRAM },
      { name: 'Honey', quantity: 1, unit: Unit.TABLESPOON },
    ],
    prepItems: [{ id: 'seed_prep_oats_soak', label: 'Soak the oats in the fridge', leadTimeHours: 8 }],
  },
  {
    id: 'seed_recipe_chicken_tikka',
    name: 'Chicken Tikka Traybake',
    notes: 'Marinate for four hours minimum. Overnight is better.',
    servings: 4,
    caloriesPerServing: 510,
    proteinPerServing: 44,
    carbsPerServing: 12,
    fatPerServing: 30,
    owner: 'admin',
    isPublic: true,
    ingredients: [
      { name: 'Chicken thigh', quantity: 800, unit: Unit.GRAM },
      { name: 'Greek yoghurt', quantity: 200, unit: Unit.GRAM },
      { name: 'Garam masala', quantity: 2, unit: Unit.TEASPOON },
      { name: 'Smoked paprika', quantity: 2, unit: Unit.TEASPOON },
      { name: 'Ground turmeric', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Garlic clove', quantity: 4, unit: Unit.PIECE },
      { name: 'Lemon', quantity: 1, unit: Unit.PIECE },
      { name: 'Red bell pepper', quantity: 2, unit: Unit.PIECE },
      { name: 'Onion', quantity: 1, unit: Unit.PIECE },
      { name: 'Salt', quantity: 1, unit: Unit.TEASPOON },
    ],
    prepItems: [{ id: 'seed_prep_tikka_marinate', label: 'Marinate the chicken', leadTimeHours: 4 }],
  },
  {
    id: 'seed_recipe_red_lentil_dal',
    name: 'Red Lentil Dal',
    notes: 'Red lentils need no real soak — a rinse and a short sit is plenty.',
    servings: 4,
    caloriesPerServing: 320,
    proteinPerServing: 18,
    carbsPerServing: 48,
    fatPerServing: 6,
    owner: 'admin',
    isPublic: true,
    ingredients: [
      { name: 'Red lentils', quantity: 300, unit: Unit.GRAM },
      { name: 'Onion', quantity: 1, unit: Unit.PIECE },
      { name: 'Garlic clove', quantity: 3, unit: Unit.PIECE },
      { name: 'Ginger', quantity: 15, unit: Unit.GRAM },
      { name: 'Ground turmeric', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Cumin seeds', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Coconut milk', quantity: 200, unit: Unit.MILLILITRE },
      { name: 'Spinach', quantity: 100, unit: Unit.GRAM },
      { name: 'Salt', quantity: 1, unit: Unit.TEASPOON },
    ],
    prepItems: [{ id: 'seed_prep_dal_rinse', label: 'Rinse and soak the red lentils', leadTimeHours: 1 }],
  },
  {
    id: 'seed_recipe_black_bean_chilli',
    name: 'Black Bean Chilli',
    notes: 'Freezes well. Make the full six portions even if you are cooking for two.',
    servings: 6,
    caloriesPerServing: 390,
    proteinPerServing: 20,
    carbsPerServing: 58,
    fatPerServing: 8,
    owner: 'admin',
    isPublic: true,
    ingredients: [
      { name: 'Dried black beans', quantity: 400, unit: Unit.GRAM },
      { name: 'Onion', quantity: 2, unit: Unit.PIECE },
      { name: 'Carrot', quantity: 2, unit: Unit.PIECE },
      { name: 'Celery stick', quantity: 2, unit: Unit.PIECE },
      { name: 'Red bell pepper', quantity: 1, unit: Unit.PIECE },
      { name: 'Tomato passata', quantity: 500, unit: Unit.MILLILITRE },
      { name: 'Smoked paprika', quantity: 2, unit: Unit.TEASPOON },
      { name: 'Chilli powder', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Olive oil', quantity: 2, unit: Unit.TABLESPOON },
      { name: 'Salt', quantity: 1, unit: Unit.TEASPOON },
    ],
    prepItems: [{ id: 'seed_prep_chilli_soak', label: 'Soak the dried black beans', leadTimeHours: 12 }],
  },
  {
    id: 'seed_recipe_paneer_wraps',
    name: 'Paneer Tikka Wraps',
    notes: 'Weeknight-fast once the paneer has had a couple of hours in the marinade.',
    servings: 2,
    caloriesPerServing: 560,
    proteinPerServing: 26,
    carbsPerServing: 58,
    fatPerServing: 24,
    owner: 'admin',
    isPublic: true,
    ingredients: [
      { name: 'Paneer', quantity: 250, unit: Unit.GRAM },
      { name: 'Greek yoghurt', quantity: 100, unit: Unit.GRAM },
      { name: 'Garam masala', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Smoked paprika', quantity: 1, unit: Unit.TEASPOON },
      { name: 'Tortilla wrap', quantity: 4, unit: Unit.PIECE },
      { name: 'Red bell pepper', quantity: 1, unit: Unit.PIECE },
      { name: 'Onion', quantity: 1, unit: Unit.PIECE },
      { name: 'Lime', quantity: 1, unit: Unit.PIECE },
      { name: 'Coriander', quantity: 10, unit: Unit.GRAM },
    ],
    prepItems: [{ id: 'seed_prep_paneer_marinate', label: 'Marinate the paneer', leadTimeHours: 2 }],
  },
  // The last two carry NO prep items on purpose: MP-14's todo regeneration has
  // to handle a plan entry that produces zero todos without falling over.
  {
    id: 'seed_recipe_spaghetti_bolognese',
    name: 'Spaghetti Bolognese',
    notes: 'No prep timer. Start to finish in the same hour.',
    servings: 4,
    caloriesPerServing: 640,
    proteinPerServing: 34,
    carbsPerServing: 72,
    fatPerServing: 24,
    owner: 'admin',
    isPublic: true,
    ingredients: [
      { name: 'Spaghetti', quantity: 400, unit: Unit.GRAM },
      { name: 'Lamb mince', quantity: 500, unit: Unit.GRAM },
      { name: 'Tomato passata', quantity: 500, unit: Unit.MILLILITRE },
      { name: 'Onion', quantity: 1, unit: Unit.PIECE },
      { name: 'Carrot', quantity: 1, unit: Unit.PIECE },
      { name: 'Celery stick', quantity: 2, unit: Unit.PIECE },
      { name: 'Garlic clove', quantity: 3, unit: Unit.PIECE },
      { name: 'Parmesan', quantity: 40, unit: Unit.GRAM },
      { name: 'Olive oil', quantity: 2, unit: Unit.TABLESPOON },
    ],
    prepItems: [],
  },
  {
    id: 'seed_recipe_salmon_quinoa',
    name: 'Salmon, Quinoa & Greens',
    notes: 'Owned by the non-admin account and kept private — useful for testing the owner-or-admin delete rule in MP-13.',
    servings: 2,
    caloriesPerServing: 580,
    proteinPerServing: 42,
    carbsPerServing: 44,
    fatPerServing: 24,
    owner: 'cook',
    isPublic: false,
    ingredients: [
      { name: 'Salmon fillet', quantity: 300, unit: Unit.GRAM },
      { name: 'Quinoa', quantity: 150, unit: Unit.GRAM },
      { name: 'Tenderstem broccoli', quantity: 200, unit: Unit.GRAM },
      { name: 'Lemon', quantity: 1, unit: Unit.PIECE },
      { name: 'Olive oil', quantity: 1, unit: Unit.TABLESPOON },
      { name: 'Black pepper', quantity: 1, unit: Unit.TEASPOON },
    ],
    prepItems: [],
  },
]

/** Starter pantry for the non-admin account, so MP-51's filter has data. */
const COOK_PANTRY = [
  'Onion',
  'Garlic clove',
  'Ginger',
  'Olive oil',
  'Salt',
  'Black pepper',
  'Ground turmeric',
  'Cumin seeds',
  'Basmati rice',
  'Red lentils',
  'Greek yoghurt',
  'Rolled oats',
]

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10)

  // --- Users ---------------------------------------------------------------
  // Keyed on the unique email. Note that re-running rewrites passwordHash:
  // bcrypt salts every call differently, so the stored string changes even
  // though the password does not. Harmless, and it means editing
  // SEED_PASSWORD above actually takes effect.
  const admin = await prisma.user.upsert({
    where: { email: 'admin@mealplanner.test' },
    update: { name: 'Admin Cook', passwordHash, roles: [Role.USER, Role.ADMIN] },
    create: {
      email: 'admin@mealplanner.test',
      name: 'Admin Cook',
      passwordHash,
      roles: [Role.USER, Role.ADMIN],
    },
  })

  const cook = await prisma.user.upsert({
    where: { email: 'cook@mealplanner.test' },
    update: { name: 'Everyday Cook', passwordHash, roles: [Role.USER] },
    create: {
      email: 'cook@mealplanner.test',
      name: 'Everyday Cook',
      passwordHash,
      roles: [Role.USER],
    },
  })

  const userIds = { admin: admin.id, cook: cook.id }

  // --- Ingredients ---------------------------------------------------------
  // One transaction rather than 55 sequential round trips.
  await prisma.$transaction(
    INGREDIENTS.map((ingredient) =>
      prisma.ingredient.upsert({
        where: { name: ingredient.name },
        update: { defaultUnit: ingredient.defaultUnit, category: ingredient.category },
        create: ingredient,
      }),
    ),
  )

  // name -> id, so the recipe data below can refer to ingredients by name.
  const ingredientIds = new Map(
    (await prisma.ingredient.findMany({ select: { id: true, name: true } })).map((i) => [i.name, i.id]),
  )

  const resolveIngredient = (name: string): string => {
    const id = ingredientIds.get(name)
    if (!id) {
      throw new Error(`Recipe refers to "${name}", which is not in INGREDIENTS. Add it to the catalogue.`)
    }
    return id
  }

  // --- Recipes -------------------------------------------------------------
  for (const recipe of RECIPES) {
    const { id, ingredients, prepItems, owner, ...fields } = recipe

    await prisma.recipe.upsert({
      where: { id },
      update: { ...fields, createdById: userIds[owner] },
      create: { id, ...fields, createdById: userIds[owner] },
    })

    // Replace the ingredient rows: upsert the ones we want, then drop any
    // left over from an earlier version of this seed. Without the delete,
    // removing an ingredient from the list above would never take effect.
    const wantedIngredientIds = ingredients.map((i) => resolveIngredient(i.name))

    await prisma.$transaction([
      ...ingredients.map((line, index) =>
        prisma.recipeIngredient.upsert({
          where: {
            recipeId_ingredientId: {
              recipeId: id,
              // Safe: wantedIngredientIds is built from this same array, so
              // every index exists. `?? ''` only satisfies the compiler's
              // noUncheckedIndexedAccess.
              ingredientId: wantedIngredientIds[index] ?? '',
            },
          },
          update: { quantity: line.quantity, unit: line.unit },
          create: {
            recipeId: id,
            ingredientId: wantedIngredientIds[index] ?? '',
            quantity: line.quantity,
            unit: line.unit,
          },
        }),
      ),
      prisma.recipeIngredient.deleteMany({
        where: { recipeId: id, ingredientId: { notIn: wantedIngredientIds } },
      }),
    ])

    await prisma.$transaction([
      ...prepItems.map((prep) =>
        prisma.prepItem.upsert({
          where: { id: prep.id },
          update: { label: prep.label, leadTimeHours: prep.leadTimeHours, recipeId: id },
          create: { ...prep, recipeId: id },
        }),
      ),
      prisma.prepItem.deleteMany({
        where: { recipeId: id, id: { notIn: prepItems.map((p) => p.id) } },
      }),
    ])
  }

  // --- Pantry --------------------------------------------------------------
  await prisma.$transaction(
    COOK_PANTRY.map((name) => {
      const ingredientId = resolveIngredient(name)
      return prisma.pantryItem.upsert({
        where: { userId_ingredientId: { userId: cook.id, ingredientId } },
        update: {},
        create: { userId: cook.id, ingredientId },
      })
    }),
  )

  // --- Summary -------------------------------------------------------------
  const [users, ingredients, recipes, recipeIngredients, prep, pantry] = await Promise.all([
    prisma.user.count(),
    prisma.ingredient.count(),
    prisma.recipe.count(),
    prisma.recipeIngredient.count(),
    prisma.prepItem.count(),
    prisma.pantryItem.count(),
  ])

  console.log('\nSeed complete:')
  console.table({
    users: { rows: users },
    ingredients: { rows: ingredients },
    recipes: { rows: recipes },
    recipeIngredients: { rows: recipeIngredients },
    prepItems: { rows: prep },
    pantryItems: { rows: pantry },
  })
  console.log(`Log in with admin@mealplanner.test or cook@mealplanner.test — password "${SEED_PASSWORD}"\n`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error('\nSeed failed:')
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
