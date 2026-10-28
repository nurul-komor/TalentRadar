import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { createRequireAdmin } from '../middleware/admin.js'

export function createAdminRoutes(db: Db, jwtSecret: string) {
  const adminRoutes = new Hono<{ Variables: AuthVariables }>()
  adminRoutes.use('*', createRequireAuth(jwtSecret))
  adminRoutes.use('*', createRequireAdmin(db))

  adminRoutes.get('/users', async (c) => {
    const users = await db
      .collection('profiles')
      .find({}, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray()
    return c.json({ users })
  })

  adminRoutes.get('/discovery/status', async (c) => {
    const jobs = db.collection('jobs')
    const [totalJobs, mostRecent] = await Promise.all([
      jobs.countDocuments({}),
      jobs.find({}, { projection: { discoveredAt: 1 } }).sort({ discoveredAt: -1 }).limit(1).next(),
    ])
    return c.json({ totalJobs, mostRecentDiscoveredAt: mostRecent?.discoveredAt ?? null })
  })

  return adminRoutes
}
