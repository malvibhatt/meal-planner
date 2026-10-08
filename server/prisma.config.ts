import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

/**
 * Prisma 7 moved the datasource URL out of schema.prisma and into this file.
 * That is an improvement: the URL is now resolved by real TypeScript, so the
 * CLI reads the same `.env` the server does instead of Prisma's own
 * half-working env loader.
 *
 * `env()` fails loudly if DATABASE_URL is missing, which is what we want for
 * a destructive-by-nature tool like `migrate`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma migrate reset` and `prisma db seed` both run this.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
