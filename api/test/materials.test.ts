import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createMaterialsRoutes } from '../src/routes/materials'
import { ensureMaterialsIndexes } from '../src/materials/materialsService'
import type { MaterialsGenerator } from '../src/materials/types'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

const fakeGenerator: MaterialsGenerator = async () => ({
  content: {
    unmetRequirements: ['Kubernetes'],
    tailoredCv: 'Tailored CV text',
    coverLetter: 'Cover letter text',
    outreachMessage: 'Outreach text',
  },
  usage: { inputTokens: 1000, outputTokens: 500 },
})

interface AuthResponseBody {
  token: string
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'materials-user@example.com', password: 'password123' }),
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

describe('materials routes', () => {
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
    await ensureMaterialsIndexes(db)
    await insertJob(db)

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/materials', createMaterialsRoutes(db, JWT_SECRET, fakeGenerator))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a generate request with no token', async () => {
    const res = await app.request('/materials/remoteok:1/generate', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('generates materials and returns the stored document', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; materials: { version: number } }
    expect(body.status).toBe('generated')
    expect(body.materials.version).toBe(1)
  })

  it('404s when generating materials for a job that does not exist', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/materials/remoteok:missing/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('exports the tailored CV as a PDF with the correct content type', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await app.request('/materials/remoteok:1/1/export?doc=tailoredCv&format=pdf', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    const buffer = Buffer.from(await res.arrayBuffer())
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('exports the cover letter as a DOCX with the correct content type', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await app.request('/materials/remoteok:1/1/export?doc=coverLetter&format=docx', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('404s when exporting a materials version that does not exist', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/materials/remoteok:1/99/export?doc=tailoredCv&format=pdf', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })
})
