import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import type { Job } from '@job-hunter/shared'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createJobsRoutes } from '../src/routes/jobs'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

interface AuthResponseBody {
  token: string
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'jobs-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

function makeJob(overrides: Partial<Job> & { sourceJobId: string }): Omit<Job, '_id'> {
  return {
    sourceId: 'remoteok',
    normalizedUrl: `https://example.com/${overrides.sourceJobId}`,
    title: 'Engineer',
    company: 'Acme',
    rawDescription: 'desc',
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: null,
    status: 'discovered',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    verifiedAt: null,
    verificationEvidence: null,
    contentHash: null,
    extractedRequirements: null,
    extractedAt: null,
    score: null,
    scoreBreakdown: null,
    govtDetails: null,
    scoredAt: null,
    ...overrides,
  }
}

interface JobsListBody {
  jobs: Array<Job & { _id: string }>
  total: number
}

describe('jobs routes', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: Hono

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
  })

  afterAll(async () => {
    await mongod.stop()
  })

  beforeEach(async () => {
    const conn = await connectMongo(mongod.getUri(), uniqueDbName())
    client = conn.client
    db = conn.db
    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/jobs', createJobsRoutes(db, JWT_SECRET))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/jobs')
    expect(res.status).toBe(401)
  })

  it('lists jobs sorted by discoveredAt descending', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'older', discoveredAt: '2026-01-01T00:00:00.000Z' }),
      makeJob({ sourceJobId: 'newer', discoveredAt: '2026-01-02T00:00:00.000Z' }),
    ] as Job[])

    const res = await app.request('/jobs', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.total).toBe(2)
    expect(body.jobs.map((j) => j.sourceJobId)).toEqual(['newer', 'older'])
  })

  it('filters by status', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'a', status: 'discovered' }),
      makeJob({ sourceJobId: 'b', status: 'verified' }),
    ] as Job[])

    const res = await app.request('/jobs?status=verified', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].sourceJobId).toBe('b')
  })

  it('filters by keyword matching title or company, case-insensitively', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'a', title: 'Senior Backend Engineer', company: 'Acme' }),
      makeJob({ sourceJobId: 'b', title: 'Designer', company: 'BACKEND Studios' }),
      makeJob({ sourceJobId: 'c', title: 'Frontend Engineer', company: 'Widgets Inc' }),
    ] as Job[])

    const res = await app.request('/jobs?q=backend', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.jobs.map((j) => j.sourceJobId).sort()).toEqual(['a', 'b'])
  })

  it('filters by location substring, case-insensitively', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'a', location: 'Remote - Europe' }),
      makeJob({ sourceJobId: 'b', location: 'Remote - US' }),
      makeJob({ sourceJobId: 'c', location: null }),
    ] as Job[])

    const res = await app.request('/jobs?location=europe', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].sourceJobId).toBe('a')
  })

  it('filters by sourceId', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'a', sourceId: 'remoteok' }),
      makeJob({ sourceJobId: 'b', sourceId: 'himalayas' }),
    ] as Job[])

    const res = await app.request('/jobs?sourceId=himalayas', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].sourceJobId).toBe('b')
  })

  it('filters by salary range overlap', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'too-low', salaryMin: 40000, salaryMax: 60000 }),
      makeJob({ sourceJobId: 'overlaps', salaryMin: 90000, salaryMax: 130000 }),
      makeJob({ sourceJobId: 'too-high', salaryMin: 200000, salaryMax: 250000 }),
      makeJob({ sourceJobId: 'unspecified', salaryMin: null, salaryMax: null }),
    ] as Job[])

    const res = await app.request('/jobs?salaryMin=80000&salaryMax=150000', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].sourceJobId).toBe('overlaps')
  })

  it('filters by discoveredAfter', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'old', discoveredAt: '2026-01-01T00:00:00.000Z' }),
      makeJob({ sourceJobId: 'recent', discoveredAt: '2026-01-10T00:00:00.000Z' }),
    ] as Job[])

    const res = await app.request('/jobs?discoveredAfter=2026-01-05T00:00:00.000Z', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].sourceJobId).toBe('recent')
  })

  it('paginates with limit and offset', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany(
      Array.from({ length: 5 }, (_, i) =>
        makeJob({
          sourceJobId: `job-${i}`,
          discoveredAt: `2026-01-0${i + 1}T00:00:00.000Z`,
        })
      ) as Job[]
    )

    const res = await app.request('/jobs?limit=2&offset=1', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as JobsListBody
    expect(body.total).toBe(5)
    expect(body.jobs).toHaveLength(2)
    expect(body.jobs.map((j) => j.sourceJobId)).toEqual(['job-3', 'job-2'])
  })

  it('returns a single job by id', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertOne(makeJob({ sourceJobId: 'solo' }) as Job)
    const inserted = await db.collection<Job>('jobs').findOne({ sourceJobId: 'solo' })

    const res = await app.request(`/jobs/${inserted?._id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Job
    expect(body.sourceJobId).toBe('solo')
  })

  it('returns 404 for an unknown job id', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/jobs/0123456789abcdef01234567', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for a malformed job id', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/jobs/not-an-object-id', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('filters to government jobs with category=government', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'g1', sourceId: 'teletalk-govt' }),
      makeJob({ sourceJobId: 'p1', sourceId: 'remoteok' }),
    ] as Job[])

    const res = await app.request('/jobs?category=government', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as JobsListBody

    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].sourceId).toBe('teletalk-govt')
  })

  it('filters to private jobs with category=private', async () => {
    const token = await registerAndGetToken(app)
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'g1', sourceId: 'teletalk-govt' }),
      makeJob({ sourceJobId: 'p1', sourceId: 'remoteok' }),
    ] as Job[])

    const res = await app.request('/jobs?category=private', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as JobsListBody

    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].sourceId).toBe('remoteok')
  })
})
