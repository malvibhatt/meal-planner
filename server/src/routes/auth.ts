import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.ts'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../auth/tokens.ts'
import { REFRESH_COOKIE_NAME, clearRefreshCookie, setRefreshCookie } from '../auth/cookies.ts'
import { requireAuth } from '../middleware/requireAuth.ts'
import { HttpError, unauthorized } from '../lib/httpError.ts'
import { Role } from '../../generated/prisma/enums.ts'

export const authRouter = Router()

/**
 * The only user shape that ever leaves the server. Everything goes through
 * this function, so `passwordHash` cannot escape by someone forgetting a
 * `select` somewhere.
 */
type PublicUser = {
  id: string
  email: string
  name: string
  roles: Role[]
}

const toPublicUser = (user: { id: string; email: string; name: string; roles: Role[] }): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  roles: user.roles,
})

// Emails are compared by a case-sensitive unique index, so they are lowercased
// and trimmed on the way in — otherwise "Me@x.com" and "me@x.com" are two
// accounts and login becomes a guessing game.
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'))

const registerSchema = z.object({
  email: emailSchema,
  // 8 is the floor. Length beats character-class rules for real-world strength.
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name must be 80 characters or fewer'),
})

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})

/** Issues both tokens, puts the refresh one in the cookie, returns the body. */
function issueSession(res: Parameters<typeof setRefreshCookie>[0], user: PublicUser) {
  setRefreshCookie(res, signRefreshToken({ id: user.id }))

  return { user, accessToken: signAccessToken({ id: user.id, email: user.email, roles: user.roles }) }
}

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------
authRouter.post('/auth/register', async (req, res) => {
  const { email, password, name } = registerSchema.parse(req.body)

  // A pre-check for a friendly 409. The unique index is still the real
  // guarantee — two simultaneous registrations would both pass this check,
  // and the second one's insert is what actually fails.
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new HttpError(409, 'That email is already registered', { email: 'That email is already registered' })
  }

  const user = await prisma.user.create({
    data: { email, name, passwordHash: await hashPassword(password), roles: [Role.USER] },
  })

  res.status(201).json(issueSession(res, toPublicUser(user)))
})

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
authRouter.post('/auth/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { email } })

  // Deliberately the same error whether the email is unknown or the password
  // is wrong. Distinguishing them turns the login form into an endpoint for
  // enumerating which emails have accounts.
  //
  // The password is verified even when no user was found, against a throwaway
  // hash, so a missing account and a wrong password take the same time. A fast
  // "no" versus a slow "no" is the same leak measured with a stopwatch.
  const matches = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, '$2a$12$0000000000000000000000000000000000000000000000000000')

  if (!user || !matches) {
    throw unauthorized('Invalid email or password')
  }

  res.json(issueSession(res, toPublicUser(user)))
})

// ---------------------------------------------------------------------------
// POST /auth/refresh — the cookie alone is the credential
// ---------------------------------------------------------------------------
authRouter.post('/auth/refresh', async (req, res) => {
  const token: unknown = req.cookies?.[REFRESH_COOKIE_NAME]

  if (typeof token !== 'string' || token.length === 0) {
    throw unauthorized('No refresh token')
  }

  const claims = verifyRefreshToken(token)

  // The token proves the user existed when it was issued, up to seven days
  // ago. This read confirms they still exist and picks up role changes made
  // since — the one place where fresh authorisation data is worth a query.
  const user = await prisma.user.findUnique({ where: { id: claims.sub } })

  if (!user) {
    clearRefreshCookie(res)
    throw unauthorized('Invalid or expired token')
  }

  // The refresh cookie is reissued too, so an active user's seven days slide
  // forward instead of logging them out mid-session. Worth knowing: without a
  // server-side record of issued tokens, a stolen refresh token stays valid
  // until it expires. Revocation needs a token store, which is a later
  // problem than this ticket.
  res.json(issueSession(res, toPublicUser(user)))
})

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
authRouter.post('/auth/logout', (_req, res) => {
  // No requireAuth on purpose. Logging out with an already-expired access
  // token must still clear the cookie, and a 401 here would strand the user
  // in a half-logged-in state.
  clearRefreshCookie(res)
  res.status(204).end()
})

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------
authRouter.get('/auth/me', requireAuth, async (req, res) => {
  // Reads the database rather than echoing the token's claims, so a name or
  // role changed ten seconds ago shows up here immediately.
  const user = await prisma.user.findUnique({ where: { id: req.user?.id } })

  if (!user) {
    throw unauthorized('Invalid or expired token')
  }

  res.json({ user: toPublicUser(user) })
})
