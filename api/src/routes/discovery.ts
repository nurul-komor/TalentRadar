import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { runDiscovery } from '../discovery/discoveryService.js'
import type { JobSource } from '../discovery/types.js'

export function createDiscoveryRoutes(db: Db, jwtSecret: string, sources: JobSource[]) {
  const discoveryRoutes = new Hono<{ Variables: AuthVariables }>()
  discoveryRoutes.use('*', createRequireAuth(jwtSecret))

  discoveryRoutes.post('/run', async (c) => {
    const result = await runDiscovery(db, sources)
    return c.json(result)
  })

  return discoveryRoutes
}
