import type { Db } from 'mongodb'
import type { Job } from '@job-hunter/shared'
import { normalizeUrl } from './normalizeUrl.js'
import type { JobSource, RawJobPosting } from './types.js'

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

interface SourceRunTotals {
  discovered: number
  duplicates: number
  errors: DiscoveryResult['errors']
}

async function persistPosting(db: Db, posting: RawJobPosting): Promise<'discovered' | 'duplicate'> {
  const normalizedPostingUrl = normalizeUrl(posting.url)
  const duplicate = await isDuplicate(db, posting, normalizedPostingUrl)
  if (duplicate) return 'duplicate'

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
    verifiedAt: null,
    verificationEvidence: null,
    contentHash: null,
    extractedRequirements: null,
    extractedAt: null,
    score: null,
    scoreBreakdown: null,
    scoredAt: null,
    govtDetails: posting.govtDetails ?? null,
  })
  return 'discovered'
}

async function runSource(db: Db, source: JobSource): Promise<SourceRunTotals> {
  const totals: SourceRunTotals = { discovered: 0, duplicates: 0, errors: [] }

  let postings: RawJobPosting[]
  try {
    postings = await source.fetchJobs()
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    totals.errors.push({ sourceId: source.id, message })
    return totals
  }

  for (const posting of postings) {
    try {
      const outcome = await persistPosting(db, posting)
      if (outcome === 'duplicate') totals.duplicates += 1
      else totals.discovered += 1
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      totals.errors.push({ sourceId: posting.sourceId, message })
    }
  }

  return totals
}

export async function runDiscovery(db: Db, sources: JobSource[]): Promise<DiscoveryResult> {
  // Each source persists its own postings as soon as it resolves, rather than
  // waiting on every source via Promise.allSettled before writing anything —
  // one slow source (e.g. a rate-limited upstream API) would otherwise hold
  // up jobs from every other, fast source for the length of the whole run.
  const sourceTotals = await Promise.all(sources.map((source) => runSource(db, source)))

  return sourceTotals.reduce<DiscoveryResult>(
    (acc, totals) => ({
      discovered: acc.discovered + totals.discovered,
      duplicates: acc.duplicates + totals.duplicates,
      errors: [...acc.errors, ...totals.errors],
    }),
    { discovered: 0, duplicates: 0, errors: [] }
  )
}
