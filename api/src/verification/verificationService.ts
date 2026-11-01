import type { Db } from 'mongodb'
import type { Job } from '@job-hunter/shared'
import { UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'
import type { JobVerifier } from './types.js'

export interface VerificationResult {
  checked: number
  verified: number
  rejected: number
  inconclusive: number
  errors: Array<{ jobId: string; message: string }>
}

export async function runVerification(db: Db, verifier: JobVerifier): Promise<VerificationResult> {
  const jobs = db.collection<Job>('jobs')
  const discoveredJobs = await jobs
    .find({ status: 'discovered', sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS } })
    .toArray()

  let verified = 0
  let rejected = 0
  let inconclusive = 0
  const errors: VerificationResult['errors'] = []

  for (const job of discoveredJobs) {
    const jobKey = { sourceId: job.sourceId, sourceJobId: job.sourceJobId }

    try {
      const outcome = await verifier(job.normalizedUrl)
      const now = new Date().toISOString()

      if (outcome.status === 'inconclusive') {
        inconclusive += 1
        await jobs.updateOne(jobKey, {
          $set: { verifiedAt: now, verificationEvidence: outcome.evidence, updatedAt: now },
        })
        continue
      }

      if (outcome.status === 'verified') {
        verified += 1
      } else {
        rejected += 1
      }

      await jobs.updateOne(jobKey, {
        $set: {
          status: outcome.status,
          verifiedAt: now,
          verificationEvidence: outcome.evidence,
          updatedAt: now,
        },
      })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      errors.push({ jobId: `${job.sourceId}:${job.sourceJobId}`, message })
    }
  }

  return { checked: discoveredJobs.length, verified, rejected, inconclusive, errors }
}
