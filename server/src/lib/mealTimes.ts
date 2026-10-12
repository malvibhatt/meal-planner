import { MealType, PrepTiming } from '../../generated/prisma/enums.ts'

/**
 * What time of day each meal happens. The roadmap's §4 defaults.
 */
export const MEAL_TIMES: Record<MealType, { hour: number; minute: number }> = {
  [MealType.BREAKFAST]: { hour: 8, minute: 0 },
  [MealType.LUNCH]: { hour: 13, minute: 0 },
  [MealType.SNACK]: { hour: 17, minute: 0 },
  [MealType.DINNER]: { hour: 20, minute: 0 },
}

/**
 * The times of day a person is actually available to start a long prep step.
 * Ascending, and the scheduler relies on that order.
 *
 * Two slots, because they are the two moments a soak realistically begins:
 * after breakfast, and last thing before bed.
 */
export const PREP_SLOTS: { hour: number; minute: number }[] = [
  { hour: 9, minute: 0 },
  { hour: 21, minute: 30 },
]

/**
 * The clock time of a planned meal, as an instant.
 *
 * **Everything here is UTC, deliberately.** `MealPlanEntry.date` is a
 * Postgres DATE — a calendar day with no timezone — and the meal times above
 * are wall-clock times. Combining them needs a timezone, and picking UTC
 * makes the arithmetic deterministic and the tests honest.
 *
 * The consequence to know: a user in IST sees "lunch 13:00" meaning 13:00
 * UTC, which is 18:30 their time. Fixing that properly means storing a
 * timezone per user and converting at the edges — a real feature, not a
 * one-line change, and out of scope here.
 */
export function mealAt(date: Date, mealType: MealType): Date {
  const time = MEAL_TIMES[mealType]

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), time.hour, time.minute, 0, 0),
  )
}

/**
 * The latest prep slot at or before `deadline`.
 *
 * Walks backwards a day at a time, checking the day's slots latest-first.
 * Bounded by the 168-hour (7 day) ceiling on `leadTimeHours`, so the guard is
 * generous rather than load-bearing.
 */
function latestSlotAtOrBefore(deadline: Date): Date {
  for (let daysBack = 0; daysBack <= 400; daysBack += 1) {
    for (let i = PREP_SLOTS.length - 1; i >= 0; i -= 1) {
      const slot = PREP_SLOTS[i]

      if (!slot) continue

      const candidate = Date.UTC(
        deadline.getUTCFullYear(),
        deadline.getUTCMonth(),
        deadline.getUTCDate() - daysBack,
        slot.hour,
        slot.minute,
        0,
        0,
      )

      if (candidate <= deadline.getTime()) return new Date(candidate)
    }
  }

  /* c8 ignore next */
  throw new Error(`No prep slot found at or before ${deadline.toISOString()}`)
}

/**
 * When a prep step needs to be started, for a meal on `date` at `mealType`.
 *
 * Two modes, because "2 hours before" and "soak for 8 hours" are different
 * kinds of instruction:
 *
 * **EXACT** — a literal offset.
 *
 *     dueAt = mealAt - leadTimeHours
 *
 * Right for marinating, toasting spices, taking something out to thaw. A
 * 1-hour step before Tuesday lunch is due Tuesday 12:00.
 *
 * **SLOT** — the lead time is a *minimum*, and the result is rounded back to
 * the latest PREP_SLOT that still satisfies it.
 *
 *     dueAt = latest prep slot <= (mealAt - leadTimeHours)
 *
 * Right for soaking, where 8 hours is a floor and longer is fine. Beans for
 * Tuesday lunch (13:00) with an 8-hour minimum come out as **Monday 21:30** —
 * put them in before bed — rather than Tuesday 05:00. For Tuesday dinner
 * (20:00) the same step becomes **Tuesday 09:00**, that morning.
 *
 * This is the correction to ROADMAP §4, which modelled every step as an exact
 * subtraction and so produced times nobody would be awake for.
 */
export function dueAt(date: Date, mealType: MealType, leadTimeHours: number, timing: PrepTiming): Date {
  const deadline = new Date(mealAt(date, mealType).getTime() - leadTimeHours * 60 * 60 * 1000)

  return timing === PrepTiming.SLOT ? latestSlotAtOrBefore(deadline) : deadline
}
