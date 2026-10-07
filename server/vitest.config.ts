import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests import the app, which validates the environment at import time.
    // These values satisfy that validation so the suite needs no .env file —
    // which is also what makes it run in CI.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/meal_planner_test',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    },
  },
})
