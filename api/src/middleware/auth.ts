import { createMiddleware } from 'hono/factory'
import { verifyAuthToken } from '../lib/jwt.js'

export interface AuthVariables {
  profileId: string
  /** Admin profile id when this is an impersonation session (token `act` claim), else null. */
  impersonatedBy: string | null
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
      c.set('impersonatedBy', typeof payload.act === 'string' ? payload.act : null)
      await next()
    } catch {
      return c.json({ error: 'invalid or expired token' }, 401)
    }
  })
}
