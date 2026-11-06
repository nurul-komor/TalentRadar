import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { searchSimilarJobs, ensureVectorIndexes } from '../../src/suggestions/vectorSearch'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function insertJob(
  db: Db,
  sourceJobId: string,
  embedding: number[] | null,
  overrides: Record<string, unknown> = {}
) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId,
    normalizedUrl: `https://remoteok.com/remote-jobs/${sourceJobId}`,
    title: `Job ${sourceJobId}`,
    company: 'Acme',
    rawDescription: 'desc',
    location: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: null,
    status: 'verified',
    discoveredAt: now,
    updatedAt: now,
    verifiedAt: now,
    verificationEvidence: null,
    contentHash: null,
    extractedRequirements: null,
    extractedAt: null,
    score: null,
    scoreBreakdown: null,
    scoredAt: null,
    govtDetails: null,
    embedding,
    ...overrides,
  })
}

describe('searchSimilarJobs (in-memory fallback)', () => {
  let mongo: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create()
    const conn = await connectMongo(mongo.getUri(), uniqueDbName())
    client = conn.client
    db = conn.db
  })

  afterAll(async () => {
    await client.close()
    await mongo.stop()
  })

  beforeEach(async () => {
    await db.collection('jobs').deleteMany({})
  })

  it('ranks the job whose vector points the same direction as the query highest', async () => {
    await insertJob(db, 'python', [1, 1, 0, 0]) // aligned with query
    await insertJob(db, 'design', [0, 0, 1, 1]) // orthogonal to query

    const matches = await searchSimilarJobs(db, [1, 1, 0, 0], { limit: 10 })

    expect(matches.map((m) => m.job.sourceJobId)).toEqual(['python', 'design'])
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity)
    expect(matches[0].similarity).toBeCloseTo(1, 5)
    expect(matches[1].similarity).toBeCloseTo(0, 5)
  })

  it('respects the limit and skips jobs without an embedding', async () => {
    await insertJob(db, 'a', [1, 0, 0, 0])
    await insertJob(db, 'b', [0.9, 0.1, 0, 0])
    await insertJob(db, 'c', [0.8, 0.2, 0, 0])
    await insertJob(db, 'no-embedding', null)

    const matches = await searchSimilarJobs(db, [1, 0, 0, 0], { limit: 2 })

    expect(matches).toHaveLength(2)
    expect(matches.map((m) => m.job.sourceJobId)).not.toContain('no-embedding')
  })

  it('excludes unscored (govt) sources from results', async () => {
    await insertJob(db, 'remote', [1, 0, 0, 0])
    await insertJob(db, 'govt', [1, 0, 0, 0], { sourceId: 'teletalk-govt' })

    const matches = await searchSimilarJobs(db, [1, 0, 0, 0], { limit: 10 })

    expect(matches.map((m) => m.job.sourceId)).not.toContain('teletalk-govt')
  })

  it('ensureVectorIndexes is a no-op (does not throw) on non-Atlas Mongo', async () => {
    await expect(ensureVectorIndexes(db, 4)).resolves.toBeUndefined()
  })
})
