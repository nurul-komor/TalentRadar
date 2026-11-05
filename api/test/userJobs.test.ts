import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createUserJobsRoutes } from '../src/routes/userJobs'
import { ensureUserJobsIndexes, type JobPageExtractor } from '../src/userJobs/userJobsService'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

// A stand-in extractor so preview tests don't hit the network/LLM. previewJobFromUrl
// still fetches the URL first, so these tests use data: URLs the extractor ignores.
const fakeExtractor: JobPageExtractor = async () => ({
  title: 'Senior Engineer',
  company: 'Acme Corp',
  description: 'Build things.',
  location: 'Remote',
  salaryMin: 100000,
  salaryMax: 150000,
})

async function registerAndGetToken(app: Hono, email = 'userjobs@example.com'): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  })
  const body = (await res.json()) as { token: string }
  return body.token
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

describe('user jobs routes', () => {
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
    await ensureUserJobsIndexes(db)

    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/user-jobs', createUserJobsRoutes(db, JWT_SECRET, fakeExtractor))
  })

  afterEach(async () => {
    await client.close()
  })

  it('requires auth', async () => {
    const res = await app.request('/user-jobs')
    expect(res.status).toBe(401)
  })

  it('saves a manual job as private by default and lists it', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/user-jobs', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'Backend Dev', company: 'Globex', description: 'Node + Mongo' }),
    })
    expect(res.status).toBe(201)
    const saved = (await res.json()) as { _id: string; visibility: string; title: string }
    expect(saved.visibility).toBe('private')
    expect(saved.title).toBe('Backend Dev')

    const listRes = await app.request('/user-jobs', { headers: auth(token) })
    const body = (await listRes.json()) as { jobs: Array<{ _id: string }> }
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0]._id).toBe(saved._id)
  })

  it('rejects a job with no title', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/user-jobs', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ company: 'Globex' }),
    })
    expect(res.status).toBe(400)
  })

  it('toggles visibility via PATCH', async () => {
    const token = await registerAndGetToken(app)
    const createRes = await app.request('/user-jobs', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'X', company: 'Y' }),
    })
    const { _id } = (await createRes.json()) as { _id: string }

    const patchRes = await app.request(`/user-jobs/${_id}`, {
      method: 'PATCH',
      headers: auth(token),
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(patchRes.status).toBe(200)
    const updated = (await patchRes.json()) as { visibility: string }
    expect(updated.visibility).toBe('public')
  })

  it("does not let a user patch another user's job", async () => {
    const ownerToken = await registerAndGetToken(app, 'owner@example.com')
    const otherToken = await registerAndGetToken(app, 'other@example.com')
    const createRes = await app.request('/user-jobs', {
      method: 'POST',
      headers: auth(ownerToken),
      body: JSON.stringify({ title: 'X', company: 'Y' }),
    })
    const { _id } = (await createRes.json()) as { _id: string }

    const patchRes = await app.request(`/user-jobs/${_id}`, {
      method: 'PATCH',
      headers: auth(otherToken),
      body: JSON.stringify({ visibility: 'public' }),
    })
    expect(patchRes.status).toBe(404)
  })

  it('deletes a job the caller owns', async () => {
    const token = await registerAndGetToken(app)
    const createRes = await app.request('/user-jobs', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'X', company: 'Y' }),
    })
    const { _id } = (await createRes.json()) as { _id: string }

    const delRes = await app.request(`/user-jobs/${_id}`, { method: 'DELETE', headers: auth(token) })
    expect(delRes.status).toBe(204)

    const listRes = await app.request('/user-jobs', { headers: auth(token) })
    const body = (await listRes.json()) as { jobs: unknown[] }
    expect(body.jobs).toHaveLength(0)
  })

  it('fetches a single job the caller owns by id', async () => {
    const token = await registerAndGetToken(app)
    const createRes = await app.request('/user-jobs', {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ title: 'Platform Engineer', company: 'Initech' }),
    })
    const { _id } = (await createRes.json()) as { _id: string }

    const getRes = await app.request(`/user-jobs/${_id}`, { headers: auth(token) })
    expect(getRes.status).toBe(200)
    const job = (await getRes.json()) as { _id: string; title: string }
    expect(job._id).toBe(_id)
    expect(job.title).toBe('Platform Engineer')
  })

  it("does not let a user fetch another user's job by id", async () => {
    const ownerToken = await registerAndGetToken(app, 'owner@example.com')
    const otherToken = await registerAndGetToken(app, 'other@example.com')
    const createRes = await app.request('/user-jobs', {
      method: 'POST',
      headers: auth(ownerToken),
      body: JSON.stringify({ title: 'X', company: 'Y' }),
    })
    const { _id } = (await createRes.json()) as { _id: string }

    const getRes = await app.request(`/user-jobs/${_id}`, { headers: auth(otherToken) })
    expect(getRes.status).toBe(404)
  })

  it('returns 404 for a missing or invalid job id', async () => {
    const token = await registerAndGetToken(app)
    for (const id of ['not-an-object-id', '0123456789abcdef01234567']) {
      const res = await app.request(`/user-jobs/${id}`, { headers: auth(token) })
      expect(res.status).toBe(404)
    }
  })

  it('rejects a preview request with an invalid or non-http URL', async () => {
    const token = await registerAndGetToken(app)
    for (const url of ['not-a-url', 'ftp://example.com/x', '']) {
      const res = await app.request('/user-jobs/preview', {
        method: 'POST',
        headers: auth(token),
        body: JSON.stringify({ url }),
      })
      expect(res.status).toBe(400)
    }
  })
})
