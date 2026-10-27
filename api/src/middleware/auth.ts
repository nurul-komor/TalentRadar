import { createMiddleware } from 'hono/factory'
import { verifyAuthToken } from '../lib/jwt.js'

export interface AuthVariables {
  profileId: string
}

export function createRequireAuth(jwtSecret: string) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header('Authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'missing bearer token' }, 401)
    }
    const token = header.slice('Bearer '.length)
    try {
      const payload = await verifyAuthToken(token, jwtSecret)
      c.set('profileId', payload.sub)
      await next()
    } catch {
      return c.json({ error: 'invalid or expired token' }, 401)
    }
  })
}
