import type { RequestHandler } from 'express'
import { verifyAccessToken } from '../auth/tokens.ts'
import { forbidden, unauthorized } from '../lib/httpError.ts'
import type { Role } from '../../generated/prisma/enums.ts'

/**
 * Reads `Authorization: Bearer <token>`, verifies it, and attaches the caller
 * to `req.user`. No database hit: everything needed to authorise a request is
 * in the token, which is the point of using a JWT rather than a session id.
 *
 * The tradeoff to know: a role change does not take effect until the user's
 * current access token expires, up to 15 minutes later. That is the price of
 * not querying the database on every request, and 15 minutes is chosen to
 * keep that window short.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization

  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Authentication required')
  }

  const claims = verifyAccessToken(header.slice('Bearer '.length).trim())

  req.user = { id: claims.sub, email: claims.email, roles: claims.roles }

  next()
}

/**
 * Role gate. Always mounted *after* requireAuth:
 *
 *   router.delete('/recipes/:id', requireAuth, requireRole('ADMIN'), handler)
 *
 * 401 means "I do not know who you are", 403 means "I know, and the answer is
 * no". Conflating them makes the frontend unable to decide between redirecting
 * to login and showing the forbidden page (MP-24/MP-25 depend on this).
 */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      throw unauthorized('Authentication required')
    }

    if (!roles.some((role) => req.user?.roles.includes(role))) {
      throw forbidden()
    }

    next()
  }
