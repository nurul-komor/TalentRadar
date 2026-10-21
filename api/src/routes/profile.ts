import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import { ProfileUpdateSchema } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth'

export function createProfileRoutes(db: Db, jwtSecret: string) {
  const profileRoutes = new Hono<{ Variables: AuthVariables }>()
  profileRoutes.use('*', createRequireAuth(jwtSecret))

  profileRoutes.get('/', async (c) => {
    const profile = await db
      .collection('profiles')
      .findOne(
        { _id: new ObjectId(c.get('profileId')) },
        { projection: { passwordHash: 0 } }
      )
    if (!profile) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(profile)
  })

  profileRoutes.put('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = ProfileUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', details: parsed.error.flatten() }, 400)
    }

    const profiles = db.collection('profiles')
    const result = await profiles.findOneAndUpdate(
      { _id: new ObjectId(c.get('profileId')) },
      { $set: { ...parsed.data, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    )
    if (!result) {
      return c.json({ error: 'profile not found' }, 404)
    }
    return c.json(result)
  })

  return profileRoutes
}
