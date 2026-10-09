import { execFileSync } from 'node:child_process'

/**
 * Brings the test database up to the current migrations once, before any test
 * runs. `migrate deploy` (not `dev`) is the right verb: it applies committed
 * migrations and never prompts or invents new ones.
 *
 * This is what lets both a fresh clone and CI run `npm test` with nothing but
 * an empty database to point at.
 */
export default function setup() {
  const databaseUrl = process.env['TEST_DATABASE_URL']

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })
}
