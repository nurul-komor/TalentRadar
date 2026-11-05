import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ObjectId, type Db, type MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { ensureMaterialsIndexes, generateMaterials } from '../../src/materials/materialsService'
import type { MaterialsGenerator } from '../../src/materials/types'
import type { Profile } from '@job-hunter/shared'
import { emptyResume } from '@job-hunter/shared'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function baseProfile(): Profile {
  return {
    email: 'user@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText: 'Experienced backend engineer.',
    resume: emptyResume(),
  }
}

async function insertJob(db: Db) {
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
    govtDetails: null,
    scoredAt: null,
  })
}

function fixedGenerator(): { generator: MaterialsGenerator; callCount: () => number } {
  let calls = 0
  const generator: MaterialsGenerator = async () => {
    calls += 1
    return {
      content: {
        unmetRequirements: [],
        tailoredCv: `Tailored CV v${calls}`,
        coverLetter: 'Cover letter',
        outreachMessage: 'Outreach',
      },
      model: 'claude-opus-4-8',
      usage: { inputTokens: 1000, outputTokens: 500 },
    }
  }
  return { generator, callCount: () => calls }
}

describe('generateMaterials', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let originalDaily: string | undefined

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
    await ensureMaterialsIndexes(db)
    originalDaily = process.env.ANTHROPIC_DAILY_BUDGET_USD
    process.env.ANTHROPIC_DAILY_BUDGET_USD = '10'
  })

  afterEach(async () => {
    await client.close()
    process.env.ANTHROPIC_DAILY_BUDGET_USD = originalDaily
  })

  it('generates and stores materials as version 1 for a job with no prior materials', async () => {
    await insertJob(db)
    const { generator } = fixedGenerator()

    const result = await generateMaterials(
      db,
      { sourceId: 'remoteok', sourceJobId: '1' },
      baseProfile(),
      'profile-1',
      generator
    )

    expect(result.status).toBe('generated')
    expect(result.materials?.version).toBe(1)
    expect(result.materials?.jobId).toBe('remoteok:1')
    expect(result.materials?.tailoredCv).toBe('Tailored CV v1')
  })

  it('increments the version on a second generation for the same job', async () => {
    await insertJob(db)
    const { generator } = fixedGenerator()

    await generateMaterials(
      db,
      { sourceId: 'remoteok', sourceJobId: '1' },
      baseProfile(),
      'profile-1',
      generator
    )
    const second = await generateMaterials(
      db,
      { sourceId: 'remoteok', sourceJobId: '1' },
      baseProfile(),
      'profile-1',
      generator
    )

    expect(second.materials?.version).toBe(2)
    const stored = await db.collection('materials').find({ jobId: 'remoteok:1' }).toArray()
    expect(stored).toHaveLength(2)
  })

  it('throws when the job does not exist', async () => {
    const { generator } = fixedGenerator()
    await expect(
      generateMaterials(
        db,
        { sourceId: 'remoteok', sourceJobId: 'missing' },
        baseProfile(),
        'profile-1',
        generator
      )
    ).rejects.toThrow()
  })

  it('snapshots missing skills without mutating the profile résumé', async () => {
    // Job requires three skills; the profile already holds one of them.
    await db.collection('jobs').insertOne({
      sourceId: 'remoteok',
      sourceJobId: '1',
      normalizedUrl: 'https://remoteok.com/remote-jobs/1',
      title: 'Backend Engineer',
      company: 'Acme',
      rawDescription: 'We need a backend engineer.',
      status: 'verified',
      extractedRequirements: { requiredSkills: ['Kubernetes', 'Go', 'Docker'] },
    })

    const profileId = new ObjectId()
    const profile: Profile = {
      ...baseProfile(),
      resume: { ...emptyResume(), skillGroups: [{ category: 'Core', skills: ['Go'] }] },
    }
    // Store with an ObjectId _id (as the app does). Listed field-by-field so the
    // string `Profile._id` type doesn't collide with the Mongo ObjectId.
    await db.collection('profiles').insertOne({
      _id: profileId,
      email: profile.email,
      eligibility: profile.eligibility,
      preferences: profile.preferences,
      cvText: profile.cvText,
      resume: profile.resume,
    })

    const { generator } = fixedGenerator()
    const result = await generateMaterials(
      db,
      { sourceId: 'remoteok', sourceJobId: '1' },
      profile,
      profileId.toHexString(),
      generator
    )

    // The gap snapshot excludes the already-held skill and is stored on the record.
    expect(result.materials?.missingSkills).toEqual(['Kubernetes', 'Docker'])

    // The master profile résumé is left exactly as it was — generation never writes to it.
    const updated = (await db.collection('profiles').findOne({ _id: profileId })) as unknown as Profile
    expect(updated.resume.skillGroups).toEqual([{ category: 'Core', skills: ['Go'] }])
  })

  it('defers generation when the daily budget is exceeded', async () => {
    process.env.ANTHROPIC_DAILY_BUDGET_USD = '0'
    await insertJob(db)
    const { generator, callCount } = fixedGenerator()

    const result = await generateMaterials(
      db,
      { sourceId: 'remoteok', sourceJobId: '1' },
      baseProfile(),
      'profile-1',
      generator
    )

    expect(result).toEqual({ status: 'deferred', materials: null, reason: 'AI budget exceeded' })
    expect(callCount()).toBe(0)
  })
})
