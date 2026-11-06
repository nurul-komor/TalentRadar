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
import { createJobPageExtractor } from './userJobs/userJobsService.js'
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
import { createRequirementsExtractor } from './scoring/requirementsExtractor.js'
import { createMaterialsGenerator } from './materials/materialsGenerator.js'
import { createResumeExtractor } from './profile/resumeExtractor.js'
import { createCloudinaryUploader } from './profile/cloudinaryStorage.js'
import type { LlmConfig } from './llm/config.js'

export function mountRoutes(
  app: Hono,
  db: Db,
  jwtSecret: string,
  cronSecret: string,
  llmConfig: LlmConfig | null
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
  const resumeExtractor = llmConfig
    ? createResumeExtractor(llmConfig.provider, llmConfig.resume.model)
    : null
  const cvUploader = createCloudinaryUploader(process.env)

  app.route('/auth', createAuthRoutes(db, jwtSecret))
  app.route('/profile', createProfileRoutes(db, jwtSecret, undefined, resumeExtractor, cvUploader))
  app.route('/discovery', createDiscoveryRoutes(db, jwtSecret, sources))
  app.route('/verification', createVerificationRoutes(db, jwtSecret, pageEvidenceVerifier))
  app.route('/jobs', createJobsRoutes(db, jwtSecret, sources))
  app.route('/public', createPublicRoutes(db))
  app.route('/admin', createAdminRoutes(db, jwtSecret))
  app.route('/cron', createCronRoutes(db, cronSecret, sources))
  app.route('/applications', createApplicationsRoutes(db, jwtSecret))
  app.route('/automation', createAutomationRoutes(db, jwtSecret))
  app.route('/job-tracking', createJobTrackingRoutes(db, jwtSecret))
  // User-added jobs work with or without an LLM: the URL preview uses the
  // configured provider when present and falls back to heuristic extraction
  // otherwise, so this route mounts unconditionally.
  app.route(
    '/user-jobs',
    createUserJobsRoutes(
      db,
      jwtSecret,
      llmConfig ? createJobPageExtractor(llmConfig.provider, llmConfig.requirements.model) : null
    )
  )

  if (llmConfig) {
    app.route(
      '/scoring',
      createScoringRoutes(
        db,
        jwtSecret,
        createRequirementsExtractor(llmConfig.provider, llmConfig.requirements.model)
      )
    )
    app.route(
      '/materials',
      createMaterialsRoutes(
        db,
        jwtSecret,
        createMaterialsGenerator(
          llmConfig.provider,
          llmConfig.materials.model,
          llmConfig.materials.reasoning
        )
      )
    )
  }

  return app
}
