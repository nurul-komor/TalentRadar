import type { Db } from 'mongodb'
import type { Job, JobSourceId } from '@job-hunter/shared'
import { UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'

export const VECTOR_INDEX_NAME = 'jobs_embedding_index'

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

function cosineSimilarity(a: number[], b: number[]): number {
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
                status: 'verified',
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
      status: 'verified',
      sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS },
      embedding: { $type: 'array' },
    })
    .toArray()

  return embedded
    .map((job) => ({ job, similarity: cosineSimilarity(queryVector, job.embedding as number[]) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}
