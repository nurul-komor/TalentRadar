import type { Db, Filter } from 'mongodb'
import type { Job, JobSourceId, JobStatus } from '@job-hunter/shared'
import { UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'

export const VECTOR_INDEX_NAME = 'jobs_embedding_index'

// Job statuses eligible for suggestions. Mirrors what the public /jobs feed surfaces
// (everything except 'rejected') rather than runScoring's verified-only scope — the
// discovery feed may never be promoted to 'verified', and users still want matches from it.
export const SUGGESTIBLE_JOB_STATUSES: JobStatus[] = ['discovered', 'verified']

export interface JobMatch {
  job: Job
  // Cosine similarity mapped to 0..1 (1 = identical direction).
  similarity: number
}

// Creates the Atlas Vector Search index on jobs.embedding. This is a no-op on a non-Atlas
// deployment (local mongod / mongodb-memory-server): createSearchIndex throws there, which
// we swallow so startup still succeeds — /suggestions then uses the in-memory fallback.
export async function ensureVectorIndexes(db: Db, dimensions = 1536): Promise<void> {
  try {
    await db.collection('jobs').createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: dimensions, similarity: 'cosine' },
          // Fields used in the $vectorSearch `filter` must be declared here as `filter` type.
          { type: 'filter', path: 'status' },
          { type: 'filter', path: 'sourceId' },
        ],
      },
    })
  } catch (reason) {
    // Already-exists is fine; anything else almost certainly means "not an Atlas cluster".
    const message = reason instanceof Error ? reason.message : String(reason)
    if (!/already exists/i.test(message)) {
      console.warn(
        `Vector search index not created (${message}). /suggestions will use the in-memory fallback.`
      )
    }
  }
}

// Once $vectorSearch fails on this process we know the cluster isn't Atlas-with-search, so we
// stop attempting the aggregation and go straight to the in-memory path on every later call.
let vectorSearchUnavailable = false

// Lets the admin vector-status endpoint report whether this process has fallen back to the
// in-memory cosine path. Null = never attempted a $vectorSearch yet this process.
export function isVectorSearchUnavailable(): boolean {
  return vectorSearchUnavailable
}

// Maps a raw cosine similarity (-1..1) to the 0..1 scale Atlas reports as `vectorSearchScore`
// for a cosine index, i.e. (1 + cos) / 2. Used so the in-memory fallback and the /jobs match
// sort produce the same score scale as the Atlas $vectorSearch path.
export function cosineToUnitScore(cosine: number): number {
  return (1 + cosine) / 2
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

// Ranks verified jobs by semantic similarity to `queryVector`. Prefers Atlas $vectorSearch;
// on any failure (index missing / not Atlas) it falls back to loading embedded jobs and
// computing cosine similarity in Node. Returns at most `limit` matches, most-similar first.
export async function searchSimilarJobs(
  db: Db,
  queryVector: number[],
  options: { limit?: number } = {}
): Promise<JobMatch[]> {
  const limit = options.limit ?? 20
  const jobs = db.collection<Job>('jobs')

  if (!vectorSearchUnavailable) {
    try {
      const results = await jobs
        .aggregate<Job & { _vectorScore: number }>([
          {
            $vectorSearch: {
              index: VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector,
              numCandidates: Math.max(limit * 10, 100),
              limit,
              filter: {
                status: { $in: SUGGESTIBLE_JOB_STATUSES },
                sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS as JobSourceId[] },
              },
            },
          },
          { $addFields: { _vectorScore: { $meta: 'vectorSearchScore' } } },
        ])
        .toArray()

      return results.map(({ _vectorScore, ...job }) => ({
        job: job as Job,
        // Atlas returns cosine similarity already normalized to 0..1.
        similarity: _vectorScore,
      }))
    } catch (reason) {
      vectorSearchUnavailable = true
      const message = reason instanceof Error ? reason.message : String(reason)
      console.warn(`$vectorSearch unavailable (${message}); using in-memory cosine fallback.`)
    }
  }

  // In-memory fallback — fine for the current feed size; O(n) over embedded jobs.
  const embedded = await jobs
    .find({
      status: { $in: SUGGESTIBLE_JOB_STATUSES },
      sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS },
      embedding: { $type: 'array' },
    })
    .toArray()

  return embedded
    .map((job) => ({
      job,
      // Normalize to Atlas's (1+cos)/2 scale so fallback scores match the $vectorSearch path.
      similarity: cosineToUnitScore(cosineSimilarity(queryVector, job.embedding as number[])),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

export interface RankedJobsPage {
  jobs: Array<Job & { matchScore: number }>
  total: number
}

// How many of the top semantic matches the "Best match" sort ranks before applying the
// remaining (non-vector) filters. Plenty for a human browsing by relevance; matches ranked
// beyond this aren't paginated into, which is an acceptable bound for a best-match view.
const MATCH_CANDIDATE_POOL = 500

// "Best match" ranks jobs in two freshness tiers: everything discovered within this many
// days sorts as a block above older postings, with match score ordering within each tier.
// Keeps genuinely fresh roles at the top without discarding strong older matches.
const FRESH_WINDOW_DAYS = 7

// Powers the /jobs "Best match" sort: ranks jobs by similarity to queryVector server-side via
// Atlas $vectorSearch, then applies `postFilter` (the filters $vectorSearch can't express —
// keyword/salary/date/language/location) to the ranked pool and paginates. Keeps the heavy
// vector work in Atlas instead of streaming every embedding into Node. Falls back to in-app
// cosine over the filtered set when $vectorSearch is unavailable (non-Atlas dev/test).
export async function searchRankedJobsPage(
  db: Db,
  queryVector: number[],
  opts: { postFilter: Filter<Job>; limit: number; offset: number }
): Promise<RankedJobsPage> {
  const { postFilter, limit, offset } = opts
  const jobs = db.collection<Job>('jobs')
  // ISO cutoff for the "fresh" tier; discoveredAt is an ISO string, so string comparison is chronological.
  const freshCutoff = new Date(Date.now() - FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const isFreshJob = (job: Job) => job.discoveredAt >= freshCutoff
  const roundScore = (job: Job & { matchScore: number }) => ({
    ...job,
    matchScore: Math.round(job.matchScore * 10) / 10,
  })

  if (!vectorSearchUnavailable) {
    try {
      const [result] = await jobs
        .aggregate([
          {
            $vectorSearch: {
              index: VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector,
              numCandidates: MATCH_CANDIDATE_POOL * 2,
              limit: MATCH_CANDIDATE_POOL,
              filter: {
                status: { $in: SUGGESTIBLE_JOB_STATUSES },
                sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS as JobSourceId[] },
              },
            },
          },
          {
            $addFields: {
              matchScore: { $multiply: [{ $meta: 'vectorSearchScore' }, 100] },
              // Fresh-first tiering: jobs from the last FRESH_WINDOW_DAYS rank as a block
              // above older ones; matchScore orders within each tier (see sort below).
              isFresh: { $cond: [{ $gte: ['$discoveredAt', freshCutoff] }, 1, 0] },
            },
          },
          { $match: postFilter },
          { $sort: { isFresh: -1, matchScore: -1 } },
          { $project: { embedding: 0, isFresh: 0 } },
          {
            $facet: {
              page: [{ $skip: offset }, { $limit: limit }],
              count: [{ $count: 'n' }],
            },
          },
        ])
        .toArray()

      const page = ((result?.page ?? []) as Array<Job & { matchScore: number }>).map(roundScore)
      const total = (result?.count?.[0]?.n as number | undefined) ?? 0
      return { jobs: page, total }
    } catch (reason) {
      vectorSearchUnavailable = true
      const message = reason instanceof Error ? reason.message : String(reason)
      console.warn(`$vectorSearch unavailable (${message}); using in-memory cosine fallback.`)
    }
  }

  // Fallback — rank the filtered, embedded jobs in Node.
  const candidates = await jobs.find({ ...postFilter, embedding: { $type: 'array' } }).toArray()
  const ranked = candidates
    .map((job) => {
      const { embedding, ...rest } = job
      const matchScore = cosineToUnitScore(cosineSimilarity(queryVector, embedding as number[])) * 100
      return roundScore({ ...(rest as Job), matchScore })
    })
    // Mirror the Atlas path: fresh tier first, then match score within each tier.
    .sort((a, b) => {
      const freshDelta = Number(isFreshJob(b)) - Number(isFreshJob(a))
      return freshDelta !== 0 ? freshDelta : b.matchScore - a.matchScore
    })
  return { jobs: ranked.slice(offset, offset + limit), total: ranked.length }
}
