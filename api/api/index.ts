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
  if (!mongodbUri) throw new Error('MONGODB_URI is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')

  const { db } = await connectMongo(mongodbUri, process.env.MONGODB_DB_NAME ?? 'job_hunter')
  await ensureJobIndexes(db)
  return mountRoutes(createApp(), db, jwtSecret)
}

export default async function handler(request: Request) {
  if (!appPromise) appPromise = buildApp()
  const app = await appPromise
  return app.fetch(request)
}
