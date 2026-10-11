import { z } from 'zod'

/**
 * One pagination shape for every list endpoint, so the frontend learns it
 * once. `total` is what lets MP-53 render "page 3 of 12"; `hasMore` is what
 * an infinite scroll actually needs. Returning both costs one COUNT query and
 * saves the frontend from computing either.
 */
export type Paginated<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Capped: without a ceiling, `?pageSize=1000000` is a free denial of
  // service against your own database.
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const paginate = <T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> => ({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
  hasMore: page * pageSize < total,
})

/** `?page=2&pageSize=20` → the `skip`/`take` Prisma wants. */
export const toSkipTake = (page: number, pageSize: number) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
})
