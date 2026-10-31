import type { Db } from 'mongodb'
import type { Application } from '@job-hunter/shared'
import { writeAuditLog } from './auditLog.js'

const DUPLICATE_WINDOW_DAYS = 60

export async function ensureApplicationIndexes(db: Db): Promise<void> {
  await db.collection('applications').createIndex({ jobId: 1 }, { unique: true })
}

export async function createApplication(
  db: Db,
  jobKey: { sourceId: string; sourceJobId: string },
  actorProfileId: string
): Promise<Application> {
  const jobId = `${jobKey.sourceId}:${jobKey.sourceJobId}`
  const applications = db.collection<Application>('applications')

  const existingForJob = await applications.findOne({ jobId })
  if (existingForJob) {
    throw new Error(`an application already exists for job ${jobId}`)
  }

  const job = await db.collection('jobs').findOne(jobKey)
  if (!job) {
    throw new Error(`job not found: ${jobId}`)
  }

  const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const existingForCompanyTitle = await applications.findOne({
    company: job.company,
    title: job.title,
    createdAt: { $gte: cutoff },
  })
  if (existingForCompanyTitle) {
    throw new Error(
      `an application for ${job.company} / ${job.title} already exists within the last ${DUPLICATE_WINDOW_DAYS} days`
    )
  }

  const now = new Date().toISOString()
  const application: Application = {
    jobId,
    profileId: actorProfileId,
    company: job.company,
    title: job.title,
    status: 'draft',
    materialsVersion: null,
    requiredAnswers: [],
    createdAt: now,
    updatedAt: now,
  }
  await applications.insertOne(application)
  await writeAuditLog(db, {
    action: 'application_created',
    jobId,
    runNumber: null,
    actorProfileId,
    details: { company: job.company, title: job.title },
  })

  return application
}
