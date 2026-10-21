import { serve } from '@hono/node-server'
import { createApp } from './app'

const port = Number(process.env.PORT ?? 8787)
const app = createApp()

serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on http://localhost:${port}`)
})
