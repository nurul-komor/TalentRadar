import { Hono } from 'hono'
import type { Db } from 'mongodb'
import type { Application, AutomationRun } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { createApplication } from '../applications/applicationsService.js'
import { approveRun } from '../applications/automationRunsService.js'
import { ForbiddenError, NotFoundError } from '../lib/errors.js'

export function createApplicationsRoutes(db: Db, jwtSecret: string) {
  const applicationsRoutes = new Hono<{ Variables: AuthVariables }>()
  applicationsRoutes.use('*', createRequireAuth(jwtSecret))

  applicationsRoutes.get('/', async (c) => {
    const applications = await db
      .collection<Application>('applications')
      .find({ profileId: c.get('profileId') })
      .sort({ updatedAt: -1 })
      .toArray()
    return c.json({ applications })
  })

  applicationsRoutes.post('/', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body.sourceId !== 'string' || typeof body.sourceJobId !== 'string') {
      return c.json({ error: 'sourceId and sourceJobId are required' }, 400)
    }

    try {
      const application = await createApplication(
        db,
        { sourceId: body.sourceId, sourceJobId: body.sourceJobId },
        c.get('profileId')
      )
      return c.json(application, 201)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'failed to create application'
      return c.json({ error: message }, 409)
    }
  })

  applicationsRoutes.get('/:jobId', async (c) => {
    const jobId = c.req.param('jobId')
    // Applications are owned per-user, so scope the lookup to the caller's
    // profile. Another user's application for the same (shared) job simply
    // reads as "not found" here — the drawer then starts the caller's own.
    const application = await db
      .collection<Application>('applications')
      .findOne({ jobId, profileId: c.get('profileId') })
    if (!application) {
      return c.json({ error: 'application not found' }, 404)
    }

    const latestRun = await db
      .collection<AutomationRun>('automationRuns')
      .find({ jobId })
      .sort({ runNumber: -1 })
      .limit(1)
      .toArray()

    return c.json({ application, latestRun: latestRun[0] ?? null })
  })

  // Lets the owner fill in the required answers the automation couldn't infer
  // (unlabeled fields, option groups) so the run can clear the canSubmit gate.
  // Answers are merged by question onto the existing list; unknown questions are
  // ignored rather than appended, keeping the set aligned with the discovered form.
  applicationsRoutes.put('/:jobId/answers', async (c) => {
    const jobId = c.req.param('jobId')
    const body = await c.req.json().catch(() => null)
    if (!body || !Array.isArray(body.answers)) {
      return c.json({ error: 'answers must be an array of { question, answer }' }, 400)
    }

    const application = await db
      .collection<Application>('applications')
      .findOne({ jobId, profileId: c.get('profileId') })
    if (!application) {
      return c.json({ error: 'application not found' }, 404)
    }

    const updates = new Map<string, string | null>()
    for (const item of body.answers) {
      if (!item || typeof item.question !== 'string') continue
      const value = item.answer
      if (value !== null && typeof value !== 'string') continue
      updates.set(item.question, value === '' ? null : value)
    }

    const mergedAnswers = application.requiredAnswers.map((entry) =>
      updates.has(entry.question) ? { ...entry, answer: updates.get(entry.question)! } : entry
    )

    await db.collection<Application>('applications').updateOne(
      { jobId, profileId: c.get('profileId') },
      { $set: { requiredAnswers: mergedAnswers, updatedAt: new Date().toISOString() } }
    )

    return c.json({ ...application, requiredAnswers: mergedAnswers })
  })

  applicationsRoutes.post('/:jobId/runs/:runNumber/approve', async (c) => {
    const jobId = c.req.param('jobId')
    const runNumber = Number(c.req.param('runNumber'))

    try {
      const result = await approveRun(db, jobId, runNumber, c.get('profileId'))
      return c.json(result)
    } catch (reason) {
      if (reason instanceof ForbiddenError) return c.json({ error: reason.message }, 403)
      if (reason instanceof NotFoundError) return c.json({ error: reason.message }, 404)
      console.error('failed to approve run', reason)
      return c.json({ error: 'failed to approve run' }, 500)
    }
  })

  return applicationsRoutes
}
