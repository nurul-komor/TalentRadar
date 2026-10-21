import { serve } from '@hono/node-server'
import { createApp } from './app'
import { connectMongo } from './db'
import { createAuthRoutes } from './routes/auth'

async function main() {
  const mongodbUri = process.env.MONGODB_URI
  const jwtSecret = process.env.JWT_SECRET
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')

  const app = createApp()
  app.route('/auth', createAuthRoutes(db, jwtSecret))

  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`API listening on http://localhost:${port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
