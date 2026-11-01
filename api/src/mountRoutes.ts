import type { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createAuthRoutes } from './routes/auth.js'
import { createProfileRoutes } from './routes/profile.js'
import { createDiscoveryRoutes } from './routes/discovery.js'
import { createVerificationRoutes } from './routes/verification.js'
import { createScoringRoutes } from './routes/scoring.js'
import { createJobsRoutes } from './routes/jobs.js'
import { createPublicRoutes } from './routes/public.js'
import { createAdminRoutes } from './routes/admin.js'
import { createCronRoutes } from './routes/cron.js'
import { createMaterialsRoutes } from './routes/materials.js'
import { createApplicationsRoutes } from './routes/applications.js'
import { createAutomationRoutes } from './routes/automation.js'
import { remoteOkSource } from './discovery/sources/remoteok.js'
import { weWorkRemotelySource } from './discovery/sources/weworkremotely.js'
import { himalayasSource } from './discovery/sources/himalayas.js'
import { teletalkGovtSource } from './discovery/sources/teletalkGovt.js'
import { pageEvidenceVerifier } from './verification/pageEvidenceVerifier.js'
import { createClaudeRequirementsExtractor } from './scoring/requirementsExtractor.js'
import { createClaudeMaterialsGenerator } from './materials/materialsGenerator.js'

export function mountRoutes(
  app: Hono,
  db: Db,
  jwtSecret: string,
  cronSecret: string,
  anthropicApiKey: string | undefined
) {
  const sources = [remoteOkSource, weWorkRemotelySource, himalayasSource, teletalkGovtSource]

  app.route('/auth', createAuthRoutes(db, jwtSecret))
  app.route('/profile', createProfileRoutes(db, jwtSecret))
  app.route('/discovery', createDiscoveryRoutes(db, jwtSecret, sources))
  app.route('/verification', createVerificationRoutes(db, jwtSecret, pageEvidenceVerifier))
  app.route('/jobs', createJobsRoutes(db))
  app.route('/public', createPublicRoutes(db))
  app.route('/admin', createAdminRoutes(db, jwtSecret))
  app.route('/cron', createCronRoutes(db, cronSecret, sources))
  app.route('/applications', createApplicationsRoutes(db, jwtSecret))
  app.route('/automation', createAutomationRoutes(db, jwtSecret))

  if (anthropicApiKey) {
    app.route(
      '/scoring',
      createScoringRoutes(db, jwtSecret, createClaudeRequirementsExtractor(anthropicApiKey))
    )
    app.route(
      '/materials',
      createMaterialsRoutes(db, jwtSecret, createClaudeMaterialsGenerator(anthropicApiKey))
    )
  }

  return app
}
