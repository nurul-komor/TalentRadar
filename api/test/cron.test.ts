import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createCronRoutes } from '../src/routes/cron'
import { ensureJobIndexes } from '../src/discovery/discoveryService'
import type { JobSource } from '../src/discovery/types'

const CRON_SECRET = 'test-cron-secret'

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

interface DiscoveryResponseBody {
  discovered: number
  duplicates: number
  errors: unknown[]
}

describe('cron routes', () => {
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
    app.route('/cron', createCronRoutes(db, CRON_SECRET, [fakeSource('remoteok')]))
  })

  afterEach(async () => {
    await client.close()
  })

  it('rejects a request with no Authorization header', async () => {
    const res = await app.request('/cron/discovery')
    expect(res.status).toBe(401)
  })

  it('rejects a request with the wrong secret', async () => {
    const res = await app.request('/cron/discovery', {
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    expect(res.status).toBe(401)
  })

  it('runs discovery and returns counts when the secret matches', async () => {
    const res = await app.request('/cron/discovery', {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as DiscoveryResponseBody
    expect(body.discovered).toBe(1)
    expect(body.duplicates).toBe(0)
    expect(body.errors).toEqual([])
  })
})
