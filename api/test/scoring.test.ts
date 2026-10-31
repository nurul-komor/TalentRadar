import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ObjectId, type Db, type MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createScoringRoutes } from '../src/routes/scoring'
import { ensureJobIndexes } from '../src/discovery/discoveryService'
import type { JobRequirementsExtractor } from '../src/scoring/types'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const fakeExtractor: JobRequirementsExtractor = async () => ({
  requirements: {
    requiredSkills: [],
    niceToHaveSkills: [],
    minExperienceYears: null,
    workAuthRequirement: 'any',
    remoteType: 'fully_remote',
  },
  usage: { inputTokens: 1000, outputTokens: 100 },
})

interface AuthResponseBody {
  token: string
}

interface ScoringResponseBody {
  checked: number
  scored: number
  deferred: number
  errors: unknown[]
}

async function registerAndGetToken(app: Hono): Promise<{ token: string; profileId: string }> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'scoring-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString())
  return { token: body.token, profileId: payload.sub }
}

describe('scoring routes', () => {
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
    await ensureJobIndexes(db)

    const now = new Date().toISOString()
    await db.collection('jobs').insertOne({
      sourceId: 'remoteok',
      sourceJobId: '1',
      normalizedUrl: 'https://remoteok.com/remote-jobs/1',
      title: 'Engineer',
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
    })

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/scoring', createScoringRoutes(db, JWT_SECRET, fakeExtractor))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/scoring/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('404s when the authenticated profile does not exist', async () => {
    const { token, profileId } = await registerAndGetToken(app)
    await db.collection('profiles').deleteOne({ _id: new ObjectId(profileId) })

    const res = await app.request('/scoring/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('runs scoring against the authenticated profile and returns counts', async () => {
    const { token } = await registerAndGetToken(app)
    const res = await app.request('/scoring/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ScoringResponseBody
    expect(body.checked).toBe(1)
    expect(body.scored).toBe(1)
    expect(body.deferred).toBe(0)
    expect(body.errors).toEqual([])
  })
})
