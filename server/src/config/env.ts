import 'dotenv/config'
import { z } from 'zod'

/**
 * Every environment variable the server reads, in one place, validated once at
 * boot. The payoff: a missing or malformed variable fails immediately with a
 * readable message, instead of surfacing as `undefined` three layers deep at
 * 2am. Nothing else in the codebase touches `process.env`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Everything arrives as a string; coerce turns "4000" into 4000.
  PORT: z.coerce.number().int().positive().default(4000),

  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // 32 chars is the floor for an HMAC-SHA256 secret worth the name.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:\n')
  console.error(z.prettifyError(parsed.error))
  console.error('\nCopy server/.env.example to server/.env and fill it in.')
  process.exit(1)
}

export const env = parsed.data

export const isProduction = env.NODE_ENV === 'production'
