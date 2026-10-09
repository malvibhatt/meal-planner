import type { Role } from '../../generated/prisma/enums.ts'

/**
 * `requireAuth` puts the caller's identity on the request so downstream
 * handlers can read `req.user` with real types instead of casting.
 */
export type AuthenticatedUser = {
  id: string
  email: string
  roles: Role[]
}

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. Undefined on any route that does not use it. */
      user?: AuthenticatedUser
    }
  }
}
