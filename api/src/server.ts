import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { connectMongo } from './db.js'
import { mountRoutes } from './mountRoutes.js'
import { ensureJobIndexes } from './discovery/discoveryService.js'
import { ensureMaterialsIndexes } from './materials/materialsService.js'
import { ensureApplicationIndexes } from './applications/applicationsService.js'
import { ensureAutomationRunIndexes } from './applications/automationRunsService.js'

async function main() {
  const mongodbUri = process.env.MONGODB_URI
  const jwtSecret = process.env.JWT_SECRET
  const cronSecret = process.env.CRON_SECRET
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')
  if (!cronSecret) throw new Error('CRON_SECRET is required')
  if (!anthropicApiKey) {
    console.warn('ANTHROPIC_API_KEY is not set — /scoring and /materials routes will be disabled')
  }

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')
  await ensureJobIndexes(db)
  await ensureMaterialsIndexes(db)
  await ensureApplicationIndexes(db)
  await ensureAutomationRunIndexes(db)

  const app = mountRoutes(createApp(), db, jwtSecret, cronSecret, anthropicApiKey)

  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`API listening on http://localhost:${port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
