import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { isProduction } from '../config/env.ts'
import { HttpError } from '../lib/httpError.ts'

/**
 * The last middleware in the stack. Express identifies an error handler by its
 * arity — four parameters — which is why `_next` is declared but unused.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route code needs no try/catch just to report a failure.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // --- Validation ----------------------------------------------------------
  // A failed `schema.parse()` becomes the 422 shape the frontend's forms
  // consume: a human-readable `message` plus one message per bad field, keyed
  // by field name so a form can drop each straight onto the right input.
  if (err instanceof ZodError) {
    const errors: Record<string, string> = {}

    for (const issue of err.issues) {
      const field = issue.path.join('.') || '_'
      // First issue per field wins — forms show one message per input.
      errors[field] ??= issue.message
    }

    res.status(422).json({ message: 'Validation failed', errors })
    return
  }

  // --- Deliberate, known failures -----------------------------------------
  if (err instanceof HttpError) {
    res.status(err.status).json({
      message: err.message,
      ...(err.errors ? { errors: err.errors } : {}),
    })
    return
  }

  // --- Everything else is a bug -------------------------------------------
  console.error(err)

  res.status(500).json({
    message: 'Internal server error',
    // A stack trace is a gift to an attacker; local debugging only.
    ...(isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  })
}
