import { Hono } from 'hono'
import type { Db } from 'mongodb'
import type { Job, JobSourceId, PublicJobsSummary } from '@job-hunter/shared'
import { JobSourceIdSchema } from '@job-hunter/shared'

const FEATURED_JOBS_LIMIT = 8

export function createPublicRoutes(db: Db) {
  const publicRoutes = new Hono()

  publicRoutes.get('/jobs-summary', async (c) => {
    const jobs = db.collection<Job>('jobs')

    const [totalJobs, sourceCounts, featured] = await Promise.all([
      jobs.countDocuments({}),
      jobs
        .aggregate<{ _id: JobSourceId; count: number }>([
          { $match: { status: 'verified' } },
          { $group: { _id: '$sourceId', count: { $sum: 1 } } },
        ])
        .toArray(),
      jobs
        .find({ status: 'verified' })
        .sort({ discoveredAt: -1 })
        .limit(FEATURED_JOBS_LIMIT)
        .toArray(),
    ])

    const countBySource = new Map(sourceCounts.map((entry) => [entry._id, entry.count]))
    const bySource = JobSourceIdSchema.options.map((sourceId) => ({
      sourceId,
      count: countBySource.get(sourceId) ?? 0,
    }))

    const summary: PublicJobsSummary = {
      totalJobs,
      bySource,
      featuredJobs: featured.map((job) => ({
        _id: String(job._id),
        title: job.title,
        company: job.company,
        location: job.location,
        sourceId: job.sourceId,
        postedAt: job.postedAt,
        discoveredAt: job.discoveredAt,
      })),
    }

    return c.json(summary)
  })

  return publicRoutes
}
