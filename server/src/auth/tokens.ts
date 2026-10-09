import jwt from 'jsonwebtoken'
import { env } from '../config/env.ts'
import type { Role } from '../../generated/prisma/enums.ts'
import { unauthorized } from '../lib/httpError.ts'

/**
 * Two tokens, two very different jobs.
 *
 * The access token is short-lived and travels in the `Authorization` header,
 * where JavaScript can read it. Fifteen minutes is the blast radius if it
 * leaks.
 *
 * The refresh token is long-lived and travels only in an httpOnly cookie,
 * where JavaScript cannot read it. It can mint access tokens but is useless
 * to an XSS payload.
 *
 * Both are signed with the same JWT_SECRET, and each carries a `typ` claim
 * that is checked on verification. Without that check an attacker could
 * present a refresh token as an access token and get a 7-day session out of
 * a 15-minute one. Two separate secrets would be stronger still; one secret
 * plus a verified `typ` is the simpler design that closes the same hole, and
 * it keeps .env to the single JWT_SECRET the roadmap specifies.
 */
export const ACCESS_TOKEN_TTL = '15m'
export const REFRESH_TOKEN_TTL = '7d'

/** Seconds, for the cookie's maxAge. Kept beside the TTL above so they cannot drift. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

type AccessClaims = {
  sub: string
  typ: 'access'
  email: string
  roles: Role[]
}

type RefreshClaims = {
  sub: string
  typ: 'refresh'
}

export const signAccessToken = (user: { id: string; email: string; roles: Role[] }): string =>
  jwt.sign({ typ: 'access', email: user.email, roles: user.roles } satisfies Omit<AccessClaims, 'sub'>, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: ACCESS_TOKEN_TTL,
  })

export const signRefreshToken = (user: { id: string }): string =>
  jwt.sign({ typ: 'refresh' } satisfies Omit<RefreshClaims, 'sub'>, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: REFRESH_TOKEN_TTL,
  })

/**
 * Verifies signature, expiry and token type in one go. Every failure mode —
 * tampered signature, expired, wrong type, malformed — collapses to the same
 * 401. Telling a caller *why* their token is invalid is free information for
 * an attacker.
 */
function verify(token: string, expected: 'access' | 'refresh'): jwt.JwtPayload {
  let payload: string | jwt.JwtPayload

  try {
    payload = jwt.verify(token, env.JWT_SECRET)
  } catch {
    throw unauthorized('Invalid or expired token')
  }

  if (typeof payload === 'string' || payload.typ !== expected || typeof payload.sub !== 'string') {
    throw unauthorized('Invalid or expired token')
  }

  return payload
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = verify(token, 'access')

  return {
    sub: payload.sub as string,
    typ: 'access',
    email: typeof payload.email === 'string' ? payload.email : '',
    roles: Array.isArray(payload.roles) ? (payload.roles as Role[]) : [],
  }
}

export function verifyRefreshToken(token: string): RefreshClaims {
  const payload = verify(token, 'refresh')

  return { sub: payload.sub as string, typ: 'refresh' }
}
