import { serve } from '@hono/node-server'
import { createApp } from './app'
import { connectMongo } from './db'
import { createAuthRoutes } from './routes/auth'
import { createProfileRoutes } from './routes/profile'
import { createDiscoveryRoutes } from './routes/discovery'
import { ensureJobIndexes } from './discovery/discoveryService'
import { remoteOkSource } from './discovery/sources/remoteok'
import { weWorkRemotelySource } from './discovery/sources/weworkremotely'
import { himalayasSource } from './discovery/sources/himalayas'

async function main() {
  const mongodbUri = process.env.MONGODB_URI
  const jwtSecret = process.env.JWT_SECRET
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')
  await ensureJobIndexes(db)

  const app = createApp()
  app.route('/auth', createAuthRoutes(db, jwtSecret))
  app.route('/profile', createProfileRoutes(db, jwtSecret))
  app.route(
    '/discovery',
    createDiscoveryRoutes(db, jwtSecret, [remoteOkSource, weWorkRemotelySource, himalayasSource])
  )

  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`API listening on http://localhost:${port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
