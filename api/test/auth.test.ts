import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'

const JWT_SECRET = 'test-secret'

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

describe('auth routes', () => {
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
  })

  afterEach(async () => {
    await client.close()
  })

  it('registers a new profile and returns a token', async () => {
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
  })

  it('rejects registering the same email twice', async () => {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com', password: 'password123' }),
    }
    await app.request('/auth/register', init)
    const res = await app.request('/auth/register', init)
    expect(res.status).toBe(409)
  })

  it('rejects an invalid register payload', async () => {
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'short' }),
    })
    expect(res.status).toBe(400)
  })

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const payload = { email: 'login@example.com', password: 'password123' }
    const registerInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
    await app.request('/auth/register', registerInit)

    const ok = await app.request('/auth/login', registerInit)
    expect(ok.status).toBe(200)
    expect(typeof (await ok.json()).token).toBe('string')

    const bad = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, password: 'wrong-password' }),
    })
    expect(bad.status).toBe(401)
  })
})
