import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createProfileRoutes } from '../src/routes/profile'

const JWT_SECRET = 'test-secret'

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
    app.route('/profile', createProfileRoutes(db, JWT_SECRET))
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
})
