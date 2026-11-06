import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import type { UserJob } from '@job-hunter/shared'
import { UserJobInputSchema, UserJobUpdateSchema } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import {
  createUserJob,
  getUserJob,
  listUserJobs,
  previewJobFromUrl,
  resyncUserJob,
  PreviewError,
  type JobPageExtractor,
} from '../userJobs/userJobsService.js'

const URL_SCHEMA_PATTERN = /^https?:\/\//i

// `getExtractor` is read per request so runtime-saved AI credentials apply immediately; it
// returns null when no LLM is configured, in which case preview/resync fall back to the
// heuristic extractor exactly as before.
export function createUserJobsRoutes(
  db: Db,
  jwtSecret: string,
  getExtractor: () => JobPageExtractor | null
) {
  const userJobsRoutes = new Hono<{ Variables: AuthVariables }>()
  userJobsRoutes.use('*', createRequireAuth(jwtSecret))

  // Fetch + parse a pasted URL into an editable preview. Nothing is persisted here.
  userJobsRoutes.post('/preview', async (c) => {
    const body = await c.req.json().catch(() => null)
    const url = typeof body?.url === 'string' ? body.url.trim() : ''
    if (!url || !URL_SCHEMA_PATTERN.test(url)) {
      return c.json({ error: 'Enter a valid http(s) URL.' }, 400)
    }
    try {
      const preview = await previewJobFromUrl(url, getExtractor())
      return c.json(preview)
    } catch (reason) {
      if (reason instanceof PreviewError) return c.json({ error: reason.message }, 422)
      console.error('failed to preview user job', reason)
      return c.json({ error: 'Failed to read that page.' }, 500)
    }
  })

  userJobsRoutes.get('/', async (c) => {
    const jobs = await listUserJobs(db, c.get('profileId'))
    return c.json({ jobs })
  })

  userJobsRoutes.get('/:id', async (c) => {
    const job = await getUserJob(db, c.get('profileId'), c.req.param('id'))
    if (!job) return c.json({ error: 'job not found' }, 404)
    return c.json(job)
  })

  userJobsRoutes.post('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = UserJobInputSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid job.' }, 400)
    }
    const job = await createUserJob(db, c.get('profileId'), parsed.data)
    return c.json(job, 201)
  })

  // Update a saved job the caller owns — currently just the private/public toggle.
  userJobsRoutes.patch('/:id', async (c) => {
    const id = c.req.param('id')
    if (!ObjectId.isValid(id)) return c.json({ error: 'job not found' }, 404)
    const body = await c.req.json().catch(() => null)
    const parsed = UserJobUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid update.' }, 400)
    }

    // Query by ObjectId `_id` via the untyped collection handle (the shared
    // schema types `_id` as a string), matching the pattern in jobs.ts.
    const result = await db.collection('userJobs').findOneAndUpdate(
      { _id: new ObjectId(id), profileId: c.get('profileId') },
      { $set: { ...parsed.data, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' }
    )
    if (!result) return c.json({ error: 'job not found' }, 404)
    return c.json(result as unknown as UserJob)
  })

  // Re-scrape a link-synced job from its stored URL and refresh it in place.
  // Mirrors /jobs/:id/resync for operator-added discovery jobs.
  userJobsRoutes.post('/:id/resync', async (c) => {
    const id = c.req.param('id')
    if (!ObjectId.isValid(id)) return c.json({ error: 'job not found' }, 404)
    try {
      const job = await resyncUserJob(db, c.get('profileId'), id, getExtractor())
      if (!job) return c.json({ error: 'job not found' }, 404)
      return c.json(job)
    } catch (reason) {
      if (reason instanceof PreviewError) return c.json({ error: reason.message }, 422)
      console.error('failed to resync user job', reason)
      return c.json({ error: 'Failed to resync that job.' }, 500)
    }
  })

  userJobsRoutes.delete('/:id', async (c) => {
    const id = c.req.param('id')
    if (!ObjectId.isValid(id)) return c.json({ error: 'job not found' }, 404)
    const result = await db
      .collection('userJobs')
      .deleteOne({ _id: new ObjectId(id), profileId: c.get('profileId') })
    if (result.deletedCount === 0) return c.json({ error: 'job not found' }, 404)
    return c.body(null, 204)
  })

  return userJobsRoutes
}
