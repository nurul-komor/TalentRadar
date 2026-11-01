import { Hono } from 'hono'
import { ObjectId, type Db, type Filter } from 'mongodb'
import type { Job, JobSourceId, JobStatus } from '@job-hunter/shared'
import { JobSourceIdSchema, JobStatusSchema, UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

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

export function createJobsRoutes(db: Db) {
  const jobsRoutes = new Hono()

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

  return jobsRoutes
}
