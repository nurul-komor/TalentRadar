import { Hono } from 'hono'
import { ObjectId, type Db, type Filter } from 'mongodb'
import type { Job, JobSourceId, JobStatus } from '@job-hunter/shared'
import { JobSourceIdSchema, JobStatusSchema, UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { verifyAuthToken } from '../lib/jwt.js'
import type { JobSource } from '../discovery/types.js'
import type { Embedder } from '../embeddings/embeddingProvider.js'
import { embedProfile } from '../suggestions/embeddingService.js'
import { searchRankedJobsPage } from '../suggestions/vectorSearch.js'
import { isAdmin } from '../lib/admins.js'
import { listPublicUserJobs, getPublicUserJob } from '../userJobs/userJobsService.js'

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

// Programming-language filter. Each option maps to a regex matched against a
// job's title, description, and extracted required skills. Patterns are tuned
// to the quirks of language names: word boundaries keep `java` from matching
// `javascript`, `go` also accepts `golang`, and `c#`/`c++` match their symbols.
const LANGUAGE_PATTERNS: Record<string, string> = {
  python: '\\bpython\\b',
  typescript: '\\btypescript\\b',
  javascript: '\\bjavascript\\b',
  java: '\\bjava\\b',
  go: '\\b(?:golang|go)\\b',
  csharp: '(?:c#|\\bc[-\\s]?sharp\\b|\\.net\\b)',
  php: '\\bphp\\b',
  cpp: '(?:c\\+\\+|\\bcpp\\b)',
  kotlin: '\\bkotlin\\b',
  rust: '\\brust\\b',
}

function parseLanguages(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const selected = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value in LANGUAGE_PATTERNS)
  const deduped = [...new Set(selected)]
  return deduped.length ? deduped : undefined
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
  languages?: string[]
}): Filter<Job> {
  const filter: Filter<Job> = {}
  // Each `$or` group lives under `$and` so multiple text filters (keyword +
  // language) compose instead of one overwriting the other's `$or` key.
  const andGroups: Filter<Job>[] = []
  if (query.status) filter.status = query.status
  if (query.sourceId) filter.sourceId = query.sourceId
  if (query.category === 'government') filter.sourceId = { $in: GOVT_JOB_SOURCE_IDS }
  if (query.category === 'private') filter.sourceId = { $nin: GOVT_JOB_SOURCE_IDS }
  if (query.location) filter.location = { $regex: escapeRegex(query.location), $options: 'i' }
  if (query.company) filter.company = { $regex: `^${escapeRegex(query.company)}$`, $options: 'i' }
  if (query.keyword) {
    const pattern = escapeRegex(query.keyword)
    // Search the fields a user would expect a keyword to hit: the role title,
    // the company, the posting body, and the extracted required skills — so a
    // term like "kubernetes" or "react" matches jobs that only name it in the
    // description, not just those with it in the title.
    andGroups.push({
      $or: [
        { title: { $regex: pattern, $options: 'i' } },
        { company: { $regex: pattern, $options: 'i' } },
        { rawDescription: { $regex: pattern, $options: 'i' } },
        { 'extractedRequirements.requiredSkills': { $regex: pattern, $options: 'i' } },
      ],
    })
  }
  if (query.languages && query.languages.length > 0) {
    // Match ANY selected language, across the fields most likely to name it.
    const pattern = query.languages.map((key) => LANGUAGE_PATTERNS[key]).join('|')
    andGroups.push({
      $or: [
        { title: { $regex: pattern, $options: 'i' } },
        { rawDescription: { $regex: pattern, $options: 'i' } },
        { 'extractedRequirements.requiredSkills': { $regex: pattern, $options: 'i' } },
      ],
    })
  }
  if (query.salaryMin !== undefined) filter.salaryMax = { $gte: query.salaryMin }
  if (query.salaryMax !== undefined) filter.salaryMin = { $lte: query.salaryMax }
  if (query.discoveredAfter) filter.discoveredAt = { $gte: query.discoveredAfter }
  if (andGroups.length > 0) filter.$and = andGroups
  return filter
}

// Reads the caller's profileId from a Bearer token if one is present and valid. The jobs feed
// is public, so this is optional — it returns null (rather than 401) when there's no usable
// token, letting the handler fall back to the anonymous behavior.
async function optionalProfileId(authHeader: string | undefined, jwtSecret: string): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const payload = await verifyAuthToken(authHeader.slice('Bearer '.length), jwtSecret)
    return payload.sub
  } catch {
    return null
  }
}

export function createJobsRoutes(
  db: Db,
  jwtSecret: string,
  sources: JobSource[],
  // Read per request so a runtime embedding change applies immediately; null = no embedder.
  getEmbedder: () => Embedder | null = () => null
) {
  const jobsRoutes = new Hono<{ Variables: AuthVariables }>()

  jobsRoutes.get('/', async (c) => {
    const limit = parseLimit(c.req.query('limit'))
    const offset = parseOffset(c.req.query('offset'))
    const sortByMatch = c.req.query('sort') === 'match'
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
      languages: parseLanguages(c.req.query('languages')),
    })

    const jobs = db.collection<Job>('jobs')

    // "Best match": re-rank the feed by semantic similarity to the signed-in user's resume.
    // Applied only when an embedder is configured and the caller has a resume to embed; otherwise
    // we silently fall back to the default newest-first ordering below. The vector ranking runs in
    // Atlas (searchRankedJobsPage); the full `filter` is re-applied to the ranked pool so every
    // filter still works.
    const embedder = getEmbedder()
    if (sortByMatch && embedder) {
      const profileId = await optionalProfileId(c.req.header('Authorization'), jwtSecret)
      const queryVector = profileId ? await embedProfile(db, profileId, embedder).catch(() => null) : null
      if (queryVector) {
        const page = await searchRankedJobsPage(db, queryVector, { postFilter: filter, limit, offset })
        return c.json(page)
      }
    }

    const [results, total] = await Promise.all([
      jobs.find(filter).sort({ discoveredAt: -1 }).skip(offset).limit(limit).toArray(),
      jobs.countDocuments(filter),
    ])

    return c.json({ jobs: results, total })
  })

  // Public jobs members added themselves and chose to share. They live in a
  // separate `userJobs` collection, so the discovery feed above never includes
  // them — these two routes surface the shared ones to everyone. Registered
  // before `/:id` so the static `community` segment wins the route match. The
  // caller's own public jobs are excluded from the list (they already see them
  // via /user-jobs and the "My jobs" tab), inferred from an optional Bearer token.
  jobsRoutes.get('/community', async (c) => {
    const profileId = await optionalProfileId(c.req.header('Authorization'), jwtSecret)
    const jobs = await listPublicUserJobs(db, { excludeProfileId: profileId })
    return c.json({ jobs })
  })

  jobsRoutes.get('/community/:id', async (c) => {
    const job = await getPublicUserJob(db, c.req.param('id'))
    if (!job) return c.json({ error: 'job not found' }, 404)
    return c.json(job)
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
    if (!isAdmin(profile?.email)) {
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
