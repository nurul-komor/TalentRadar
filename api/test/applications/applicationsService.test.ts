import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { createApplication, ensureApplicationIndexes } from '../../src/applications/applicationsService'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function insertJob(db: Db, overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId: '1',
    normalizedUrl: 'https://remoteok.com/remote-jobs/1',
    title: 'Backend Engineer',
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
    verificationEvidence: 'apply now',
    contentHash: null,
    extractedRequirements: null,
    extractedAt: null,
    score: null,
    scoreBreakdown: null,
    scoredAt: null,
    ...overrides,
  })
}

describe('createApplication', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

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
    await ensureApplicationIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('creates a draft application for an existing job', async () => {
    await insertJob(db)
    const application = await createApplication(
      db,
      { sourceId: 'remoteok', sourceJobId: '1' },
      'profile-1'
    )

    expect(application.jobId).toBe('remoteok:1')
    expect(application.status).toBe('draft')
    expect(application.requiredAnswers).toEqual([])
  })

  it('throws when the job does not exist', async () => {
    await expect(
      createApplication(db, { sourceId: 'remoteok', sourceJobId: 'missing' }, 'profile-1')
    ).rejects.toThrow('job not found')
  })

  it('throws when an application already exists for the exact same job', async () => {
    await insertJob(db)
    await createApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 'profile-1')

    await expect(
      createApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 'profile-1')
    ).rejects.toThrow('already exists')
  })

  it('throws when a different job with the same company and title was applied to recently', async () => {
    await insertJob(db, { sourceJobId: '1', normalizedUrl: 'https://remoteok.com/remote-jobs/1' })
    await createApplication(db, { sourceId: 'remoteok', sourceJobId: '1' }, 'profile-1')

    await insertJob(db, {
      sourceJobId: '2',
      normalizedUrl: 'https://remoteok.com/remote-jobs/2',
      company: 'Acme',
      title: 'Backend Engineer',
    })

    await expect(
      createApplication(db, { sourceId: 'remoteok', sourceJobId: '2' }, 'profile-1')
    ).rejects.toThrow('already exists within the last 60 days')
  })
})
