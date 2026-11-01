import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { ensureJobIndexes } from '../../src/discovery/discoveryService'
import { runVerification } from '../../src/verification/verificationService'
import type { JobVerifier, VerificationOutcome } from '../../src/verification/types'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function fixedVerifier(outcome: VerificationOutcome): JobVerifier {
  return async () => outcome
}

async function insertDiscoveredJob(db: Db, overrides: Partial<Record<string, unknown>> = {}) {
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
    status: 'discovered',
    discoveredAt: now,
    updatedAt: now,
    verifiedAt: null,
    verificationEvidence: null,
    ...overrides,
  })
}

describe('runVerification', () => {
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

  it('marks a discovered job verified and records evidence', async () => {
    await insertDiscoveredJob(db)
    const verifier = fixedVerifier({ status: 'verified', httpStatus: 200, evidence: 'apply now' })

    const result = await runVerification(db, verifier)

    expect(result).toEqual({ checked: 1, verified: 1, rejected: 0, inconclusive: 0, errors: [] })
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('verified')
    expect(stored?.verificationEvidence).toBe('apply now')
    expect(stored?.verifiedAt).not.toBeNull()
  })

  it('marks a discovered job rejected and records evidence', async () => {
    await insertDiscoveredJob(db)
    const verifier = fixedVerifier({
      status: 'rejected',
      httpStatus: 200,
      evidence: 'position has been filled',
    })

    const result = await runVerification(db, verifier)

    expect(result).toEqual({ checked: 1, verified: 0, rejected: 1, inconclusive: 0, errors: [] })
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('rejected')
  })

  it('leaves status unchanged on an inconclusive outcome but records the check', async () => {
    await insertDiscoveredJob(db)
    const verifier = fixedVerifier({ status: 'inconclusive', httpStatus: 200, evidence: null })

    const result = await runVerification(db, verifier)

    expect(result).toEqual({ checked: 1, verified: 0, rejected: 0, inconclusive: 1, errors: [] })
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.status).toBe('discovered')
    expect(stored?.verifiedAt).not.toBeNull()
  })

  it('does not re-check a job that is already verified or rejected', async () => {
    await insertDiscoveredJob(db, { sourceJobId: '1', status: 'verified' })
    await insertDiscoveredJob(db, { sourceJobId: '2', normalizedUrl: 'https://remoteok.com/remote-jobs/2' })
    const verifier = fixedVerifier({ status: 'verified', httpStatus: 200, evidence: 'apply now' })

    const result = await runVerification(db, verifier)

    expect(result.checked).toBe(1)
  })

  it('isolates one job verifier failure from the rest', async () => {
    await insertDiscoveredJob(db, { sourceJobId: '1', normalizedUrl: 'https://remoteok.com/remote-jobs/1' })
    await insertDiscoveredJob(db, { sourceJobId: '2', normalizedUrl: 'https://remoteok.com/remote-jobs/2' })

    const verifier: JobVerifier = async (url: string) => {
      if (url === 'https://remoteok.com/remote-jobs/1') {
        throw new Error('boom')
      }
      return { status: 'verified', httpStatus: 200, evidence: 'apply now' }
    }

    const result = await runVerification(db, verifier)

    expect(result.verified).toBe(1)
    expect(result.errors).toEqual([{ jobId: 'remoteok:1', message: 'boom' }])
    const untouched = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(untouched?.status).toBe('discovered')
  })

  it('excludes teletalk-govt jobs from the discovered-jobs query', async () => {
    await insertDiscoveredJob(db, { sourceId: 'teletalk-govt', sourceJobId: 'g1' })
    const verifier = vi.fn()

    const result = await runVerification(db, verifier)

    expect(result.checked).toBe(0)
    expect(verifier).not.toHaveBeenCalled()
  })
})
