import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { ensureJobIndexes } from '../../src/discovery/discoveryService'
import { runScoring } from '../../src/scoring/scoringService'
import type { JobRequirementsExtractor } from '../../src/scoring/types'
import type { Profile } from '@job-hunter/shared'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function baseProfile(): Profile {
  return {
    email: 'user@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: null,
  }
}

async function insertVerifiedJob(db: Db, overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId: '1',
    normalizedUrl: 'https://remoteok.com/remote-jobs/1',
    title: 'Backend Engineer',
    company: 'Acme',
    rawDescription: 'We need a backend engineer.',
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

const FIXED_REQUIREMENTS = {
  requiredSkills: [],
  niceToHaveSkills: [],
  minExperienceYears: null,
  workAuthRequirement: 'any' as const,
  remoteType: 'fully_remote' as const,
}

function fixedExtractor(): { extractor: JobRequirementsExtractor; callCount: () => number } {
  let calls = 0
  const extractor: JobRequirementsExtractor = async () => {
    calls += 1
    return { requirements: FIXED_REQUIREMENTS, usage: { inputTokens: 1000, outputTokens: 100 } }
  }
  return { extractor, callCount: () => calls }
}

describe('runScoring', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let originalDaily: string | undefined
  let originalMonthly: string | undefined

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
    originalDaily = process.env.ANTHROPIC_DAILY_BUDGET_USD
    originalMonthly = process.env.ANTHROPIC_MONTHLY_BUDGET_USD
    process.env.ANTHROPIC_DAILY_BUDGET_USD = '10'
    process.env.ANTHROPIC_MONTHLY_BUDGET_USD = '100'
  })

  afterEach(async () => {
    await client.close()
    process.env.ANTHROPIC_DAILY_BUDGET_USD = originalDaily
    process.env.ANTHROPIC_MONTHLY_BUDGET_USD = originalMonthly
  })

  it('extracts, scores, and stores the result for a verified job with no prior extraction', async () => {
    await insertVerifiedJob(db)
    const { extractor, callCount } = fixedExtractor()

    const result = await runScoring(db, baseProfile(), extractor)

    expect(result).toEqual({ checked: 1, scored: 1, deferred: 0, errors: [] })
    expect(callCount()).toBe(1)
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    // citizen(30) + remoteOnly+fullyRemote(20) + no-minSalary(20) + no-requiredSkills(10) + no-locationPref(10)
    expect(stored?.score).toBe(90)
    expect(stored?.contentHash).not.toBeNull()
    expect(stored?.extractedRequirements).toEqual(FIXED_REQUIREMENTS)
  })

  it('does not call the extractor again when the content hash is unchanged', async () => {
    await insertVerifiedJob(db)
    const { extractor, callCount } = fixedExtractor()

    await runScoring(db, baseProfile(), extractor)
    const result = await runScoring(db, baseProfile(), extractor)

    expect(result.scored).toBe(1)
    expect(callCount()).toBe(1) // second run reused the cached extraction
  })

  it('re-extracts when the job content hash has changed', async () => {
    await insertVerifiedJob(db)
    const { extractor, callCount } = fixedExtractor()
    await runScoring(db, baseProfile(), extractor)

    await db.collection('jobs').updateOne(
      { sourceJobId: '1' },
      { $set: { rawDescription: 'Updated posting text.' } }
    )
    await runScoring(db, baseProfile(), extractor)

    expect(callCount()).toBe(2)
  })

  it('only considers jobs with status verified', async () => {
    await insertVerifiedJob(db, { sourceJobId: '1', status: 'discovered' })
    await insertVerifiedJob(db, {
      sourceJobId: '2',
      status: 'rejected',
      normalizedUrl: 'https://remoteok.com/remote-jobs/2',
    })
    const { extractor } = fixedExtractor()

    const result = await runScoring(db, baseProfile(), extractor)

    expect(result.checked).toBe(0)
  })

  it('defers extraction when the daily budget is exceeded and no cached extraction exists', async () => {
    process.env.ANTHROPIC_DAILY_BUDGET_USD = '0' // exceeded before any spend
    await insertVerifiedJob(db)
    const { extractor, callCount } = fixedExtractor()

    const result = await runScoring(db, baseProfile(), extractor)

    expect(result).toEqual({ checked: 1, scored: 0, deferred: 1, errors: [] })
    expect(callCount()).toBe(0)
    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(stored?.score).toBeNull()
  })

  it('isolates one job extractor failure from the rest', async () => {
    await insertVerifiedJob(db, { sourceJobId: '1', normalizedUrl: 'https://remoteok.com/remote-jobs/1' })
    await insertVerifiedJob(db, { sourceJobId: '2', normalizedUrl: 'https://remoteok.com/remote-jobs/2' })

    let callNumber = 0
    const sometimesFailingExtractor: JobRequirementsExtractor = async () => {
      callNumber += 1
      if (callNumber === 1) {
        throw new Error('extraction boom')
      }
      return { requirements: FIXED_REQUIREMENTS, usage: { inputTokens: 1000, outputTokens: 100 } }
    }

    const result = await runScoring(db, baseProfile(), sometimesFailingExtractor)

    expect(result.scored).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toBe('extraction boom')
  })
})
