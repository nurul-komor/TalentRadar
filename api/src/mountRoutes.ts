import type { Hono } from 'hono'
import type { Db } from 'mongodb'
import { createAuthRoutes } from './routes/auth.js'
import { createProfileRoutes } from './routes/profile.js'
import { createDiscoveryRoutes } from './routes/discovery.js'
import { createVerificationRoutes } from './routes/verification.js'
import { createJobsRoutes } from './routes/jobs.js'
import { createAdminRoutes } from './routes/admin.js'
import { createCronRoutes } from './routes/cron.js'
import { remoteOkSource } from './discovery/sources/remoteok.js'
import { weWorkRemotelySource } from './discovery/sources/weworkremotely.js'
import { himalayasSource } from './discovery/sources/himalayas.js'
import { pageEvidenceVerifier } from './verification/pageEvidenceVerifier.js'

export function mountRoutes(app: Hono, db: Db, jwtSecret: string, cronSecret: string) {
  const sources = [remoteOkSource, weWorkRemotelySource, himalayasSource]
  app.route('/auth', createAuthRoutes(db, jwtSecret))
  app.route('/profile', createProfileRoutes(db, jwtSecret))
  app.route('/discovery', createDiscoveryRoutes(db, jwtSecret, sources))
  app.route('/verification', createVerificationRoutes(db, jwtSecret, pageEvidenceVerifier))
  app.route('/jobs', createJobsRoutes(db, jwtSecret))
  app.route('/admin', createAdminRoutes(db, jwtSecret))
  app.route('/cron', createCronRoutes(db, cronSecret, sources))
  return app
}
