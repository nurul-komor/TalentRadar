import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
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

  it('persists govtDetails when a source populates it, and null when it does not', async () => {
    const govtSource: JobSource = {
      id: 'teletalk-govt',
      async fetchJobs() {
        return [
          {
            sourceId: 'teletalk-govt',
            sourceJobId: '15068',
            url: 'https://alljobs.teletalk.com.bd/jobs/government/559?jobId=15068',
            title: 'Accounts Assistant',
            company: 'Narail Distric (DCNARAIL)',
            rawDescription: 'Accounts Assistant at Narail Distric (DCNARAIL) — 02 vacancies.',
            location: null,
            salaryMin: null,
            salaryMax: null,
            postedAt: '2026-11-01T03:00:00.000Z',
            govtDetails: {
              jobCode: 'GJOB15068',
              vacancy: '02',
              minAge: 18,
              maxAge: 32,
              genderRequirement: 'any',
              publishedDate: '2026-11-01T03:00:00.000Z',
              deadlineDate: '2026-11-22T10:00:00.000Z',
              advertisementNo: '05.44.6500.402.06.012.26-206',
              advertisementPdfUrl: 'https://alljobs.teletalk.com.bd/public/uploads/governments/jobs/advertisement-1793262869609.pdf',
              applicationPortalUrl: 'https://dcnarail.teletalk.com.bd/',
            },
          },
        ]
      },
    }
    const plainSource: JobSource = {
      id: 'remoteok',
      async fetchJobs() {
        return [
          {
            sourceId: 'remoteok',
            sourceJobId: 'r1',
            url: 'https://remoteok.com/remote-jobs/r1',
            title: 'Engineer',
            company: 'Acme',
            rawDescription: 'desc',
            location: null,
            salaryMin: null,
            salaryMax: null,
            postedAt: null,
          },
        ]
      },
    }

    await runDiscovery(db, [govtSource, plainSource])

    const jobs = db.collection('jobs')
    const govtJob = await jobs.findOne({ sourceId: 'teletalk-govt', sourceJobId: '15068' })
    const plainJob = await jobs.findOne({ sourceId: 'remoteok', sourceJobId: 'r1' })

    expect(govtJob?.govtDetails).toEqual({
      jobCode: 'GJOB15068',
      vacancy: '02',
      minAge: 18,
      maxAge: 32,
      genderRequirement: 'any',
      publishedDate: '2026-11-01T03:00:00.000Z',
      deadlineDate: '2026-11-22T10:00:00.000Z',
      advertisementNo: '05.44.6500.402.06.012.26-206',
      advertisementPdfUrl: 'https://alljobs.teletalk.com.bd/public/uploads/governments/jobs/advertisement-1793262869609.pdf',
      applicationPortalUrl: 'https://dcnarail.teletalk.com.bd/',
    })
    expect(plainJob?.govtDetails).toBeNull()
  })

  it('persists a fast source\'s jobs without waiting for a slower source to resolve', async () => {
    let resolveSlowSource: (jobs: RawJobPosting[]) => void = () => {}
    const slowSource: JobSource = {
      id: 'teletalk-govt',
      fetchJobs: () => new Promise((resolve) => { resolveSlowSource = resolve }),
    }
    const fastJob: RawJobPosting = {
      ...SAMPLE_JOB,
      sourceJobId: 'fast-1',
      url: 'https://remoteok.com/remote-jobs/fast-1',
    }
    const fastSource = fakeSource('remoteok', [fastJob])

    const discoveryPromise = runDiscovery(db, [slowSource, fastSource])

    await vi.waitFor(
      async () => {
        const stored = await db.collection('jobs').findOne({ sourceJobId: 'fast-1' })
        expect(stored).not.toBeNull()
      },
      { timeout: 2000 }
    )

    resolveSlowSource([])
    const result = await discoveryPromise
    expect(result.discovered).toBe(1)
  })
})
