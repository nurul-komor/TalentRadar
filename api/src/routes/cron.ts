import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireCronSecret } from '../middleware/cron.js'
import { runDiscovery } from '../discovery/discoveryService.js'
import type { JobSource } from '../discovery/types.js'

export function createCronRoutes(db: Db, cronSecret: string, sources: JobSource[]) {
  const cronRoutes = new Hono()
  cronRoutes.use('*', createRequireCronSecret(cronSecret))

  cronRoutes.get('/discovery', async (c) => {
    const result = await runDiscovery(db, sources)
    return c.json(result)
  })

  return cronRoutes
}
