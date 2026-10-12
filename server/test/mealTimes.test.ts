import { describe, expect, it } from 'vitest'
import { MEAL_TIMES, PREP_SLOTS, dueAt, mealAt } from '../src/lib/mealTimes.ts'
import { toUtcDay } from '../src/lib/dateRange.ts'
import { MealType, PrepTiming } from '../generated/prisma/enums.ts'

/**
 * The prep-timer rule, unit-tested with no database in sight. The roadmap
 * says to write the rule down before coding it and then unit-test it; this is
 * that test.
 */
describe('mealAt', () => {
  it('uses the §4 default clock times', () => {
    expect(MEAL_TIMES[MealType.BREAKFAST]).toEqual({ hour: 8, minute: 0 })
    expect(MEAL_TIMES[MealType.LUNCH]).toEqual({ hour: 13, minute: 0 })
    expect(MEAL_TIMES[MealType.SNACK]).toEqual({ hour: 17, minute: 0 })
    expect(MEAL_TIMES[MealType.DINNER]).toEqual({ hour: 20, minute: 0 })
  })

  it('puts the meal at its clock time on the planned day', () => {
    expect(mealAt(toUtcDay('2026-10-13'), MealType.LUNCH).toISOString()).toBe('2026-10-13T13:00:00.000Z')
    expect(mealAt(toUtcDay('2026-10-13'), MealType.DINNER).toISOString()).toBe('2026-10-13T20:00:00.000Z')
  })
})

describe('dueAt with EXACT timing — a literal offset', () => {
  /**
   * The worked example from ROADMAP §4 — with its arithmetic corrected.
   *
   * The roadmap says: "Tuesday lunch (13:00) + 'soak beans, 12h' → dueAt =
   * Monday 01:00." That subtraction is off by a day: 13:00 minus 12 hours is
   * 01:00 on the *same* Tuesday. The rule itself (dueAt = mealAt - leadTime)
   * is right; only the example's answer is wrong.
   *
   * It matters downstream. The roadmap reasons that 01:00 "falls before Monday
   * breakfast, so it surfaces in Sunday dinner's bucket" — with the correct
   * instant, that becomes "before Tuesday breakfast, so Monday dinner's
   * bucket". One day later than the doc claims, which is exactly the kind of
   * off-by-one that would make MP-70's bucketing look broken when it was
   * following the spec faithfully.
   */
  it('gives Tuesday 01:00 for a 12-hour soak before Tuesday lunch', () => {
    const tuesday = toUtcDay('2026-10-13')

    expect(dueAt(tuesday, MealType.LUNCH, 12, PrepTiming.EXACT).toISOString()).toBe('2026-10-13T01:00:00.000Z')
  })

  it('reaches the previous day once the lead time passes the clock time', () => {
    // 13 hours before 13:00 is midnight; 14 hours is the day before.
    expect(dueAt(toUtcDay('2026-10-13'), MealType.LUNCH, 13, PrepTiming.EXACT).toISOString()).toBe('2026-10-13T00:00:00.000Z')
    expect(dueAt(toUtcDay('2026-10-13'), MealType.LUNCH, 14, PrepTiming.EXACT).toISOString()).toBe('2026-10-12T23:00:00.000Z')
  })

  it('handles a zero lead time as "at the meal itself"', () => {
    expect(dueAt(toUtcDay('2026-10-13'), MealType.DINNER, 0, PrepTiming.EXACT).toISOString()).toBe('2026-10-13T20:00:00.000Z')
  })

  it('crosses a month boundary', () => {
    expect(dueAt(toUtcDay('2026-11-01'), MealType.BREAKFAST, 12, PrepTiming.EXACT).toISOString()).toBe('2026-10-31T20:00:00.000Z')
  })

  it('crosses a year boundary', () => {
    expect(dueAt(toUtcDay('2027-01-01'), MealType.BREAKFAST, 24, PrepTiming.EXACT).toISOString()).toBe('2026-12-31T08:00:00.000Z')
  })

  it('handles a week-long lead time', () => {
    expect(dueAt(toUtcDay('2026-10-13'), MealType.LUNCH, 168, PrepTiming.EXACT).toISOString()).toBe('2026-10-06T13:00:00.000Z')
  })

  it('is unaffected by the machine timezone, because the arithmetic is UTC', () => {
    // A date-only value parsed as UTC, plus UTC meal times, means the result
    // cannot shift with the server's TZ. This assertion would fail if any
    // local-time getter crept into mealAt.
    const iso = dueAt(toUtcDay('2026-03-29'), MealType.BREAKFAST, 8, PrepTiming.EXACT).toISOString()

    // 2026-03-29 is the European DST switch. Still exactly 8 hours.
    expect(iso).toBe('2026-03-29T00:00:00.000Z')
  })
})

describe('dueAt with SLOT timing — "soak for at least N hours"', () => {
  it('uses two prep slots: 09:00 and 21:30', () => {
    expect(PREP_SLOTS).toEqual([
      { hour: 9, minute: 0 },
      { hour: 21, minute: 30 },
    ])
  })

  /**
   * The two cases that define the rule, stated by the person who has to cook.
   *
   * "If cooking time is dinner then soaking time should be morning 9AM, if
   * cooking time is lunch then soaking time should be at night before bed
   * 9:30PM."
   *
   * Both come out right with an 8-hour minimum, which is the real floor for
   * beans — the 12 in the roadmap was never meant as an exact figure.
   */
  it('puts a soak for Tuesday LUNCH at Monday 21:30 — before bed the night before', () => {
    const tuesday = toUtcDay('2026-10-13')

    expect(dueAt(tuesday, MealType.LUNCH, 8, PrepTiming.SLOT).toISOString()).toBe('2026-10-12T21:30:00.000Z')
  })

  it('puts a soak for Tuesday DINNER at Tuesday 09:00 — that morning', () => {
    const tuesday = toUtcDay('2026-10-13')

    expect(dueAt(tuesday, MealType.DINNER, 8, PrepTiming.SLOT).toISOString()).toBe('2026-10-13T09:00:00.000Z')
  })

  it('never schedules a soak for less than its minimum', () => {
    const tuesday = toUtcDay('2026-10-13')

    for (const mealType of [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER]) {
      for (const minimum of [1, 4, 8, 12, 24, 48]) {
        const due = dueAt(tuesday, mealType, minimum, PrepTiming.SLOT)
        const soakedFor = (mealAt(tuesday, mealType).getTime() - due.getTime()) / 3_600_000

        expect(soakedFor).toBeGreaterThanOrEqual(minimum)
      }
    }
  })

  it('always lands exactly on a prep slot', () => {
    const tuesday = toUtcDay('2026-10-13')

    for (const mealType of [MealType.BREAKFAST, MealType.LUNCH, MealType.SNACK, MealType.DINNER]) {
      for (const minimum of [0, 1, 7, 8, 9, 13, 23, 25, 100, 168]) {
        const due = dueAt(tuesday, mealType, minimum, PrepTiming.SLOT)

        expect(PREP_SLOTS).toContainEqual({ hour: due.getUTCHours(), minute: due.getUTCMinutes() })
      }
    }
  })

  it('picks the latest slot that still satisfies the minimum, not the earliest', () => {
    const tuesday = toUtcDay('2026-10-13')

    // Dinner is 20:00. An 8h minimum allows anything up to 12:00, and 09:00 is
    // the latest slot before that — not 21:30 the previous night.
    expect(dueAt(tuesday, MealType.DINNER, 8, PrepTiming.SLOT).toISOString()).toBe('2026-10-13T09:00:00.000Z')

    // Raise it to 12h and 09:00 no longer qualifies, so it steps back a slot.
    expect(dueAt(tuesday, MealType.DINNER, 12, PrepTiming.SLOT).toISOString()).toBe('2026-10-12T21:30:00.000Z')
  })

  it('a longer minimum is also fine — the whole point is that it is a floor', () => {
    const tuesday = toUtcDay('2026-10-13')
    const due = dueAt(tuesday, MealType.LUNCH, 8, PrepTiming.SLOT)
    const soakedFor = (mealAt(tuesday, MealType.LUNCH).getTime() - due.getTime()) / 3_600_000

    // Monday 21:30 to Tuesday 13:00 is 15.5 hours for an 8-hour minimum.
    expect(soakedFor).toBe(15.5)
  })

  it('walks back across days, months and years for a long minimum', () => {
    expect(dueAt(toUtcDay('2026-01-01'), MealType.BREAKFAST, 48, PrepTiming.SLOT).toISOString()).toBe(
      '2025-12-29T21:30:00.000Z',
    )
  })

  it('schedules the two modes differently for the same step length', () => {
    const tuesday = toUtcDay('2026-10-13')

    expect(dueAt(tuesday, MealType.DINNER, 1, PrepTiming.EXACT).toISOString()).toBe('2026-10-13T19:00:00.000Z')
    expect(dueAt(tuesday, MealType.DINNER, 1, PrepTiming.SLOT).toISOString()).toBe('2026-10-13T09:00:00.000Z')
  })
})
