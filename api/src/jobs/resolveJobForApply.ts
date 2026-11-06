import { ObjectId, type Db } from 'mongodb'
import type { Job, UserJob } from '@job-hunter/shared'

// Virtual sourceId for user-added jobs in the apply flows. A user job has no
// place in the fixed discovery `sourceId` enum, so it borrows this label and its
// Mongo `_id` as the `sourceJobId` — a jobId then reads `userJob:<id>`, parsed
// the same way as any `sourceId:sourceJobId` pair by the route layer.
export const USER_JOB_SOURCE_ID = 'userJob'

// The minimal slice of a job the apply flows (materials generation, application
// creation, automation) actually read. Resolving both discovered jobs and user
// jobs to this shape lets those services treat the two sources uniformly.
export interface ResolvedApplyJob {
  sourceId: string
  sourceJobId: string
  company: string
  title: string
  rawDescription: string
  normalizedUrl: string
  extractedRequirements: Job['extractedRequirements']
}

// Resolve either a discovered job (shared `jobs` collection) or a user-added job
// (`userJobs`, scoped to its owner) into the common apply shape. Returns null
// when nothing matches — including a user job owned by a different profile, so
// callers can treat that as "not found" rather than leaking another user's post.
export async function resolveJobForApply(
  db: Db,
  sourceId: string,
  sourceJobId: string,
  profileId: string
): Promise<ResolvedApplyJob | null> {
  if (sourceId === USER_JOB_SOURCE_ID) {
    if (!ObjectId.isValid(sourceJobId)) return null
    const userJob = (await db
      .collection('userJobs')
      .findOne({ _id: new ObjectId(sourceJobId), profileId })) as (UserJob & { _id: ObjectId }) | null
    if (!userJob) return null
    return {
      sourceId,
      sourceJobId,
      company: userJob.company,
      title: userJob.title,
      // User jobs store free-form text in `description`; discovered jobs call the
      // same field `rawDescription`. No structured requirements are extracted for
      // user jobs, so the generator falls back to the posting text.
      rawDescription: userJob.description,
      normalizedUrl: userJob.url ?? '',
      extractedRequirements: null,
    }
  }

  // Queried through the untyped collection because `sourceId` is a plain string
  // here, narrower than Job's `sourceId` enum — an unknown value simply matches
  // nothing and falls through to the null branch.
  const job = (await db.collection('jobs').findOne({ sourceId, sourceJobId })) as Job | null
  if (!job) return null
  return {
    sourceId: job.sourceId,
    sourceJobId: job.sourceJobId,
    company: job.company,
    title: job.title,
    rawDescription: job.rawDescription,
    normalizedUrl: job.normalizedUrl,
    extractedRequirements: job.extractedRequirements,
  }
}
