import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { connectMongo } from './db.js'
import { mountRoutes } from './mountRoutes.js'
import { ensureJobIndexes } from './discovery/discoveryService.js'
import { ensureMaterialsIndexes } from './materials/materialsService.js'
import { ensureUserJobsIndexes } from './userJobs/userJobsService.js'
import { ensureApplicationIndexes } from './applications/applicationsService.js'
import { ensureAutomationRunIndexes } from './applications/automationRunsService.js'
import { ensureJobTrackingIndexes } from './jobTracking/jobTrackingService.js'
import { createAiRuntime } from './ai/aiRuntime.js'
import { ensureVectorIndexes } from './suggestions/vectorSearch.js'

async function main() {
  const mongodbUri = process.env.MONGODB_URI
  const jwtSecret = process.env.JWT_SECRET
  const cronSecret = process.env.CRON_SECRET
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')
  if (!cronSecret) throw new Error('CRON_SECRET is required')

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')
  await ensureJobIndexes(db)
  await ensureMaterialsIndexes(db)
  await ensureUserJobsIndexes(db)
  await ensureApplicationIndexes(db)
  await ensureAutomationRunIndexes(db)
  await ensureJobTrackingIndexes(db)

  // The AI runtime builds the active LLM provider + embedder from DB settings merged over
  // env; it can be hot-reloaded from the admin settings page, so AI routes mount regardless
  // of whether a key is present at startup.
  const ai = await createAiRuntime(db)
  if (ai.llm) {
    console.log(
      `LLM provider: ${ai.llm.providerName} ` +
        `(resume=${ai.llm.resume.model}, requirements=${ai.llm.requirements.model}, materials=${ai.llm.materials.model})`
    )
  } else {
    console.warn('No LLM API key configured — /scoring, /materials disabled until set in admin settings')
  }
  if (ai.embedder) {
    console.log(
      `Embeddings (${ai.settings.embeddingMode}): ${ai.embedder.model} (${ai.embedder.dimensions} dims)`
    )
    await ensureVectorIndexes(db, ai.embedder.dimensions)
  } else {
    console.warn('No embedder configured — /suggestions disabled until set in admin settings')
  }

  const app = mountRoutes(createApp(), db, jwtSecret, cronSecret, ai)

  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`API listening on http://localhost:${port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
