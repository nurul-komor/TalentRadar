import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { Db, MongoClient } from 'mongodb'
import { connectMongo } from '../src/db'
import { createAuthRoutes } from '../src/routes/auth'
import { createAdminRoutes } from '../src/routes/admin'
import { verifyAuthToken } from '../src/lib/jwt'
import { ADMIN_EMAILS } from '../src/lib/admins'
import type { AiRuntime } from '../src/ai/aiRuntime'

const JWT_SECRET = 'test-secret'
const ADMIN_EMAIL = ADMIN_EMAILS[0]
const USER_EMAIL = 'member@example.com'
const PASSWORD = 'password123'

// The impersonation endpoints don't touch the AI runtime, so a bare stub is enough to mount
// the admin router.
const aiStub = {} as unknown as AiRuntime

function uniqueDbName(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function registerAndLogin(app: Hono, email: string): Promise<string> {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  }
  await app.request('/auth/register', init)
  const res = await app.request('/auth/login', init)
  const body = (await res.json()) as { token: string }
  return body.token
}

describe('admin impersonation', () => {
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
    app.route('/admin', createAdminRoutes(db, JWT_SECRET, aiStub))
  })

  afterEach(async () => {
    await client.close()
  })

  it('lets an admin mint a reversible token for another user, then return to admin', async () => {
    const adminToken = await registerAndLogin(app, ADMIN_EMAIL)
    await registerAndLogin(app, USER_EMAIL)

    const usersRes = await app.request('/admin/users', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const { users } = (await usersRes.json()) as { users: Array<{ _id: string; email: string }> }
    const target = users.find((u) => u.email === USER_EMAIL)!
    const adminId = users.find((u) => u.email === ADMIN_EMAIL)!._id

    // Impersonate: the token acts as the target but records the acting admin.
    const impRes = await app.request(`/admin/users/${target._id}/impersonate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(impRes.status).toBe(200)
    const { token: impToken, email } = (await impRes.json()) as { token: string; email: string }
    expect(email).toBe(USER_EMAIL)

    const impPayload = await verifyAuthToken(impToken, JWT_SECRET)
    expect(impPayload.sub).toBe(target._id)
    expect(impPayload.act).toBe(adminId)

    // Return to admin: the impersonation token itself ends the session.
    const stopRes = await app.request('/auth/stop-impersonate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${impToken}` },
    })
    expect(stopRes.status).toBe(200)
    const { token: backToken } = (await stopRes.json()) as { token: string }
    const backPayload = await verifyAuthToken(backToken, JWT_SECRET)
    expect(backPayload.sub).toBe(adminId)
    expect(backPayload.act).toBeUndefined()
  })

  it('forbids a non-admin from impersonating', async () => {
    await registerAndLogin(app, ADMIN_EMAIL)
    const userToken = await registerAndLogin(app, USER_EMAIL)

    // Grab some real id to target (the admin's).
    const adminUser = await db.collection('profiles').findOne({ email: ADMIN_EMAIL })
    const res = await app.request(`/admin/users/${adminUser!._id.toString()}/impersonate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('rejects stop-impersonate on a normal (non-impersonation) session', async () => {
    const userToken = await registerAndLogin(app, USER_EMAIL)
    const res = await app.request('/auth/stop-impersonate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    })
    expect(res.status).toBe(400)
  })

  it('rejects impersonating yourself and an invalid id', async () => {
    const adminToken = await registerAndLogin(app, ADMIN_EMAIL)
    const adminUser = await db.collection('profiles').findOne({ email: ADMIN_EMAIL })

    const self = await app.request(`/admin/users/${adminUser!._id.toString()}/impersonate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(self.status).toBe(400)

    const bad = await app.request('/admin/users/not-an-id/impersonate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(bad.status).toBe(400)
  })
})
