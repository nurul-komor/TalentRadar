import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { emptyResume, type Resume } from '@job-hunter/shared'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createProfileRoutes } from '../src/routes/profile'
import type { CvParser } from '../src/profile/cvParser'
import type { ResumeExtractor } from '../src/profile/types'

const JWT_SECRET = 'test-secret'
const fakeCvParser: CvParser = async () => 'Parsed CV text from the fake extractor.'

const extractedResume: Resume = {
  ...emptyResume(),
  fullName: 'Nurul Komor',
  headline: 'Full-Stack Developer',
}

const fakeResumeExtractor: ResumeExtractor = async () => ({
  resume: extractedResume,
  model: 'claude-haiku-4-5',
  usage: { inputTokens: 10, outputTokens: 5 },
})

interface AuthResponseBody {
  token: string
}

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'profile-owner@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

describe('profile routes', () => {
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
    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/profile', createProfileRoutes(db, JWT_SECRET, fakeCvParser))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/profile')
    expect(res.status).toBe(401)
  })

  it('returns the caller profile without the password hash', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string; passwordHash?: string }
    expect(body.email).toBe('profile-owner@example.com')
    expect(body.passwordHash).toBeUndefined()
  })

  it('updates preferences and returns the updated profile', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          targetRoles: ['Software Engineer'],
          remoteOnly: true,
          minSalaryUsd: 80000,
          locations: ['Remote'],
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      preferences: { targetRoles: string[]; minSalaryUsd: number | null }
    }
    expect(body.preferences.targetRoles).toEqual(['Software Engineer'])
    expect(body.preferences.minSalaryUsd).toBe(80000)
  })

  it('rejects an invalid update payload', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { minSalaryUsd: -5 } }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a CV upload with no token', async () => {
    const res = await app.request('/profile/cv', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('parses an uploaded CV and stores the extracted text on the profile', async () => {
    const token = await registerAndGetToken(app)
    const file = new File([Buffer.from('fake pdf bytes')], 'resume.pdf', {
      type: 'application/pdf',
    })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request('/profile/cv', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { cvText: string }
    expect(body.cvText).toBe('Parsed CV text from the fake extractor.')
  })

  it('rejects an unsupported file type', async () => {
    const token = await registerAndGetToken(app)
    const file = new File([Buffer.from('not a cv')], 'resume.png', { type: 'image/png' })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request('/profile/cv', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    expect(res.status).toBe(400)
  })

  it('rejects a file over the 10 MB size limit', async () => {
    const token = await registerAndGetToken(app)
    const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1)
    const file = new File([oversizedBytes], 'resume.pdf', { type: 'application/pdf' })
    const formData = new FormData()
    formData.append('file', file)

    const res = await app.request('/profile/cv', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    expect(res.status).toBe(400)
  })

  it('rejects a CV export request with no token', async () => {
    const res = await app.request('/profile/cv/export')
    expect(res.status).toBe(401)
  })

  it('exports the caller profile as a PDF', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/profile/cv/export', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    const buffer = Buffer.from(await res.arrayBuffer())
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  })
})

describe('profile routes with resume extraction', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: Hono
  let originalDailyBudget: string | undefined

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
    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/profile', createProfileRoutes(db, JWT_SECRET, fakeCvParser, fakeResumeExtractor))
    originalDailyBudget = process.env.ANTHROPIC_DAILY_BUDGET_USD
  })

  afterEach(async () => {
    await client.close()
    // Assigning `undefined` to process.env.X stringifies it to "undefined" rather than
    // unsetting it — delete when there was no original value, or the next test reads
    // Number.parseFloat("undefined") === NaN and every budget check wrongly fails.
    if (originalDailyBudget === undefined) {
      delete process.env.ANTHROPIC_DAILY_BUDGET_USD
    } else {
      process.env.ANTHROPIC_DAILY_BUDGET_USD = originalDailyBudget
    }
  })

  async function uploadCv(token: string) {
    const file = new File([Buffer.from('fake pdf bytes')], 'resume.pdf', { type: 'application/pdf' })
    const formData = new FormData()
    formData.append('file', file)
    return app.request('/profile/cv', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
  }

  it('auto-fills an empty structured resume from the extracted CV', async () => {
    const token = await registerAndGetToken(app)
    const res = await uploadCv(token)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { resume: Resume; suggestedResume: Resume | null }
    expect(body.resume.fullName).toBe('Nurul Komor')
    expect(body.suggestedResume).toBeNull()
  })

  it('suggests the extracted resume instead of overwriting an existing one', async () => {
    const token = await registerAndGetToken(app)
    await app.request('/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: { ...emptyResume(), fullName: 'Existing Name' } }),
    })

    const res = await uploadCv(token)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { resume: Resume; suggestedResume: Resume | null }
    expect(body.resume.fullName).toBe('Existing Name')
    expect(body.suggestedResume?.fullName).toBe('Nurul Komor')
  })

  it('skips extraction silently when the AI budget is exceeded', async () => {
    process.env.ANTHROPIC_DAILY_BUDGET_USD = '0'
    const token = await registerAndGetToken(app)
    const res = await uploadCv(token)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { cvText: string; resume: Resume; suggestedResume: Resume | null }
    expect(body.cvText).toBe('Parsed CV text from the fake extractor.')
    expect(body.resume).toEqual(emptyResume())
    expect(body.suggestedResume).toBeNull()
  })
})
