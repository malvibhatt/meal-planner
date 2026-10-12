import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { env } from './config/env.ts'
import { healthRouter } from './routes/health.ts'
import { authRouter } from './routes/auth.ts'
import { ingredientsRouter } from './routes/ingredients.ts'
import { recipesRouter } from './routes/recipes.ts'
import { mealPlanRouter } from './routes/mealPlan.ts'
import { shoppingListRouter } from './routes/shoppingList.ts'
import { todosRouter } from './routes/todos.ts'
import { UPLOAD_DIR, uploadsRouter } from './routes/uploads.ts'
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
  app.use(ingredientsRouter)
  app.use(recipesRouter)
  app.use(mealPlanRouter)
  app.use(shoppingListRouter)
  app.use(todosRouter)
  app.use(uploadsRouter)

  // Serves the uploaded images back. `index: false` and `dotfiles: 'ignore'`
  // keep this from behaving like a general-purpose file server: no directory
  // listings, no serving anything that starts with a dot.
  app.use(
    '/uploads',
    express.static(UPLOAD_DIR, {
      index: false,
      dotfiles: 'ignore',
      // Filenames are random and content never changes under one, so these
      // can be cached hard.
      maxAge: '7d',
    }),
  )

  // Order is load-bearing: 404 after all routes, error handler dead last.
  app.use(notFound)
  app.use(errorHandler)

  return app
}
