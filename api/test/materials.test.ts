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
  model: 'claude-opus-4-8',
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
    app.route('/materials', createMaterialsRoutes(db, JWT_SECRET, () => fakeGenerator))
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

  it('exports the latest tailored CV as a PDF without a version in the path', async () => {
    const token = await registerAndGetToken(app)
    // Two generations — the latest-version export must pick v2.
    await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await app.request('/materials/remoteok:1/export?doc=tailoredCv&format=pdf', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('tailored-cv.pdf')
    const buffer = Buffer.from(await res.arrayBuffer())
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  })

  it('404s the latest-version export when the job has no materials', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/materials/remoteok:1/export?doc=tailoredCv&format=pdf', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('gets the latest generated materials for a job', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    const res = await app.request('/materials/remoteok:1', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version: number; coverLetter: string }
    expect(body.version).toBe(2)
    expect(body.coverLetter).toBe('Cover letter text')
  })

  it('rejects getting materials with no token', async () => {
    const res = await app.request('/materials/remoteok:1')
    expect(res.status).toBe(401)
  })

  it('404s when getting materials for a job with none generated', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/materials/remoteok:1', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('saves a cover letter under the profile and reads it back, without a base résumé', async () => {
    const token = await registerAndGetToken(app)
    const saveRes = await app.request('/materials/remoteok:1/save', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coverLetter: 'My saved cover letter' }),
    })
    expect(saveRes.status).toBe(200)
    const saved = (await saveRes.json()) as { coverLetter: string; tailoredCv: string | null }
    expect(saved.coverLetter).toBe('My saved cover letter')
    expect(saved.tailoredCv).toBeNull()

    const getRes = await app.request('/materials/remoteok:1/saved', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as { coverLetter: string }
    expect(body.coverLetter).toBe('My saved cover letter')
  })

  it('merges a later résumé save without clearing the saved cover letter', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/materials/remoteok:1/save', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coverLetter: 'Cover' }),
    })
    await app.request('/materials/remoteok:1/save', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tailoredCv: 'CV' }),
    })

    const getRes = await app.request('/materials/remoteok:1/saved', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await getRes.json()) as { coverLetter: string; tailoredCv: string }
    expect(body.coverLetter).toBe('Cover')
    expect(body.tailoredCv).toBe('CV')

    // One record per (user, job) — the second save upserted, not inserted.
    const count = await db.collection('savedMaterials').countDocuments({ jobId: 'remoteok:1' })
    expect(count).toBe(1)
  })

  it('rejects a save with an empty payload', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/materials/remoteok:1/save', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('404s reading saved materials when the user saved none', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/materials/remoteok:1/saved', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('scopes saved materials to the caller, hiding another profile\'s save', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/materials/remoteok:1/save', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coverLetter: 'mine' }),
    })
    await db
      .collection('savedMaterials')
      .updateOne({ jobId: 'remoteok:1' }, { $set: { profileId: 'someone-else' } })

    const res = await app.request('/materials/remoteok:1/saved', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })

  it('404s when the only materials for a job belong to a different profile', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/materials/remoteok:1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    await db.collection('materials').updateOne({ jobId: 'remoteok:1' }, { $set: { profileId: 'someone-else' } })

    // The lookup is scoped to the caller's profile, so another profile's
    // materials are simply invisible (404) rather than disclosed via a 403.
    const res = await app.request('/materials/remoteok:1', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
  })
})
