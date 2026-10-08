import 'dotenv/config'
import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 moved the datasource URL out of schema.prisma and into this file.
 * That is an improvement: the URL is now resolved by real TypeScript, so the
 * CLI reads the same `.env` the server does instead of Prisma's own
 * half-working env loader.
 *
 * Note `process.env[...]` rather than the `env()` helper from `prisma/config`.
 * `env()` resolves eagerly and throws if the variable is missing — and this
 * file is loaded by *every* prisma command, including `generate`, which does
 * not touch a database. That combination breaks `npm ci` anywhere there is no
 * .env file, CI being the obvious one. Reading process.env directly leaves the
 * URL undefined until a command actually needs it, at which point Prisma
 * reports a clear "no datasource URL" error of its own.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma migrate reset` and `prisma db seed` both run this.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
})
