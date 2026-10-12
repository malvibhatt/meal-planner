import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { HttpError, unauthorized } from '../lib/httpError.ts'
import { toUtcDay } from '../lib/dateRange.ts'
import { TodoStatus } from '../../generated/prisma/enums.ts'

export const todosRouter = Router()

const idParamSchema = z.object({ id: z.string().min(1) })

const listQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
    .optional(),
  /**
   * `?status=PENDING` is how the UI asks for "what is still outstanding".
   * Omitted means everything, including done and cancelled — a history view.
   */
  status: z.enum(TodoStatus).optional(),
})

const patchSchema = z.object({
  status: z.enum(TodoStatus, { error: 'status must be PENDING, DONE or CANCELLED' }),
})

/**
 * GET /todos?from=&to=
 *
 * Filtered on `dueAt`, not on the date of the meal that generated it — a
 * 12-hour soak for Tuesday lunch is *Monday's* job, and Monday is when the
 * user needs to see it.
 *
 * The range is optional here, unlike the shopping list: "show me everything
 * outstanding" is a legitimate ask for a todo list, and the result set is
 * bounded by how much the user has planned.
 */
todosRouter.get('/todos', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const { from, to, status } = listQuerySchema.parse(req.query)

  const items = await prisma.todoItem.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
      ...(from || to
        ? {
            dueAt: {
              ...(from ? { gte: toUtcDay(from) } : {}),
              // Inclusive of the whole "to" day, not midnight at its start.
              ...(to ? { lt: new Date(toUtcDay(to).getTime() + 86_400_000) } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      label: true,
      dueAt: true,
      status: true,
      completedAt: true,
      cancelledAt: true,
      sourceEntryId: true,
      sourcePrepItemId: true,
    },
    orderBy: [{ dueAt: 'asc' }, { label: 'asc' }],
  })

  res.json({ items })
})

/**
 * PATCH /todos/:id — tick it, dismiss it, or put it back.
 *
 * `status` is the only writable field. Labels and due dates are derived from
 * the plan, and letting a client edit them would mean the next regeneration
 * silently overwrote the edit.
 *
 * Nothing here expires a todo. An overdue soak stays on the list looking
 * overdue until the user resolves it one way or the other, which is the point:
 * a task quietly vanishing because its moment passed is how you end up with
 * unsoaked beans.
 */
todosRouter.patch('/todos/:id', requireAuth, async (req, res) => {
  const userId = req.user?.id

  if (!userId) throw unauthorized()

  const { id } = idParamSchema.parse(req.params)
  const { status } = patchSchema.parse(req.body)

  // Scoped by userId: another user's todo is a 404.
  const existing = await prisma.todoItem.findFirst({ where: { id, userId }, select: { id: true } })

  if (!existing) throw new HttpError(404, 'Todo not found')

  const now = new Date()

  const todo = await prisma.todoItem.update({
    where: { id: existing.id },
    data: {
      status,
      // Each timestamp is set only by its own status and cleared by any other,
      // so a todo can never claim to have been both completed and cancelled.
      completedAt: status === TodoStatus.DONE ? now : null,
      cancelledAt: status === TodoStatus.CANCELLED ? now : null,
    },
    select: { id: true, label: true, dueAt: true, status: true, completedAt: true, cancelledAt: true },
  })

  res.json({ todo })
})
