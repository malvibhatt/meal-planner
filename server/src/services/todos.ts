import { dueAt } from '../lib/mealTimes.ts'
import { MealType, PrepTiming, TodoStatus } from '../../generated/prisma/enums.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

type PlanEntryForTodos = {
  id: string
  userId: string
  date: Date
  mealType: MealType
  recipe: {
    name: string
    prepItems: { id: string; label: string; leadTimeHours: number; timing: PrepTiming }[]
  }
}

/**
 * Rebuilds the todos for one plan entry.
 *
 * The whole design rests on the `@@unique([sourceEntryId, sourcePrepItemId])`
 * index from MP-11. Because "the todo for this prep item of this plan entry"
 * is addressable, regeneration is an **upsert** rather than a
 * delete-and-recreate — and `isDone` is simply not in the `update` clause, so
 * a ticked todo stays ticked through any number of rewrites.
 *
 * Delete-and-recreate would have been simpler to write and would silently
 * untick every todo the user had already completed. That is the bug this
 * function exists to not have.
 */
export async function regenerateTodosForEntry(tx: Prisma.TransactionClient, entry: PlanEntryForTodos): Promise<void> {
  const wanted = entry.recipe.prepItems.map((prep) => ({
    prepItemId: prep.id,
    label: `${prep.label} — ${entry.recipe.name}`,
    dueAt: dueAt(entry.date, entry.mealType, prep.leadTimeHours, prep.timing),
  }))

  for (const todo of wanted) {
    await tx.todoItem.upsert({
      where: {
        sourceEntryId_sourcePrepItemId: {
          sourceEntryId: entry.id,
          sourcePrepItemId: todo.prepItemId,
        },
      },
      // Note the omission: `status`, `completedAt` and `cancelledAt` are
      // never touched. The label and dueAt are derived data and may
      // legitimately change (the recipe was renamed, the meal moved to a
      // different day); whether the user has done or dismissed the task is
      // theirs, not ours.
      update: { label: todo.label, dueAt: todo.dueAt },
      create: {
        userId: entry.userId,
        label: todo.label,
        dueAt: todo.dueAt,
        sourceEntryId: entry.id,
        sourcePrepItemId: todo.prepItemId,
      },
    })
  }

  // Prep items removed from the recipe since the last run leave todos behind.
  // Only still-pending ones go: a DONE todo records something the user
  // actually did, and a CANCELLED one records a decision they made. Deleting
  // either would be rewriting history — and a dismissed step would come back
  // from the dead on the next regeneration.
  await tx.todoItem.deleteMany({
    where: {
      sourceEntryId: entry.id,
      status: TodoStatus.PENDING,
      sourcePrepItemId: { notIn: wanted.map((todo) => todo.prepItemId) },
    },
  })
}

/**
 * Called before a plan entry is deleted.
 *
 * Pending todos are noise once the meal is off the plan, so they go. Resolved
 * ones survive: the user soaked those chickpeas, and that happened whether or
 * not the meal is still planned. Their `sourceEntryId` becomes NULL via the
 * FK's ON DELETE SET NULL once the entry row disappears — which is exactly why
 * MP-11 chose SetNull over Cascade there.
 */
export async function discardPendingTodosForEntry(tx: Prisma.TransactionClient, entryId: string): Promise<void> {
  await tx.todoItem.deleteMany({ where: { sourceEntryId: entryId, status: TodoStatus.PENDING } })
}

/** What regeneration needs to read. Kept here so callers cannot forget a field. */
export const planEntryTodoInclude = {
  recipe: {
    select: { name: true, prepItems: { select: { id: true, label: true, leadTimeHours: true, timing: true } } },
  },
} satisfies Prisma.MealPlanEntryInclude
