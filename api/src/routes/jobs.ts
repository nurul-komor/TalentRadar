import { Hono } from 'hono'
import { ObjectId, type Db, type Filter } from 'mongodb'
import type { Job, JobSourceId, JobStatus } from '@job-hunter/shared'
import { JobSourceIdSchema, JobStatusSchema, UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import type { JobSource } from '../discovery/types.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

// Force-sync is restricted to this operator account, both in the dashboard UI
// and here as a server-side guard so the endpoint can't be called by others.
const FORCE_SYNC_EMAIL = 'nurulkomor123@gmail.com'

export const GOVT_JOB_SOURCE_IDS = UNSCORED_JOB_SOURCE_IDS

function parseLimit(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

function parseOffset(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return 0
  return parsed
}

function parseStatus(raw: string | undefined): JobStatus | undefined {
  const parsed = JobStatusSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

function parseSourceId(raw: string | undefined): JobSourceId | undefined {
  const parsed = JobSourceIdSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

function parseCategory(raw: string | undefined): 'government' | 'private' | undefined {
  return raw === 'government' || raw === 'private' ? raw : undefined
}

function parseText(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

function parseSalaryBound(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseIsoDate(raw: string | undefined): string | undefined {
  if (!raw || Number.isNaN(Date.parse(raw))) return undefined
  return raw
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildJobsFilter(query: {
  status?: JobStatus
  sourceId?: JobSourceId
  category?: 'government' | 'private'
  keyword?: string
  location?: string
  company?: string
  salaryMin?: number
  salaryMax?: number
  discoveredAfter?: string
}): Filter<Job> {
  const filter: Filter<Job> = {}
  if (query.status) filter.status = query.status
  if (query.sourceId) filter.sourceId = query.sourceId
  if (query.category === 'government') filter.sourceId = { $in: GOVT_JOB_SOURCE_IDS }
  if (query.category === 'private') filter.sourceId = { $nin: GOVT_JOB_SOURCE_IDS }
  if (query.location) filter.location = { $regex: escapeRegex(query.location), $options: 'i' }
  if (query.company) filter.company = { $regex: `^${escapeRegex(query.company)}$`, $options: 'i' }
  if (query.keyword) {
    const pattern = escapeRegex(query.keyword)
    filter.$or = [{ title: { $regex: pattern, $options: 'i' } }, { company: { $regex: pattern, $options: 'i' } }]
  }
  if (query.salaryMin !== undefined) filter.salaryMax = { $gte: query.salaryMin }
  if (query.salaryMax !== undefined) filter.salaryMin = { $lte: query.salaryMax }
  if (query.discoveredAfter) filter.discoveredAt = { $gte: query.discoveredAfter }
  return filter
}

export function createJobsRoutes(db: Db, jwtSecret: string, sources: JobSource[]) {
  const jobsRoutes = new Hono<{ Variables: AuthVariables }>()

  jobsRoutes.get('/', async (c) => {
    const limit = parseLimit(c.req.query('limit'))
    const offset = parseOffset(c.req.query('offset'))
    const filter = buildJobsFilter({
      status: parseStatus(c.req.query('status')),
      sourceId: parseSourceId(c.req.query('sourceId')),
      category: parseCategory(c.req.query('category')),
      keyword: parseText(c.req.query('q')),
      location: parseText(c.req.query('location')),
      company: parseText(c.req.query('company')),
      salaryMin: parseSalaryBound(c.req.query('salaryMin')),
      salaryMax: parseSalaryBound(c.req.query('salaryMax')),
      discoveredAfter: parseIsoDate(c.req.query('discoveredAfter')),
    })

    const jobs = db.collection<Job>('jobs')

    const [results, total] = await Promise.all([
      jobs.find(filter).sort({ discoveredAt: -1 }).skip(offset).limit(limit).toArray(),
      jobs.countDocuments(filter),
    ])

    return c.json({ jobs: results, total })
  })

  jobsRoutes.get('/:id', async (c) => {
    const id = c.req.param('id')
    if (!ObjectId.isValid(id)) {
      return c.json({ error: 'job not found' }, 404)
    }

    const job = await db.collection('jobs').findOne<Job>({ _id: new ObjectId(id) })
    if (!job) {
      return c.json({ error: 'job not found' }, 404)
    }
    return c.json(job)
  })

  // Force-sync re-scrapes a single job from its source and overwrites the stored
  // description/location. Normal discovery skips already-known jobs as
  // duplicates, so this is the only way to refresh a stale posting in place.
  // Restricted to the operator account (checked here, not just in the UI).
  jobsRoutes.post('/:id/resync', createRequireAuth(jwtSecret), async (c) => {
    const profileId = c.get('profileId')
    let profile: { email?: string } | null = null
    try {
      profile = await db.collection('profiles').findOne<{ email?: string }>({ _id: new ObjectId(profileId) })
    } catch {
      profile = null
    }
    if (!profile || profile.email !== FORCE_SYNC_EMAIL) {
      return c.json({ error: 'forbidden' }, 403)
    }

    const id = c.req.param('id')
    if (!ObjectId.isValid(id)) {
      return c.json({ error: 'job not found' }, 404)
    }

    const jobs = db.collection('jobs')
    const objectId = new ObjectId(id)
    const job = await jobs.findOne<Job>({ _id: objectId })
    if (!job) {
      return c.json({ error: 'job not found' }, 404)
    }

    const source = sources.find((candidate) => candidate.id === job.sourceId)
    if (!source) {
      return c.json({ error: `no source registered for '${job.sourceId}'` }, 400)
    }

    let postings
    try {
      postings = await source.fetchJobs()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      return c.json({ error: `source fetch failed: ${message}` }, 502)
    }

    const match = postings.find((posting) => posting.sourceJobId === job.sourceJobId)
    if (!match) {
      return c.json({ error: 'job is no longer listed on its source' }, 404)
    }

    await jobs.updateOne(
      { _id: objectId },
      {
        $set: {
          rawDescription: match.rawDescription,
          location: match.location,
          updatedAt: new Date().toISOString(),
        },
      }
    )

    const updated = await jobs.findOne<Job>({ _id: objectId })
    return c.json(updated)
  })

  return jobsRoutes
}
