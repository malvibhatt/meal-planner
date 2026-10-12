import { z } from 'zod'
import { HttpError } from './httpError.ts'

/** A calendar day as the API speaks it: "2026-10-11". */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Not a real date')

/**
 * Parses a day string into midnight UTC — matching how `@db.Date` columns
 * come back from Postgres, so comparisons line up exactly.
 */
export const toUtcDay = (day: string): Date => new Date(`${day}T00:00:00Z`)

/** The longest range any endpoint will aggregate over. Three months of plan. */
const MAX_RANGE_DAYS = 92

export const dateRangeSchema = z.object({ from: daySchema, to: daySchema })

/**
 * `?from=&to=` with both ends required, validated, and bounded.
 *
 * The bound is not bureaucracy: the shopping-list and todo queries scan every
 * plan entry in the range, and `?from=1900-01-01&to=2100-01-01` would be a
 * cheap way to make the database work very hard.
 */
export function parseDateRange(query: unknown): { from: Date; to: Date } {
  const { from, to } = dateRangeSchema.parse(query)

  const fromDate = toUtcDay(from)
  const toDate = toUtcDay(to)

  if (fromDate > toDate) {
    throw new HttpError(422, 'Validation failed', { to: '"to" must not be earlier than "from"' })
  }

  const days = (toDate.getTime() - fromDate.getTime()) / 86_400_000 + 1

  if (days > MAX_RANGE_DAYS) {
    throw new HttpError(422, 'Validation failed', {
      to: `Range must be ${MAX_RANGE_DAYS} days or fewer (asked for ${days})`,
    })
  }

  return { from: fromDate, to: toDate }
}
