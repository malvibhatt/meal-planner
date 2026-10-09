/**
 * An error that carries the HTTP status it should produce.
 *
 * Route handlers `throw new HttpError(409, '...')` and stop caring about the
 * response; the error handler in middleware/errorHandler.ts turns it into
 * JSON. Express 5 forwards throws from async handlers automatically, so this
 * works without a single try/catch in the route code.
 *
 * Note the explicit field assignments instead of TypeScript parameter
 * properties — tsconfig sets `erasableSyntaxOnly`, which bans syntax that
 * only exists in TS and would need real transformation to run.
 */
export class HttpError extends Error {
  readonly status: number
  readonly errors: Record<string, string> | undefined

  constructor(status: number, message: string, errors?: Record<string, string>) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.errors = errors
  }
}

export const unauthorized = (message = 'Authentication required') => new HttpError(401, message)
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, message)
