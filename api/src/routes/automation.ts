import { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { runAutomation, submitApplication } from '../automation/automationOrchestrator.js'
import { ForbiddenError, NotFoundError } from '../lib/errors.js'

export function createAutomationRoutes(db: Db, jwtSecret: string) {
  const automationRoutes = new Hono<{ Variables: AuthVariables }>()
  automationRoutes.use('*', createRequireAuth(jwtSecret))

  automationRoutes.post('/:jobId/run', async (c) => {
    const jobIdParam = c.req.param('jobId')
    const separatorIndex = jobIdParam.indexOf(':')
    const sourceId = separatorIndex === -1 ? '' : jobIdParam.slice(0, separatorIndex)
    const sourceJobId = separatorIndex === -1 ? '' : jobIdParam.slice(separatorIndex + 1)
    if (!sourceId || !sourceJobId) {
      return c.json({ error: 'invalid job id' }, 400)
    }

    try {
      const run = await runAutomation(db, { sourceId, sourceJobId }, c.get('profileId'))
      return c.json(run)
    } catch (reason) {
      if (reason instanceof ForbiddenError) return c.json({ error: reason.message }, 403)
      if (reason instanceof NotFoundError) return c.json({ error: reason.message }, 404)
      console.error('failed to run automation', reason)
      return c.json({ error: 'failed to run automation' }, 500)
    }
  })

  automationRoutes.post('/:jobId/runs/:runNumber/submit', async (c) => {
    const jobIdParam = c.req.param('jobId')
    const separatorIndex = jobIdParam.indexOf(':')
    const sourceId = separatorIndex === -1 ? '' : jobIdParam.slice(0, separatorIndex)
    const sourceJobId = separatorIndex === -1 ? '' : jobIdParam.slice(separatorIndex + 1)
    const runNumber = Number(c.req.param('runNumber'))
    if (!sourceId || !sourceJobId) {
      return c.json({ error: 'invalid job id' }, 400)
    }

    try {
      const run = await submitApplication(db, { sourceId, sourceJobId }, runNumber, c.get('profileId'))
      return c.json(run)
    } catch (reason) {
      if (reason instanceof ForbiddenError) return c.json({ error: reason.message }, 403)
      if (reason instanceof NotFoundError) return c.json({ error: reason.message }, 404)
      console.error('failed to submit application', reason)
      return c.json({ error: 'failed to submit application' }, 500)
    }
  })

  return automationRoutes
}
