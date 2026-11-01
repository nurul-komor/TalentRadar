import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import type { Job, PublicJobsSummary } from '@job-hunter/shared'
import { connectMongo } from '../src/db'
import { createPublicRoutes } from '../src/routes/public'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
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

describe('public routes', () => {
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
    app.route('/public', createPublicRoutes(db))
  })

  afterEach(async () => {
    await client.close()
  })

  it('requires no authorization header', async () => {
    const res = await app.request('/public/jobs-summary')
    expect(res.status).toBe(200)
  })

  it('counts all jobs for totalJobs regardless of status', async () => {
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'a', status: 'discovered' }),
      makeJob({ sourceJobId: 'b', status: 'verified' }),
      makeJob({ sourceJobId: 'c', status: 'rejected' }),
    ] as Job[])

    const res = await app.request('/public/jobs-summary')
    const body = (await res.json()) as PublicJobsSummary
    expect(body.totalJobs).toBe(3)
  })

  it('groups verified job counts by source, including sources with zero jobs', async () => {
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'a', sourceId: 'remoteok', status: 'verified' }),
      makeJob({ sourceJobId: 'b', sourceId: 'remoteok', status: 'verified' }),
      makeJob({ sourceJobId: 'c', sourceId: 'himalayas', status: 'verified' }),
      makeJob({ sourceJobId: 'd', sourceId: 'weworkremotely', status: 'discovered' }),
    ] as Job[])

    const res = await app.request('/public/jobs-summary')
    const body = (await res.json()) as PublicJobsSummary
    expect(body.bySource).toEqual(
      expect.arrayContaining([
        { sourceId: 'remoteok', count: 2 },
        { sourceId: 'himalayas', count: 1 },
        { sourceId: 'weworkremotely', count: 0 },
      ])
    )
  })

  it('returns only verified jobs as featured, newest first, limited to 8', async () => {
    await db.collection<Job>('jobs').insertMany([
      makeJob({ sourceJobId: 'not-verified', status: 'discovered', discoveredAt: '2026-01-09T00:00:00.000Z' }),
      ...Array.from({ length: 9 }, (_, i) =>
        makeJob({
          sourceJobId: `verified-${i}`,
          status: 'verified',
          discoveredAt: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`,
        })
      ),
    ] as Job[])

    const res = await app.request('/public/jobs-summary')
    const body = (await res.json()) as PublicJobsSummary
    expect(body.featuredJobs).toHaveLength(8)
    expect(body.featuredJobs.every((job) => job.sourceId === 'remoteok')).toBe(true)
    expect(body.featuredJobs[0].title).toBe('Engineer')
  })

  it('does not leak internal-only fields on featured jobs', async () => {
    await db.collection<Job>('jobs').insertOne(
      makeJob({
        sourceJobId: 'solo',
        status: 'verified',
        rawDescription: 'internal description text',
        score: 90,
      }) as Job
    )

    const res = await app.request('/public/jobs-summary')
    const body = (await res.json()) as PublicJobsSummary
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('internal description text')
    expect(body.featuredJobs[0]).not.toHaveProperty('rawDescription')
    expect(body.featuredJobs[0]).not.toHaveProperty('score')
    expect(body.featuredJobs[0]).not.toHaveProperty('scoreBreakdown')
    expect(body.featuredJobs[0]).not.toHaveProperty('verificationEvidence')
  })
})
