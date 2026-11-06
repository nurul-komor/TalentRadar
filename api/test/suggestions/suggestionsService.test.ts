import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ObjectId, type Db, type MongoClient } from 'mongodb'
import { connectMongo } from '../../src/db'
import { embedJobs, embedProfile } from '../../src/suggestions/embeddingService'
import { getSuggestions } from '../../src/suggestions/suggestionsService'
import { createMockEmbedder } from './mockEmbedder'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function insertJob(
  db: Db,
  sourceJobId: string,
  title: string,
  rawDescription: string,
  overrides: Record<string, unknown> = {}
) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId,
    normalizedUrl: `https://remoteok.com/remote-jobs/${sourceJobId}`,
    title,
    company: 'Acme',
    rawDescription,
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
    ...overrides,
  })
}

async function insertProfile(db: Db, cvText: string): Promise<string> {
  const now = new Date().toISOString()
  const result = await db.collection('profiles').insertOne({
    email: 'user@example.com',
    eligibility: { workAuthorization: 'citizen', countries: [] },
    preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
    cvText,
    resume: { skillGroups: [], headline: null, summary: null },
    onboardingCompletedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  return result.insertedId.toString()
}

describe('embeddingService', () => {
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
    await db.collection('profiles').deleteMany({})
    await db.collection('aiUsage').deleteMany({})
  })

  it('embedJobs embeds verified jobs and caches by content hash', async () => {
    await insertJob(db, '1', 'Python Backend Engineer', 'Build Django APIs')
    await insertJob(db, '2', 'Frontend Developer', 'React and TypeScript UI')
    const embedder = createMockEmbedder()

    const first = await embedJobs(db, embedder)
    expect(first.embedded).toBe(2)
    expect(embedder.calls).toHaveLength(1)

    const stored = await db.collection('jobs').findOne({ sourceJobId: '1' })
    expect(Array.isArray(stored?.embedding)).toBe(true)
    expect(stored?.embeddingModel).toBe('text-embedding-3-small')

    // Second run: both jobs are already embedded, so the lazy (missing-only) pass finds no
    // candidates and makes no new embed call.
    const second = await embedJobs(db, embedder)
    expect(second.embedded).toBe(0)
    expect(embedder.calls).toHaveLength(1)
  })

  it('embedJobs re-embeds when force is set', async () => {
    await insertJob(db, '1', 'Python Backend Engineer', 'Build Django APIs')
    const embedder = createMockEmbedder()
    await embedJobs(db, embedder)
    const forced = await embedJobs(db, embedder, { force: true })
    expect(forced.embedded).toBe(1)
    expect(embedder.calls).toHaveLength(2)
  })

  it('embedJobs excludes govt (unscored) sources', async () => {
    await insertJob(db, 'g', 'Govt clerk', 'apply', { sourceId: 'teletalk-govt' })
    const embedder = createMockEmbedder()
    const result = await embedJobs(db, embedder)
    expect(result.checked).toBe(0)
    expect(result.embedded).toBe(0)
  })

  it('embedProfile caches and only re-embeds when the resume text changes', async () => {
    const profileId = await insertProfile(db, 'Python backend developer with Django')
    const embedder = createMockEmbedder()

    const v1 = await embedProfile(db, profileId, embedder)
    expect(v1).not.toBeNull()
    expect(embedder.calls).toHaveLength(1)

    // Unchanged → served from cache, no new embed call.
    const v2 = await embedProfile(db, profileId, embedder)
    expect(v2).toEqual(v1)
    expect(embedder.calls).toHaveLength(1)

    // Change cvText → re-embed.
    await db
      .collection('profiles')
      .updateOne({ _id: new ObjectId(profileId) }, { $set: { cvText: 'React frontend engineer' } })
    await embedProfile(db, profileId, embedder)
    expect(embedder.calls).toHaveLength(2)
  })
})

describe('getSuggestions (hybrid ranking)', () => {
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
    await db.collection('profiles').deleteMany({})
    await db.collection('aiUsage').deleteMany({})
  })

  it('ranks the semantically closest job first for a matching resume', async () => {
    await insertJob(db, 'py', 'Python Backend Engineer', 'Django API development in Python')
    await insertJob(db, 'fe', 'Design Lead', 'Figma design systems')
    const profileId = await insertProfile(db, 'Experienced Python backend engineer, Django and API')
    const embedder = createMockEmbedder()

    const { suggestions, semanticUnavailable } = await getSuggestions(db, embedder, profileId, 10)

    expect(semanticUnavailable).toBe(false)
    expect(suggestions[0].job.sourceJobId).toBe('py')
    expect(suggestions[0].finalScore).toBeGreaterThan(suggestions[1].finalScore)
  })

  it('blends the rule-based score into the final rank', async () => {
    // Two jobs with identical embedding text → equal semantic score; the one with the higher
    // existing rule score must rank first after blending.
    await insertJob(db, 'low', 'Python Backend', 'Python backend', { score: 10 })
    await insertJob(db, 'high', 'Python Backend', 'Python backend', { score: 90 })
    const profileId = await insertProfile(db, 'Python backend')
    const embedder = createMockEmbedder()

    const { suggestions } = await getSuggestions(db, embedder, profileId, 10)

    expect(suggestions[0].job.sourceJobId).toBe('high')
    expect(suggestions[0].ruleScore).toBe(90)
  })

  it('returns semanticUnavailable when the profile has nothing to embed', async () => {
    await insertJob(db, 'py', 'Python Backend Engineer', 'Python Django')
    const profileId = await insertProfile(db, '')
    // Also clear the resume so profileEmbeddingText yields empty.
    await db
      .collection('profiles')
      .updateOne(
        { _id: new ObjectId(profileId) },
        { $set: { cvText: null, resume: { skillGroups: [], headline: null, summary: null } } }
      )
    const embedder = createMockEmbedder()

    const { suggestions, semanticUnavailable } = await getSuggestions(db, embedder, profileId, 10)

    expect(semanticUnavailable).toBe(true)
    expect(suggestions).toEqual([])
  })
})
