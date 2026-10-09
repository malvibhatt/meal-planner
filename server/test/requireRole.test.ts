import { beforeEach, afterAll, describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireAuth, requireRole } from '../src/middleware/requireAuth.ts'
import { errorHandler } from '../src/middleware/errorHandler.ts'
import { signAccessToken } from '../src/auth/tokens.ts'
import { Role } from '../generated/prisma/enums.ts'
import { resetDb, testDb } from './helpers/db.ts'

/**
 * A throwaway app with one guarded route. Testing the middleware directly
 * rather than through a real endpoint keeps this honest — there is no
 * admin-only route yet (MP-13's recipe delete is the first), and this proves
 * the gate works before anything depends on it.
 */
const app = express()
app.get('/admin-only', requireAuth, requireRole(Role.ADMIN), (req, res) => {
  res.json({ ok: true, as: req.user?.email })
})
app.get('/staff-only', requireAuth, requireRole(Role.ADMIN, Role.USER), (_req, res) => {
  res.json({ ok: true })
})
app.use(errorHandler)

const tokenFor = (email: string, roles: Role[]) => signAccessToken({ id: 'u_1', email, roles })

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('requireRole', () => {
  it('401s when nobody is authenticated — "I do not know who you are"', async () => {
    const res = await request(app).get('/admin-only')

    expect(res.status).toBe(401)
  })

  it('403s an authenticated user who lacks the role — "I know, and the answer is no"', async () => {
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${tokenFor('u@x.com', [Role.USER])}`)

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/permission/i)
  })

  it('lets an admin through', async () => {
    const token = tokenFor('a@x.com', [Role.USER, Role.ADMIN])

    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.as).toBe('a@x.com')
  })

  it('passes when the user holds any one of several accepted roles', async () => {
    const res = await request(app).get('/staff-only').set('Authorization', `Bearer ${tokenFor('u@x.com', [Role.USER])}`)

    expect(res.status).toBe(200)
  })
})
