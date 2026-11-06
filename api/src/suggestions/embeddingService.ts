import { createHash } from 'crypto'
import { ObjectId, type Db } from 'mongodb'
import type { Job, Profile } from '@job-hunter/shared'
import { UNSCORED_JOB_SOURCE_IDS } from '@job-hunter/shared'
import { isWithinBudget, recordUsage } from '../scoring/aiUsageService.js'
import type { Embedder } from '../embeddings/embeddingProvider.js'
import { jobEmbeddingText, profileEmbeddingText } from './embeddingText.js'
import { SUGGESTIBLE_JOB_STATUSES } from './vectorSearch.js'

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
  // Jobs whose embedding call failed even when retried individually (e.g. still over the
  // token limit) — skipped so they never block the rest of the run.
  failed: number
}

// Embeds suggestible jobs (see SUGGESTIBLE_JOB_STATUSES) whose embedding is missing or stale
// (the embedded text's hash changed). Budget-gated and usage-recorded exactly like runScoring.
// `force` re-embeds every eligible job regardless of hash (used by the reindex endpoint, e.g.
// after a model change). `limit` bounds how many are embedded in this call.
export async function embedJobs(
  db: Db,
  embedder: Embedder,
  options: { force?: boolean; limit?: number } = {}
): Promise<EmbedJobsResult> {
  const { force = false, limit } = options
  const jobs = db.collection<Job>('jobs')

  const query: Record<string, unknown> = {
    status: { $in: SUGGESTIBLE_JOB_STATUSES },
    sourceId: { $nin: UNSCORED_JOB_SOURCE_IDS },
  }
  // Lazy top-up (non-force) only needs jobs that have never been embedded. Restricting the
  // query to those keeps the common GET /suggestions path from loading the whole feed every
  // call; a full re-embed to catch changed descriptions is the (force) reindex endpoint's job.
  if (!force) query.embeddingHash = null

  // Never load the stored embedding arrays (1536 floats each) — we only need the source fields
  // to recompute the text + hash, so projecting them out keeps this scan light.
  const candidates = await jobs.find(query, { projection: { embedding: 0 } }).toArray()

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
    // embeddingHash is only ever set together with a stored embedding, so a matching hash means
    // this job is already embedded with the current text — no need to read the vector back.
    if (!force && job.embeddingHash === hash) {
      skipped += 1
      continue
    }
    pending.push({ job, text, hash })
  }

  const slice = typeof limit === 'number' ? pending.slice(0, limit) : pending

  let embedded = 0
  let deferred = 0
  let failed = 0

  const persist = async (item: { job: Job; hash: string }, vector: number[]) => {
    await jobs.updateOne(
      { sourceId: item.job.sourceId, sourceJobId: item.job.sourceJobId },
      {
        $set: {
          embedding: vector,
          embeddingModel: embedder.model,
          embeddingHash: item.hash,
          embeddedAt: new Date().toISOString(),
        },
      }
    )
    embedded += 1
  }

  for (let i = 0; i < slice.length; i += EMBED_BATCH_SIZE) {
    if (!(await isWithinBudget(db))) {
      deferred = slice.length - embedded - failed
      break
    }
    const batch = slice.slice(i, i + EMBED_BATCH_SIZE)
    try {
      const { vectors, usage } = await embedder.embed(batch.map((b) => b.text))
      await recordUsage(db, { inputTokens: usage.inputTokens, outputTokens: 0 }, embedder.model)
      for (let j = 0; j < batch.length; j += 1) await persist(batch[j], vectors[j])
    } catch (reason) {
      // A single malformed/over-limit input rejects the whole batch request. Fall back to
      // embedding each item alone so one bad job can't block the rest; skip any that still fail.
      console.warn(
        `Batch embed failed (${reason instanceof Error ? reason.message : String(reason)}); retrying items individually.`
      )
      for (const item of batch) {
        try {
          const { vectors, usage } = await embedder.embed([item.text])
          await recordUsage(db, { inputTokens: usage.inputTokens, outputTokens: 0 }, embedder.model)
          await persist(item, vectors[0])
        } catch (itemReason) {
          failed += 1
          // Tombstone the job: record the hash with a null embedding so the lazy (missing-only)
          // pass won't retry it every request. It'll be retried only if its text — and thus its
          // hash — changes, or via a force reindex.
          await jobs.updateOne(
            { sourceId: item.job.sourceId, sourceJobId: item.job.sourceJobId },
            { $set: { embedding: null, embeddingModel: embedder.model, embeddingHash: item.hash, embeddedAt: new Date().toISOString() } }
          )
          console.warn(
            `Skipped job ${item.job.sourceId}:${item.job.sourceJobId} — embed failed: ${
              itemReason instanceof Error ? itemReason.message : String(itemReason)
            }`
          )
        }
      }
    }
  }

  return { checked: candidates.length, embedded, skipped, deferred, failed }
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
