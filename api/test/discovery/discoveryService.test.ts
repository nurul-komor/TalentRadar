import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { runDiscovery, ensureJobIndexes } from '../../src/discovery/discoveryService'
import type { JobSource, RawJobPosting } from '../../src/discovery/types'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function fakeSource(id: JobSource['id'], jobs: RawJobPosting[]): JobSource {
  return { id, fetchJobs: async () => jobs }
}

function failingSource(id: JobSource['id'], message: string): JobSource {
  return {
    id,
    fetchJobs: async () => {
      throw new Error(message)
    },
  }
}

const SAMPLE_JOB: RawJobPosting = {
  sourceId: 'remoteok',
  sourceJobId: '1',
  url: 'https://remoteok.com/remote-jobs/1',
  title: 'Backend Engineer',
  company: 'Acme',
  rawDescription: 'desc',
  location: null,
  salaryMin: null,
  salaryMax: null,
  postedAt: null,
}

describe('runDiscovery', () => {
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
    await ensureJobIndexes(db)
  })

  afterEach(async () => {
    await client.close()
  })

  it('inserts a newly discovered job', async () => {
    const result = await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    expect(result).toEqual({ discovered: 1, duplicates: 0, errors: [] })

    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('discovered')
    expect(stored?.normalizedUrl).toBe('https://remoteok.com/remote-jobs/1')
  })

  it('skips a job already seen by sourceId+sourceJobId', async () => {
    await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    const result = await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    expect(result).toEqual({ discovered: 0, duplicates: 1, errors: [] })
  })

  it('skips a job already seen by normalized URL even with a different sourceJobId', async () => {
    await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    const sameUrlDifferentId = { ...SAMPLE_JOB, sourceJobId: '2' }
    const result = await runDiscovery(db, [fakeSource('remoteok', [sameUrlDifferentId])])
    expect(result).toEqual({ discovered: 0, duplicates: 1, errors: [] })
  })

  it('skips a job already seen by company+title within the dedupe window', async () => {
    await runDiscovery(db, [fakeSource('remoteok', [SAMPLE_JOB])])
    const sameRoleDifferentUrl = {
      ...SAMPLE_JOB,
      sourceJobId: '3',
      url: 'https://remoteok.com/remote-jobs/3',
    }
    const result = await runDiscovery(db, [fakeSource('remoteok', [sameRoleDifferentUrl])])
    expect(result).toEqual({ discovered: 0, duplicates: 1, errors: [] })
  })

  it('records a per-source error without blocking other sources', async () => {
    const result = await runDiscovery(db, [
      failingSource('weworkremotely', 'network timeout'),
      fakeSource('remoteok', [SAMPLE_JOB]),
    ])
    expect(result.discovered).toBe(1)
    expect(result.errors).toEqual([{ sourceId: 'weworkremotely', message: 'network timeout' }])
  })

  it('records a per-posting error without blocking other postings in the same run', async () => {
    const malformedPosting = { ...SAMPLE_JOB, sourceJobId: '99', url: 'not-a-valid-url' }
    const goodPosting = { ...SAMPLE_JOB, sourceJobId: '100', url: 'https://remoteok.com/remote-jobs/100' }

    const result = await runDiscovery(db, [
      fakeSource('remoteok', [malformedPosting, goodPosting]),
    ])

    expect(result.discovered).toBe(1)
    expect(result.duplicates).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.sourceId).toBe('remoteok')
    expect(result.errors[0]?.message).toMatch(/invalid url/i)

    const stored = await db.collection('jobs').findOne({ sourceJobId: '100' })
    expect(stored?.status).toBe('discovered')
    const notStored = await db.collection('jobs').findOne({ sourceJobId: '99' })
    expect(notStored).toBeNull()
  })
})
