import type { Response } from 'supertest'

/**
 * Pulls one cookie out of a response's Set-Cookie header.
 *
 * supertest gives raw header strings, and the refresh-token assertions care
 * about the attributes (HttpOnly, SameSite, Path, Max-Age) as much as the
 * value — those attributes are the security properties the ticket asks for.
 */
export function getSetCookie(res: Response, name: string): string | undefined {
  const header = res.headers['set-cookie']
  const all = Array.isArray(header) ? header : header ? [header] : []

  return all.find((cookie) => cookie.startsWith(`${name}=`))
}

/** The `name=value` part only, formatted for sending back in a Cookie header. */
export function cookieValue(setCookie: string): string {
  return setCookie.split(';')[0] ?? ''
}
