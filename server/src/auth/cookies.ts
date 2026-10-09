import type { Response } from 'express'
import { isProduction } from '../config/env.ts'
import { REFRESH_TOKEN_TTL_SECONDS } from './tokens.ts'

export const REFRESH_COOKIE_NAME = 'mp_refresh'

/**
 * Scoped to /auth, so the browser sends the refresh token to the four auth
 * endpoints and nowhere else. Every other request to the API carries no
 * refresh token at all, which shrinks what a CSRF attempt or a leaky log can
 * reach.
 */
const REFRESH_COOKIE_PATH = '/auth'

const baseOptions = {
  // JavaScript cannot read it. This is the entire reason the refresh token
  // lives in a cookie instead of localStorage.
  httpOnly: true,

  // 'lax' lets the cookie ride along on normal navigation and same-site XHR
  // while withholding it from cross-site POSTs — the CSRF shape that matters
  // here. localhost:5173 and localhost:4000 are same-site (ports are not part
  // of a site), so this works in dev. A deployment on two different domains
  // would need sameSite: 'none' with secure: true.
  sameSite: 'lax',

  // HTTPS only in production; plain http has to work on localhost.
  secure: isProduction,

  path: REFRESH_COOKIE_PATH,
} as const

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  })
}

export function clearRefreshCookie(res: Response): void {
  // Must match name, path and options, or the browser treats it as a
  // different cookie and quietly keeps the original.
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions)
}
