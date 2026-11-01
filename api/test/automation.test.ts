import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createAutomationRoutes } from '../src/routes/automation'
import { ensureApplicationIndexes } from '../src/applications/applicationsService'
import { ensureAutomationRunIndexes } from '../src/applications/automationRunsService'
import { verifyAuthToken } from '../src/lib/jwt'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const MOCK_FORM_HTML = `
<form>
  <label for="email-field">Email address</label>
  <input type="email" id="email-field" />
</form>
`

function dataUrl(html: string): string {
  return 'data:text/html,' + encodeURIComponent(html)
}

interface AuthResponseBody {
  token: string
}

async function registerAndGetToken(app: Hono): Promise<{ token: string; profileId: string }> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'automation-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  const payload = await verifyAuthToken(body.token, JWT_SECRET)
  return { token: body.token, profileId: payload.sub }
}

async function insertJob(db: Db) {
  const now = new Date().toISOString()
  await db.collection('jobs').insertOne({
    sourceId: 'remoteok',
    sourceJobId: '1',
    normalizedUrl: dataUrl(MOCK_FORM_HTML),
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
    govtDetails: null,
    scoredAt: null,
  })
}

async function insertMaterials(db: Db) {
  await db.collection('materials').insertOne({
    jobId: 'remoteok:1',
    version: 1,
    unmetRequirements: [],
    tailoredCv: 'Tailored CV text.',
    coverLetter: 'Cover letter text.',
    outreachMessage: 'Outreach text.',
    createdAt: new Date().toISOString(),
  })
}

async function insertApplication(db: Db, profileId: string) {
  const now = new Date().toISOString()
  await db.collection('applications').insertOne({
    jobId: 'remoteok:1',
    profileId,
    company: 'Acme',
    title: 'Engineer',
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
  })
}

describe('automation routes', () => {
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
    await insertMaterials(db)

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/automation', createAutomationRoutes(db, JWT_SECRET))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a run request with no token', async () => {
    const res = await app.request('/automation/remoteok:1/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('runs automation and returns the resulting run', async () => {
    const { token, profileId } = await registerAndGetToken(app)
    await insertApplication(db, profileId)
    const res = await app.request('/automation/remoteok:1/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ready_for_approval')
  })

  it('403s a submit request for a run that has not been approved', async () => {
    const { token, profileId } = await registerAndGetToken(app)
    await insertApplication(db, profileId)
    await app.request('/automation/remoteok:1/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await app.request('/automation/remoteok:1/runs/1/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(403)
  })
})
