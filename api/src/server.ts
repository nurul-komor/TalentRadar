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
import { createLlmConfig } from './llm/config.js'

async function main() {
  const mongodbUri = process.env.MONGODB_URI
  const jwtSecret = process.env.JWT_SECRET
  const cronSecret = process.env.CRON_SECRET
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')
  if (!cronSecret) throw new Error('CRON_SECRET is required')

  // LLM_PROVIDER (default "anthropic") selects which provider and models power the AI
  // routes; the config is null when that provider's API key is missing.
  const llmConfig = createLlmConfig(process.env)
  if (!llmConfig) {
    const provider = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase()
    const keyName =
      provider === 'openai'
        ? 'OPENAI_API_KEY'
        : provider === 'gemini' || provider === 'google'
          ? 'GEMINI_API_KEY'
          : 'ANTHROPIC_API_KEY'
    console.warn(
      `${keyName} is not set — /scoring and /materials routes will be disabled (LLM_PROVIDER=${provider})`
    )
  } else {
    console.log(
      `LLM provider: ${llmConfig.providerName} ` +
        `(resume=${llmConfig.resume.model}, requirements=${llmConfig.requirements.model}, materials=${llmConfig.materials.model})`
    )
  }

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')
  await ensureJobIndexes(db)
  await ensureMaterialsIndexes(db)
  await ensureUserJobsIndexes(db)
  await ensureApplicationIndexes(db)
  await ensureAutomationRunIndexes(db)
  await ensureJobTrackingIndexes(db)

  const app = mountRoutes(createApp(), db, jwtSecret, cronSecret, llmConfig)

  const port = Number(process.env.PORT ?? 8787)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`API listening on http://localhost:${port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
