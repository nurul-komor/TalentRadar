import { Hono } from 'hono'
import { ObjectId, type Db } from 'mongodb'
import type { Profile } from '@job-hunter/shared'
import { createRequireAuth, type AuthVariables } from '../middleware/auth.js'
import { runScoring } from '../scoring/scoringService.js'
import type { JobRequirementsExtractor } from '../scoring/types.js'

export function createScoringRoutes(db: Db, jwtSecret: string, extractor: JobRequirementsExtractor) {
  const scoringRoutes = new Hono<{ Variables: AuthVariables }>()
  scoringRoutes.use('*', createRequireAuth(jwtSecret))

  scoringRoutes.post('/run', async (c) => {
    const profile = (await db
      .collection('profiles')
      .findOne({ _id: new ObjectId(c.get('profileId')) })) as Profile | null
    if (!profile) {
      return c.json({ error: 'profile not found' }, 404)
    }

    const result = await runScoring(db, profile, extractor)
    return c.json(result)
  })

  return scoringRoutes
}
