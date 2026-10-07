import { createApp } from './app.ts'
import { env } from './config/env.ts'

const app = createApp()

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`)
  console.log(`CORS origin: ${env.CLIENT_ORIGIN}`)
})
