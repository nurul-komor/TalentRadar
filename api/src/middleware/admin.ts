import { createMiddleware } from 'hono/factory'
import { ObjectId, type Db } from 'mongodb'
import type { AuthVariables } from './auth.js'
import { isAdmin } from '../lib/admins.js'

export function createRequireAdmin(db: Db) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const profile = await db
      .collection('profiles')
      .findOne({ _id: new ObjectId(c.get('profileId')) }, { projection: { email: 1 } })
    if (!isAdmin(profile?.email)) {
      return c.json({ error: 'forbidden' }, 403)
    }
    await next()
  })
}
