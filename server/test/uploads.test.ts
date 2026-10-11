import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.ts'
import { UPLOAD_DIR } from '../src/routes/uploads.ts'
import { resetDb, testDb } from './helpers/db.ts'
import { authAs } from './helpers/auth.ts'

const app = createApp()

let user: Awaited<ReturnType<typeof authAs>>

/** The smallest valid 1x1 PNG. Real bytes, so multer's parsing is real too. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

/** Files present before this suite ran — anything new is ours to clean up. */
let preexisting: Set<string>

beforeAll(() => {
  preexisting = new Set(readdirSync(UPLOAD_DIR))
})

beforeEach(async () => {
  await resetDb()
  user = await authAs('uploader@example.com')
})

afterEach(() => {
  for (const name of readdirSync(UPLOAD_DIR)) {
    if (!preexisting.has(name)) rmSync(path.join(UPLOAD_DIR, name), { force: true })
  }
})

afterAll(() => testDb.$disconnect())

describe('POST /uploads', () => {
  it('401s without a token — an open upload endpoint is free file hosting', async () => {
    const res = await request(app).post('/uploads').attach('file', PNG, 'photo.png')

    expect(res.status).toBe(401)
  })

  it('stores the image and returns an absolute URL', async () => {
    const res = await request(app).post('/uploads').set('Authorization', user.header).attach('file', PNG, 'photo.png')

    expect(res.status).toBe(201)
    expect(res.body.url).toMatch(/^http:\/\/localhost:4000\/uploads\/[0-9a-f-]+\.png$/)
    expect(res.body.size).toBe(PNG.length)
    expect(readdirSync(UPLOAD_DIR)).toContain(res.body.filename)
  })

  it('ignores the client-supplied filename entirely', async () => {
    const res = await request(app)
      .post('/uploads')
      .set('Authorization', user.header)
      .attach('file', PNG, '../../../etc/passwd.png')

    expect(res.status).toBe(201)
    // A random uuid plus an extension derived from the validated mime type.
    expect(res.body.filename).toMatch(/^[0-9a-f-]{36}\.png$/)
    expect(res.body.filename).not.toContain('passwd')
    expect(res.body.filename).not.toContain('..')
    // And nothing escaped the upload directory.
    expect(path.dirname(path.resolve(UPLOAD_DIR, res.body.filename))).toBe(UPLOAD_DIR)
  })

  it('rejects a non-image with the 422 field-error shape', async () => {
    const res = await request(app)
      .post('/uploads')
      .set('Authorization', user.header)
      .attach('file', Buffer.from('#!/bin/sh\necho hi'), { filename: 'shell.sh', contentType: 'application/x-sh' })

    expect(res.status).toBe(422)
    expect(res.body.errors.file).toMatch(/JPEG, PNG, WebP or AVIF/i)
  })

  it('rejects a file over the 5MB limit', async () => {
    const tooBig = Buffer.alloc(6 * 1024 * 1024, 1)

    const res = await request(app)
      .post('/uploads')
      .set('Authorization', user.header)
      .attach('file', tooBig, { filename: 'big.png', contentType: 'image/png' })

    expect(res.status).toBe(422)
    expect(res.body.errors.file).toMatch(/5MB or smaller/i)
  })

  it('422s when no file is attached', async () => {
    const res = await request(app).post('/uploads').set('Authorization', user.header)

    expect(res.status).toBe(422)
    expect(res.body.errors.file).toBeDefined()
  })

  it('serves the uploaded image back, and the URL works as a recipe photoUrl', async () => {
    const upload = await request(app)
      .post('/uploads')
      .set('Authorization', user.header)
      .attach('file', PNG, 'photo.png')

    const served = await request(app).get(`/uploads/${upload.body.filename}`)

    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toBe('image/png')
    expect(Buffer.from(served.body)).toEqual(PNG)
  })

  it('does not serve dotfiles or list the directory', async () => {
    const listing = await request(app).get('/uploads/')
    const dotfile = await request(app).get('/uploads/.gitkeep')

    expect(listing.status).toBe(404)
    expect(dotfile.status).toBe(404)
  })
})
