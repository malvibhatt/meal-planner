import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { IngredientCategory } from '../../generated/prisma/enums.ts'

export const ingredientsRouter = Router()

const listQuerySchema = z.object({
  // Optional typeahead filter. MP-42's recipe form needs to search a
  // 55-row-and-growing catalogue without shipping all of it to the browser
  // on every keystroke.
  q: z.string().trim().min(1).optional(),
  category: z.enum(IngredientCategory).optional(),
})

/**
 * GET /ingredients — the whole catalogue, unpaginated.
 *
 * Deliberately not paginated: this is a reference list the frontend wants in
 * full to populate a select. It is tens of rows, not thousands. If it ever
 * grows past a few hundred, paginate it then.
 */
ingredientsRouter.get('/ingredients', requireAuth, async (req, res) => {
  const { q, category } = listQuerySchema.parse(req.query)

  const ingredients = await prisma.ingredient.findMany({
    where: {
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(category ? { category } : {}),
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, defaultUnit: true, category: true },
  })

  res.json({ items: ingredients })
})
