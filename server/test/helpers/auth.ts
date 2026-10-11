import { signAccessToken } from '../../src/auth/tokens.ts'
import { Role } from '../../generated/prisma/enums.ts'
import { createUser } from './db.ts'

/**
 * A real user row plus a working bearer header for it. Tests that are about
 * recipes should not have to post to /auth/login first.
 */
export async function authAs(email: string, roles: Role[] = [Role.USER]) {
  const user = await createUser({ email, password: 'password123', roles })

  return {
    user,
    header: `Bearer ${signAccessToken({ id: user.id, email: user.email, roles: user.roles })}`,
  }
}
