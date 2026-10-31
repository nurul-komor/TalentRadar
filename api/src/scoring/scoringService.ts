import { createHash } from 'crypto'
import type { Db } from 'mongodb'
import type { Job, Profile } from '@job-hunter/shared'
import { isWithinBudget, recordUsage } from './aiUsageService'
import { computeScore } from './scoreCalculator'
import type { JobRequirementsExtractor } from './types'

export interface ScoringResult {
  checked: number
  scored: number
  deferred: number
  errors: Array<{ jobId: string; message: string }>
}

function hashContent(rawDescription: string): string {
  return createHash('sha256').update(rawDescription).digest('hex')
}

export async function runScoring(
  db: Db,
  profile: Profile,
  extractor: JobRequirementsExtractor
): Promise<ScoringResult> {
  const jobs = db.collection<Job>('jobs')
  const verifiedJobs = await jobs.find({ status: 'verified' }).toArray()

  let scored = 0
  let deferred = 0
  const errors: ScoringResult['errors'] = []

  for (const job of verifiedJobs) {
    const jobKey = { sourceId: job.sourceId, sourceJobId: job.sourceJobId }

    try {
      const currentHash = hashContent(job.rawDescription)
      const now = new Date().toISOString()

      let requirements = job.extractedRequirements

      if (job.contentHash !== currentHash || !requirements) {
        if (!(await isWithinBudget(db))) {
          if (!requirements) {
            deferred += 1
            continue
          }
          // Budget exceeded but a prior extraction exists — score against the stale extraction.
        } else {
          const extraction = await extractor({
            title: job.title,
            company: job.company,
            rawDescription: job.rawDescription,
          })
          requirements = extraction.requirements
          await recordUsage(db, extraction.usage)
          await jobs.updateOne(jobKey, {
            $set: { contentHash: currentHash, extractedRequirements: requirements, extractedAt: now },
          })
        }
      }

      if (!requirements) {
        deferred += 1
        continue
      }

      const { score, breakdown } = computeScore(requirements, job, profile)
      await jobs.updateOne(jobKey, {
        $set: { score, scoreBreakdown: breakdown, scoredAt: now },
      })
      scored += 1
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      errors.push({ jobId: `${job.sourceId}:${job.sourceJobId}`, message })
    }
  }

  return { checked: verifiedJobs.length, scored, deferred, errors }
}
