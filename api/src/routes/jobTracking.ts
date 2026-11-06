import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { TrackedJobInputSchema, TrackedJobUpdateSchema, TrackedJobImportSchema } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import {
  listTrackedJobs,
  createTrackedJob,
  updateTrackedJob,
  deleteTrackedJob,
  resolveImportPrefill,
} from '../jobTracking/jobTrackingService.js'

export function createJobTrackingRoutes(db: Db, jwtSecret: string) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  routes.use('*', createRequireAuth(jwtSecret))

  routes.get('/', async (c) => {
    const jobs = await listTrackedJobs(db, c.get('profileId'))
    return c.json({ jobs })
  })

  routes.post('/', async (c) => {
    const parsed = TrackedJobInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid job.' }, 400)
    }
    const job = await createTrackedJob(db, c.get('profileId'), parsed.data)
    return c.json(job, 201)
  })

  // Create a tracked job pre-filled from an existing discovered job, user-added
  // job, or application the caller owns.
  routes.post('/import', async (c) => {
    const parsed = TrackedJobImportSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid import.' }, 400)
    }
    const profileId = c.get('profileId')
    const prefill = await resolveImportPrefill(db, profileId, parsed.data.kind, parsed.data.id)
    if (!prefill) return c.json({ error: 'Source record not found.' }, 404)
    const { materialsJobId, ...fields } = prefill
    const job = await createTrackedJob(
      db,
      profileId,
      { ...fields, status: 'not_applied' },
      { kind: parsed.data.kind, id: parsed.data.id },
      materialsJobId
    )
    return c.json(job, 201)
  })

  routes.patch('/:id', async (c) => {
    const parsed = TrackedJobUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid update.' }, 400)
    }
    const job = await updateTrackedJob(db, c.get('profileId'), c.req.param('id'), parsed.data)
    if (!job) return c.json({ error: 'job not found' }, 404)
    return c.json(job)
  })

  routes.delete('/:id', async (c) => {
    const removed = await deleteTrackedJob(db, c.get('profileId'), c.req.param('id'))
    if (!removed) return c.json({ error: 'job not found' }, 404)
    return c.body(null, 204)
  })

  return routes
}
