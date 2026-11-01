import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createApplicationsRoutes } from '../src/routes/applications'
import { ensureApplicationIndexes } from '../src/applications/applicationsService'
import { ensureAutomationRunIndexes } from '../src/applications/automationRunsService'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

interface AuthResponseBody {
  token: string
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'applications-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

async function insertJob(db: Db) {
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
    govtDetails: null,
    scoredAt: null,
  })
}

describe('applications routes', () => {
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
    await ensureApplicationIndexes(db)
    await ensureAutomationRunIndexes(db)
    await insertJob(db)

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/applications', createApplicationsRoutes(db, JWT_SECRET))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/applications', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('creates an application', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { jobId: string; status: string }
    expect(body.jobId).toBe('remoteok:1')
    expect(body.status).toBe('draft')
  })

  it('rejects a duplicate application for the same job', async () => {
    const token = await registerAndGetToken(app)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    await app.request('/applications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })

    const res = await app.request('/applications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    expect(res.status).toBe(409)
  })

  it('gets an application with no automation run yet', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })

    const res = await app.request('/applications/remoteok:1', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { application: { jobId: string }; latestRun: null }
    expect(body.application.jobId).toBe('remoteok:1')
    expect(body.latestRun).toBeNull()
  })

  it('lists only the current profile\'s applications', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })

    const now = new Date().toISOString()
    await db.collection('applications').insertOne({
      jobId: 'remoteok:other',
      profileId: 'some-other-profile-id',
      company: 'Other Co',
      title: 'Other Role',
      status: 'draft',
      materialsVersion: null,
      requiredAnswers: [],
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.request('/applications', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applications: Array<{ jobId: string }> }
    expect(body.applications).toHaveLength(1)
    expect(body.applications[0].jobId).toBe('remoteok:1')
  })

  it('rejects listing applications with no token', async () => {
    const res = await app.request('/applications')
    expect(res.status).toBe(401)
  })

  it('404s when getting an application that does not exist', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/applications/remoteok:missing', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('approving a run with an unresolved required answer does not approve it', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    await db
      .collection('applications')
      .updateOne(
        { jobId: 'remoteok:1' },
        { $set: { requiredAnswers: [{ question: 'Why this role?', answer: null }] } }
      )
    const now = new Date().toISOString()
    await db.collection('automationRuns').insertOne({
      jobId: 'remoteok:1',
      runNumber: 1,
      status: 'ready_for_approval',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.request('/applications/remoteok:1/runs/1/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approved: boolean }
    expect(body.approved).toBe(false)
  })

  it('approves a run once every required answer is resolved', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })
    const now = new Date().toISOString()
    await db.collection('automationRuns').insertOne({
      jobId: 'remoteok:1',
      runNumber: 1,
      status: 'ready_for_approval',
      filledFields: { name: 'Jane Doe' },
      blockReason: null,
      manualApplyUrl: null,
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.request('/applications/remoteok:1/runs/1/approve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approved: boolean }
    expect(body.approved).toBe(true)
  })

  it('lists only the current profile\'s applications', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'remoteok', sourceJobId: '1' }),
    })

    const otherRes = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other-user@example.com', password: 'password123' }),
    })
    const otherToken = ((await otherRes.json()) as AuthResponseBody).token

    const res = await app.request('/applications', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applications: Array<{ jobId: string }> }
    expect(body.applications).toHaveLength(1)
    expect(body.applications[0].jobId).toBe('remoteok:1')

    const otherListRes = await app.request('/applications', {
      headers: { Authorization: `Bearer ${otherToken}` },
    })
    const otherBody = (await otherListRes.json()) as { applications: unknown[] }
    expect(otherBody.applications).toHaveLength(0)
  })
})
