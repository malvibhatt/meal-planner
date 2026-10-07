import { Router } from 'express'

export const healthRouter = Router()

/**
 * GET /health — liveness probe. No auth, no database. If this answers, the
 * process is up and routing works; that is the whole claim it makes.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true })
})
