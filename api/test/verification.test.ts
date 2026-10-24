import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createVerificationRoutes } from '../src/routes/verification'
import { ensureJobIndexes } from '../src/discovery/discoveryService'
import type { JobVerifier } from '../src/verification/types'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const fakeVerifier: JobVerifier = async () => ({
  status: 'verified',
  httpStatus: 200,
  evidence: 'apply now',
})

interface AuthResponseBody {
  token: string
}

interface VerificationResponseBody {
  checked: number
  verified: number
  rejected: number
  inconclusive: number
  errors: unknown[]
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'verification-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

describe('verification routes', () => {
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
      status: 'discovered',
      discoveredAt: now,
      updatedAt: now,
      verifiedAt: null,
      verificationEvidence: null,
    })

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/verification', createVerificationRoutes(db, JWT_SECRET, fakeVerifier))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/verification/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('runs verification and returns counts', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/verification/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as VerificationResponseBody
    expect(body.checked).toBe(1)
    expect(body.verified).toBe(1)
    expect(body.rejected).toBe(0)
    expect(body.inconclusive).toBe(0)
    expect(body.errors).toEqual([])
  })
})
