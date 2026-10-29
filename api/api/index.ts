import { createApp } from '../src/app.js'
import { connectMongo } from '../src/db.js'
import { mountRoutes } from '../src/mountRoutes.js'
import { ensureJobIndexes } from '../src/discovery/discoveryService.js'

// Fluid Compute reuses warm instances across invocations, so the Mongo
// connection and assembled app are cached at module scope instead of being
// rebuilt on every request.
let appPromise: ReturnType<typeof buildApp> | undefined

async function buildApp() {
  const mongodbUri = process.env.MONGODB_URI
  const jwtSecret = process.env.JWT_SECRET
  const cronSecret = process.env.CRON_SECRET
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')
  if (!cronSecret) throw new Error('CRON_SECRET is required')

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')
  await ensureJobIndexes(db)
  return mountRoutes(createApp(), db, jwtSecret, cronSecret)
}

// A bare `export default function handler(request)` is treated by Vercel as the
// legacy Node (req, res) signature and gets handed a raw Node request instead of a
// Web API Request, breaking Hono's `c.req.header()`. The fetch Web Standard export
// (default-exported object with a `fetch` method) is required to get a real Request.
export default {
  async fetch(request: Request) {
    if (!appPromise) appPromise = buildApp()
    const app = await appPromise
    return app.fetch(request)
  },
}
