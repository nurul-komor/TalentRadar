import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import { RegisterRequestSchema, LoginRequestSchema, emptyResume } from '@job-hunter/shared'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { createAuthToken } from '../lib/jwt.js'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { isAdmin } from '../lib/admins.js'

export function createAuthRoutes(db: Db, jwtSecret: string) {
  const authRoutes = new Hono<{ Variables: AuthVariables }>()

  authRoutes.post('/register', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = RegisterRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
    }
    const { email, password } = parsed.data

    const profiles = db.collection('profiles')
    const existing = await profiles.findOne({ email })
    if (existing) {
      return c.json({ error: 'email already registered' }, 409)
    }

    const passwordHash = await hashPassword(password)
    const now = new Date().toISOString()
    const result = await profiles.insertOne({
      email,
      passwordHash,
      eligibility: { workAuthorization: 'unknown', countries: [] },
      preferences: { targetRoles: [], remoteOnly: true, minSalaryUsd: null, locations: [] },
      cvText: null,
      resume: emptyResume(),
      onboardingCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    const token = await createAuthToken(result.insertedId.toString(), jwtSecret)
    return c.json({ token }, 201)
  })

  authRoutes.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = LoginRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
    }
    const { email, password } = parsed.data

    const profiles = db.collection('profiles')
    const profile = await profiles.findOne({ email })
    if (!profile || !(await verifyPassword(password, profile.passwordHash))) {
      return c.json({ error: 'invalid email or password' }, 401)
    }

    const token = await createAuthToken(profile._id.toString(), jwtSecret)
    return c.json({ token })
  })

  // End an admin impersonation session and return to the admin's own account. Gated by auth
  // (not admin — the active session is the impersonated user), it re-verifies that the `act`
  // claim points at a real admin before minting a fresh, non-impersonated admin token.
  authRoutes.post('/stop-impersonate', createRequireAuth(jwtSecret), async (c) => {
    const adminId = c.get('impersonatedBy')
    if (!adminId || !ObjectId.isValid(adminId)) return c.json({ error: 'not impersonating' }, 400)
    const admin = await db
      .collection('profiles')
      .findOne({ _id: new ObjectId(adminId) }, { projection: { email: 1 } })
    if (!isAdmin(admin?.email)) return c.json({ error: 'forbidden' }, 403)
    const token = await createAuthToken(adminId, jwtSecret)
    return c.json({ token })
  })

  return authRoutes
}
