import type { ErrorRequestHandler } from 'express'
import { isProduction } from '../config/env.ts'

/**
 * The last middleware in the stack. Express identifies an error handler by its
 * arity — four parameters — which is why `_next` is declared but unused.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route code needs no try/catch just to report a failure.
 *
 * MP-13 extends this to translate zod failures into the 422 shape the frontend
 * forms consume. For now every unhandled error is a 500.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err)

  res.status(500).json({
    message: 'Internal server error',
    // A stack trace is a gift to an attacker; local debugging only.
    ...(isProduction ? {} : { detail: err instanceof Error ? err.message : String(err) }),
  })
}
