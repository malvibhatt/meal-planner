import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.ts'
import { env } from '../config/env.ts'

/**
 * One PrismaClient for the whole process.
 *
 * Why a single instance: each client owns a connection pool. Constructing one
 * per request exhausts Postgres' connection limit within a few dozen requests
 * — a classic and confusing production failure. `tsx watch` restarts the whole
 * process on save, so there is no hot-reload leak to guard against here.
 *
 * Why the adapter: Prisma 7 dropped the bundled Rust query engine and the
 * `datasourceUrl` option with it. The database connection is now an ordinary
 * `pg` pool handed to the client, which is a genuine improvement — the pool is
 * a thing you can configure and inspect rather than a black box.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })

export const prisma = new PrismaClient({
  adapter,

  // In development, log every SQL statement Prisma runs. This is the cheapest
  // way to see whether the aggregations in MP-14 are one query or an N+1.
  log: env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
})
