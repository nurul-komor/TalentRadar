import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createDiscoveryRoutes } from '../src/routes/discovery'
import { ensureJobIndexes } from '../src/discovery/discoveryService'
import type { JobSource } from '../src/discovery/types'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function fakeSource(id: JobSource['id']): JobSource {
  return {
    id,
    fetchJobs: async () => [
      {
        sourceId: id,
        sourceJobId: '1',
        url: `https://example.com/${id}/1`,
        title: 'Engineer',
        company: 'Acme',
        rawDescription: 'desc',
        location: null,
        salaryMin: null,
        salaryMax: null,
        postedAt: null,
      },
    ],
  }
}

interface AuthResponseBody {
  token: string
}

interface DiscoveryResponseBody {
  discovered: number
  duplicates: number
  errors: unknown[]
}

async function registerAndGetToken(app: Hono): Promise<string> {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'discovery-user@example.com', password: 'password123' }),
  })
  const body = (await res.json()) as AuthResponseBody
  return body.token
}

describe('discovery routes', () => {
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
    app = new Hono()
    app.route('/auth', createAuthRoutes(db, JWT_SECRET))
    app.route('/discovery', createDiscoveryRoutes(db, JWT_SECRET, [fakeSource('remoteok')]))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no token', async () => {
    const res = await app.request('/discovery/run', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('runs discovery and returns counts', async () => {
    const token = await registerAndGetToken(app)
    const res = await app.request('/discovery/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as DiscoveryResponseBody
    expect(body.discovered).toBe(1)
    expect(body.duplicates).toBe(0)
    expect(body.errors).toEqual([])
  })
})
