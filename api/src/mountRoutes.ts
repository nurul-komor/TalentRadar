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
import { createUserJobsRoutes } from './routes/userJobs.js'
import { createApplicationsRoutes } from './routes/applications.js'
import { createAutomationRoutes } from './routes/automation.js'
import { createJobTrackingRoutes } from './routes/jobTracking.js'
import { remoteOkSource } from './discovery/sources/remoteok.js'
import { weWorkRemotelySource } from './discovery/sources/weworkremotely.js'
import { himalayasSource } from './discovery/sources/himalayas.js'
import { teletalkGovtSource } from './discovery/sources/teletalkGovt.js'
import { brainStation23Source } from './discovery/sources/brainStation23.js'
import { riseupLabsSource } from './discovery/sources/riseupLabs.js'
import { enosisSource } from './discovery/sources/enosis.js'
import { bdtaskSource } from './discovery/sources/bdtask.js'
import { seliseSource } from './discovery/sources/selise.js'
import { bjitSource } from './discovery/sources/bjit.js'
import { cefaloSource } from './discovery/sources/cefalo.js'
import { vivasoftSource } from './discovery/sources/vivasoft.js'
import { dsInnovatorsSource } from './discovery/sources/dsInnovators.js'
import { pageEvidenceVerifier } from './verification/pageEvidenceVerifier.js'
import { createCloudinaryUploader } from './profile/cloudinaryStorage.js'
import { createSuggestionsRoutes } from './routes/suggestions.js'
import type { AiRuntime } from './ai/aiRuntime.js'

export function mountRoutes(
  app: Hono,
  db: Db,
  jwtSecret: string,
  cronSecret: string,
  // The live AI runtime: route handlers read providers/embedder/extractors off it per
  // request, so credentials saved via the admin settings page apply without a redeploy.
  ai: AiRuntime
) {
  const sources = [
    remoteOkSource,
    weWorkRemotelySource,
    himalayasSource,
    teletalkGovtSource,
    brainStation23Source,
    riseupLabsSource,
    enosisSource,
    bdtaskSource,
    seliseSource,
    bjitSource,
    cefaloSource,
    vivasoftSource,
    dsInnovatorsSource,
  ]
  // The CV uploader is env-only (Cloudinary), unaffected by AI settings, so it's built once.
  const cvUploader = createCloudinaryUploader(process.env)

  app.route('/auth', createAuthRoutes(db, jwtSecret))
  app.route(
    '/profile',
    createProfileRoutes(
      db,
      jwtSecret,
      undefined,
      () => ai.resumeExtractor,
      () => cvUploader,
      () => ai.embedder
    )
  )
  app.route('/discovery', createDiscoveryRoutes(db, jwtSecret, sources))
  app.route('/verification', createVerificationRoutes(db, jwtSecret, pageEvidenceVerifier))
  app.route('/jobs', createJobsRoutes(db, jwtSecret, sources, () => ai.embedder))
  app.route('/public', createPublicRoutes(db))
  app.route('/admin', createAdminRoutes(db, jwtSecret, ai))
  app.route('/cron', createCronRoutes(db, cronSecret, sources))
  app.route('/applications', createApplicationsRoutes(db, jwtSecret))
  app.route('/automation', createAutomationRoutes(db, jwtSecret))
  app.route('/job-tracking', createJobTrackingRoutes(db, jwtSecret))
  // All AI-backed routes mount unconditionally and resolve the current provider/embedder off
  // the runtime per request — a route returns 503 (or, for user-jobs, falls back to heuristic
  // extraction) when nothing is configured, and starts working the moment credentials are saved.
  app.route('/user-jobs', createUserJobsRoutes(db, jwtSecret, () => ai.jobPageExtractor))
  app.route('/suggestions', createSuggestionsRoutes(db, jwtSecret, () => ai.embedder))
  app.route('/scoring', createScoringRoutes(db, jwtSecret, () => ai.requirementsExtractor))
  app.route('/materials', createMaterialsRoutes(db, jwtSecret, () => ai.materialsGenerator))

  return app
}
