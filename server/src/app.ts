import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { env } from './config/env.ts'
import { healthRouter } from './routes/health.ts'
import { authRouter } from './routes/auth.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { notFound } from './middleware/notFound.ts'

/**
 * Builds the Express app without starting a listener. The split matters:
 * `index.ts` owns the port, tests import this and drive it in-process with
 * supertest — no port, no race, no cleanup.
 */
export function createApp() {
  const app = express()

  // Express sees the real client IP and protocol when behind a proxy (needed
  // for `secure` cookies to work in production).
  app.set('trust proxy', 1)

  app.use(
    cors({
      // A single explicit origin, not `*`. `credentials: true` is what allows
      // the browser to send the httpOnly refresh cookie (MP-12), and the spec
      // forbids pairing credentials with a wildcard origin.
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  )

  // Caps the request body. Without a limit, one large POST is a denial of
  // service. 1mb is generous for JSON; photo uploads take a different path
  // through multer in MP-13.
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.use(healthRouter)
  app.use(authRouter)

  // Order is load-bearing: 404 after all routes, error handler dead last.
  app.use(notFound)
  app.use(errorHandler)

  return app
}
