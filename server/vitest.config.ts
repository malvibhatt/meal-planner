import 'dotenv/config'
import { defineConfig } from 'vitest/config'

/**
 * The suite talks to a real Postgres — the auth endpoints are mostly about
 * what the database enforces (the unique email index, the user actually
 * existing), and mocking Prisma would test the mock.
 *
 * TEST_DATABASE_URL must be set, and must be a *different* database from
 * DATABASE_URL, because globalSetup migrates it and every test truncates it.
 */
const databaseUrl = process.env['TEST_DATABASE_URL']

if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy it from .env.example — it must point at a throwaway database, not your dev one.',
  )
}

// The guard rail that matters. Without it, one careless copy-paste in .env
// points the suite at the development database and the first `beforeEach`
// truncates all your seed data. Costs nothing, prevents a bad afternoon.
if (!/_test(\?|$)/.test(databaseUrl)) {
  throw new Error(`Refusing to run: TEST_DATABASE_URL must name a database ending in "_test" (got "${databaseUrl}").`)
}

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],

    // Never discover tests inside build output. tsconfig.build.json already
    // keeps test/ out of dist/, but a stale dist from an older build would
    // otherwise be collected as a duplicate suite.
    exclude: ['**/node_modules/**', 'dist/**', 'generated/**'],

    // Tests import the app, which validates the environment at import time.
    // These values satisfy that validation, so the suite needs no .env of its
    // own beyond the database URL above.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      CLIENT_ORIGIN: 'http://localhost:5173',
    },

    // One worker. The tests share a database and truncate it between cases,
    // so running files in parallel would have them deleting each other's rows.
    fileParallelism: false,
  },
})
