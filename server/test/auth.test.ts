import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.ts'
import { Role } from '../generated/prisma/enums.ts'
import { createUser, resetDb, testDb } from './helpers/db.ts'
import { cookieValue, getSetCookie } from './helpers/cookies.ts'

const app = createApp()

const VALID = { email: 'new@example.com', password: 'correct-horse', name: 'New Cook' }

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('POST /auth/register', () => {
  it('creates the user, returns { user, accessToken } and sets the refresh cookie', async () => {
    const res = await request(app).post('/auth/register').send(VALID)

    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ email: VALID.email, name: VALID.name, roles: [Role.USER] })
    expect(res.body.accessToken).toBeTypeOf('string')
    expect(getSetCookie(res, REFRESH_COOKIE_NAME)).toBeDefined()
  })

  it('never returns the password hash', async () => {
    const res = await request(app).post('/auth/register').send(VALID)

    expect(res.body.user).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(res.body)).not.toContain('$2')
  })

  it('stores the email lowercased and trimmed', async () => {
    await request(app).post('/auth/register').send({ ...VALID, email: '  MiXeD@Example.COM ' })

    expect(await testDb.user.findUnique({ where: { email: 'mixed@example.com' } })).not.toBeNull()
  })

  it('rejects a duplicate email with 409', async () => {
    await createUser({ email: VALID.email, password: 'whatever1' })

    const res = await request(app).post('/auth/register').send(VALID)

    expect(res.status).toBe(409)
    expect(res.body.errors).toHaveProperty('email')
  })

  it('returns the 422 field-error shape the frontend forms expect', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'nope', password: 'short', name: '' })

    expect(res.status).toBe(422)
    expect(res.body.message).toBe('Validation failed')
    expect(Object.keys(res.body.errors).sort()).toEqual(['email', 'name', 'password'])
    expect(res.body.errors.password).toMatch(/at least 8/)
  })
})

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await createUser({ email: 'cook@example.com', password: 'correct-horse', name: 'Cook' })
  })

  it('returns { user, accessToken } and sets an httpOnly, sameSite refresh cookie', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'cook@example.com', password: 'correct-horse' })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('cook@example.com')
    expect(res.body.accessToken).toBeTypeOf('string')

    const cookie = getSetCookie(res, REFRESH_COOKIE_NAME)
    expect(cookie).toBeDefined()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\/auth/i)
    // 7 days, as the ticket specifies.
    expect(cookie).toMatch(/Max-Age=604800/i)
  })

  it('accepts a differently-cased email', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'COOK@example.com', password: 'correct-horse' })

    expect(res.status).toBe(200)
  })

  it('rejects a wrong password with 401', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'cook@example.com', password: 'wrong-horse' })

    expect(res.status).toBe(401)
    expect(getSetCookie(res, REFRESH_COOKIE_NAME)).toBeUndefined()
  })

  it('gives an unknown email the identical error to a wrong password, so accounts cannot be enumerated', async () => {
    const unknown = await request(app).post('/auth/login').send({ email: 'ghost@example.com', password: 'whatever1' })
    const wrong = await request(app).post('/auth/login').send({ email: 'cook@example.com', password: 'wrong-horse' })

    expect(unknown.status).toBe(wrong.status)
    expect(unknown.body).toEqual(wrong.body)
  })
})

describe('GET /auth/me', () => {
  it('401s without a token', async () => {
    const res = await request(app).get('/auth/me')

    expect(res.status).toBe(401)
  })

  it('401s on a malformed or tampered token', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', 'Bearer not.a.jwt')

    expect(res.status).toBe(401)
  })

  it('401s when the Authorization header is missing the Bearer scheme', async () => {
    const login = await registerAndLogin()
    const res = await request(app).get('/auth/me').set('Authorization', login.accessToken)

    expect(res.status).toBe(401)
  })

  it('returns the current user for a valid access token', async () => {
    const { accessToken } = await registerAndLogin()

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(VALID.email)
    expect(res.body.user).not.toHaveProperty('passwordHash')
  })

  it('reflects a role change immediately, because it reads the database', async () => {
    const { accessToken, user } = await registerAndLogin()
    await testDb.user.update({ where: { id: user.id }, data: { roles: [Role.USER, Role.ADMIN] } })

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`)

    expect(res.body.user.roles).toEqual([Role.USER, Role.ADMIN])
  })

  it('refuses a refresh token used as an access token', async () => {
    const { refreshCookie } = await registerAndLogin()
    const refreshToken = cookieValue(refreshCookie).split('=')[1] ?? ''

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${refreshToken}`)

    expect(res.status).toBe(401)
  })
})

describe('POST /auth/refresh', () => {
  it('issues a new access token from the cookie alone — no Authorization header', async () => {
    const { refreshCookie } = await registerAndLogin()

    const res = await request(app).post('/auth/refresh').set('Cookie', cookieValue(refreshCookie))

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTypeOf('string')
    expect(res.body.user.email).toBe(VALID.email)

    // And the new token actually works.
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`)
    expect(me.status).toBe(200)
  })

  it('slides the refresh cookie forward', async () => {
    const { refreshCookie } = await registerAndLogin()

    const res = await request(app).post('/auth/refresh').set('Cookie', cookieValue(refreshCookie))

    expect(getSetCookie(res, REFRESH_COOKIE_NAME)).toBeDefined()
  })

  it('401s with no cookie', async () => {
    const res = await request(app).post('/auth/refresh')

    expect(res.status).toBe(401)
  })

  it('401s when the cookie holds an access token rather than a refresh token', async () => {
    const { accessToken } = await registerAndLogin()

    const res = await request(app).post('/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${accessToken}`)

    expect(res.status).toBe(401)
  })

  it('401s once the user has been deleted', async () => {
    const { refreshCookie, user } = await registerAndLogin()
    await testDb.user.delete({ where: { id: user.id } })

    const res = await request(app).post('/auth/refresh').set('Cookie', cookieValue(refreshCookie))

    expect(res.status).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('clears the refresh cookie and returns 204', async () => {
    const { refreshCookie } = await registerAndLogin()

    const res = await request(app).post('/auth/logout').set('Cookie', cookieValue(refreshCookie))

    expect(res.status).toBe(204)
    expect(getSetCookie(res, REFRESH_COOKIE_NAME)).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i)
  })

  it('works without a valid access token, so an expired session can still log out', async () => {
    const res = await request(app).post('/auth/logout')

    expect(res.status).toBe(204)
  })
})

/** Registers VALID and hands back the token, cookie and row. */
async function registerAndLogin() {
  const res = await request(app).post('/auth/register').send(VALID)
  const refreshCookie = getSetCookie(res, REFRESH_COOKIE_NAME)

  if (!refreshCookie) throw new Error('register did not set a refresh cookie')

  return { accessToken: res.body.accessToken as string, refreshCookie, user: res.body.user as { id: string } }
}
