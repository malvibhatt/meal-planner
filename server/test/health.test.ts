import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'

const app = createApp()

describe('GET /health', () => {
  it('returns 200 with { ok: true }', async () => {
    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

describe('unmatched routes', () => {
  it('returns a JSON 404, not an HTML page', async () => {
    const res = await request(app).get('/nope')

    expect(res.status).toBe(404)
    expect(res.type).toBe('application/json')
    expect(res.body.message).toContain('/nope')
  })
})
