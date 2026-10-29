import { createMiddleware } from 'hono/factory'

export function createRequireCronSecret(cronSecret: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('Authorization')
    if (header !== `Bearer ${cronSecret}`) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  })
}
