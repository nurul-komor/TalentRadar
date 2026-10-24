import type { Db } from 'mongodb'
import type { Job } from '@job-hunter/shared'
import { normalizeUrl } from './normalizeUrl'
import type { JobSource, RawJobPosting } from './types'

const DEDUPE_WINDOW_DAYS = 60

export interface DiscoveryResult {
  discovered: number
  duplicates: number
  errors: Array<{ sourceId: string; message: string }>
}

export async function ensureJobIndexes(db: Db): Promise<void> {
  const jobs = db.collection<Job>('jobs')
  await jobs.createIndex({ sourceId: 1, sourceJobId: 1 }, { unique: true })
  await jobs.createIndex({ normalizedUrl: 1 }, { unique: true })
}

async function isDuplicate(
  db: Db,
  posting: RawJobPosting,
  normalizedUrl: string
): Promise<boolean> {
  const jobs = db.collection('jobs')

  const bySourceId = await jobs.findOne({
    sourceId: posting.sourceId,
    sourceJobId: posting.sourceJobId,
  })
  if (bySourceId) return true

  const byUrl = await jobs.findOne({ normalizedUrl })
  if (byUrl) return true

  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const byCompanyTitle = await jobs.findOne({
    company: posting.company,
    title: posting.title,
    discoveredAt: { $gte: cutoff },
  })
  return byCompanyTitle !== null
}

export async function runDiscovery(db: Db, sources: JobSource[]): Promise<DiscoveryResult> {
  const results = await Promise.allSettled(sources.map((source) => source.fetchJobs()))

  let discovered = 0
  let duplicates = 0
  const errors: DiscoveryResult['errors'] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const source = sources[i]

    if (result.status === 'rejected') {
      const reason = result.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      errors.push({ sourceId: source.id, message })
      continue
    }

    for (const posting of result.value) {
      try {
        const normalizedPostingUrl = normalizeUrl(posting.url)
        const duplicate = await isDuplicate(db, posting, normalizedPostingUrl)
        if (duplicate) {
          duplicates += 1
          continue
        }

        const now = new Date().toISOString()
        await db.collection<Job>('jobs').insertOne({
          sourceId: posting.sourceId,
          sourceJobId: posting.sourceJobId,
          normalizedUrl: normalizedPostingUrl,
          title: posting.title,
          company: posting.company,
          rawDescription: posting.rawDescription,
          location: posting.location,
          salaryMin: posting.salaryMin,
          salaryMax: posting.salaryMax,
          postedAt: posting.postedAt,
          status: 'discovered',
          discoveredAt: now,
          updatedAt: now,
        })
        discovered += 1
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason)
        errors.push({ sourceId: posting.sourceId, message })
        continue
      }
    }
  }

  return { discovered, duplicates, errors }
}
