import { createHash } from 'crypto'
import { ObjectId, type Db } from 'mongodb'
import type { Job, Profile } from '@job-hunter/shared'
import { UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'
import { isWithinBudget, recordUsage } from '../scoring/aiUsageService.js'
import type { Embedder } from '../embeddings/embeddingProvider.js'
import { jobEmbeddingText, profileEmbeddingText } from './embeddingText.js'

// How many unembedded jobs to embed per batch / per lazy top-up request. Keeps a single
// embed call (and its cost) bounded while still making steady progress across requests.
const EMBED_BATCH_SIZE = 100

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export interface EmbedJobsResult {
  checked: number
  embedded: number
  skipped: number
  deferred: number
}

// Embeds verified, scoreable jobs whose embedding is missing or stale (the embedded text's
// hash changed). Budget-gated and usage-recorded exactly like runScoring. `force` re-embeds
// every verified job regardless of hash (used by the reindex endpoint, e.g. after a model
// change). `limit` bounds how many are embedded in this call.
export async function embedJobs(
  db: Db,
  embedder: Embedder,
  options: { force?: boolean; limit?: number } = {}
): Promise<EmbedJobsResult> {
  const { force = false, limit } = options
  const jobs = db.collection<Job>('jobs')

  const candidates = await jobs
    .find({ status: 'verified', sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS } })
    .toArray()

  // Decide what actually needs embedding (missing, stale, or forced) before spending budget.
  const pending: Array<{ job: Job; text: string; hash: string }> = []
  let skipped = 0
  for (const job of candidates) {
    const text = jobEmbeddingText(job)
    if (!text) {
      skipped += 1
      continue
    }
    const hash = hashText(`${embedder.model}:${text}`)
    if (!force && job.embeddingHash === hash && Array.isArray(job.embedding)) {
      skipped += 1
      continue
    }
    pending.push({ job, text, hash })
  }

  const slice = typeof limit === 'number' ? pending.slice(0, limit) : pending

  let embedded = 0
  let deferred = 0
  for (let i = 0; i < slice.length; i += EMBED_BATCH_SIZE) {
    if (!(await isWithinBudget(db))) {
      deferred = slice.length - embedded
      break
    }
    const batch = slice.slice(i, i + EMBED_BATCH_SIZE)
    const { vectors, usage } = await embedder.embed(batch.map((b) => b.text))
    await recordUsage(db, { inputTokens: usage.inputTokens, outputTokens: 0 }, embedder.model)

    const now = new Date().toISOString()
    for (let j = 0; j < batch.length; j += 1) {
      const { job, hash } = batch[j]
      await jobs.updateOne(
        { sourceId: job.sourceId, sourceJobId: job.sourceJobId },
        {
          $set: {
            embedding: vectors[j],
            embeddingModel: embedder.model,
            embeddingHash: hash,
            embeddedAt: now,
          },
        }
      )
      embedded += 1
    }
  }

  return { checked: candidates.length, embedded, skipped, deferred }
}

// Ensures the given profile has a current resume embedding, computing and caching it when
// missing or stale, and returns the vector. Returns null when there is nothing to embed
// (empty resume + no cvText) or the AI budget is exhausted. Best-effort by contract: callers
// should treat a null/throw as "no semantic ranking available", never as a hard failure.
export async function embedProfile(
  db: Db,
  profileId: string,
  embedder: Embedder
): Promise<number[] | null> {
  const profiles = db.collection<Profile>('profiles')
  const profile = (await profiles.findOne({ _id: new ObjectId(profileId) as unknown as never })) as
    | Profile
    | null
  if (!profile) return null

  const text = profileEmbeddingText(profile)
  if (!text) return null

  const hash = hashText(`${embedder.model}:${text}`)
  if (profile.resumeEmbeddingHash === hash && Array.isArray(profile.resumeEmbedding)) {
    return profile.resumeEmbedding
  }

  if (!(await isWithinBudget(db))) return null

  const { vectors, usage } = await embedder.embed([text])
  await recordUsage(db, { inputTokens: usage.inputTokens, outputTokens: 0 }, embedder.model)
  const vector = vectors[0]

  await profiles.updateOne(
    { _id: new ObjectId(profileId) as unknown as never },
    {
      $set: {
        resumeEmbedding: vector,
        resumeEmbeddingModel: embedder.model,
        resumeEmbeddingHash: hash,
        resumeEmbeddedAt: new Date().toISOString(),
      },
    }
  )
  return vector
}
